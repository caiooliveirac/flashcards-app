import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { cards, decks, notes, reviewLogs } from "@/db/schema";

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface DeckActivity {
  /** max(notes.created_at) do baralho (notas não deletadas) — base da hibernação. */
  lastNoteAt: Date | null;
  /** max(review_logs.reviewed_at) do baralho — meta "última atividade". */
  lastReviewAt: Date | null;
}

const toNullableDate = (value: unknown): Date | null =>
  value == null ? null : new Date(value as string | number | Date);

/**
 * Sinais baratos de atividade por baralho para a home ("edição do dia").
 * Duas agregações simples, RLS-scoped (papel app via withUserTransaction),
 * sem migrations: última nota criada e última revisão registrada.
 */
export async function deckActivityByDeck(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<Map<string, DeckActivity>> {
  return runUser(userId, async (tx) => {
    const [noteRows, reviewRows] = await Promise.all([
      tx
        .select({
          deckId: notes.deckId,
          lastNoteAt: sql<Date | null>`max(${notes.createdAt})`.mapWith(toNullableDate),
        })
        .from(notes)
        .innerJoin(decks, eq(decks.id, notes.deckId))
        .where(
          and(eq(notes.ownerUserId, userId), isNull(notes.deletedAt), isNull(decks.deletedAt)),
        )
        .groupBy(notes.deckId),
      tx
        .select({
          deckId: notes.deckId,
          lastReviewAt: sql<Date | null>`max(${reviewLogs.reviewedAt})`.mapWith(toNullableDate),
        })
        .from(reviewLogs)
        .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
        .innerJoin(notes, eq(notes.id, cards.noteId))
        .where(and(eq(reviewLogs.userId, userId), isNull(notes.deletedAt)))
        .groupBy(notes.deckId),
    ]);

    const map = new Map<string, DeckActivity>();
    for (const row of noteRows) {
      map.set(row.deckId, { lastNoteAt: row.lastNoteAt, lastReviewAt: null });
    }
    for (const row of reviewRows) {
      const existing = map.get(row.deckId);
      if (existing) {
        existing.lastReviewAt = row.lastReviewAt;
      } else {
        map.set(row.deckId, { lastNoteAt: null, lastReviewAt: row.lastReviewAt });
      }
    }
    return map;
  });
}
