import { PgBoss } from "pg-boss";
import { getDb } from "@/db/runtime";
import type { JobEnqueuer, JobPayloads, QueueName } from "./types";

/**
 * Instância pg-boss SEND-ONLY da web (§6.1): reusa o Pool do service via
 * opção `db` (sem pool novo), supervise/schedule desligados (só o worker
 * supervisiona) e migrate:false (D15 — schema pgboss vem por migration).
 * O worker tem instância própria em src/lib/jobs/worker-boss.ts.
 */

let bossPromise: Promise<PgBoss> | null = null;
const ensuredQueues = new Set<string>();

async function getSendOnlyBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const pool = getDb().serviceRawPool;
      const boss = new PgBoss({
        db: {
          executeSql: (text: string, values?: unknown[]) =>
            pool.query(text, values as never[]),
        },
        schema: "pgboss",
        migrate: false,
        supervise: false,
        schedule: false,
      });
      boss.on("error", (err) => {
        console.error("[pg-boss send-only]", err);
      });
      await boss.start();
      return boss;
    })();
  }
  return bossPromise;
}

async function ensureQueue(boss: PgBoss, queue: QueueName): Promise<void> {
  if (ensuredQueues.has(queue)) return;
  // Idempotente: cria se não existir (v12 exige fila explícita antes do send).
  await boss.createQueue(queue);
  ensuredQueues.add(queue);
}

export async function getJobEnqueuer(): Promise<JobEnqueuer> {
  const boss = await getSendOnlyBoss();
  return {
    async enqueue<Q extends QueueName>(
      queue: Q,
      payload: JobPayloads[Q],
      opts?: {
        singletonKey?: string;
        singletonSeconds?: number;
        startAfterSeconds?: number;
      },
    ): Promise<void> {
      await ensureQueue(boss, queue);
      await boss.send(queue, payload, {
        singletonKey: opts?.singletonKey,
        singletonSeconds: opts?.singletonSeconds,
        startAfter: opts?.startAfterSeconds,
      });
    },
  };
}
