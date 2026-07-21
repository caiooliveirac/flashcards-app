import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServableAsset } from "@/features/media/service";
import { getStorage } from "@/lib/storage";

import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Serve um asset `ready` do usuário ("?thumb=1" para a thumbnail). s3 =>
 * redirect 302 para presigned GET curto; local => streaming autenticado.
 * Qualquer outro caso => 404 uniforme (nunca 403 — não vaza existência).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ assetId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }
  const thumb = request.nextUrl.searchParams.get("thumb") === "1";

  const asset = await getServableAsset(session.user.id, { assetId, thumb });
  if (!asset) {
    return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  }

  const storage = getStorage();
  const target = await storage.createDownloadTarget(asset.key, { expiresSeconds: 600 });

  if (target.mode === "redirect") {
    return NextResponse.redirect(target.url, 302);
  }

  const stream = await storage.getStream(asset.key);
  return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
