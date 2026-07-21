import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { buryCard, suspendCard, unsuspendCard } from "@/features/review/manage";
import { getReviewQueue, submitReview } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let deckId: string;

const clozeContent = {
  schemaVersion: 1,
  kind: "cloze",
  text: [
    {
      type: "paragraph",
      content: [
        { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "Lima" }] },
        { type: "text", text: " fica no " },
        { type: "cloze", groupKey: "g2", content: [{ type: "text", text: "Peru" }] },
      ],
    },
  ],
};

const run = () => db.clients.withUserTransaction;

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("burial-a@teste.dev");
  const deck = await createDeck(userA, { name: "Burial" }, run());
  deckId = deck.deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("sibling burial (F3#6)", () => {
  it("revisar um grupo cloze enterra o irmão até o próximo dia; some da fila", async () => {
    const note = await createNote(
      userA,
      { deckId, noteType: "cloze", content: clozeContent },
      run(),
    );
    const [firstCard, secondCard] = note.cardIds;

    // Fila inicial: os 2 grupos aparecem.
    const before = await getReviewQueue(userA, { deckId }, run());
    expect(before.cards.filter((c) => c.noteId === note.noteId)).toHaveLength(2);

    await submitReview(userA, { cardId: firstCard!, rating: 3, idempotencyKey: randomUUID() }, run());

    // O irmão foi enterrado (buried_until futuro).
    const [siblingProgress] = await run()(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, secondCard!)),
    );
    expect(siblingProgress).toBeDefined();
    expect(siblingProgress!.buriedUntil).not.toBeNull();
    expect(siblingProgress!.buriedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Fila não traz mais o irmão (nem o já-revisado).
    const after = await getReviewQueue(userA, { deckId }, run());
    expect(after.cards.some((c) => c.cardId === secondCard)).toBe(false);
    expect(after.cards.some((c) => c.cardId === firstCard)).toBe(false);
  });
});

describe("suspender/enterrar manual", () => {
  it("card suspenso sai da fila e volta ao reativar", async () => {
    const note = await createNote(
      userA,
      {
        deckId,
        noteType: "basic",
        content: {
          schemaVersion: 1,
          kind: "basic",
          front: [{ type: "paragraph", content: [{ type: "text", text: "x?" }] }],
          back: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }],
        },
      },
      run(),
    );
    const cardId = note.cardIds[0]!;

    await suspendCard(userA, { cardId }, run());
    let queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.cards.some((c) => c.cardId === cardId)).toBe(false);

    await unsuspendCard(userA, { cardId }, run());
    queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.cards.some((c) => c.cardId === cardId)).toBe(true);
  });

  it("enterrar manual com irmãos tira a nota inteira da fila", async () => {
    const note = await createNote(
      userA,
      { deckId, noteType: "cloze", content: clozeContent },
      run(),
    );
    await buryCard(userA, { cardId: note.cardIds[0]!, includeSiblings: true }, run());
    const queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.cards.some((c) => note.cardIds.includes(c.cardId))).toBe(false);
  });
});
