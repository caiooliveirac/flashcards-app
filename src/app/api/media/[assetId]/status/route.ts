import { NextResponse } from "next/server";
import { z } from "zod";
import { getAssetStatus, MediaNotFoundError } from "@/features/media/service";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

/** Status do processamento do asset (polling do editor após o confirm). */
export async function GET(
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
    const status = await getAssetStatus(session.user.id, { assetId });
    return NextResponse.json(status);
  } catch (err) {
    if (err instanceof MediaNotFoundError) {
      return NextResponse.json({ error: "não encontrado" }, { status: 404 });
    }
    throw err;
  }
}
