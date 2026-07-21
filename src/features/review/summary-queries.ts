import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { cardProgress, cards, decks, notes } from "@/db/schema";

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Resumo pós-sessão: menor due_at FUTURO do deck (cards vivos, não suspensos).
 * Barato (índice em card_progress) e segue o padrão RLS + ownership explícito
 * de service.ts.
 */
export async function getNextDueAt(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<Date | null> {
  return runUser(userId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({ dueAt: cardProgress.dueAt })
      .from(cardProgress)
      .innerJoin(cards, eq(cards.id, cardProgress.cardId))
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .innerJoin(decks, eq(decks.id, notes.deckId))
      .where(
        and(
          eq(cardProgress.userId, userId),
          eq(cards.ownerUserId, userId),
          eq(cards.status, "active"),
          isNull(notes.deletedAt),
          isNull(decks.deletedAt),
          eq(notes.deckId, input.deckId),
          ne(cardProgress.state, "new"),
          isNull(cardProgress.suspendedAt),
          gt(cardProgress.dueAt, now),
        ),
      )
      .orderBy(asc(cardProgress.dueAt))
      .limit(1);
    return row?.dueAt ?? null;
  });
}
