import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mata o worker subido no global-setup (SIGTERM no process group → o worker
 * faz boss.stop() graceful; SIGKILL de garantia após 5s).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKER_PID_FILE = path.join(ROOT, "tests", "e2e", ".tmp", "worker.pid");

function alive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(WORKER_PID_FILE)) return;
  const pid = Number(fs.readFileSync(WORKER_PID_FILE, "utf8"));
  fs.rmSync(WORKER_PID_FILE, { force: true });
  if (!Number.isFinite(pid) || pid <= 0) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return; // já morto
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && alive(pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (alive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // corrida com a morte natural — ok
    }
  }
  console.log(`[global-teardown] worker (pgid ${pid}) finalizado`);
}
