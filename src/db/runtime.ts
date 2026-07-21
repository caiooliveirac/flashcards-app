import { createDbClients, type DbClients, type Tx } from "./client";

// Singleton lazy (sobrevive a HMR em dev via globalThis) — os pools só são
// criados no primeiro uso, nunca no build.
const globalForDb = globalThis as unknown as { __flashcardsDb?: DbClients };

export function getDb(): DbClients {
  if (!globalForDb.__flashcardsDb) {
    const appUrl = process.env.DATABASE_URL_APP;
    const serviceUrl = process.env.DATABASE_URL_SERVICE;
    if (!appUrl || !serviceUrl) {
      throw new Error(
        "DATABASE_URL_APP e DATABASE_URL_SERVICE precisam estar definidas (.env.local — ver .env.example)",
      );
    }
    globalForDb.__flashcardsDb = createDbClients({
      appUrl,
      serviceUrl,
      appPoolMax: Number(process.env.DATABASE_POOL_MAX_APP ?? 6),
      servicePoolMax: Number(process.env.DATABASE_POOL_MAX_SERVICE ?? 2),
    });
  }
  return globalForDb.__flashcardsDb;
}

export function withUserTransaction<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return getDb().withUserTransaction(userId, fn);
}

export function withServiceTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().withServiceTransaction(fn);
}
