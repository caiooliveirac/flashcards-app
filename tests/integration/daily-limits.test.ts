import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deckSettings, userPreferences } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { getReviewQueue, submitReview } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;

const run = () => db.clients.withUserTransaction;

function basic(text: string) {
  return {
    schemaVersion: 1,
    kind: "basic",
    front: [{ type: "paragraph", content: [{ type: "text", text }] }],
    back: [{ type: "paragraph", content: [{ type: "text", text: "r" }] }],
  };
}

async function deckWith(n: number): Promise<string> {
  const deck = await createDeck(userA, { name: `d${randomUUID().slice(0, 6)}` }, run());
  for (let i = 0; i < n; i++) {
    await createNote(userA, { deckId: deck.deckId, noteType: "basic", content: basic(`q${i}`) }, run());
  }
  return deck.deckId;
}

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("limits-a@teste.dev");
  await run()(userA, (tx) =>
    tx
      .insert(userPreferences)
      .values({ userId: userA, newCardsPerDay: 2, maxReviewsPerDay: 50 }),
  );
});

afterAll(async () => {
  await db.drop();
});

describe("limites diários por dia de estudo (F3#7)", () => {
  it("a fila respeita new_cards_per_day mesmo com mais cards novos disponíveis", async () => {
    const deckId = await deckWith(5);
    const queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.newCount).toBe(2); // 5 disponíveis, limite 2
  });

  it("cards introduzidos hoje CONSOMEM o orçamento — não reseta na mesma sessão", async () => {
    const deckId = await deckWith(5);
    const first = await getReviewQueue(userA, { deckId }, run());
    expect(first.newCount).toBe(2);

    // Introduz os 2 permitidos (viram learning).
    for (const c of first.cards) {
      await submitReview(userA, { cardId: c.cardId, rating: 3, idempotencyKey: randomUUID() }, run());
    }

    // Orçamento diário esgotado: nenhum novo, apesar de 3 ainda serem 'new'.
    const second = await getReviewQueue(userA, { deckId }, run());
    expect(second.newCount).toBe(0);
  });

  it("override do deck sobrepõe a preferência do usuário", async () => {
    const deckId = await deckWith(5);
    await run()(userA, (tx) =>
      tx
        .update(deckSettings)
        .set({ newPerDayOverride: 4 })
        .where(eq(deckSettings.deckId, deckId)),
    );
    const queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.newCount).toBe(4);
  });
});
