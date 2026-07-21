import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NoteEditorScreen } from "@/features/editor/note-editor-screen";
import { getDeck, type DeckWithSettings } from "@/features/decks/service";
import { listTags } from "@/features/tags/service";
import { auth } from "@/lib/auth";
import { mediaMaxBytes } from "@/lib/storage/types";

/**
 * Criação contínua de cards (aceite F2#1: 5 cards básicos < 60s sem mouse).
 * Server page valida sessão + ownership do deck; o editor é client.
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
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/decks/${deckId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← {deck.name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Adicionar cards</h1>
        </div>
      </div>

      <div className="mt-4">
        <NoteEditorScreen
          deckId={deckId}
          deckName={deck.name}
          maxBytes={mediaMaxBytes()}
          tagSuggestions={tags.map((t) => t.name)}
        />
      </div>
    </main>
  );
}
