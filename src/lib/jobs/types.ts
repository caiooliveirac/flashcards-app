/**
 * Contratos da fila de jobs (arquitetura §1, D4/D15).
 * Implementação: pg-boss 12 no schema `pgboss` da mesma base, conectando como
 * flashcards_service (o runtime de usuário não enxerga o schema pgboss).
 * A interface é própria para permitir trocar por BullMQ sem tocar no domínio.
 *
 * Topologia: web = instância send-only (supervise:false, schedule:false)
 * reusando o pg.Pool do service; worker = processo PM2 dedicado com start() +
 * work() + schedule() (único com supervise ativo), migrate:false (D15).
 */

export const QUEUES = {
  /** Valida upload confirmado: HEAD tamanho, magic bytes, sha256, thumbnail, staging→final. */
  mediaValidate: "media.validate",
  /** GC: staging órfã/não confirmada + assets ready sem media_references após carência. */
  mediaGc: "media.gc",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MediaValidatePayload {
  assetId: string;
}

/** Payload vazio — job agendado (cron horário) e disparável manualmente. */
export type MediaGcPayload = Record<string, never>;

export interface JobPayloads {
  [QUEUES.mediaValidate]: MediaValidatePayload;
  [QUEUES.mediaGc]: MediaGcPayload;
}

/** API de enfileiramento exposta às features (web). Nunca importar pg-boss fora de lib/jobs. */
export interface JobEnqueuer {
  enqueue<Q extends QueueName>(
    queue: Q,
    payload: JobPayloads[Q],
    opts?: {
      /** Debounce/dedup: só um job por chave por janela. */
      singletonKey?: string;
      singletonSeconds?: number;
      startAfterSeconds?: number;
    },
  ): Promise<void>;
}

/** Carência antes do GC apagar staging não confirmada / asset órfão. */
export const MEDIA_STAGING_GRACE_HOURS = 6;
export const MEDIA_ORPHAN_GRACE_HOURS = 24;
