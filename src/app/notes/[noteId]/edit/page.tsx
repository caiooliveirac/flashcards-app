import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NoteEditorScreen } from "@/features/editor/note-editor-screen";
import { getNoteForEdit, type NoteForEdit } from "@/features/editor/queries";
import { getDeck, type DeckWithSettings } from "@/features/decks/service";
import { listTags } from "@/features/tags/service";
import { auth } from "@/lib/auth";
import { noteContentToPmDocs } from "@/lib/editor/parse";
import { mediaMaxBytes } from "@/lib/storage/types";

/**
 * Edição de nota (aceite F2#2): o tipo NÃO muda; o matching por groupKey/
 * fingerprint no service preserva o progresso dos cards que se mantêm.
 */
export default async function EditNotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const userId = session.user.id;
  const { noteId } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(noteId)) {
    notFound();
  }

  let note: NoteForEdit;
  try {
    note = await getNoteForEdit(userId, noteId);
  } catch {
    notFound();
  }

  let deck: DeckWithSettings;
  try {
    deck = await getDeck(userId, { deckId: note.deckId });
  } catch {
    notFound();
  }

  const tags = await listTags(userId);
  const initialDocs = noteContentToPmDocs(note.content);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="min-w-0">
        <Link
          href={`/decks/${note.deckId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {deck.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Editar nota</h1>
      </div>

      <p
        role="note"
        className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
      >
        Editar preserva o progresso dos cards cujo grupo ou conteúdo se mantém; ocultações
        removidas têm os cards desativados (nunca apagados).
      </p>

      <div className="mt-4">
        <NoteEditorScreen
          deckId={note.deckId}
          deckName={deck.name}
          maxBytes={mediaMaxBytes()}
          tagSuggestions={tags.map((t) => t.name)}
          editNote={{
            noteId: note.noteId,
            noteType: note.noteType,
            initialDocs,
            initialTags: note.tagNames,
            clozeGroupKeys: note.clozeGroupKeys,
          }}
        />
      </div>
    </main>
  );
}
