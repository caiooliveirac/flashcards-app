import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createEmptyCard } from "ts-fsrs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardProgress, fsrsProfiles, reviewLogs } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { buildScheduler } from "@/features/review/fsrs";
import { submitReview } from "@/features/review/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let deckId: string;

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
  userA = await db.createUser("fase3-a@teste.dev");
  const deck = await createDeck(userA, { name: "Fase3" }, run());
  deckId = deck.deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("idempotência sob concorrência (F3#1)", () => {
  it("N submits paralelos com a MESMA key geram exatamente 1 review_log", async () => {
    const cardId = await card("concorrência");
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        submitReview(userA, { cardId, rating: 3, idempotencyKey: key }, run()),
      ),
    );

    // Exatamente um não-duplicado; o restante devolve duplicate=true.
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);

    const logs = await run()(userA, (tx) =>
      tx.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId)),
    );
    expect(logs).toHaveLength(1);

    const [progress] = await run()(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, cardId)),
    );
    expect(progress!.reps).toBe(1); // uma revisão só, apesar dos 8 disparos
  });
});

describe("agendamento FSRS sobrevive ao round-trip pelo banco (F3#4)", () => {
  it("stability/difficulty lidos do float8 batem EXATAMENTE com o ts-fsrs", async () => {
    const cardId = await card("float8");
    await submitReview(userA, { cardId, rating: 3, idempotencyKey: randomUUID() }, run());

    // Perfil ativo do usuário → mesmo scheduler do submit.
    const [profile] = await run()(userA, (tx) =>
      tx
        .select({ parameters: fsrsProfiles.parameters, desiredRetention: fsrsProfiles.desiredRetention })
        .from(fsrsProfiles)
        .where(eq(fsrsProfiles.userId, userA)),
    );
    const scheduler = buildScheduler(profile);
    // Para a PRIMEIRA revisão de um card novo, stability/difficulty independem
    // do instante — comparação exata (float64) prova que o float8 não truncou.
    const expected = scheduler.fsrs.next(createEmptyCard(new Date()), new Date(), 3).card;

    const [progress] = await run()(userA, (tx) =>
      tx.select().from(cardProgress).where(eq(cardProgress.cardId, cardId)),
    );
    expect(progress!.stability).toBe(expected.stability);
    expect(progress!.difficulty).toBe(expected.difficulty);
    expect(progress!.state).toBe("learning");
  });
});
