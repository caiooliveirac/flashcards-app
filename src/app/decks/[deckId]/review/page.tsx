import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getReviewQueue } from "@/features/review/service";
import { ReviewSession, type SessionCard } from "@/features/review/review-session";
import { auth } from "@/lib/auth";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { deckId } = await params;

  let queue;
  try {
    queue = await getReviewQueue(session.user.id, { deckId });
  } catch {
    notFound();
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-semibold outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
            Flashcards
          </Link>
          <Link
            href={`/decks/${queue.deckId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {queue.deckName}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {queue.cards.length === 0 ? (
          <div className="mx-auto max-w-lg rounded-xl border border-dashed border-border p-10 text-center">
            <h1 className="text-lg font-semibold">Tudo em dia ✨</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum card para revisar em “{queue.deckName}” agora. Adicione
              cards novos ou volte quando houver revisões vencidas.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href={`/decks/${queue.deckId}/new`}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
              >
                Adicionar cards
              </Link>
              <Link
                href="/"
                className="rounded-lg border border-border px-4 py-2 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                Voltar aos baralhos
              </Link>
            </div>
          </div>
        ) : (
          <ReviewSession
            deckId={queue.deckId}
            deckName={queue.deckName}
            cards={queue.cards as SessionCard[]}
          />
        )}
      </main>
    </div>
  );
}
