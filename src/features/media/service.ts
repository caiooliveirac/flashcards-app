import { randomUUID } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, mediaAssets } from "@/db/schema";
import { getJobEnqueuer, QUEUES, type JobEnqueuer } from "@/lib/jobs";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  finalKey,
  getStorage,
  mediaMaxBytes,
  stagingKey,
  type UploadTarget,
} from "@/lib/storage";

/**
 * Serviço de mídia (arquitetura §10): registro → upload em staging → confirm
 * (enfileira validação real no worker) → serving só de asset `ready`.
 * userId vem SEMPRE da sessão; além da RLS, toda query filtra ownerUserId
 * explicitamente (autorização na camada de serviço — RLS é rede de segurança).
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Entrada inválida (mime/limite) — rotas mapeiam para 400. */
export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

/** Asset inexistente, de outro usuário ou em status incompatível — rotas mapeiam para 404 (nunca 403: não vaza existência). */
export class MediaNotFoundError extends Error {
  constructor(message = "mídia não encontrada") {
    super(message);
    this.name = "MediaNotFoundError";
  }
}

/** Limites baratos por usuário — rotas mapeiam para 429 (protege storage e fila de validação). */
export class MediaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRateLimitError";
  }
}

export const MAX_UPLOADS_PER_HOUR = 30;
export const MAX_PENDING_UPLOADS = 20;

const ONE_HOUR_MS = 3_600_000;

export interface RequestUploadInput {
  fileName?: string;
  declaredMime: string;
  declaredBytes: number;
}

export interface RequestUploadResult {
  assetId: string;
  target: UploadTarget;
}

export async function requestUpload(
  userId: string,
  input: RequestUploadInput,
  runUser: UserRunner = withUserTransaction,
): Promise<RequestUploadResult> {
  const { fileName, declaredMime, declaredBytes } = input;

  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    throw new MediaValidationError(
      `tipo de arquivo não permitido: "${declaredMime}" (aceitos: ${ALLOWED_IMAGE_MIME_TYPES.join(", ")})`,
    );
  }
  const maxBytes = mediaMaxBytes();
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
    throw new MediaValidationError("tamanho declarado inválido");
  }
  if (declaredBytes > maxBytes) {
    throw new MediaValidationError(
      `arquivo excede o limite de ${maxBytes} bytes (declarado: ${declaredBytes})`,
    );
  }

  // id gerado na aplicação: a storage_key final precisa dele antes do INSERT.
  const assetId = randomUUID();

  await runUser(userId, async (tx) => {
    // Rate limit barato NA MESMA tx do INSERT: contagens e inserção enxergam o
    // mesmo estado — sem infra extra (Redis etc.), suficiente contra abuso.
    const [hourly] = await tx
      .select({ total: count() })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.ownerUserId, userId),
          gt(mediaAssets.createdAt, new Date(Date.now() - ONE_HOUR_MS)),
        ),
      );
    if ((hourly?.total ?? 0) >= MAX_UPLOADS_PER_HOUR) {
      throw new MediaRateLimitError(
        `limite de ${MAX_UPLOADS_PER_HOUR} uploads por hora atingido — aguarde um pouco antes de enviar novas imagens`,
      );
    }
    const [pending] = await tx
      .select({ total: count() })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.ownerUserId, userId),
          eq(mediaAssets.status, "pending"),
          isNull(mediaAssets.deletedAt),
        ),
      );
    if ((pending?.total ?? 0) >= MAX_PENDING_UPLOADS) {
      throw new MediaRateLimitError(
        `você já tem ${MAX_PENDING_UPLOADS} uploads aguardando validação — conclua-os ou aguarde antes de enviar novas imagens`,
      );
    }

    await tx.insert(mediaAssets).values({
      id: assetId,
      ownerUserId: userId,
      storageKey: finalKey(userId, assetId),
      mimeType: declaredMime,
      byteSize: declaredBytes,
      status: "pending",
    });
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "media.request_upload",
      entityType: "media_asset",
      entityId: assetId,
      metadata: { fileName: fileName ?? null, declaredMime, declaredBytes },
    });
  });

  // Fora da tx: presigned/target não depende do banco e não deve segurar conexão.
  const target = await getStorage().createUploadTarget(stagingKey(assetId), {
    expiresSeconds: 60,
    contentType: declaredMime,
  });

  return { assetId, target };
}

export async function confirmUpload(
  userId: string,
  input: { assetId: string },
  enqueuer?: JobEnqueuer,
  runUser: UserRunner = withUserTransaction,
): Promise<{ status: "validating" }> {
  const { assetId } = input;

  const firstConfirm = await runUser(userId, async (tx) => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        status: mediaAssets.status,
        confirmedAt: mediaAssets.confirmedAt,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, userId)))
      .limit(1);
    if (!asset || asset.status !== "pending") {
      throw new MediaNotFoundError();
    }
    // Idempotente: já confirmado => mantém o PRIMEIRO confirmed_at e NÃO
    // re-enfileira (o singleton do pg-boss só dedup na janela de 60s).
    if (asset.confirmedAt !== null) {
      return false;
    }
    // isNull no WHERE: se um confirm concorrente venceu entre o SELECT acima e
    // este UPDATE, 0 linhas => também não re-enfileira.
    const [updated] = await tx
      .update(mediaAssets)
      .set({ confirmedAt: new Date() })
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerUserId, userId),
          isNull(mediaAssets.confirmedAt),
        ),
      )
      .returning({ id: mediaAssets.id });
    if (!updated) {
      return false;
    }
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "media.confirm",
      entityType: "media_asset",
      entityId: assetId,
    });
    return true;
  });

  if (firstConfirm) {
    // Depois do COMMIT: o worker precisa enxergar o asset ao processar o job.
    const jobs = enqueuer ?? (await getJobEnqueuer());
    await jobs.enqueue(
      QUEUES.mediaValidate,
      { assetId },
      { singletonKey: assetId, singletonSeconds: 60 },
    );
  }

  return { status: "validating" };
}

export interface MediaAssetStatus {
  status: "pending" | "ready" | "failed";
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

export async function getAssetStatus(
  userId: string,
  input: { assetId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<MediaAssetStatus> {
  const { assetId } = input;
  return runUser(userId, async (tx) => {
    const [asset] = await tx
      .select({
        status: mediaAssets.status,
        width: mediaAssets.width,
        height: mediaAssets.height,
        mimeType: mediaAssets.mimeType,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, userId)))
      .limit(1);
    if (!asset) throw new MediaNotFoundError();
    return asset;
  });
}

/**
 * Usado pela rota PUT de upload (driver local): garante asset do usuário em
 * `pending` e AINDA NÃO confirmado — depois do confirm a staging pertence ao
 * worker; aceitar re-upload reabriria o TOCTOU que a validação fecha.
 */
export async function getPendingUploadAsset(
  userId: string,
  input: { assetId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<{ assetId: string }> {
  const { assetId } = input;
  return runUser(userId, async (tx) => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        status: mediaAssets.status,
        confirmedAt: mediaAssets.confirmedAt,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerUserId, userId)))
      .limit(1);
    if (!asset || asset.status !== "pending" || asset.confirmedAt !== null) {
      throw new MediaNotFoundError();
    }
    return { assetId: asset.id };
  });
}

export interface ServableAsset {
  key: string;
  mimeType: string;
}

/**
 * Key servível de um asset `ready` do usuário — null caso contrário (a rota
 * devolve 404 uniforme; asset pending/failed/inexistente/alheio é indistinguível).
 */
export async function getServableAsset(
  userId: string,
  input: { assetId: string; thumb?: boolean },
  runUser: UserRunner = withUserTransaction,
): Promise<ServableAsset | null> {
  const { assetId, thumb } = input;
  return runUser(userId, async (tx) => {
    const [asset] = await tx
      .select({
        status: mediaAssets.status,
        storageKey: mediaAssets.storageKey,
        thumbnailKey: mediaAssets.thumbnailKey,
        mimeType: mediaAssets.mimeType,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerUserId, userId),
          // Defesa: soft-deletado (GC) => 404 uniforme, nunca 500 de ENOENT ao
          // tentar servir um objeto que já saiu do storage.
          isNull(mediaAssets.deletedAt),
        ),
      )
      .limit(1);
    if (!asset || asset.status !== "ready") return null;
    if (thumb) {
      // Thumbnail é gerada pelo worker; sem thumbnail_key não há o que servir.
      if (!asset.thumbnailKey) return null;
      return { key: asset.thumbnailKey, mimeType: "image/webp" };
    }
    return { key: asset.storageKey, mimeType: asset.mimeType ?? "application/octet-stream" };
  });
}
