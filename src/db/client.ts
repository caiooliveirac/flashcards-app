import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbClients {
  /** Pool do role flashcards_app — RLS ativa; use SEMPRE via withUserTransaction. */
  dbApp: Db;
  /** Pool do role flashcards_service — BYPASSRLS restrito; use via withServiceTransaction. */
  dbService: Db;
  /**
   * Pool pg cru do service — EXCLUSIVO para a instância pg-boss send-only da
   * web (opção `db` do construtor, §6.1: reusa conexões em vez de abrir pool
   * novo). Nunca usar para queries de domínio.
   */
  serviceRawPool: Pool;
  withUserTransaction: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  withServiceTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  end: () => Promise<void>;
}

export interface DbConfig {
  appUrl: string;
  serviceUrl: string;
  appPoolMax?: number;
  servicePoolMax?: number;
}

export function createDbClients(config: DbConfig): DbClients {
  const appPool = new Pool({ connectionString: config.appUrl, max: config.appPoolMax ?? 6 });
  const servicePool = new Pool({
    connectionString: config.serviceUrl,
    max: config.servicePoolMax ?? 2,
  });

  const dbApp = drizzle(appPool, { schema });
  const dbService = drizzle(servicePool, { schema });

  async function withUserTransaction<T>(
    userId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!userId) {
      throw new Error("withUserTransaction exige userId da sessão (nunca do cliente)");
    }
    return dbApp.transaction(async (tx) => {
      // Transaction-local (3º arg true): o contexto morre no COMMIT/ROLLBACK —
      // a conexão volta limpa ao pool. db.transaction fixa UMA conexão física
      // para o callback inteiro, então set_config e queries compartilham conexão.
      await tx.execute(
        sql`select set_config('app.current_user_id', ${userId}, true)`,
      );
      return fn(tx);
    });
  }

  async function withServiceTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return dbService.transaction(fn);
  }

  return {
    dbApp,
    dbService,
    serviceRawPool: servicePool,
    withUserTransaction,
    withServiceTransaction,
    end: async () => {
      await appPool.end();
      await servicePool.end();
    },
  };
}
