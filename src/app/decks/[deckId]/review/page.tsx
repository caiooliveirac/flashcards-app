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

  // Chrome mínimo: sem SiteHeader/nav global — a sessão ocupa a tela toda.
  return (
    <div className="mx-auto w-full max-w-[640px]">
      {queue.cards.length === 0 ? (
        <div className="flex min-h-dvh flex-col">
          <header className="px-6 pt-5">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {queue.deckName}
            </p>
            <div className="mt-2 h-[3px] bg-track" />
          </header>
          <main className="flex flex-1 flex-col justify-center px-6 py-10">
            <h1 className="text-2xl font-semibold leading-[1.45] text-pretty sm:text-[29px]">
              Tudo em dia
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum card para revisar em “{queue.deckName}” agora. Adicione
              cards novos ou volte quando houver revisões vencidas.
            </p>
          </main>
          <div className="px-6 pb-6">
            <Link
              href={`/decks/${queue.deckId}/new`}
              className="flex min-h-14 w-full items-center justify-center bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
            >
              Adicionar cards
            </Link>
            <Link
              href="/"
              className="mt-2 flex min-h-14 w-full items-center justify-center border-2 border-divider px-6 text-[15px] font-semibold transition-colors duration-150 ease-out hover:bg-surface"
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
    </div>
  );
}
