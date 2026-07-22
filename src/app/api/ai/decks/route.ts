import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listDecks } from "@/features/decks/service";

export const runtime = "nodejs";

/** Baralhos do usuário para o seletor de confirmação ao criar card pela IA. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }
  const decks = await listDecks(session.user.id);
  return NextResponse.json(
    decks.map((d) => ({ id: d.id, name: d.name })),
  );
}
