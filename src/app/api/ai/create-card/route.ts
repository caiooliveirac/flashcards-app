import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAiEnabled } from "@/lib/ai/config";
import { createCardFromDraft } from "@/features/assistant/service";

export const runtime = "nodejs";

// Confirmação da criação de card proposto pela IA (§9.2: mutação confirmada na
// UI). O deckId vem da escolha do usuário; ownership é garantido pela RLS dentro
// de createCardFromDraft (userId da sessão, nunca do cliente).
const bodySchema = z.object({
  deckId: z.uuid(),
  kind: z.enum(["basic", "cloze"]),
  front: z.string().max(20000).optional(),
  back: z.string().max(20000).optional(),
  text: z.string().max(20000).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  if (!isAiEnabled()) {
    return NextResponse.json({ error: "IA indisponível" }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "requisição inválida" }, { status: 400 });
  }

  try {
    const result = await createCardFromDraft(session.user.id, body);
    return NextResponse.json(result);
  } catch {
    // rascunho inválido, deck de outro usuário (barrado por RLS), etc.
    return NextResponse.json(
      { error: "Não foi possível criar o card com esse rascunho." },
      { status: 400 },
    );
  }
}
