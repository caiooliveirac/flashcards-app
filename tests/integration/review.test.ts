import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress, reviewLogs } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import {
  getReviewQueue,
  reviewCountsByDeck,
  submitReview,
} from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let userB: string;
let deckId: string;
let basicCardId: string;

const basicContent = {
  schemaVersion: 1,
  kind: "basic",
  front: [{ type: "paragraph", content: [{ type: "text", text: "Capital do Peru?" }] }],
  back: [{ type: "paragraph", content: [{ type: "text", text: "Lima" }] }],
};

const clozeContent = {
  schemaVersion: 1,
  kind: "cloze",
  text: [
    {
      type: "paragraph",
      content: [
        { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "Lima" }] },
        { type: "text", text: " é a capital do " },
        { type: "cloze", groupKey: "g2", content: [{ type: "text", text: "Peru" }] },
      ],
    },
  ],
};

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("review-a@teste.dev");
  userB = await db.createUser("review-b@teste.dev");
  const deck = await createDeck(
    userA,
    { name: "Geografia" },
    db.clients.withUserTransaction,
  );
  deckId = deck.deckId;
  const basic = await createNote(
    userA,
    { deckId, noteType: "basic", content: basicContent },
    db.clients.withUserTransaction,
  );
  basicCardId = basic.cardIds[0]!;
  await createNote(
    userA,
    { deckId, noteType: "cloze", content: clozeContent },
    db.clients.withUserTransaction,
  );
});

afterAll(async () => {
  await db.drop();
});

describe("fila de revisão (MVP)", () => {
  it("cards novos entram na fila com o grupo cloze certo; contagens batem", async () => {
    const queue = await getReviewQueue(userA, { deckId }, db.clients.withUserTransaction);
    expect(queue.deckName).toBe("Geografia");
    expect(queue.dueCount).toBe(0);
    expect(queue.newCount).toBe(3);
    expect(queue.cards).toHaveLength(3);
    const clozeCards = queue.cards.filter((c) => c.noteType === "cloze");
    expect(clozeCards.map((c) => c.clozeGroupKey).sort()).toEqual(["g1", "g2"]);
    expect(queue.cards.every((c) => c.isNew)).toBe(true);

    const counts = await reviewCountsByDeck(userA, db.clients.withUserTransaction);
    expect(counts.get(deckId)).toEqual({ dueCount: 0, newCount: 3 });
  });

  it("usuário B não enxerga o baralho de A", async () => {
    await expect(
      getReviewQueue(userB, { deckId }, db.clients.withUserTransaction),
    ).rejects.toThrow(/não encontrado/);
  });
});

describe("submitReview (FSRS + idempotência)", () => {
  it("persiste log + progresso com agendamento futuro", async () => {
    const key = randomUUID();
    const before = Date.now();
    const result = await submitReview(
      userA,
      { cardId: basicCardId, rating: 3, idempotencyKey: key, durationMs: 1200 },
      db.clients.withUserTransaction,
    );
    expect(result.duplicate).toBe(false);
    expect(result.state).toBe("learning");
    expect(result.dueAt.getTime()).toBeGreaterThan(before);

    const progress = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, basicCardId)),
    );
    expect(progress).toHaveLength(1);
    expect(progress[0]!.reps).toBe(1);
    expect(progress[0]!.state).toBe("learning");
    expect(progress[0]!.stability).toBeGreaterThan(0);
    expect(progress[0]!.lastReviewedAt).not.toBeNull();
    expect(progress[0]!.dueAt?.getTime()).toBe(result.dueAt.getTime());

    const logs = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, basicCardId)),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rating).toBe(3);
    expect(logs[0]!.stateBefore).toBe("new");
    expect(logs[0]!.stateAfter).toBe("learning");

    // Double-submit da MESMA key: no-op idempotente, nenhum log novo.
    const dup = await submitReview(
      userA,
      { cardId: basicCardId, rating: 1, idempotencyKey: key },
      db.clients.withUserTransaction,
    );
    expect(dup.duplicate).toBe(true);
    const logsAfter = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, basicCardId)),
    );
    expect(logsAfter).toHaveLength(1);
  });

  it("card revisado sai dos novos; contagens da home refletem", async () => {
    const queue = await getReviewQueue(userA, { deckId }, db.clients.withUserTransaction);
    // O basic virou learning com due em ~1min: não é novo nem vencido ainda.
    expect(queue.newCount).toBe(2);
    expect(queue.cards.some((c) => c.cardId === basicCardId)).toBe(false);

    const counts = await reviewCountsByDeck(userA, db.clients.withUserTransaction);
    expect(counts.get(deckId)).toEqual({ dueCount: 0, newCount: 2 });
  });

  it("card vencido volta como due (envelhecendo o progresso)", async () => {
    await db.clients.withUserTransaction(userA, (tx) =>
      tx
        .update(cardProgress)
        .set({ dueAt: new Date(Date.now() - 60_000) })
        .where(eq(cardProgress.cardId, basicCardId)),
    );
    const queue = await getReviewQueue(userA, { deckId }, db.clients.withUserTransaction);
    expect(queue.dueCount).toBe(1);
    expect(queue.cards[0]!.cardId).toBe(basicCardId);
    expect(queue.cards[0]!.isNew).toBe(false);

    const counts = await reviewCountsByDeck(userA, db.clients.withUserTransaction);
    expect(counts.get(deckId)).toEqual({ dueCount: 1, newCount: 2 });
  });

  it("usuário B não consegue revisar card de A", async () => {
    await expect(
      submitReview(
        userB,
        { cardId: basicCardId, rating: 3, idempotencyKey: randomUUID() },
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(/não encontrado/);
  });
});
