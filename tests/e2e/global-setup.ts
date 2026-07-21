import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG_1X1_BASE64 } from "./helpers";

/**
 * Global setup dos E2E:
 * 1. Seed idempotente (usuários e2e / e2e-b, senha 1234) via scripts/seed-e2e.ts.
 * 2. Fixture PNG em tests/e2e/fixtures/pixel.png (upload mobile — F2#4).
 * 3. Worker (src/workers/index.ts) via spawn detached — o worker não abre
 *    porta, então o webServer do Playwright (que exige port/url para
 *    readiness) não serve; readiness é a linha JSON {"event":"started"} no
 *    stdout. PID do process group persistido para o global-teardown.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const TMP_DIR = path.join(ROOT, "tests", "e2e", ".tmp");
const WORKER_PID_FILE = path.join(TMP_DIR, "worker.pid");
const WORKER_LOG_FILE = path.join(TMP_DIR, "worker.log");

function seed(): void {
  const res = spawnSync(
    TSX,
    ["--env-file-if-exists=.env.local", "scripts/seed-e2e.ts"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (res.status !== 0) {
    throw new Error(`seed-e2e falhou (exit ${res.status ?? "signal"})`);
  }
}

function writeFixtures(): void {
  const fixturesDir = path.join(ROOT, "tests", "e2e", "fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });
  fs.writeFileSync(path.join(fixturesDir, "pixel.png"), Buffer.from(PNG_1X1_BASE64, "base64"));
}

async function startWorker(): Promise<void> {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Run anterior abortado pode ter deixado worker vivo — mata antes de subir outro
  // (dois workers disputariam os mesmos jobs pg-boss).
  if (fs.existsSync(WORKER_PID_FILE)) {
    const stale = Number(fs.readFileSync(WORKER_PID_FILE, "utf8"));
    if (Number.isFinite(stale) && stale > 0) {
      try {
        process.kill(-stale, "SIGKILL");
      } catch {
        // já morto
      }
    }
    fs.rmSync(WORKER_PID_FILE, { force: true });
  }

  const logStream = fs.createWriteStream(WORKER_LOG_FILE);
  const child = spawn(TSX, ["--env-file-if-exists=.env.local", "src/workers/index.ts"], {
    cwd: ROOT,
    detached: true, // process group próprio — teardown mata o grupo inteiro
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Mesmos defaults do dev server — web e worker precisam do MESMO diretório.
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: ".data/media",
    },
  });
  if (!child.pid) {
    throw new Error("spawn do worker não devolveu pid");
  }
  fs.writeFileSync(WORKER_PID_FILE, String(child.pid));

  // Readiness: espera a linha {"src":"worker","event":"started"} (máx 30s).
  await new Promise<void>((resolve, reject) => {
    let buffer = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(
        new Error(`worker não ficou pronto em 30s — veja ${WORKER_LOG_FILE}\n${buffer}`),
      );
    }, 30_000);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      buffer += text;
      logStream.write(text);
      if (!done && buffer.includes('"event":"started"')) {
        done = true;
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      logStream.write(chunk);
    });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`worker saiu prematuramente (exit ${code})\n${buffer}`));
    });
  });

  child.unref();
  console.log(`[global-setup] worker pronto (pid ${child.pid})`);
}

export default async function globalSetup(): Promise<void> {
  seed();
  writeFixtures();
  await startWorker();
}
