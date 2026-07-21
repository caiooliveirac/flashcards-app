import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import type { DbClients } from "@/db/client";
import { auditLogs, mediaAssets } from "@/db/schema";
import {
  type AllowedImageMimeType,
  finalKey,
  mediaMaxBytes,
  stagingKey,
  type StorageDriver,
  thumbnailKey,
} from "@/lib/storage/types";

/**
 * Pipeline de validação REAL de mídia (§10, aceite F2#3). O presigned PUT não
 * valida nada — este handler é a única barreira: tamanho via head, magic bytes
 * via range, sha256/dimensões/thumbnail via sharp. A key final é gravada A
 * PARTIR DO BUFFER VALIDADO em memória (nunca copy da staging): um re-PUT
 * concorrente na staging vira irrelevante e sha256/width/height/mime/byteSize
 * batem com o objeto final por construção (mata o TOCTOU de verdade).
 *
 * Falha de VALIDAÇÃO: marca 'failed' + limpa staging + audit, SEM lançar.
 * Falha INESPERADA (I/O): lança e o pg-boss faz retry (asset segue 'pending' e
 * a staging segue intacta — o delete dela só acontece após o commit de 'ready').
 */

export interface MediaHandlerDeps {
  storage: StorageDriver;
  clients: DbClients;
}

const THUMBNAIL_MAX_PX = 512;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Magic bytes reais dos MIMEs aceitos — o detectado prevalece sobre o declarado. */
export function detectImageMime(bytes: Buffer): AllowedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  const ascii = bytes.toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Marca 'failed' + limpa staging + audit 'media.rejected' (validação, não I/O). */
async function rejectAsset(
  deps: MediaHandlerDeps,
  assetId: string,
  reason: string,
): Promise<void> {
  await deps.storage.delete(stagingKey(assetId));
  await deps.clients.withServiceTransaction(async (tx) => {
    const [updated] = await tx
      .update(mediaAssets)
      .set({ status: "failed" })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, "pending")))
      .returning({ id: mediaAssets.id });
    if (updated) {
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: "media.rejected",
        entityType: "media_asset",
        entityId: assetId,
        metadata: { reason },
      });
    }
  });
}

export async function handleMediaValidate(
  assetId: string,
  deps: MediaHandlerDeps,
): Promise<void> {
  const asset = await deps.clients.withServiceTransaction(async (tx) => {
    const [row] = await tx
      .select({
        id: mediaAssets.id,
        ownerUserId: mediaAssets.ownerUserId,
        status: mediaAssets.status,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    return row ?? null;
  });
  // Idempotente: asset inexistente ou já processado (ready/failed) => no-op,
  // então retries do pg-boss são seguros.
  if (!asset || asset.status !== "pending") {
    return;
  }

  const staging = stagingKey(assetId);

  const head = await deps.storage.head(staging);
  if (!head) {
    // Staging nunca subiu (upload não aconteceu antes do confirm).
    await rejectAsset(deps, assetId, "staging_missing");
    return;
  }
  if (head.size > mediaMaxBytes()) {
    await rejectAsset(deps, assetId, "oversize");
    return;
  }

  const magicBytes = await deps.storage.getRange(staging, 0, 15);
  const detectedMime = detectImageMime(magicBytes);
  if (!detectedMime) {
    await rejectAsset(deps, assetId, "invalid_magic_bytes");
    return;
  }

  const body = await readAll(await deps.storage.getStream(staging));
  if (body.length > mediaMaxBytes()) {
    // Cinto e suspensórios: o head já limitou, mas o corpo é a verdade.
    await rejectAsset(deps, assetId, "oversize");
    return;
  }
  const sha256 = createHash("sha256").update(body).digest("hex");

  let width: number;
  let height: number;
  try {
    const metadata = await sharp(body).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("imagem sem dimensões");
    }
    width = metadata.width;
    height = metadata.height;
  } catch {
    // sharp não decodificou => arquivo corrompido (magic bytes podem ser forjados).
    await rejectAsset(deps, assetId, "corrupt_image");
    return;
  }

  let thumbBuffer: Buffer;
  try {
    // SÓ a decodificação/re-encode fica no try: metadata() lê apenas o header,
    // então um PNG truncado (header válido, corpo cortado) só estoura AQUI.
    thumbBuffer = await sharp(body)
      .resize({
        width: THUMBNAIL_MAX_PX,
        height: THUMBNAIL_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    await rejectAsset(deps, assetId, "corrupt_image");
    return;
  }
  // putObject FORA do catch de validação: falha de I/O real deve lançar e ser
  // retentada pelo pg-boss — nunca virar 'failed'.
  const thumbKey = thumbnailKey(asset.ownerUserId, assetId);
  await deps.storage.putObject(thumbKey, thumbBuffer, "image/webp");

  // Key final gravada A PARTIR DO BUFFER JÁ VALIDADO em memória — NUNCA copy
  // da staging: re-PUT concorrente na staging não alcança o objeto final, e
  // sha256/width/height/mime/byteSize batem com ele por construção.
  const destKey = finalKey(asset.ownerUserId, assetId);
  await deps.storage.putObject(destKey, body, detectedMime);

  await deps.clients.withServiceTransaction(async (tx) => {
    const [updated] = await tx
      .update(mediaAssets)
      .set({
        storageKey: destKey,
        mimeType: detectedMime,
        byteSize: body.length,
        sha256,
        width,
        height,
        thumbnailKey: thumbKey,
        status: "ready",
      })
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, "pending")))
      .returning({ id: mediaAssets.id });
    if (updated) {
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: "media.validated",
        entityType: "media_asset",
        entityId: assetId,
      });
    }
  });

  // Staging só sai DEPOIS do commit de 'ready', best-effort: se o UPDATE falhar
  // antes, o retry reexecuta o pipeline inteiro (idempotente) com a staging
  // intacta; se só este delete falhar, o GC varre o resíduo.
  try {
    await deps.storage.delete(staging);
  } catch (error) {
    console.log(
      JSON.stringify({
        src: "worker",
        event: "media_validate_staging_delete_failed",
        assetId,
        error: String(error),
      }),
    );
  }
}
