import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { getReviewQueue, submitReview } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let deckId: string;
let fragile: string;
let fresher: string;

const run = () => db.clients.withUserTransaction;

function basic(t: string) {
  return {
    schemaVersion: 1,
    kind: "basic",
    front: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    back: [{ type: "paragraph", content: [{ type: "text", text: "r" }] }],
  };
}
async function card(t: string): Promise<string> {
  const note = await createNote(userA, { deckId, noteType: "basic", content: basic(t) }, run());
  return note.cardIds[0]!;
}

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("rescue-a@teste.dev");
  deckId = (await createDeck(userA, { name: "Resgate" }, run())).deckId;

  fragile = await card("frágil");
  fresher = await card("recente");
  await card("novo"); // fica como novo (sem revisão)

  for (const c of [fragile, fresher]) {
    await submitReview(userA, { cardId: c, rating: 3, idempotencyKey: randomUUID() }, run());
  }
  // fragile: vencido há 60 dias (retrievability baixa). fresher: vencido há 1h.
  await run()(userA, (tx) =>
    tx
      .update(cardProgress)
      .set({
        dueAt: new Date(Date.now() - 60 * 86_400_000),
        lastReviewedAt: new Date(Date.now() - 60 * 86_400_000),
      })
      .where(eq(cardProgress.cardId, fragile)),
  );
  await run()(userA, (tx) =>
    tx
      .update(cardProgress)
      .set({ dueAt: new Date(Date.now() - 3_600_000) })
      .where(eq(cardProgress.cardId, fresher)),
  );
});

afterAll(async () => {
  await db.drop();
});

describe("resgate de backlog (§8) — modo da fila", () => {
  it("modo normal inclui o card novo", async () => {
    const q = await getReviewQueue(userA, { deckId, mode: "normal" }, run());
    expect(q.cards.some((c) => c.isNew)).toBe(true);
  });

  it("modo resgate: sem novos e o mais frágil (menor retrievability) primeiro", async () => {
    const q = await getReviewQueue(userA, { deckId, mode: "rescue" }, run());
    expect(q.cards.every((c) => !c.isNew)).toBe(true);
    expect(q.newCount).toBe(0);
    // fragile (60d vencido) vem antes de fresher (1h).
    const ids = q.cards.map((c) => c.cardId);
    expect(ids[0]).toBe(fragile);
    expect(ids).toContain(fresher);
  });
});
