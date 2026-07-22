import { describe, expect, it } from "vitest";
import { suggestCards, type GenerateFn } from "@/lib/ai/card-suggester";

/** Provider mockado — a IA nunca é chamada de verdade no CI. */
function fakeGenerate(json: string, capture?: (req: { system: string; user: string }) => void): GenerateFn {
  return async (req) => {
    capture?.(req);
    return json;
  };
}

describe("suggestCards", () => {
  it("converte JSON válido e descarta cards inválidos", async () => {
    const json = JSON.stringify({
      cards: [
        { kind: "basic", front: "Q1", back: "A1", text: "", tags: [] },
        { kind: "cloze", front: "", back: "", text: "X {{y}} Z", tags: [] },
        { kind: "basic", front: "", back: "", text: "", tags: [] }, // inválido → descartado
      ],
    });
    const res = await suggestCards({ sourceText: "material", mode: "initial" }, fakeGenerate(json));
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0]!.noteType).toBe("basic");
    expect(res.cards[1]!.noteType).toBe("cloze");
  });

  it("inclui feedback e cards anteriores no prompt em modo revise", async () => {
    let captured: { system: string; user: string } | undefined;
    const json = JSON.stringify({ cards: [{ kind: "basic", front: "Q", back: "A", text: "", tags: [] }] });
    await suggestCards(
      {
        sourceText: "meu material",
        mode: "revise",
        feedback: "respostas mais curtas",
        prior: [{ front: "Pergunta antiga", back: "Resposta", rating: 3 }],
      },
      fakeGenerate(json, (req) => (captured = req)),
    );
    expect(captured!.user).toContain("meu material");
    expect(captured!.user).toContain("respostas mais curtas");
    expect(captured!.user).toContain("Pergunta antiga");
    expect(captured!.user).toContain("nota 3/10");
  });

  it("limita a quantidade de cards por resposta", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      kind: "basic" as const,
      front: `Q${i}`,
      back: `A${i}`,
      text: "",
      tags: [],
    }));
    const res = await suggestCards(
      { sourceText: "x", mode: "initial" },
      fakeGenerate(JSON.stringify({ cards: many })),
    );
    expect(res.cards.length).toBeLessThanOrEqual(8);
  });

  it("lança em JSON inesperado (o caller degrada com aviso calmo)", async () => {
    await expect(
      suggestCards({ sourceText: "x", mode: "initial" }, fakeGenerate("não é json")),
    ).rejects.toThrow();
  });
});
