import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { noteContentSchema, type Block, type Inline } from "@/lib/content/schema";
import { collectGroupKeysFromDoc } from "@/lib/editor/cloze-node";
import { editorExtensions } from "@/lib/editor/extensions";
import { noteContentToPmDocs, parseBlocksToPmDoc } from "@/lib/editor/parse";
import { pmDocsToNoteContent, serializePmToBlocks } from "@/lib/editor/serialize";

const clozeSchema = getSchema(editorExtensions({ mode: "cloze" }));

const ASSET_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

/** Doc realista: heading + parágrafo com highlight e 2 grupos cloze + lista aninhada + code. */
const realisticBlocks: Array<Block<Inline>> = [
  { type: "heading", level: 2, content: [{ type: "text", text: "Farmacologia" }] },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "O antídoto da " },
      { type: "text", text: "intoxicação digitálica", marks: ["highlight"] },
      { type: "text", text: " é " },
      {
        type: "cloze",
        groupKey: "g1",
        hint: "anticorpo",
        content: [{ type: "text", text: "anti-digoxina Fab", marks: ["bold"] }],
      },
      { type: "text", text: "." },
    ],
  },
  {
    type: "list",
    ordered: false,
    items: [
      {
        blocks: [
          { type: "paragraph", content: [{ type: "text", text: "Indicações" }] },
          {
            type: "list",
            ordered: true,
            items: [
              {
                blocks: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "K+ > " },
                      {
                        type: "cloze",
                        groupKey: "g2",
                        content: [{ type: "text", text: "5,5 mEq/L" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        blocks: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "dose dupla", marks: ["italic", "highlight"] }],
          },
        ],
      },
    ],
  },
  { type: "codeBlock", language: "ts", text: "const dose = pesoKg * 0.5;" },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "Mesmo grupo: " },
      { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "Fab" }] },
    ],
  },
];

describe("fixture realista", () => {
  it("faz round-trip exato e é válido no schema PM real e no zod", () => {
    const doc = parseBlocksToPmDoc(realisticBlocks);
    expect(serializePmToBlocks(doc)).toStrictEqual(realisticBlocks);
    expect(() => clozeSchema.nodeFromJSON(doc).check()).not.toThrow();
    const content = pmDocsToNoteContent("cloze", { text: doc });
    expect(noteContentSchema.safeParse(content).success).toBe(true);
    expect(collectGroupKeysFromDoc(doc)).toStrictEqual(["g1", "g2"]);
  });
});

describe("normalizações do serializer", () => {
  it("reordena marks para a ordem canônica e deduplica", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "code" }, { type: "bold" }, { type: "code" }],
            },
          ],
        },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "x", marks: ["bold", "code"] }] },
    ]);
  });

  it("descarta marks desconhecidos do formato", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "https://a" } }, { type: "bold" }],
            },
          ],
        },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "x", marks: ["bold"] }] },
    ]);
  });

  it("mescla text nodes adjacentes com marks idênticos", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "text", text: "c" },
          ],
        },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "ab", marks: ["bold"] },
          { type: "text", text: "c" },
        ],
      },
    ]);
  });

  it("descarta no máximo um parágrafo vazio final (TrailingNode), exceto se único", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
        { type: "paragraph" },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "x" }] },
    ]);
    expect(serializePmToBlocks({ type: "doc", content: [{ type: "paragraph" }] })).toStrictEqual([
      { type: "paragraph", content: [] },
    ]);
  });

  it("descarta imagem sem assetId e preserva alt quando presente", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "blob:x", assetId: null, alt: "sem upload" } },
        { type: "image", attrs: { src: "blob:y", assetId: ASSET_ID, alt: "ok" } },
        { type: "image", attrs: { assetId: ASSET_ID, alt: null } },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "image", assetId: ASSET_ID, alt: "ok" },
      { type: "image", assetId: ASSET_ID },
    ]);
  });

  it("descarta cloze vazio e desembrulha groupKey inválido", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "cloze", attrs: { groupKey: "g1", hint: null }, content: [] },
            { type: "text", text: "a" },
            {
              type: "cloze",
              attrs: { groupKey: "c1", hint: null },
              content: [{ type: "text", text: "b" }],
            },
          ],
        },
      ],
    };
    // cloze vazio some; groupKey "c1" (inválido) desembrulha e mescla com o vizinho
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "ab" }] },
    ]);
  });

  it("desembrulha cloze em nota basic (pmDocsToNoteContent)", () => {
    const front: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a " },
            {
              type: "cloze",
              attrs: { groupKey: "g1", hint: "h" },
              content: [{ type: "text", text: "b" }],
            },
          ],
        },
      ],
    };
    const content = pmDocsToNoteContent("basic", { front, back: { type: "doc" } });
    expect(content).toStrictEqual({
      schemaVersion: 1,
      kind: "basic",
      front: [{ type: "paragraph", content: [{ type: "text", text: "a b" }] }],
      back: [],
    });
    expect(noteContentSchema.safeParse(content).success).toBe(true);
  });

  it("verso basic com um único parágrafo vazio normaliza para []", () => {
    const content = pmDocsToNoteContent("basic", {
      front: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "f" }] }] },
      back: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(content.back).toStrictEqual([]);
    expect(content.front).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "f" }] },
    ]);
  });

  it("codeBlock: language null vira ausente e texto concatena múltiplos text nodes", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: null },
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([{ type: "codeBlock", text: "ab" }]);
  });

  it("nível de heading fora de 1-3 normaliza para 1 e nós desconhecidos são descartados", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "t" }] },
        { type: "horizontalRule" },
        { type: "blockquote", content: [{ type: "paragraph" }] },
      ],
    };
    expect(serializePmToBlocks(doc)).toStrictEqual([
      { type: "heading", level: 1, content: [{ type: "text", text: "t" }] },
    ]);
  });
});

describe("representação de nós sem UI na F2 (lossy, determinística)", () => {
  it("formula vira parágrafo com o latex literal", () => {
    const doc = parseBlocksToPmDoc([{ type: "formula", latex: "E=mc^2" }]);
    expect(doc.content).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "E=mc^2" }] },
    ]);
    expect(() => clozeSchema.nodeFromJSON(doc).check()).not.toThrow();
  });

  it("math inline vira text node literal", () => {
    const doc = parseBlocksToPmDoc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "área: " },
          { type: "math", latex: "\\pi r^2" },
        ],
      },
    ]);
    expect(doc.content).toStrictEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "área: " },
          { type: "text", text: "\\pi r^2" },
        ],
      },
    ]);
  });

  it("callout é achatado nos blocos filhos", () => {
    const doc = parseBlocksToPmDoc([
      {
        type: "callout",
        variant: "warning",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "cuidado" }] },
          { type: "codeBlock", text: "x" },
        ],
      },
    ]);
    expect(doc.content).toStrictEqual([
      { type: "paragraph", content: [{ type: "text", text: "cuidado" }] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x" }] },
    ]);
  });

  it("item de lista sem parágrafo inicial ganha parágrafo vazio (schema PM exige)", () => {
    const doc = parseBlocksToPmDoc([
      {
        type: "list",
        ordered: true,
        items: [{ blocks: [{ type: "codeBlock", text: "x" }] }],
      },
    ]);
    expect(doc.content?.[0]?.content?.[0]?.content?.[0]).toStrictEqual({ type: "paragraph" });
    expect(() => clozeSchema.nodeFromJSON(doc).check()).not.toThrow();
  });

  it("parse: code é exclusivo (excludes '_' no editor) e marks seguem o rank do schema", () => {
    const doc = parseBlocksToPmDoc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a", marks: ["code", "bold"] },
          { type: "text", text: "b", marks: ["highlight", "bold"] },
        ],
      },
    ]);
    expect(doc.content?.[0]?.content).toStrictEqual([
      { type: "text", text: "a", marks: [{ type: "code" }] },
      { type: "text", text: "b", marks: [{ type: "bold" }, { type: "highlight" }] },
    ]);
    expect(() => clozeSchema.nodeFromJSON(doc).check()).not.toThrow();
  });

  it("blocks vazios viram doc com parágrafo único", () => {
    expect(parseBlocksToPmDoc([])).toStrictEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("noteContentToPmDocs", () => {
  it("basic devolve front/back; cloze devolve text", () => {
    const basic = noteContentToPmDocs({
      schemaVersion: 1,
      kind: "basic",
      front: [{ type: "paragraph", content: [{ type: "text", text: "f" }] }],
      back: [],
    });
    expect(basic.front).toBeDefined();
    expect(basic.back).toStrictEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(basic.text).toBeUndefined();

    const cloze = noteContentToPmDocs({
      schemaVersion: 1,
      kind: "cloze",
      text: [
        {
          type: "paragraph",
          content: [
            { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "x" }] },
          ],
        },
      ],
    });
    expect(cloze.front).toBeUndefined();
    expect(collectGroupKeysFromDoc(cloze.text ?? { type: "doc" })).toStrictEqual(["g1"]);
  });
});

describe("collectGroupKeysFromDoc", () => {
  it("deduplica preservando ordem de aparição e ignora docs sem cloze", () => {
    const doc = parseBlocksToPmDoc([
      {
        type: "paragraph",
        content: [
          { type: "cloze", groupKey: "g2", content: [{ type: "text", text: "a" }] },
          { type: "cloze", groupKey: "g1", content: [{ type: "text", text: "b" }] },
          { type: "cloze", groupKey: "g2", content: [{ type: "text", text: "c" }] },
        ],
      },
    ]);
    expect(collectGroupKeysFromDoc(doc)).toStrictEqual(["g2", "g1"]);
    expect(collectGroupKeysFromDoc({ type: "doc", content: [{ type: "paragraph" }] })).toStrictEqual([]);
  });
});
