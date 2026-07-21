import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPendingUploadAsset, MediaNotFoundError } from "@/features/media/service";
import { getStorage, mediaMaxBytes, stagingKey } from "@/lib/storage";

import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/** Erro sentinela do cap de bytes — vira 413, nunca 500. */
class ByteLimitError extends Error {
  constructor() {
    super("limite de bytes excedido");
    this.name = "ByteLimitError";
  }
}

/**
 * Upload server-side — SÓ para o driver local (no s3 o browser sobe direto na
 * URL presigned; aqui é 404). Streaming do corpo para a key de STAGING com cap
 * duro de bytes: exceder aborta, apaga o parcial e devolve 413. A validação
 * real (magic bytes, tamanho, thumbnail) é do worker após o confirm.
 */
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const storage = getStorage();
  if (storage.kind !== "local") {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  try {
    await getPendingUploadAsset(session.user.id, { assetId });
  } catch (err) {
    if (err instanceof MediaNotFoundError) {
      return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    }
    throw err;
  }

  if (!request.body) {
    return NextResponse.json({ error: "corpo vazio" }, { status: 400 });
  }

  const maxBytes = mediaMaxBytes();
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return NextResponse.json(
      { error: `arquivo excede o limite de ${maxBytes} bytes` },
      { status: 413 },
    );
  }

  // Cap DURO independente do Content-Length: conta bytes reais do stream e
  // aborta no byte maxBytes+1 — o driver nunca materializa mais que isso.
  const source = Readable.fromWeb(request.body as unknown as NodeWebReadableStream<Uint8Array>);
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      if (total > maxBytes) callback(new ByteLimitError());
      else callback(null, chunk);
    },
  });

  const key = stagingKey(assetId);
  try {
    await storage.putObject(key, source.pipe(limiter));
  } catch (err) {
    source.destroy();
    // Escrita é atômica (tmp+rename), mas um retry pode ter deixado staging
    // antiga — delete idempotente garante que nada parcial sobrevive.
    await storage.delete(key);
    if (err instanceof ByteLimitError) {
      return NextResponse.json(
        { error: `arquivo excede o limite de ${maxBytes} bytes` },
        { status: 413 },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
