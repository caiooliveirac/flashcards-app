import { notFound, redirect } from "next/navigation";
import { NoteEditorScreen } from "@/features/editor/note-editor-screen";
import { getDeck, type DeckWithSettings } from "@/features/decks/service";
import { listTags } from "@/features/tags/service";
import { auth } from "@/lib/auth";
import { mediaMaxBytes } from "@/lib/storage/types";

/**
 * Criação contínua de cards (aceite F2#1: 5 cards básicos < 60s sem mouse).
 * Server page valida sessão + ownership do deck; o editor é client.
 * Layout do redesign: barra superior (← deck + contador) e o grid
 * editor 1fr + aside 340px vivem no client (NoteEditorScreen).
 */
export default async function NewNotePage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const userId = session.user.id;
  const { deckId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(deckId)) {
    notFound();
  }

  let deck: DeckWithSettings;
  try {
    deck = await getDeck(userId, { deckId });
  } catch {
    notFound();
  }

  const tags = await listTags(userId);

  return (
    <main className="mx-auto max-w-5xl px-5 py-6">
      <h1 className="sr-only">Adicionar cards</h1>
      <NoteEditorScreen
        deckId={deckId}
        deckName={deck.name}
        backHref={`/decks/${deckId}`}
        maxBytes={mediaMaxBytes()}
        tagSuggestions={tags.map((t) => t.name)}
      />
    </main>
  );
}
