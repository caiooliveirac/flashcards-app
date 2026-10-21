import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SOUT-22: o assistente de cards (suggestForUser), o reformulador de leech
 * (proposeLeechRewrite) e /api/ai/create-card passavam ao largo do portão que
 * só /api/ai/chat usava (checkRateLimit + recordUsage). Sem banco e sem modelo:
 * o modelo é um spy, o uso vai para um diretório temporário.
 */
const dir = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "teste-sem-rede";
  process.env.FLASHCARDS_AI_RPM = "3";
  return { path: "" };
});
dir.path = mkdtempSync(path.join(tmpdir(), "fc-ai-usage-"));
process.env.FLASHCARDS_AI_USAGE_DIR = dir.path;

vi.mock("server-only", () => ({}));
vi.mock("@/db/runtime", () => ({
  withUserTransaction: async () => ({ deckId: "d", contentJson: {}, clozeGroupKey: null, lapses: 9 }),
}));
vi.mock("@/lib/content", () => ({ cardTextForAi: () => "card difícil" }));
vi.mock("@/features/notes/service", () => ({ createNote: vi.fn() }));
vi.mock("@/features/review/manage", () => ({ suspendCard: vi.fn() }));
const suggestCards = vi.fn(async () => ({ cards: [], usage: { inputTokens: 100_000, outputTokens: 10_000 } }));
vi.mock("@/lib/ai/card-suggester", () => ({ suggestCards }));
const rewriteLeech = vi.fn(async () => ({ diagnosis: "ok", cards: [], usage: { inputTokens: 1000, outputTokens: 100 } }));
vi.mock("@/lib/ai/leech-rewriter", () => ({ rewriteLeech }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: currentUser } }) }));
const createCardFromDraft = vi.fn(async () => ({ cardCount: 1 }));
let currentUser = "u-route";

const service = await import("@/features/assistant/service");
vi.doMock("@/features/assistant/service", () => ({ ...service, createCardFromDraft }));
const { POST: createCard } = await import("@/app/api/ai/create-card/route");
const { getDailyUsage } = await import("@/lib/ai/assistant/usage-store");

const input = { sourceText: "material", mode: "initial" as const };
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  suggestCards.mockClear();
  rewriteLeech.mockClear();
  createCardFromDraft.mockClear();
});

describe("assistente de cards: mesmo portão do chat", () => {
  it("barra rajada acima do rpm sem chamar o modelo", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await service.suggestForUser("u-rpm", input).then(() => "ok", (e: Error) => e.name));
    }
    expect(results).toEqual(["ok", "ok", "ok", "AssistantRateLimitError", "AssistantRateLimitError"]);
    expect(suggestCards).toHaveBeenCalledTimes(3);
  });

  it("registra o custo da chamada no teto diário", async () => {
    await service.suggestForUser("u-custo", input);
    const u = await getDailyUsage("u-custo");
    expect(u.requests).toBe(1);
    expect(u.costUsd).toBeGreaterThan(0);
  });

  it("teto diário estourado: não chama o modelo", async () => {
    writeFileSync(
      path.join(dir.path, `u-teto-${today}.json`),
      JSON.stringify({ date: today, requests: 50, tokensIn: 0, tokensOut: 0, costUsd: 99 }),
    );
    await expect(service.suggestForUser("u-teto", input)).rejects.toThrow(/Teto/);
    await expect(service.proposeLeechRewrite("u-teto", "c1")).rejects.toThrow(/Teto/);
    expect(suggestCards).not.toHaveBeenCalled();
    expect(rewriteLeech).not.toHaveBeenCalled();
  });

  it("leech também registra uso", async () => {
    await service.proposeLeechRewrite("u-leech", "c1");
    expect((await getDailyUsage("u-leech")).requests).toBe(1);
  });
});

describe("POST /api/ai/create-card", () => {
  const req = () =>
    new Request("http://x/api/ai/create-card", {
      method: "POST",
      body: JSON.stringify({ deckId: crypto.randomUUID(), kind: "basic", front: "a", back: "b" }),
    });

  it("passa a dar 429 acima do rpm", async () => {
    currentUser = "u-route";
    const status = [];
    for (let i = 0; i < 5; i++) status.push((await createCard(req())).status);
    expect(status).toEqual([200, 200, 200, 429, 429]);
    expect(createCardFromDraft).toHaveBeenCalledTimes(3);
  });

  it("teto diário estourado: 429", async () => {
    currentUser = "u-teto";
    expect((await createCard(req())).status).toBe(429);
    expect(createCardFromDraft).not.toHaveBeenCalled();
  });
});
