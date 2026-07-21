import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmUpload, MediaNotFoundError } from "@/features/media/service";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/** Confirma o upload: enfileira a validação real no worker (202 = validando). */
export async function POST(
  _request: Request,
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

  try {
    const result = await confirmUpload(session.user.id, { assetId });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof MediaNotFoundError) {
      return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    }
    throw err;
  }
}
