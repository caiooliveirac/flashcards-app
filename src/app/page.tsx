import Link from "next/link";
import { redirect } from "next/navigation";
import { DeckMenu } from "@/components/decks/deck-menu";
import { DeckStatusBadge } from "@/components/decks/deck-status-badge";
import { listDecks } from "@/features/decks/service";
import { reviewCountsByDeck } from "@/features/review/service";
import { auth, signOut } from "@/lib/auth";

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Indicador simples e determinístico de temperatura (MVP — regra por contagem). */
function temperature(dueCount: number): { label: string; dot: string; text: string } {
  if (dueCount === 0) {
    return { label: "em dia", dot: "bg-emerald-500", text: "text-muted-foreground" };
  }
  if (dueCount < 10) {
    return { label: "atenção", dot: "bg-amber-500", text: "text-amber-700" };
  }
  return { label: "quente", dot: "bg-red-500", text: "text-red-700" };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  const { error } = await searchParams;
  const [deckRows, reviewCounts] = await Promise.all([
    listDecks(session.user.id),
    reviewCountsByDeck(session.user.id),
  ]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-semibold">Flashcards</span>
          <div className="flex items-center gap-3">
            {session.user.role === "admin" ? (
              <a
                href="/admin"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Admin
              </a>
            ) : null}
            <span className="text-sm text-muted-foreground">
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
                className="rounded-md border border-border px-3 py-1.5 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Seus baralhos</h1>
          <Link
            href="/decks/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Novo baralho
          </Link>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {deckRows.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <h2 className="text-lg font-semibold">Nenhum baralho ainda</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Crie seu primeiro baralho para começar a adicionar cards.
            </p>
            <Link
              href="/decks/new"
              className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Criar baralho
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {deckRows.map((deck) => {
              const counts = reviewCounts.get(deck.id) ?? { dueCount: 0, newCount: 0 };
              const temp = temperature(counts.dueCount);
              const hasWork = counts.dueCount + counts.newCount > 0;
              return (
                <li
                  key={deck.id}
                  className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-medium">{deck.name}</h2>
                      <div className="mt-1 flex items-center gap-2">
                        <DeckStatusBadge status={deck.status} />
                        <span className={`inline-flex items-center gap-1.5 text-xs ${temp.text}`}>
                          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${temp.dot}`} />
                          {temp.label}
                        </span>
                      </div>
                    </div>
                    <DeckMenu deckId={deck.id} deckName={deck.name} status={deck.status} />
                  </div>
                  {deck.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {deck.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm text-muted-foreground">
                    {pluralize(deck.cardCount, "card", "cards")} ·{" "}
                    <span className={counts.dueCount > 0 ? "font-medium text-foreground" : ""}>
                      {counts.dueCount} a revisar
                    </span>{" "}
                    · {counts.newCount} {counts.newCount === 1 ? "novo" : "novos"}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    {hasWork ? (
                      <Link
                        href={`/decks/${deck.id}/review`}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        Revisar
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Nada pendente</span>
                    )}
                    <Link
                      href={`/decks/${deck.id}`}
                      aria-label={`Abrir baralho ${deck.name}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Abrir
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
