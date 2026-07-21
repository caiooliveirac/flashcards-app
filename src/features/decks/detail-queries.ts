import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { cardProgress, cards, notes, reviewLogs } from "@/db/schema";

/**
 * Consultas do deck detail (redesign "Editorial Cognition", CounterStrip):
 * consolidados (card_progress em state='review') e última sessão
 * (max(review_logs.reviewed_at)) do baralho. Mesmo padrão RLS das queries de
 * src/features/decks/service.ts — transação do usuário, sem service-role.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface DeckDetailStats {
  /** Cards do baralho com progresso em state='review' (consolidados). */
  consolidatedCount: number;
  /** Última revisão registrada no baralho (null = nunca estudado). */
  lastReviewedAt: Date | null;
}

export async function getDeckDetailStats(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<DeckDetailStats> {
  return runUser(userId, async (tx) => {
    const [consolidated] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(cardProgress)
      .innerJoin(cards, eq(cards.id, cardProgress.cardId))
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .where(
        and(
          eq(cardProgress.userId, userId),
          eq(cardProgress.state, "review"),
          eq(notes.deckId, input.deckId),
          eq(cards.status, "active"),
          isNull(notes.deletedAt),
        ),
      );

    const [last] = await tx
      .select({
        lastReviewedAt: sql<Date | null>`max(${reviewLogs.reviewedAt})`.mapWith(
          (v: string | Date | null) => (v == null ? null : new Date(v)),
        ),
      })
      .from(reviewLogs)
      .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .where(and(eq(reviewLogs.userId, userId), eq(notes.deckId, input.deckId)));

    return {
      consolidatedCount: consolidated?.count ?? 0,
      lastReviewedAt: last?.lastReviewedAt ?? null,
    };
  });
}
