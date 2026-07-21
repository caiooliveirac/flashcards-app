import { PgBoss } from "pg-boss";

/**
 * Instância pg-boss do PROCESSO WORKER (§6.1, D15): pool próprio (até 5
 * conexões) no role de serviço — o schema `pgboss` é exclusivo dele —,
 * migrate:false (schema aplicado pela migration 0005) e supervise ATIVO
 * (default do construtor): só o worker supervisiona manutenção/cron; a web
 * usa a instância send-only de ./boss.ts (supervise/schedule desligados).
 */

export interface WorkerBossOptions {
  /** Default: process.env.DATABASE_URL_SERVICE. */
  connectionString?: string;
  /** Default: WORKER_PGBOSS_POOL_MAX (env) ou 5. */
  max?: number;
}

function defaultPoolMax(): number {
  const parsed = Number.parseInt(process.env.WORKER_PGBOSS_POOL_MAX ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function createWorkerBoss(options: WorkerBossOptions = {}): PgBoss {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL_SERVICE;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_SERVICE precisa estar definida para o worker (.env — ver .env.example)",
    );
  }
  const boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    max: options.max ?? defaultPoolMax(),
    migrate: false,
    // supervise fica no default (true) de propósito — único processo supervisor.
  });
  boss.on("error", (error) => {
    console.error(
      JSON.stringify({ src: "worker-boss", event: "error", error: String(error) }),
    );
  });
  return boss;
}

export async function startWorkerBoss(options: WorkerBossOptions = {}): Promise<PgBoss> {
  const boss = createWorkerBoss(options);
  await boss.start();
  return boss;
}
