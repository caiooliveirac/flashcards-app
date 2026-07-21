import fc from "fast-check";
import type {
  BasicNoteContent,
  Block,
  ClozeInline,
  ClozeNoteContent,
  Inline,
  Mark,
  TextInline,
} from "@/lib/content/schema";

/**
 * Geradores de NoteContentV1 CANÔNICO — a forma que o serializer produz:
 * marks na ordem canônica, sem text nodes adjacentes com marks idênticos,
 * sem parágrafo vazio no fim do doc, itens de lista começando com parágrafo.
 * Sobre essa forma o round-trip parse∘serialize/serialize∘parse é identidade
 * exata. math/formula/callout (sem UI na F2, lossy) ficam nos geradores
 * "exóticos", usados só nos testes de totalidade.
 */

function marksKey(t: TextInline): string {
  return (t.marks ?? []).join("|");
}

/** Mescla text nodes adjacentes com marks idênticos (canonicalização do gerador). */
export function mergeAdjacentTexts<T extends Inline>(inlines: T[]): T[] {
  const out: T[] = [];
  for (const inline of inlines) {
    const prev = out[out.length - 1];
    if (
      inline.type === "text" &&
      prev !== undefined &&
      prev.type === "text" &&
      marksKey(prev) === marksKey(inline)
    ) {
      const merged: TextInline = prev.marks
        ? { type: "text", text: prev.text + inline.text, marks: prev.marks }
        : { type: "text", text: prev.text + inline.text };
      out[out.length - 1] = merged as T;
    } else {
      out.push(inline);
    }
  }
  return out;
}

/**
 * Combos de marks válidos no schema do EDITOR: code é exclusivo
 * (Tiptap Code: excludes '_'); os demais combinam livremente na ordem canônica.
 */
const marksArb: fc.Arbitrary<Mark[]> = fc.oneof(
  { weight: 5, arbitrary: fc.subarray(["bold", "italic", "highlight"] as Mark[]) },
  { weight: 1, arbitrary: fc.constant<Mark[]>(["code"]) },
);

export const textArb: fc.Arbitrary<TextInline> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 12 }),
    marks: marksArb,
  })
  .map(({ text, marks }) =>
    marks.length > 0 ? { type: "text", text, marks } : { type: "text", text },
  );

export const groupKeyArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 9999 })
  .map((n) => `g${n}`);

export const clozeArb: fc.Arbitrary<ClozeInline> = fc
  .record({
    groupKey: groupKeyArb,
    hint: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    content: fc
      .array(textArb, { minLength: 1, maxLength: 3 })
      .map((texts) => mergeAdjacentTexts(texts)),
  })
  .map(({ groupKey, hint, content }) =>
    hint === undefined
      ? { type: "cloze", groupKey, content }
      : { type: "cloze", groupKey, hint, content },
  );

export function inlinesArb(allowCloze: boolean): fc.Arbitrary<Inline[]> {
  const inlineArb: fc.Arbitrary<Inline> = allowCloze
    ? fc.oneof({ weight: 4, arbitrary: textArb }, { weight: 1, arbitrary: clozeArb })
    : textArb;
  return fc.array(inlineArb, { maxLength: 5 }).map(mergeAdjacentTexts);
}

const paragraphArb = (allowCloze: boolean): fc.Arbitrary<Block<Inline>> =>
  fc.record({ content: inlinesArb(allowCloze) }).map(({ content }) => ({
    type: "paragraph",
    content,
  }));

const headingArb = (allowCloze: boolean): fc.Arbitrary<Block<Inline>> =>
  fc
    .record({
      level: fc.constantFrom(1 as const, 2 as const, 3 as const),
      content: inlinesArb(allowCloze),
    })
    .map(({ level, content }) => ({ type: "heading", level, content }));

const codeBlockArb: fc.Arbitrary<Block<Inline>> = fc
  .record({
    language: fc.option(fc.constantFrom("ts", "js", "python", "latex"), {
      nil: undefined,
    }),
    text: fc.string({ maxLength: 40 }),
  })
  .map(({ language, text }) =>
    language === undefined
      ? { type: "codeBlock", text }
      : { type: "codeBlock", language, text },
  );

const imageArb: fc.Arbitrary<Block<Inline>> = fc
  .record({
    assetId: fc.uuid({ version: 4 }),
    alt: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  })
  .map(({ assetId, alt }) =>
    alt === undefined ? { type: "image", assetId } : { type: "image", assetId, alt },
  );

function listArb(depth: number, allowCloze: boolean): fc.Arbitrary<Block<Inline>> {
  // Canônico: primeiro bloco de cada item é parágrafo (exigência do listItem PM).
  const itemArb = fc
    .record({
      first: paragraphArb(allowCloze),
      rest: fc.array(innerBlockArb(depth - 1, allowCloze), { maxLength: 2 }),
    })
    .map(({ first, rest }) => ({ blocks: [first, ...rest] }));
  return fc
    .record({
      ordered: fc.boolean(),
      items: fc.array(itemArb, { minLength: 1, maxLength: 3 }),
    })
    .map(({ ordered, items }) => ({ type: "list", ordered, items }));
}

function innerBlockArb(depth: number, allowCloze: boolean): fc.Arbitrary<Block<Inline>> {
  const base = [
    { weight: 4, arbitrary: paragraphArb(allowCloze) },
    { weight: 2, arbitrary: headingArb(allowCloze) },
    { weight: 1, arbitrary: codeBlockArb },
    { weight: 1, arbitrary: imageArb },
  ];
  if (depth > 0) base.push({ weight: 1, arbitrary: listArb(depth, allowCloze) });
  return fc.oneof(...base);
}

/** Último bloco nunca é parágrafo vazio (normalização de trailing do serializer). */
function fixTrailing(blocks: Array<Block<Inline>>): Array<Block<Inline>> {
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.type === "paragraph" && last.content.length === 0) {
    return [
      ...blocks.slice(0, -1),
      { type: "paragraph", content: [{ type: "text", text: "fim" }] },
    ];
  }
  return blocks;
}

export function canonicalBlocksArb(allowCloze: boolean): fc.Arbitrary<Array<Block<Inline>>> {
  return fc
    .array(innerBlockArb(1, allowCloze), { minLength: 1, maxLength: 4 })
    .map(fixTrailing);
}

/** Nota cloze válida (>= 1 ocultação garantida no primeiro parágrafo). */
export const clozeNoteContentArb: fc.Arbitrary<ClozeNoteContent> = fc
  .record({ lead: clozeArb, blocks: canonicalBlocksArb(true) })
  .map(({ lead, blocks }) => ({
    schemaVersion: 1,
    kind: "cloze",
    text: [{ type: "paragraph", content: [lead] }, ...blocks],
  }));

/** Nota basic válida (front/back sem cloze). */
export const basicNoteContentArb: fc.Arbitrary<BasicNoteContent> = fc
  .record({
    front: canonicalBlocksArb(false),
    back: fc.oneof(
      canonicalBlocksArb(false),
      fc.constant([] as Array<Block<Inline>>),
    ),
  })
  .map(({ front, back }) => ({
    schemaVersion: 1,
    kind: "basic",
    front: front as BasicNoteContent["front"],
    back: back as BasicNoteContent["back"],
  }));

// --- Geradores "exóticos": nós sem UI de editor na F2 (representação lossy) ---

const mathArb: fc.Arbitrary<Inline> = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((latex) => ({ type: "math", latex }));

const formulaArb: fc.Arbitrary<Block<Inline>> = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((latex) => ({ type: "formula", latex }));

function calloutArb(allowCloze: boolean): fc.Arbitrary<Block<Inline>> {
  return fc
    .record({
      variant: fc.constantFrom(
        "info" as const,
        "warning" as const,
        "success" as const,
        "danger" as const,
      ),
      content: fc.array(paragraphArb(allowCloze), { minLength: 1, maxLength: 2 }),
    })
    .map(({ variant, content }) => ({ type: "callout", variant, content }));
}

const exoticParagraphArb: fc.Arbitrary<Block<Inline>> = fc
  .array(fc.oneof(textArb, mathArb, clozeArb), { maxLength: 4 })
  .map((content) => ({ type: "paragraph", content }));

/** Blocks incluindo math/formula/callout — só para testes de totalidade do parse. */
export const exoticBlocksArb: fc.Arbitrary<Array<Block<Inline>>> = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: exoticParagraphArb },
    { weight: 1, arbitrary: formulaArb },
    { weight: 1, arbitrary: calloutArb(true) },
    { weight: 1, arbitrary: codeBlockArb },
    { weight: 1, arbitrary: imageArb },
  ),
  { minLength: 1, maxLength: 4 },
);
