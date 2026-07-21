import { createDbClients } from "@/db/client";
import { QUEUES, type MediaValidatePayload } from "@/lib/jobs/types";
import { startWorkerBoss } from "@/lib/jobs/worker-boss";
import { getStorage } from "@/lib/storage";
import { handleMediaGc } from "./handlers/media-gc";
import { handleMediaValidate, type MediaHandlerDeps } from "./handlers/media-validate";

/**
 * Entrypoint do worker (processo Node puro, PM2 fork — NADA de Next aqui).
 * Bundle: scripts/build-worker.mjs => dist/worker.js (D22).
 * Orçamento de conexões (§6.1): pool app 2 + pool service 2 + pg-boss 5.
 */

function log(event: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ src: "worker", event, pid: process.pid, ...extra }));
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL_APP;
  const serviceUrl = process.env.DATABASE_URL_SERVICE;
  if (!appUrl || !serviceUrl) {
    throw new Error(
      "DATABASE_URL_APP e DATABASE_URL_SERVICE precisam estar definidas para o worker",
    );
  }

  // Defaults DO WORKER: 2/2 (a web usa 6/2) — explícitos aqui (§6.1).
  const clients = createDbClients({
    appUrl,
    serviceUrl,
    appPoolMax: Number(process.env.DATABASE_POOL_MAX_APP ?? 2),
    servicePoolMax: Number(process.env.DATABASE_POOL_MAX_SERVICE ?? 2),
  });
  const deps: MediaHandlerDeps = { storage: getStorage(), clients };

  const boss = await startWorkerBoss();

  // createQueue é idempotente (upsert) — v12 exige fila explícita antes do send.
  await boss.createQueue(QUEUES.mediaValidate, { retryLimit: 3, retryBackoff: true });
  // GC é agendado de hora em hora: sem retry (a próxima varredura cobre).
  await boss.createQueue(QUEUES.mediaGc, { retryLimit: 0 });

  // v12: o handler de work() recebe ARRAY de jobs.
  await boss.work<MediaValidatePayload>(
    QUEUES.mediaValidate,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await handleMediaValidate(job.data.assetId, deps);
      }
    },
  );
  await boss.work(QUEUES.mediaGc, { batchSize: 1 }, async () => {
    await handleMediaGc(deps);
  });

  // Minuto :17 fixo — fora dos picos de hora cheia do cluster compartilhado.
  await boss.schedule(QUEUES.mediaGc, "17 * * * *", {}, { tz: "UTC" });

  log("started", { queues: Object.values(QUEUES), storage: deps.storage.kind });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log("stopping", { signal });
    try {
      // v12: stop() só resolve após o shutdown; graceful espera jobs ativos
      // até o timeout (< kill_timeout de 30s do PM2).
      await boss.stop({ graceful: true, timeout: 25_000 });
    } finally {
      await clients.end();
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      log("stop_error", { error: String(error) });
      process.exit(1);
    });
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      log("stop_error", { error: String(error) });
      process.exit(1);
    });
  });
}

main().catch((error) => {
  console.error(
    JSON.stringify({ src: "worker", event: "fatal", pid: process.pid, error: String(error) }),
  );
  process.exit(1);
});
