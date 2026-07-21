import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, cardProgress, cards } from "@/db/schema";
import { nextStudyDayStart } from "@/lib/study-day";
import { loadStudyDayConfig } from "./study-day-config";

/**
 * Gestão manual de cards na revisão (§7.2): suspender (indefinido, sai da fila
 * até reativar) e enterrar (até o próximo dia de estudo). Ambos criam a linha de
 * progresso se o card ainda for novo. Ownership explícito + RLS.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

async function assertOwnedCard(tx: Tx, userId: string, cardId: string): Promise<string> {
  const [card] = await tx
    .select({ id: cards.id, noteId: cards.noteId })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.ownerUserId, userId), eq(cards.status, "active")))
    .limit(1);
  if (!card) throw new Error("card não encontrado");
  return card.noteId;
}

export async function suspendCard(
  userId: string,
  input: { cardId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  return runUser(userId, async (tx) => {
    await assertOwnedCard(tx, userId, input.cardId);
    await tx
      .insert(cardProgress)
      .values({ userId, cardId: input.cardId, state: "new", suspendedAt: sql`now()` })
      .onConflictDoUpdate({
        target: [cardProgress.userId, cardProgress.cardId],
        set: { suspendedAt: sql`now()`, updatedAt: sql`now()` },
      });
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "card.suspend",
      entityType: "card",
      entityId: input.cardId,
    });
  });
}

export async function unsuspendCard(
  userId: string,
  input: { cardId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  return runUser(userId, async (tx) => {
    await assertOwnedCard(tx, userId, input.cardId);
    await tx
      .update(cardProgress)
      .set({ suspendedAt: null, updatedAt: sql`now()` })
      .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "card.unsuspend",
      entityType: "card",
      entityId: input.cardId,
    });
  });
}

/** Enterra o card (e opcionalmente os irmãos da nota) até o próximo dia de estudo. */
export async function buryCard(
  userId: string,
  input: { cardId: string; includeSiblings?: boolean },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  return runUser(userId, async (tx) => {
    const noteId = await assertOwnedCard(tx, userId, input.cardId);
    const config = await loadStudyDayConfig(tx, userId);
    const until = nextStudyDayStart(new Date(), config);

    const targetIds = input.includeSiblings
      ? (
          await tx
            .select({ id: cards.id })
            .from(cards)
            .where(
              and(
                eq(cards.noteId, noteId),
                eq(cards.ownerUserId, userId),
                eq(cards.status, "active"),
              ),
            )
        ).map((r) => r.id)
      : [input.cardId];

    await tx
      .insert(cardProgress)
      .values(targetIds.map((id) => ({ userId, cardId: id, state: "new" as const, buriedUntil: until })))
      .onConflictDoUpdate({
        target: [cardProgress.userId, cardProgress.cardId],
        set: { buriedUntil: until, updatedAt: sql`now()` },
        setWhere: sql`${cardProgress.suspendedAt} is null`,
      });
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "card.bury",
      entityType: "card",
      entityId: input.cardId,
      metadata: { includeSiblings: input.includeSiblings ?? false },
    });
  });
}
