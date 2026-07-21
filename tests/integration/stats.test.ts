import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeck } from "@/features/decks/service";
import { createNote } from "@/features/notes/service";
import { aggregateDailyMetrics } from "@/features/review/metrics";
import { submitReview } from "@/features/review/service";
import {
  getActivity,
  getDesiredRetention,
  getFutureDue,
  getTrueRetention,
} from "@/features/stats/queries";
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
  userA = await db.createUser("stats-a@teste.dev");
  const deck = await createDeck(userA, { name: "Stats" }, run());
  deckId = deck.deckId;
});

afterAll(async () => {
  await db.drop();
});

describe("dashboard — queries (Fase 4)", () => {
  it("true retention: Difícil(2) conta como acerto; Errei(1) como falha; 1ª/dia", async () => {
    const c1 = await card("errei");
    const c2 = await card("dificil");
    const c3 = await card("bom");
    await submitReview(userA, { cardId: c1, rating: 1, idempotencyKey: randomUUID() }, run());
    await submitReview(userA, { cardId: c2, rating: 2, idempotencyKey: randomUUID() }, run());
    await submitReview(userA, { cardId: c3, rating: 3, idempotencyKey: randomUUID() }, run());
    // 2ª revisão do MESMO card no mesmo dia NÃO deve recontar.
    await submitReview(userA, { cardId: c3, rating: 1, idempotencyKey: randomUUID() }, run());

    const ret = await getTrueRetention(userA, {}, run());
    // 3 cards distintos, todos jovens (scheduled_days_before=0).
    expect(ret.young.den).toBe(3);
    expect(ret.young.num).toBe(2); // Difícil + Bom passam; Errei falha
    expect(ret.mature.den).toBe(0);
    expect(ret.overall.pct).toBeCloseTo(2 / 3, 6);
  });

  it("atividade: estudou hoje, streak ≥ 1 após o job de métricas", async () => {
    await aggregateDailyMetrics((fn) => service(fn));
    const act = await getActivity(userA, {}, run());
    expect(act.studiedToday).toBe(true);
    expect(act.currentStreak).toBeGreaterThanOrEqual(1);
    expect(act.days.length).toBeGreaterThanOrEqual(1);
    expect(act.days[0]!.reviews).toBeGreaterThan(0);
  });

  it("future due: cards em learning vencem no horizonte, sem backlog", async () => {
    const fd = await getFutureDue(userA, { days: 7 }, run());
    expect(fd.backlog).toBe(0); // nada atrasado (tudo revisado agora)
    expect(fd.buckets.length).toBe(8); // hoje + 7 dias
    const total = fd.buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBeGreaterThanOrEqual(1); // pelo menos um card agendado
  });

  it("retenção desejada default = 0.9", async () => {
    expect(await getDesiredRetention(userA, run())).toBeCloseTo(0.9, 6);
  });
});
