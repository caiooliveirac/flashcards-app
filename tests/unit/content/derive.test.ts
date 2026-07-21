import { createHash } from "node:crypto";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalizeText,
  clozePreviewCards,
  deriveCards,
  deriveSearchText,
  nextGroupKey,
} from "@/lib/content/derive";
import {
  collectClozeInlines,
  parseNoteContent,
  type BasicNoteContent,
  type ClozeNoteContent,
} from "@/lib/content/schema";
import { clozeNoteArb, noteContentArb } from "./generators";

const NUL = String.fromCharCode(0);

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";

const basicFixture: BasicNoteContent = {
  schemaVersion: 1,
  kind: "basic",
  front: [
    { type: "paragraph", content: [{ type: "text", text: "Qual a capital?" }] },
  ],
  back: [{ type: "paragraph", content: [{ type: "text", text: "Brasília" }] }],
};

const clozeFixture: ClozeNoteContent = {
  schemaVersion: 1,
  kind: "cloze",
  text: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A capital do Brasil é " },
        {
          type: "cloze",
          groupKey: "g1",
          hint: "cidade",
          content: [{ type: "text", text: "Brasília" }],
        },
        { type: "text", text: " e a da França é " },
        {
          type: "cloze",
          groupKey: "g2",
          content: [{ type: "text", text: "Paris" }],
        },
      ],
    },
  ],
};

describe("canonicalizeText", () => {
  it("colapsa whitespace, faz trim e normaliza NFC sem baixar caixa", () => {
    expect(canonicalizeText("  a \n b\t c ")).toBe("a b c");
    expect(canonicalizeText("e\u0301clair")).toBe("\u00e9clair");
    expect(canonicalizeText("AbC")).toBe("AbC");
    expect(canonicalizeText("   ")).toBe("");
  });

  it("é idempotente (property)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        const once = canonicalizeText(s);
        expect(canonicalizeText(once)).toBe(once);
      }),
    );
  });
});

describe("deriveCards — basic", () => {
  it("gera exatamente 1 card com fingerprint no formato canonical(front) + NUL + canonical(back)", () => {
    const cards = deriveCards(basicFixture);
    expect(cards).toEqual([
      {
        clozeGroupKey: null,
        fingerprint: sha256hex("Qual a capital?" + NUL + "Brasília"),
      },
    ]);
  });

  it("usa placeholders determinísticos [img:assetId] e [math:latex]", () => {
    const content: BasicNoteContent = {
      schemaVersion: 1,
      kind: "basic",
      front: [
        { type: "paragraph", content: [{ type: "text", text: "Veja:" }] },
        { type: "image", assetId: ASSET_ID, alt: "mapa" },
      ],
      back: [
        { type: "formula", latex: "E=mc^2" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ou " },
            { type: "math", latex: "x^2" },
          ],
        },
      ],
    };
    const expected = sha256hex(
      "Veja: [img:" + ASSET_ID + "]" + NUL + "[math:E=mc^2] ou [math:x^2]",
    );
    expect(deriveCards(content)).toEqual([
      { clozeGroupKey: null, fingerprint: expected },
    ]);
  });

  it("fingerprint ignora diferenças de whitespace (canonicalização)", () => {
    const spaced: BasicNoteContent = {
      schemaVersion: 1,
      kind: "basic",
      front: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "  Qual   a capital? " }],
        },
      ],
      back: [
        { type: "paragraph", content: [{ type: "text", text: "Brasília  " }] },
      ],
    };
    expect(deriveCards(spaced)).toEqual(deriveCards(basicFixture));
  });
});

describe("deriveCards — cloze", () => {
  it("nota com 2 grupos gera 2 cards na ordem de primeira aparição (aceite F2#2)", () => {
    const cards = deriveCards(clozeFixture);
    expect(cards.map((c) => c.clozeGroupKey)).toEqual(["g1", "g2"]);
    const fps = new Set(cards.map((c) => c.fingerprint));
    expect(fps.size).toBe(2);
  });

  it("fingerprint = sha256(texto com o grupo oculto + NUL + resposta do grupo)", () => {
    const cards = deriveCards(clozeFixture);
    expect(cards).toEqual([
      {
        clozeGroupKey: "g1",
        fingerprint: sha256hex(
          "A capital do Brasil é [...] e a da França é Paris" + NUL + "Brasília",
        ),
      },
      {
        clozeGroupKey: "g2",
        fingerprint: sha256hex(
          "A capital do Brasil é Brasília e a da França é [...]" + NUL + "Paris",
        ),
      },
    ]);
  });

  it("duas ocultações no MESMO grupo geram 1 card com resposta concatenada", () => {
    const content: ClozeNoteContent = {
      schemaVersion: 1,
      kind: "cloze",
      text: [
        {
          type: "paragraph",
          content: [
            { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "Rio" }] },
            { type: "text", text: " fica no " },
            { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "Brasil" }] },
          ],
        },
      ],
    };
    expect(deriveCards(content)).toEqual([
      {
        clozeGroupKey: "g1",
        fingerprint: sha256hex("[...] fica no [...]" + NUL + "Rio Brasil"),
      },
    ]);
  });

  it("hint NÃO entra no fingerprint", () => {
    const noHint: ClozeNoteContent = JSON.parse(
      JSON.stringify(clozeFixture),
    ) as ClozeNoteContent;
    const first = noHint.text[0];
    if (first?.type === "paragraph") {
      const cloze = first.content[1];
      if (cloze?.type === "cloze") delete cloze.hint;
    }
    expect(deriveCards(noHint)).toEqual(deriveCards(clozeFixture));
  });

  it("é determinístico e gera 1 card por grupo distinto (property)", () => {
    fc.assert(
      fc.property(clozeNoteArb, (content) => {
        const a = deriveCards(content);
        const b = deriveCards(content);
        expect(b).toEqual(a);
        const seen = new Set<string>();
        const expectedKeys: string[] = [];
        for (const c of collectClozeInlines(content.text)) {
          if (!seen.has(c.groupKey)) {
            seen.add(c.groupKey);
            expectedKeys.push(c.groupKey);
          }
        }
        expect(a.map((c) => c.clozeGroupKey)).toEqual(expectedKeys);
      }),
    );
  });

  it("fingerprint é estável sob re-serialização JSON + parse Zod (property)", () => {
    fc.assert(
      fc.property(noteContentArb, (content) => {
        const round = parseNoteContent(JSON.parse(JSON.stringify(content)));
        expect(deriveCards(round)).toEqual(deriveCards(content));
        expect(deriveSearchText(round)).toBe(deriveSearchText(content));
      }),
    );
  });
});

describe("deriveSearchText", () => {
  it("revela cloze, ignora hint, inclui alt/latex/codeBlock, ordem front-back", () => {
    const content: ClozeNoteContent = {
      schemaVersion: 1,
      kind: "cloze",
      text: [
        ...clozeFixture.text,
        { type: "image", assetId: ASSET_ID, alt: "mapa do Brasil" },
        { type: "formula", latex: "E=mc^2" },
        { type: "codeBlock", text: "print('oi')" },
      ],
    };
    expect(deriveSearchText(content)).toBe(
      "A capital do Brasil é Brasília e a da França é Paris mapa do Brasil E=mc^2 print('oi')",
    );

    const basic: BasicNoteContent = {
      schemaVersion: 1,
      kind: "basic",
      front: [{ type: "paragraph", content: [{ type: "text", text: "Frente" }] }],
      back: [{ type: "paragraph", content: [{ type: "text", text: "Verso" }] }],
    };
    expect(deriveSearchText(basic)).toBe("Frente Verso");
  });

  it("nunca contém [...] nem o texto do hint (property)", () => {
    fc.assert(
      fc.property(clozeNoteArb, (content) => {
        const text = deriveSearchText(content);
        expect(text.includes("[...]")).toBe(false);
        expect(text.includes("dica-secreta")).toBe(false);
      }),
    );
  });
});

describe("clozePreviewCards", () => {
  it("frontText oculta só o grupo, answerText revela, hint = primeiro hint do grupo", () => {
    expect(clozePreviewCards(clozeFixture)).toEqual([
      {
        groupKey: "g1",
        frontText: "A capital do Brasil é [...] e a da França é Paris",
        answerText: "Brasília",
        hint: "cidade",
      },
      {
        groupKey: "g2",
        frontText: "A capital do Brasil é Brasília e a da França é [...]",
        answerText: "Paris",
      },
    ]);
  });

  it("gera um preview por grupo, na mesma ordem de deriveCards (property)", () => {
    fc.assert(
      fc.property(clozeNoteArb, (content) => {
        const previews = clozePreviewCards(content);
        const cards = deriveCards(content);
        expect(previews.map((p) => p.groupKey)).toEqual(
          cards.map((c) => c.clozeGroupKey),
        );
        for (const p of previews) {
          expect(p.frontText.includes("[...]")).toBe(true);
        }
      }),
    );
  });
});

describe("nextGroupKey", () => {
  it("casos fixos: menor gN livre sem reutilizar", () => {
    expect(nextGroupKey([])).toBe("g1");
    expect(nextGroupKey(["g1", "g3"])).toBe("g2");
    expect(nextGroupKey(["g2"])).toBe("g1");
    expect(nextGroupKey(["g1", "g2"])).toBe("g3");
    expect(nextGroupKey(["foo", "g1"])).toBe("g2");
    expect(nextGroupKey(["g10"])).toBe("g1");
  });

  it("nunca colide e é mínimo (property)", () => {
    const keyArb = fc.oneof(
      fc.integer({ min: 1, max: 30 }).map((n) => "g" + String(n)),
      fc.constantFrom("foo", "G1", "g", "g01x"),
    );
    fc.assert(
      fc.property(fc.array(keyArb, { maxLength: 40 }), (existing) => {
        const next = nextGroupKey(existing);
        expect(/^g\d+$/.test(next)).toBe(true);
        expect(existing.includes(next)).toBe(false);
        const n = Number.parseInt(next.slice(1), 10);
        for (let m = 1; m < n; m += 1) {
          expect(existing.includes("g" + String(m))).toBe(true);
        }
      }),
    );
  });
});
