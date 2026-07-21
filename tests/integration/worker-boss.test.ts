import { randomUUID } from "node:crypto";
import type { Job, PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUEUES, type MediaValidatePayload } from "@/lib/jobs/types";
import { startWorkerBoss } from "@/lib/jobs/worker-boss";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * Instância pg-boss do worker contra o schema pgboss REAL (migration 0005),
 * conectando como flashcards_service — roundtrip send→work e dedup por
 * singletonKey. Os handlers de mídia são testados em worker-media.test.ts.
 */

let db: TestDatabase;
let boss: PgBoss;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  db = await createTestDatabase();
  // O harness só expõe a URL do owner; as roles de teste compartilham a senha.
  const serviceUrl = db.ownerUrl.replace("flashcards_owner", "flashcards_service");
  boss = await startWorkerBoss({ connectionString: serviceUrl, max: 2 });
});

afterAll(async () => {
  await boss.stop({ close: true, graceful: false, timeout: 1000 });
  await db.drop();
});

describe("worker pg-boss (schema pgboss via migration, migrate:false)", () => {
  it("roundtrip: createQueue + send + work entrega o payload em ARRAY (shape v12)", async () => {
    await boss.createQueue(QUEUES.mediaValidate, { retryLimit: 3, retryBackoff: true });

    const received = deferred<Job<MediaValidatePayload>[]>();
    await boss.work<MediaValidatePayload>(
      QUEUES.mediaValidate,
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        received.resolve(jobs);
      },
    );

    const assetId = randomUUID();
    const jobId = await boss.send(QUEUES.mediaValidate, { assetId });
    expect(jobId).not.toBeNull();

    const jobs = await received.promise;
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(QUEUES.mediaValidate);
    expect(jobs[0]?.data).toEqual({ assetId });
  });

  it("singletonKey: 2 sends com a mesma chave na janela => 1 job na fila", async () => {
    await boss.createQueue(QUEUES.mediaGc, { retryLimit: 0 });

    const first = await boss.send(
      QUEUES.mediaGc,
      {},
      { singletonKey: "media-gc", singletonSeconds: 60 },
    );
    const second = await boss.send(
      QUEUES.mediaGc,
      {},
      { singletonKey: "media-gc", singletonSeconds: 60 },
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const rows = await db.ownerQuery<{ n: number }>(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1",
      [QUEUES.mediaGc],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
