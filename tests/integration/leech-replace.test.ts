import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress, notes } from "@/db/schema";
import { replaceLeech } from "@/features/assistant/service";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { getReviewQueue } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let userB: string;
let deckId: string;

const run = () => db.clients.withUserTransaction;

const basic = (front: string, back: string) => ({
  schemaVersion: 1,
  kind: "basic",
  front: [{ type: "paragraph", content: [{ type: "text", text: front }] }],
  back: [{ type: "paragraph", content: [{ type: "text", text: back }] }],
});

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await db.createUser("leech-a@teste.dev");
  userB = await db.createUser("leech-b@teste.dev");
  deckId = (await createDeck(userA, { name: "Leech" }, run())).deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("replaceLeech (reformular card difícil)", () => {
  it("cria os novos no baralho do card (proveniência IA) e suspende o antigo", async () => {
    const old = await createNote(
      userA,
      { deckId, noteType: "basic", content: basic("Critérios de sepse?", "Lista longa") },
      run(),
    );
    const oldCard = old.cardIds[0]!;

    const res = await replaceLeech(
      userA,
      {
        cardId: oldCard,
        suggestions: [
          { noteType: "basic", content: basic("PA 72×40 após volume. Próximo passo?", "Noradrenalina já.") },
          { noteType: "basic", content: basic("Alvo de PAM no choque séptico?", "≥ 65 mmHg.") },
        ],
      },
      run(),
    );
    expect(res.created).toBe(2);

    const aiNotes = await run()(userA, (tx) =>
      tx.select().from(notes).where(and(eq(notes.deckId, deckId), eq(notes.sourceType, "ai"))),
    );
    expect(aiNotes).toHaveLength(2);

    const [progress] = await run()(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, oldCard)),
    );
    expect(progress?.suspendedAt).not.toBeNull();

    const queue = await getReviewQueue(userA, { deckId }, run());
    expect(queue.cards.some((c) => c.cardId === oldCard)).toBe(false);
    expect(queue.cards.filter((c) => c.aiText.includes("Próximo passo"))).toHaveLength(1);
  });

  it("card de outra conta falha e não cria nada", async () => {
    const other = await createNote(
      userA,
      { deckId, noteType: "basic", content: basic("Q", "A") },
      run(),
    );
    await expect(
      replaceLeech(
        userB,
        { cardId: other.cardIds[0]!, suggestions: [{ noteType: "basic", content: basic("X", "Y") }] },
        run(),
      ),
    ).rejects.toThrow(/não encontrado/);
    const bNotes = await run()(userB, (tx) => tx.select().from(notes));
    expect(bNotes).toHaveLength(0);
  });
});
