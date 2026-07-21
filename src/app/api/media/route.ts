import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MediaRateLimitError,
  MediaValidationError,
  requestUpload,
} from "@/features/media/service";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  mime: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
});

/** Registra o asset (`pending`) e devolve o alvo de upload (presigned PUT no s3; rota direta no local). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  try {
    const result = await requestUpload(session.user.id, {
      fileName: parsed.data.fileName,
      declaredMime: parsed.data.mime,
      declaredBytes: parsed.data.bytes,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MediaRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
