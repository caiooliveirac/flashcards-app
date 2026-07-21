import type { DbClients } from "@/db/client";
import { aggregateDailyMetrics } from "@/features/review/metrics";

/**
 * Job noturno: agrega review_logs → daily_study_metrics por dia de estudo
 * (§7.4). Roda como flashcards_service (BYPASSRLS) via withServiceTransaction.
 * Idempotente — recomputa os últimos dias por upsert, então rodar de novo (ou
 * disparo manual) é seguro.
 */
export async function handleMetricsAggregate(clients: DbClients): Promise<{ users: number; days: number }> {
  return aggregateDailyMetrics((fn) => clients.withServiceTransaction(fn));
}
