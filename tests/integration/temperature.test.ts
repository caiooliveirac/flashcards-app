import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { deckTemperatures } from "@/features/decks/temperature";
import { createNote } from "@/features/notes/service";
import { submitReview } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let hotDeck: string;
let coldDeck: string;

const run = () => db.clients.withUserTransaction;

function basic(t: string) {
  return {
    schemaVersion: 1,
    kind: "basic",
    front: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    back: [{ type: "paragraph", content: [{ type: "text", text: "r" }] }],
  };
}
async function card(deckId: string, t: string): Promise<string> {
  const note = await createNote(userA, { deckId, noteType: "basic", content: basic(t) }, run());
  return note.cardIds[0]!;
}

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("temp-a@teste.dev");
  hotDeck = (await createDeck(userA, { name: "Quente" }, run())).deckId;
  coldDeck = (await createDeck(userA, { name: "Frio" }, run())).deckId;

  // hotDeck: 4 cards revisados e depois VENCIDOS há 10 dias (memória frágil).
  for (let i = 0; i < 4; i++) {
    const c = await card(hotDeck, `h${i}`);
    await submitReview(userA, { cardId: c, rating: 3, idempotencyKey: randomUUID() }, run());
    await run()(userA, (tx) =>
      tx
        .update(cardProgress)
        .set({
          dueAt: new Date(Date.now() - 10 * 86_400_000),
          lastReviewedAt: new Date(Date.now() - 10 * 86_400_000),
        })
        .where(eq(cardProgress.cardId, c)),
    );
  }
  // coldDeck: só cards novos (nunca revisados).
  await card(coldDeck, "c0");
  await card(coldDeck, "c1");
});

afterAll(async () => {
  await db.drop();
});

describe("temperatura de revisão por deck (§8)", () => {
  it("deck com vencidos frágeis fica quente; deck só de novos fica frio", async () => {
    const temps = await deckTemperatures(userA, run());

    const hot = temps.get(hotDeck);
    expect(hot).toBeDefined();
    expect(hot!.score).toBeGreaterThan(20); // não é frio
    expect(["morno", "quente", "muito-quente", "critico"]).toContain(hot!.tier);

    // coldDeck não tem cards em revisão → ausente do mapa (default frio na home).
    expect(temps.get(coldDeck)).toBeUndefined();
  });
});
