import { and, eq, exists, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLogs, mediaAssets, mediaReferences } from "@/db/schema";
import { MEDIA_ORPHAN_GRACE_HOURS, MEDIA_STAGING_GRACE_HOURS } from "@/lib/jobs/types";
import { finalKey, stagingKey, thumbnailKey } from "@/lib/storage/types";
import type { MediaHandlerDeps } from "./media-validate";

/**
 * GC de mídia (§10, R13 — Magalu não tem lifecycle/event notifications, a
 * limpeza é toda nossa). Idempotente: roda de hora em hora pelo schedule do
 * worker e pode ser disparado manualmente (fila media.gc).
 */

/** Staging remanescente de assets 'failed' é varrida após 7 dias (linha fica p/ auditoria). */
const FAILED_STAGING_RETENTION_DAYS = 7;

const HOUR_MS = 3_600_000;

export async function handleMediaGc(deps: MediaHandlerDeps): Promise<void> {
  const now = Date.now();
  await gcStalePending(deps, new Date(now - MEDIA_STAGING_GRACE_HOURS * HOUR_MS));
  await gcOrphanReady(deps, new Date(now - MEDIA_ORPHAN_GRACE_HOURS * HOUR_MS));
  await gcFailedStaging(deps, new Date(now - FAILED_STAGING_RETENTION_DAYS * 24 * HOUR_MS));
}

/** a) 'pending' além da carência: upload nunca confirmado/validado => failed + staging fora. */
async function gcStalePending(deps: MediaHandlerDeps, cutoff: Date): Promise<void> {
  const stale = await deps.clients.withServiceTransaction((tx) =>
    tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.status, "pending"), lt(mediaAssets.createdAt, cutoff))),
  );
  for (const { id } of stale) {
    await deps.storage.delete(stagingKey(id));
    await deps.clients.withServiceTransaction(async (tx) => {
      const [updated] = await tx
        .update(mediaAssets)
        .set({ status: "failed" })
        .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "pending")))
        .returning({ id: mediaAssets.id });
      if (updated) {
        await tx.insert(auditLogs).values({
          actorUserId: null,
          action: "media.gc_staging",
          entityType: "media_asset",
          entityId: id,
        });
      }
    });
  }
}

/**
 * b) 'ready' órfão (sem NENHUMA media_reference): MARK-AND-SWEEP com
 * orphan_seen_at — a carência conta a partir da orfandade OBSERVADA, não do
 * created_at (imagem removida de uma nota não pode morrer na varredura da hora
 * seguinte). mark: órfão vira orphan_seen_at = now(); referenciado com marca
 * residual volta a NULL. sweep: só coleta quem está marcado há mais que a
 * carência E segue órfão no recheck.
 */
async function gcOrphanReady(deps: MediaHandlerDeps, cutoff: Date): Promise<void> {
  const hasReference = (tx: Tx) =>
    tx
      .select({ one: sql`1` })
      .from(mediaReferences)
      .where(eq(mediaReferences.mediaAssetId, mediaAssets.id));

  // MARK: registra QUANDO a orfandade foi observada; referência que reapareceu
  // limpa a marca (o relógio da carência zera).
  await deps.clients.withServiceTransaction(async (tx) => {
    await tx
      .update(mediaAssets)
      .set({ orphanSeenAt: new Date() })
      .where(
        and(
          eq(mediaAssets.status, "ready"),
          isNull(mediaAssets.deletedAt),
          isNull(mediaAssets.orphanSeenAt),
          notExists(hasReference(tx)),
        ),
      );
    await tx
      .update(mediaAssets)
      .set({ orphanSeenAt: null })
      .where(
        and(
          eq(mediaAssets.status, "ready"),
          isNull(mediaAssets.deletedAt),
          isNotNull(mediaAssets.orphanSeenAt),
          exists(hasReference(tx)),
        ),
      );
  });

  // SWEEP: coleta só quem está marcado além da carência e segue órfão.
  await deps.clients.withServiceTransaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        ownerUserId: mediaAssets.ownerUserId,
        thumbnailKey: mediaAssets.thumbnailKey,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.status, "ready"),
          isNull(mediaAssets.deletedAt),
          lt(mediaAssets.orphanSeenAt, cutoff),
          notExists(hasReference(tx)),
        ),
      )
      .for("update");
    if (candidates.length === 0) {
      return;
    }

    // RECHECK obrigatório num SEGUNDO statement (snapshot fresco em READ
    // COMMITTED): o FOR UPDATE acima NÃO impede a corrida — um INSERT de
    // media_references só toma FOR KEY SHARE na linha do asset; se ele commitou
    // entre o snapshot do statement acima e a aquisição do lock, o statement
    // acima ainda devolve o asset como órfão. Só um snapshot novo enxerga a
    // referência recém-commitada.
    const stillReferenced = await tx
      .select({ mediaAssetId: mediaReferences.mediaAssetId })
      .from(mediaReferences)
      .where(
        inArray(
          mediaReferences.mediaAssetId,
          candidates.map((c) => c.id),
        ),
      );
    const referencedIds = new Set(stillReferenced.map((r) => r.mediaAssetId));

    const rescued = candidates.filter((c) => referencedIds.has(c.id));
    if (rescued.length > 0) {
      await tx
        .update(mediaAssets)
        .set({ orphanSeenAt: null })
        .where(
          inArray(
            mediaAssets.id,
            rescued.map((c) => c.id),
          ),
        );
    }

    const orphans = candidates.filter((c) => !referencedIds.has(c.id));
    if (orphans.length === 0) {
      return;
    }

    await tx
      .update(mediaAssets)
      .set({ deletedAt: new Date() })
      .where(
        inArray(
          mediaAssets.id,
          orphans.map((o) => o.id),
        ),
      );

    for (const orphan of orphans) {
      // Deletes de objeto dentro da tx: falha de I/O => rollback da marcação =>
      // a próxima varredura horária retenta (delete de key inexistente é no-op).
      await deps.storage.delete(finalKey(orphan.ownerUserId, orphan.id));
      await deps.storage.delete(
        orphan.thumbnailKey ?? thumbnailKey(orphan.ownerUserId, orphan.id),
      );
      // Staging residual (delete best-effort pós-validação pode ter falhado).
      await deps.storage.delete(stagingKey(orphan.id));
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: "media.gc_orphan",
        entityType: "media_asset",
        entityId: orphan.id,
      });
    }
  });
}

/**
 * c) 'failed' antigos: staging + resíduos de execuções antigas na key final e
 * na thumbnail saem (no-op para keys inexistentes); a linha fica para auditoria.
 */
async function gcFailedStaging(deps: MediaHandlerDeps, cutoff: Date): Promise<void> {
  const failed = await deps.clients.withServiceTransaction((tx) =>
    tx
      .select({ id: mediaAssets.id, ownerUserId: mediaAssets.ownerUserId })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.status, "failed"), lt(mediaAssets.createdAt, cutoff))),
  );
  for (const { id, ownerUserId } of failed) {
    await deps.storage.delete(stagingKey(id));
    await deps.storage.delete(finalKey(ownerUserId, id));
    await deps.storage.delete(thumbnailKey(ownerUserId, id));
  }
}
