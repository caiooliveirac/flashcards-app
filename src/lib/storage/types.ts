import type { Readable } from "node:stream";

/**
 * Abstração de Object Storage (arquitetura §10, D19/D20).
 * Driver ativo via STORAGE_DRIVER: "local" (filesystem do servidor — fallback
 * enquanto não há API key Magalu, débito) ou "s3" (Magalu Object Storage,
 * presigned PUT/GET; @aws-sdk pinado em 3.677.0 — a API da Magalu rejeita
 * aws-chunked de SDKs >= 3.729).
 *
 * Fluxo de upload (§10): asset `pending` → upload para key de STAGING →
 * confirm → worker valida de verdade (HEAD tamanho, magic bytes via Range,
 * sha256/dimensões/thumbnail via sharp) → copy staging→final (mata TOCTOU) →
 * `ready`. Staging não confirmada é varrida pelo GC.
 */

/** Como o browser deve subir o arquivo. */
export type UploadTarget =
  | {
      /** s3: PUT direto na URL assinada (expiração curta). */
      mode: "presigned-put";
      url: string;
      headers?: Record<string, string>;
      expiresAt: string;
    }
  | {
      /** local: PUT autenticado em /api/media/upload/[assetId] (streaming, cap de bytes). */
      mode: "direct";
    };

/** Como servir o arquivo ao browser. */
export type DownloadTarget =
  | {
      /** s3: redirect para presigned GET de curta duração (300–3600s). */
      mode: "redirect";
      url: string;
    }
  | {
      /** local: a própria rota autenticada faz streaming do objeto. */
      mode: "stream";
    };

export interface StorageDriver {
  readonly kind: "local" | "s3";

  /** Alvo de upload para uma key (staging). expiresSeconds só se aplica a presigned. */
  createUploadTarget(
    key: string,
    opts: { expiresSeconds: number; contentType?: string },
  ): Promise<UploadTarget>;

  /** Escrita server-side (driver local recebe o stream da rota; s3 usa PutObject no fallback). */
  putObject(key: string, body: Readable | Buffer, contentType?: string): Promise<void>;

  /** null se a key não existe. */
  head(key: string): Promise<{ size: number } | null>;

  /** Bytes [start, end] inclusivos (magic bytes no worker). */
  getRange(key: string, start: number, end: number): Promise<Buffer>;

  getStream(key: string): Promise<Readable>;

  copy(srcKey: string, dstKey: string): Promise<void>;

  /** Idempotente: deletar key inexistente não é erro. */
  delete(key: string): Promise<void>;

  createDownloadTarget(
    key: string,
    opts: { expiresSeconds: number },
  ): Promise<DownloadTarget>;
}

// --- Esquema de keys (nome interno aleatório = assetId uuid; §10) ---

export function stagingKey(assetId: string): string {
  return `staging/${assetId}`;
}

export function finalKey(ownerUserId: string, assetId: string): string {
  return `media/${ownerUserId}/${assetId}`;
}

export function thumbnailKey(ownerUserId: string, assetId: string): string {
  return `media/${ownerUserId}/${assetId}.thumb.webp`;
}

// --- Limites e validação (validação REAL é do worker — presigned PUT não valida nada) ---

export const DEFAULT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export function mediaMaxBytes(): number {
  const raw = process.env.MEDIA_MAX_BYTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEDIA_MAX_BYTES;
}

/** MIMEs aceitos, com magic bytes conferidos pelo worker (GET Range). */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
