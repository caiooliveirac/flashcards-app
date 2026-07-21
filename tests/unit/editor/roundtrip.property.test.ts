import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import {
  collectClozeInlines,
  noteContentSchema,
  type Block,
  type Inline,
} from "@/lib/content/schema";
import { collectGroupKeysFromDoc } from "@/lib/editor/cloze-node";
import { editorExtensions } from "@/lib/editor/extensions";
import { noteContentToPmDocs, parseBlocksToPmDoc } from "@/lib/editor/parse";
import { pmDocsToNoteContent, serializePmToBlocks } from "@/lib/editor/serialize";
import {
  basicNoteContentArb,
  canonicalBlocksArb,
  clozeNoteContentArb,
  exoticBlocksArb,
} from "./generators";

const clozeSchema = getSchema(editorExtensions({ mode: "cloze" }));

function uniqueGroupKeys(blocks: Array<Block<Inline>>): string[] {
  const keys: string[] = [];
  for (const c of collectClozeInlines(blocks)) {
    if (!keys.includes(c.groupKey)) keys.push(c.groupKey);
  }
  return keys;
}

function hasNoClozeInline(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasNoClozeInline);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "cloze") return false;
    return Object.values(record).every(hasNoClozeInline);
  }
  return true;
}

describe("round-trip PM <-> NoteContentV1 (aceite F2#6)", () => {
  it("serialize(parse(blocks)) === blocks para blocks canônicos (cloze)", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(true), (blocks) => {
        expect(serializePmToBlocks(parseBlocksToPmDoc(blocks))).toStrictEqual(blocks);
      }),
    );
  });

  it("serialize(parse(blocks)) === blocks para blocks canônicos (basic, sem cloze)", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(false), (blocks) => {
        expect(serializePmToBlocks(parseBlocksToPmDoc(blocks))).toStrictEqual(blocks);
      }),
    );
  });

  it("parse(serialize(doc)) === doc para docs PM canônicos", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(true), (blocks) => {
        const doc = parseBlocksToPmDoc(blocks);
        expect(parseBlocksToPmDoc(serializePmToBlocks(doc))).toStrictEqual(doc);
      }),
    );
  });

  it("groupKeys de cloze preservam identidade e ordem de aparição", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(true), (blocks) => {
        const doc = parseBlocksToPmDoc(blocks);
        expect(collectGroupKeysFromDoc(doc)).toStrictEqual(uniqueGroupKeys(blocks));
        const roundTripped = serializePmToBlocks(doc);
        expect(uniqueGroupKeys(roundTripped)).toStrictEqual(uniqueGroupKeys(blocks));
      }),
    );
  });

  it("parse é total e produz doc válido no schema PM real, mesmo com math/formula/callout", () => {
    fc.assert(
      fc.property(exoticBlocksArb, (blocks) => {
        const doc = parseBlocksToPmDoc(blocks);
        // Válido contra o schema restrito do editor (nodeFromJSON + check).
        expect(() => clozeSchema.nodeFromJSON(doc).check()).not.toThrow();
        // serialize também é total e nunca devolve nós sem UI na F2.
        const back = serializePmToBlocks(doc);
        for (const b of back) {
          expect(b.type).not.toBe("formula");
          expect(b.type).not.toBe("callout");
        }
      }),
      { numRuns: 50 },
    );
  });

  it("imagem sem assetId é descartada (injetada em doc arbitrário)", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(true), (blocks) => {
        const doc = parseBlocksToPmDoc(blocks);
        const polluted = {
          ...doc,
          content: [
            ...(doc.content ?? []),
            { type: "image", attrs: { assetId: null, alt: "quebrada" } },
          ],
        };
        expect(serializePmToBlocks(polluted)).toStrictEqual(serializePmToBlocks(doc));
      }),
    );
  });

  it("nota cloze: noteContentToPmDocs -> pmDocsToNoteContent é identidade e zod-válida", () => {
    fc.assert(
      fc.property(clozeNoteContentArb, (content) => {
        const docs = noteContentToPmDocs(content);
        expect(docs.text).toBeDefined();
        const back = pmDocsToNoteContent("cloze", { text: docs.text ?? { type: "doc" } });
        expect(back).toStrictEqual(content);
        expect(noteContentSchema.safeParse(back).success).toBe(true);
      }),
    );
  });

  it("nota basic: round-trip é identidade e zod-válida", () => {
    fc.assert(
      fc.property(basicNoteContentArb, (content) => {
        const docs = noteContentToPmDocs(content);
        const back = pmDocsToNoteContent("basic", {
          front: docs.front ?? { type: "doc" },
          back: docs.back ?? { type: "doc" },
        });
        expect(back).toStrictEqual(content);
        expect(noteContentSchema.safeParse(back).success).toBe(true);
      }),
    );
  });

  it("doc com cloze serializado como basic desembrulha tudo e permanece zod-válido", () => {
    fc.assert(
      fc.property(canonicalBlocksArb(true), (blocks) => {
        const doc = parseBlocksToPmDoc(blocks);
        const content = pmDocsToNoteContent("basic", { front: doc, back: { type: "doc" } });
        expect(hasNoClozeInline(content.front)).toBe(true);
        expect(noteContentSchema.safeParse(content).success).toBe(true);
      }),
    );
  });
});
