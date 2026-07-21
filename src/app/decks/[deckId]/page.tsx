import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { deckStatusLabel } from "@/components/decks/deck-status-badge";
import { NotesList, type NoteRow } from "@/features/editor/notes-list";
import { tagsForNotes } from "@/features/editor/queries";
import { getDeck, listDecks, type DeckWithSettings } from "@/features/decks/service";
import { listNotes, searchNotes } from "@/features/notes/service";
import { auth } from "@/lib/auth";

/**
 * Deck detail: lista de notas + busca FTS (aceite F2#7) + CTA de criação.
 * Server component — a busca é um form GET que relê a página com ?q=.
 */

const NOTE_TYPE_LABEL: Record<"basic" | "cloze", string> = {
  basic: "Básico",
  cloze: "Cloze",
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function DeckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ q?: string; error?: string; notice?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const userId = session.user.id;
  const { deckId } = await params;
  const { q, error, notice } = await searchParams;

  if (!/^[0-9a-f-]{36}$/i.test(deckId)) {
    notFound();
  }

  let deck: DeckWithSettings;
  try {
    deck = await getDeck(userId, { deckId });
  } catch {
    notFound();
  }

  const query = q?.trim() ?? "";
  const searching = query.length > 0;

  let rows: Array<{
    id: string;
    noteType: "basic" | "cloze";
    preview: string;
    cardCount: number | null;
    updatedAt: Date;
  }>;
  let searchFailure: string | null = null;
  if (searching) {
    try {
      rows = (await searchNotes(userId, { query, deckId, limit: 100 })).map((n) => ({
        ...n,
        cardCount: null,
      }));
    } catch (err) {
      rows = [];
      searchFailure = err instanceof Error ? err.message : "falha na busca";
    }
  } else {
    rows = await listNotes(userId, { deckId, limit: 100 });
  }

  const tagsByNote = await tagsForNotes(
    userId,
    rows.map((r) => r.id),
  );
  const noteRows: NoteRow[] = rows.map((r) => ({
    id: r.id,
    typeLabel: NOTE_TYPE_LABEL[r.noteType],
    preview: r.preview,
    cardCount: r.cardCount,
    tags: tagsByNote[r.id] ?? [],
    updatedAtLabel: dateFormatter.format(r.updatedAt),
  }));

  const otherDecks = (await listDecks(userId))
    .filter((d) => d.id !== deckId)
    .map((d) => ({ id: d.id, name: d.name }));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← baralhos
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold">{deck.name}</h1>
          <p className="text-sm text-muted-foreground">{deckStatusLabel(deck.status)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/decks/${deckId}/review`}
            className="rounded-lg border border-primary px-4 py-2.5 text-sm font-medium text-primary outline-offset-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Revisar
          </Link>
          <Link
            href={`/decks/${deckId}/new`}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Adicionar cards
          </Link>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <form role="search" method="GET" action={`/decks/${deckId}`} className="mt-6 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar notas neste baralho
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Buscar no baralho…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        />
        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          Buscar
        </button>
      </form>

      {searching ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {searchFailure ??
            `${noteRows.length} resultado${noteRows.length === 1 ? "" : "s"} para “${query}”`}{" "}
          ·{" "}
          <Link
            href={`/decks/${deckId}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            limpar busca
          </Link>
        </p>
      ) : null}

      {noteRows.length === 0 && !searching ? (
        <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
          <h2 className="text-lg font-semibold">Nenhum card ainda</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Crie o primeiro card deste baralho — básico, com ocultações ou a partir de um print.
          </p>
          <Link
            href={`/decks/${deckId}/new`}
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Adicionar cards
          </Link>
        </div>
      ) : (
        <NotesList notes={noteRows} decks={otherDecks} />
      )}
    </main>
  );
}
