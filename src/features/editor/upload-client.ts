import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/storage/types";

/**
 * Fluxo de upload de imagem do lado do browser (aceites F2#3/F2#4):
 * POST /api/media → PUT (rota direta local OU URL presigned s3) →
 * POST confirm → poll de status até ready|failed (validação REAL é do worker).
 * Módulo client-safe: só fetch/File — sem imports de servidor.
 */

const ALLOWED: readonly string[] = ALLOWED_IMAGE_MIME_TYPES;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

/** Rejeição ANTES de subir: tipo não-imagem ou acima do limite. null = ok. */
export function validateImageFile(
  file: { type: string; size: number },
  maxBytes: number,
): string | null {
  if (!ALLOWED.includes(file.type)) {
    return "arquivo não é uma imagem suportada — use JPEG, PNG, WebP ou GIF";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "arquivo vazio";
  }
  if (file.size > maxBytes) {
    return `imagem grande demais — o limite é ${formatBytes(maxBytes)}`;
  }
  return null;
}

/** URL de exibição de um asset (rota autenticada; redirect presigned no s3). */
export function mediaUrl(assetId: string, thumb = false): string {
  return thumb
    ? `/api/media/${assetId}?thumb=1`
    : `/api/media/${assetId}`;
}

export type UploadTargetJson =
  | { mode: "direct" }
  | { mode: "presigned-put"; url: string; headers?: Record<string, string>; expiresAt: string };

async function errorFromResponse(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      return (body as { error: string }).error;
    }
  } catch {
    // corpo não-JSON — usa fallback
  }
  return fallback;
}

/** Registra o asset (`pending`) e devolve o alvo de upload. */
export async function requestUpload(file: File): Promise<{
  assetId: string;
  target: UploadTargetJson;
}> {
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name || undefined, mime: file.type, bytes: file.size }),
  });
  if (!res.ok) {
    throw new Error(await errorFromResponse(res, "falha ao iniciar o upload da imagem"));
  }
  return (await res.json()) as { assetId: string; target: UploadTargetJson };
}

/** Sobe o arquivo cru para o alvo (rota local ou presigned PUT). */
export async function uploadToTarget(
  assetId: string,
  target: UploadTargetJson,
  file: File,
): Promise<void> {
  if (target.mode === "direct") {
    const res = await fetch(`/api/media/upload/${assetId}`, { method: "PUT", body: file });
    if (res.status === 413) {
      throw new Error("imagem grande demais — o servidor recusou o upload");
    }
    if (!res.ok) {
      throw new Error(await errorFromResponse(res, "falha no upload da imagem"));
    }
    return;
  }
  const res = await fetch(target.url, {
    method: "PUT",
    headers: target.headers,
    body: file,
  });
  if (!res.ok) {
    throw new Error("falha no upload da imagem para o storage");
  }
}

export async function confirmUpload(assetId: string): Promise<void> {
  const res = await fetch(`/api/media/${assetId}/confirm`, { method: "POST" });
  if (!res.ok) {
    throw new Error(await errorFromResponse(res, "falha ao confirmar o upload da imagem"));
  }
}

export type ProcessingOutcome = "ready" | "failed" | "timeout";

/** Poll de status a cada ~1s até ready|failed (máx ~30s → 'timeout'). */
export async function waitForProcessing(
  assetId: string,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<ProcessingOutcome> {
  const intervalMs = opts?.intervalMs ?? 1000;
  const maxAttempts = opts?.maxAttempts ?? 30;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    let status: string | undefined;
    try {
      const res = await fetch(`/api/media/${assetId}/status`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        status = body.status;
      }
    } catch {
      // falha transitória de rede: tenta de novo no próximo tick
    }
    if (status === "ready") return "ready";
    if (status === "failed") return "failed";
  }
  return "timeout";
}

/** Fluxo completo pós-inserção: PUT + confirm + poll. Lança Error pt-BR em falha de upload. */
export async function uploadAndProcess(
  assetId: string,
  target: UploadTargetJson,
  file: File,
  opts?: { intervalMs?: number; maxAttempts?: number },
): Promise<ProcessingOutcome> {
  await uploadToTarget(assetId, target, file);
  await confirmUpload(assetId);
  return waitForProcessing(assetId, opts);
}
