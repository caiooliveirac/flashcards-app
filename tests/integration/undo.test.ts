import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress, reviewLogs } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { submitReview } from "@/features/review/service";
import { undoLastReview } from "@/features/review/undo";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let deckId: string;

const basicContent = {
  schemaVersion: 1,
  kind: "basic",
  front: [{ type: "paragraph", content: [{ type: "text", text: "2+2?" }] }],
  back: [{ type: "paragraph", content: [{ type: "text", text: "4" }] }],
};

async function newCard(): Promise<string> {
  const note = await createNote(
    userA,
    { deckId, noteType: "basic", content: basicContent },
    db.clients.withUserTransaction,
  );
  return note.cardIds[0]!;
}

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("undo-a@teste.dev");
  const deck = await createDeck(userA, { name: "Undo" }, db.clients.withUserTransaction);
  deckId = deck.deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("undo compensatório (F3#2)", () => {
  it("desfazer a PRIMEIRA revisão volta o card a nunca-revisado (progresso removido)", async () => {
    const cardId = await newCard();
    await submitReview(
      userA,
      { cardId, rating: 3, idempotencyKey: randomUUID() },
      db.clients.withUserTransaction,
    );

    const result = await undoLastReview(userA, { cardId }, db.clients.withUserTransaction);
    expect(result.state).toBe("new");

    const progress = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, cardId)),
    );
    expect(progress).toHaveLength(0); // volta a "novo": sem linha de progresso

    // Histórico append-only: 1 log real + 1 log de undo, nada apagado.
    const logs = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)).orderBy(asc(reviewLogs.id)),
    );
    expect(logs).toHaveLength(2);
    expect(logs[0]!.origin).toBe("web");
    expect(logs[1]!.origin).toBe("undo");
    expect(logs[1]!.rating).toBeNull();
    expect(logs[1]!.revertedLogId).toBe(logs[0]!.id);
    expect(logs[1]!.stateAfter).toBe("new");
  });

  it("desfazer restaura learning_step/reps/lapses e last_reviewed_at do log anterior", async () => {
    const cardId = await newCard();
    // 1ª revisão (Errei → learning), 2ª revisão (Bom).
    await submitReview(
      userA,
      { cardId, rating: 1, idempotencyKey: randomUUID() },
      db.clients.withUserTransaction,
    );
    const [afterFirst] = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, cardId)),
    );
    const [firstLog] = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)),
    );

    await submitReview(
      userA,
      { cardId, rating: 3, idempotencyKey: randomUUID() },
      db.clients.withUserTransaction,
    );

    // Undo da 2ª revisão: volta EXATAMENTE ao estado pós-1ª revisão.
    await undoLastReview(userA, { cardId }, db.clients.withUserTransaction);
    const [restored] = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, cardId)),
    );
    expect(restored!.reps).toBe(afterFirst!.reps);
    expect(restored!.lapses).toBe(afterFirst!.lapses);
    expect(restored!.learningStep).toBe(afterFirst!.learningStep);
    expect(restored!.state).toBe(afterFirst!.state);
    expect(restored!.stability).toBeCloseTo(afterFirst!.stability, 9);
    expect(restored!.difficulty).toBeCloseTo(afterFirst!.difficulty, 9);
    // last_reviewed_at volta ao reviewed_at da 1ª revisão (log anterior).
    expect(restored!.lastReviewedAt?.getTime()).toBe(firstLog!.reviewedAt.getTime());

    const logs = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)),
    );
    expect(logs).toHaveLength(3); // 2 web + 1 undo
  });

  it("undo duas vezes seguidas: a segunda não tem o que desfazer", async () => {
    const cardId = await newCard();
    await submitReview(
      userA,
      { cardId, rating: 3, idempotencyKey: randomUUID() },
      db.clients.withUserTransaction,
    );
    await undoLastReview(userA, { cardId }, db.clients.withUserTransaction);
    await expect(
      undoLastReview(userA, { cardId }, db.clients.withUserTransaction),
    ).rejects.toThrow(/nada para desfazer/);
  });

  it("card sem nenhuma revisão: nada para desfazer", async () => {
    const cardId = await newCard();
    await expect(
      undoLastReview(userA, { cardId }, db.clients.withUserTransaction),
    ).rejects.toThrow(/nada para desfazer/);
  });
});
