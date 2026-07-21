import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dailyStudyMetrics, studySessions } from "@/db/schema";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { aggregateDailyMetrics } from "@/features/review/metrics";
import { startStudySession, submitReview } from "@/features/review/service";
import { undoLastReview } from "@/features/review/undo";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

let db: TestDatabase;
let userA: string;
let deckId: string;

const run = () => db.clients.withUserTransaction;
const service = <T>(fn: Parameters<TestDatabase["clients"]["withServiceTransaction"]>[0]) =>
  db.clients.withServiceTransaction(fn as never) as Promise<T>;

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
  userA = await db.createUser("metrics-a@teste.dev");
  const deck = await createDeck(userA, { name: "Metrics" }, run());
  deckId = deck.deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("sessão de estudo + daily_study_metrics (Fase 3)", () => {
  it("startStudySession reaproveita a sessão aberta do dia", async () => {
    const a = await startStudySession(userA, { deckId }, run());
    const b = await startStudySession(userA, { deckId }, run());
    expect(a).toBe(b);
  });

  it("submit atualiza contadores da sessão e o job agrega métricas do dia", async () => {
    const sessionId = await startStudySession(userA, { deckId }, run());
    const c1 = await card("a");
    const c2 = await card("b");
    await submitReview(
      userA,
      { cardId: c1, rating: 3, idempotencyKey: randomUUID(), durationMs: 1000, studySessionId: sessionId },
      run(),
    );
    await submitReview(
      userA,
      { cardId: c2, rating: 1, idempotencyKey: randomUUID(), durationMs: 2000, studySessionId: sessionId },
      run(),
    );

    const [sess] = await run()(userA, (tx) =>
      tx.select().from(studySessions).where(eq(studySessions.id, sessionId)),
    );
    expect(sess!.newCount).toBe(2); // ambos eram novos
    expect(sess!.againCount).toBe(1); // um "Errei"
    expect(sess!.timeMs).toBe(3000);

    // Job noturno (service): agrega review_logs → daily_study_metrics.
    const result = await aggregateDailyMetrics((fn) => service(fn));
    expect(result.users).toBeGreaterThanOrEqual(1);

    const rows = await run()(userA, (tx) =>
      tx.select().from(dailyStudyMetrics).where(eq(dailyStudyMetrics.userId, userA)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.newCount).toBe(2);
    expect(rows[0]!.reviewsCount).toBe(0);
    expect(rows[0]!.againCount).toBe(1);
    expect(rows[0]!.timeMs).toBe(3000);
    // Retenção: 1ª revisão de cada card — c1=Bom(≥3), c2=Errei(<3) → 1/2.
    expect(rows[0]!.retentionDen).toBe(2);
    expect(rows[0]!.retentionNum).toBe(1);
  });

  it("é idempotente e desconta revisões desfeitas (undo)", async () => {
    const c3 = await card("c");
    await submitReview(userA, { cardId: c3, rating: 3, idempotencyKey: randomUUID() }, run());
    await undoLastReview(userA, { cardId: c3 }, run());

    // Recomputa: o log revertido NÃO conta; c3 não entra em new_count.
    await aggregateDailyMetrics((fn) => service(fn));
    const [row] = await run()(userA, (tx) =>
      tx.select().from(dailyStudyMetrics).where(eq(dailyStudyMetrics.userId, userA)),
    );
    // Segue 2 (c1,c2); c3 desfeito não somou.
    expect(row!.newCount).toBe(2);
  });
});
