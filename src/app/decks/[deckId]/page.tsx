import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DeckStatusBadge } from "@/components/decks/deck-status-badge";
import { SiteHeader } from "@/components/site-header";
import { NotesList, type NoteRow } from "@/features/editor/notes-list";
import { tagsForNotes } from "@/features/editor/queries";
import { getDeckDetailStats } from "@/features/decks/detail-queries";
import { getDeck, listDecks, type DeckWithSettings } from "@/features/decks/service";
import { listNotes, searchNotes } from "@/features/notes/service";
import { reviewCountsByDeck } from "@/features/review/service";
import { auth, signOut } from "@/lib/auth";

/**
 * Deck detail: lista de notas + busca FTS (aceite F2#7) + CTA de criação.
 * Server component — a busca é um form GET que relê a página com ?q=.
 * Redesign "Editorial Cognition" (handoff seção C): masthead editorial,
 * CounterStrip, CTA dominante por estado e índice de notas em régua.
 */

const NOTE_TYPE_LABEL: Record<"basic" | "cloze", string> = {
  basic: "Básico",
  cloze: "Cloze",
};

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.1em]";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo",
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 86_400_000;
const DORMANT_AFTER_DAYS = 14;

/** Data relativa determinística (fuso de exibição do app) — nunca simula dado. */
function relativeSessionLabel(date: Date | null, now: Date): string {
  if (!date) return "—";
  const key = dayKeyFormatter.format(date);
  if (key === dayKeyFormatter.format(now)) return "hoje";
  if (key === dayKeyFormatter.format(new Date(now.getTime() - DAY_MS))) return "ontem";
  const days = Math.round((now.getTime() - date.getTime()) / DAY_MS);
  if (days > 1 && days < 30) return `há ${days} dias`;
  return shortDateFormatter.format(date);
}

interface CounterItem {
  value: string;
  label: string;
  small?: boolean;
}

/** CounterStrip: faixa horizontal de contadores separados por réguas de 1px. */
function CounterStrip({ counters }: { counters: CounterItem[] }) {
  return (
    <section
      aria-label="Resumo do baralho"
      className="grid grid-cols-2 border-y-2 border-divider sm:grid-cols-5"
    >
      {counters.map((c, i) => (
        <div
          key={c.label}
          className={[
            "border-border px-4 py-5 sm:px-5",
            i % 2 === 1 ? "border-l" : "",
            i >= 2 ? "border-t sm:border-t-0" : "",
            i > 0 && i % 2 === 0 ? "sm:border-l" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <p
            className={`font-extrabold leading-none tabular-nums ${
              c.small ? "pt-1 text-lg sm:text-xl" : "text-[28px]"
            }`}
          >
            {c.value}
          </p>
          <p className={`mt-2 ${KICKER} text-muted-foreground`}>{c.label}</p>
        </div>
      ))}
    </section>
  );
}

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

  const [tagsByNote, allDecks, reviewCounts, stats] = await Promise.all([
    tagsForNotes(
      userId,
      rows.map((r) => r.id),
    ),
    listDecks(userId),
    reviewCountsByDeck(userId),
    getDeckDetailStats(userId, { deckId }),
  ]);

  const noteRows: NoteRow[] = rows.map((r) => ({
    id: r.id,
    typeLabel: NOTE_TYPE_LABEL[r.noteType],
    preview: r.preview,
    cardCount: r.cardCount,
    tags: tagsByNote[r.id] ?? [],
    updatedAtLabel: dateFormatter.format(r.updatedAt),
  }));

  const otherDecks = allDecks
    .filter((d) => d.id !== deckId)
    .map((d) => ({ id: d.id, name: d.name }));

  const totalCards = allDecks.find((d) => d.id === deckId)?.cardCount ?? 0;
  const { dueCount, newCount } = reviewCounts.get(deckId) ?? { dueCount: 0, newCount: 0 };
  const now = new Date();
  const isEmpty = totalCards === 0;
  const recentActivity =
    stats.lastReviewedAt != null &&
    now.getTime() - stats.lastReviewedAt.getTime() <= DORMANT_AFTER_DAYS * DAY_MS;
  const isDormant = !isEmpty && dueCount === 0 && newCount === 0 && !recentActivity;

  const secondaryCta =
    "inline-flex min-h-12 items-center justify-center border border-border px-5 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface";
  const primaryCta =
    "inline-flex min-h-12 items-center justify-center bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover";

  return (
    <div className="min-h-dvh">
      <SiteHeader>
        {session.user.role === "admin" ? (
          <Link href="/admin" className="font-semibold hover:text-primary-text">
            Admin
          </Link>
        ) : null}
        <span className="hidden text-muted-foreground sm:inline">
          {session.user.email ?? session.user.name}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="min-h-11 border border-border px-4 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
          >
            Sair
          </button>
        </form>
      </SiteHeader>

      <main className="mx-auto max-w-5xl px-5 py-8">
        {/* Masthead */}
        <div className="flex flex-col gap-6 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <Link
              href="/"
              className="text-sm font-semibold text-primary-text underline-offset-4 hover:underline"
            >
              ← Baralhos
            </Link>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {deck.name}
            </h1>
            {deck.status !== "active" ? (
              <p className="mt-3">
                <DeckStatusBadge status={deck.status} />
              </p>
            ) : null}
            {deck.description ? (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{deck.description}</p>
            ) : null}
          </div>

          {/* CTA dominante por estado */}
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {dueCount > 0 ? (
              <>
                <Link href={`/decks/${deckId}/review`} className={primaryCta}>
                  Revisar agora — {dueCount}
                </Link>
                <Link href={`/decks/${deckId}/new`} className={secondaryCta}>
                  Adicionar cards
                </Link>
              </>
            ) : isEmpty ? (
              <Link href={`/decks/${deckId}/new`} className={primaryCta}>
                Criar primeiro card
              </Link>
            ) : isDormant ? (
              <Link href={`/decks/${deckId}/new`} className={primaryCta}>
                Adicionar conhecimento
              </Link>
            ) : (
              <>
                {newCount > 0 ? (
                  <Link href={`/decks/${deckId}/review`} className={secondaryCta}>
                    Estudar novos — {newCount}
                  </Link>
                ) : null}
                <Link href={`/decks/${deckId}/new`} className={secondaryCta}>
                  Adicionar cards
                </Link>
              </>
            )}
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-6 border border-destructive px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-6 border border-border bg-surface px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}

        <CounterStrip
          counters={[
            { value: String(totalCards), label: "cards" },
            { value: String(dueCount), label: "esfriando" },
            { value: String(newCount), label: "novos" },
            { value: String(stats.consolidatedCount), label: "consolidados" },
            {
              value: relativeSessionLabel(stats.lastReviewedAt, now),
              label: "última sessão",
              small: stats.lastReviewedAt != null,
            },
          ]}
        />

        {/* Busca FTS — superfície de escrita (form GET preservado) */}
        <form role="search" method="GET" action={`/decks/${deckId}`} className="mt-10">
          <label htmlFor="q" className={`block ${KICKER} text-muted-foreground`}>
            Buscar neste baralho
          </label>
          <div className="mt-1 flex items-end gap-3 border-b-2 border-divider pb-px">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Termo, tag, trecho…"
              className="min-h-11 w-full bg-transparent py-2 text-base"
            />
            <button
              type="submit"
              className="mb-1 min-h-11 shrink-0 border border-border px-4 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
            >
              Buscar
            </button>
          </div>
        </form>

        {searching ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {searchFailure ??
              `${noteRows.length} resultado${noteRows.length === 1 ? "" : "s"} para “${query}”`}{" "}
            ·{" "}
            <Link
              href={`/decks/${deckId}`}
              className="font-semibold text-primary-text underline-offset-4 hover:underline"
            >
              limpar busca
            </Link>
          </p>
        ) : null}

        {noteRows.length === 0 && !searching ? (
          <section className="mt-12 border-t-2 border-divider pt-10 pb-16">
            <p className={`${KICKER} text-muted-foreground`}>Comece aqui</p>
            <h2 className="mt-3 max-w-xl text-2xl font-extrabold leading-snug tracking-tight">
              Este baralho ainda está em branco.
            </h2>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Crie o primeiro card — básico, com ocultações ou a partir de um print. Cada card vira
              uma regra que este índice passa a acompanhar.
            </p>
          </section>
        ) : (
          <NotesList notes={noteRows} decks={otherDecks} />
        )}
      </main>
    </div>
  );
}
