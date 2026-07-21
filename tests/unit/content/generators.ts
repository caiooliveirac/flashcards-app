import * as fc from "fast-check";
import type {
  BasicBlock,
  BasicNoteContent,
  Block,
  ClozeBlock,
  ClozeInline,
  ClozeNoteContent,
  Inline,
  TextInline,
} from "@/lib/content/schema";
import type { CardMatchPlan, ExistingCardInfo } from "@/lib/content/match";

/**
 * Geradores fast-check de NoteContent VÁLIDO (basic e cloze) + helpers de
 * mutação estrutural usados nas properties de matching (§5).
 * Convenção dos pools: hints usam o marcador "dica-secreta" (nunca aparece
 * nos textos) para provar que hint é ignorado na derivação.
 */

// "[" vira "(" para as properties poderem afirmar que "[...]" so vem de cloze oculto.
const plainTextArb = fc
  .oneof(
    fc.string({ minLength: 1, maxLength: 12 }),
    fc.constantFrom("café", "e\u0301clair", " espaço  duplo ", "Palavra", "AbC"),
  )
  .map((s) => s.replace(/\[/g, "("));

export const textInlineArb: fc.Arbitrary<TextInline> = plainTextArb.map(
  (text) => ({ type: "text", text }),
);

const mathInlineArb = fc
  .constantFrom("x^2", "\\frac{a}{b}", "E=mc^2")
  .map((latex) => ({ type: "math" as const, latex }));

const uuidArb = fc.uuid({ version: 4 });

const imageBlockArb = fc
  .tuple(uuidArb, fc.option(fc.constantFrom("mapa", "figura 1"), { nil: undefined }))
  .map(([assetId, alt]) =>
    alt === undefined
      ? { type: "image" as const, assetId }
      : { type: "image" as const, assetId, alt },
  );

const codeBlockArb = fc
  .constantFrom("print('oi')", "let x = 1;")
  .map((text) => ({ type: "codeBlock" as const, text }));

const formulaBlockArb = fc
  .constantFrom("a^2+b^2=c^2", "\\int_0^1 x dx")
  .map((latex) => ({ type: "formula" as const, latex }));

const basicParagraphArb: fc.Arbitrary<BasicBlock> = fc
  .array(fc.oneof(textInlineArb, mathInlineArb), { minLength: 1, maxLength: 4 })
  .map((content) => ({ type: "paragraph", content }));

const basicBlockArb: fc.Arbitrary<BasicBlock> = fc.oneof(
  { weight: 4, arbitrary: basicParagraphArb },
  { weight: 1, arbitrary: imageBlockArb },
  { weight: 1, arbitrary: codeBlockArb },
  { weight: 1, arbitrary: formulaBlockArb },
);

export const basicNoteArb: fc.Arbitrary<BasicNoteContent> = fc
  .tuple(
    fc.array(basicBlockArb, { minLength: 1, maxLength: 3 }),
    fc.array(basicBlockArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([front, back]) => ({
    schemaVersion: 1,
    kind: "basic",
    front,
    back,
  }));

/** Parágrafo garantindo UMA ocultação do grupo dado (com hint opcional marcada). */
function clozeParagraphArb(groupKey: string): fc.Arbitrary<ClozeBlock> {
  return fc
    .tuple(
      plainTextArb,
      fc.array(textInlineArb, { minLength: 1, maxLength: 2 }),
      fc.option(fc.constant("dica-secreta"), { nil: undefined }),
      plainTextArb,
    )
    .map(([before, clozeContent, hint, after]) => {
      const cloze: ClozeInline =
        hint === undefined
          ? { type: "cloze", groupKey, content: clozeContent }
          : { type: "cloze", groupKey, content: clozeContent, hint };
      return {
        type: "paragraph",
        content: [
          { type: "text", text: before },
          cloze,
          { type: "text", text: after },
        ],
      };
    });
}

const extraClozeBlockArb: fc.Arbitrary<ClozeBlock> = fc.oneof(
  { weight: 3, arbitrary: basicParagraphArb as fc.Arbitrary<ClozeBlock> },
  { weight: 1, arbitrary: imageBlockArb },
  { weight: 1, arbitrary: codeBlockArb },
  { weight: 1, arbitrary: formulaBlockArb },
);

/** Nota cloze válida com 1..4 grupos (g1..gN, primeira aparição na ordem). */
export const clozeNoteArb: fc.Arbitrary<ClozeNoteContent> = fc
  .integer({ min: 1, max: 4 })
  .chain((n) => {
    const keys = Array.from({ length: n }, (_, i) => "g" + String(i + 1));
    return fc
      .tuple(
        fc.tuple(...keys.map(clozeParagraphArb)),
        fc.array(extraClozeBlockArb, { minLength: 0, maxLength: 2 }),
        // Às vezes o grupo 1 tem uma SEGUNDA ocultação (multi-ocultação).
        fc.option(clozeParagraphArb(keys[0] ?? "g1"), { nil: undefined }),
      )
      .map(([groupParagraphs, extra, secondOcclusion]) => ({
        schemaVersion: 1 as const,
        kind: "cloze" as const,
        text:
          secondOcclusion === undefined
            ? [...groupParagraphs, ...extra]
            : [...groupParagraphs, ...extra, secondOcclusion],
      }));
  });

export const noteContentArb = fc.oneof(basicNoteArb, clozeNoteArb);

// --- Helpers de mutação estrutural (simulam edições do usuário) ---

function mapClozeInlines(
  blocks: Array<Block<Inline>>,
  f: (c: ClozeInline) => Inline,
): Array<Block<Inline>> {
  const mapInline = (i: Inline): Inline => (i.type === "cloze" ? f(i) : i);
  const walk = (bs: Array<Block<Inline>>): Array<Block<Inline>> =>
    bs.map((b) => {
      switch (b.type) {
        case "paragraph":
        case "heading":
          return { ...b, content: b.content.map(mapInline) };
        case "list":
          return { ...b, items: b.items.map((it) => ({ blocks: walk(it.blocks) })) };
        case "callout":
          return { ...b, content: walk(b.content) };
        default:
          return b;
      }
    });
  return walk(blocks);
}

/** Renomeia um groupKey (simula o editor recriar o node com UniqueID novo). */
export function renameGroup(
  content: ClozeNoteContent,
  from: string,
  to: string,
): ClozeNoteContent {
  return {
    ...content,
    text: mapClozeInlines(content.text, (c) =>
      c.groupKey === from ? { ...c, groupKey: to } : c,
    ),
  };
}

/** Remove as ocultações de um grupo revelando o texto (a nota deve manter >= 1 cloze). */
export function removeGroup(
  content: ClozeNoteContent,
  key: string,
): ClozeNoteContent {
  return {
    ...content,
    text: mapClozeInlines(content.text, (c) =>
      c.groupKey === key
        ? { type: "text", text: c.content.map((t) => t.text).join("") }
        : c,
    ),
  };
}

/** Acrescenta um parágrafo com ocultação nova no fim (simula criar grupo novo). */
export function addGroupParagraph(
  content: ClozeNoteContent,
  key: string,
  answer: string,
): ClozeNoteContent {
  return {
    ...content,
    text: [
      ...content.text,
      {
        type: "paragraph",
        content: [
          { type: "text", text: "novo trecho " },
          { type: "cloze", groupKey: key, content: [{ type: "text", text: answer }] },
        ],
      },
    ],
  };
}

// --- Aplicação de plano sobre um "banco" simulado de cards ---

/** Aplica um CardMatchPlan como o service faria (UPDATEs/INSERTs simulados). */
export function applyPlan(
  cards: ExistingCardInfo[],
  plan: CardMatchPlan,
  makeId: () => string,
): ExistingCardInfo[] {
  const byId = new Map(cards.map((c) => [c.id, { ...c }]));
  for (const k of plan.keep) {
    const c = byId.get(k.cardId);
    if (c !== undefined) c.contentFingerprint = k.fingerprint;
  }
  for (const t of plan.transfer) {
    const c = byId.get(t.cardId);
    if (c !== undefined) {
      c.clozeGroupKey = t.newGroupKey;
      c.contentFingerprint = t.fingerprint;
    }
  }
  for (const r of plan.reactivate) {
    const c = byId.get(r.cardId);
    if (c !== undefined) {
      c.status = "active";
      c.clozeGroupKey = r.newGroupKey;
      c.contentFingerprint = r.fingerprint;
    }
  }
  for (const id of plan.remove) {
    const c = byId.get(id);
    if (c !== undefined) c.status = "removed";
  }
  const next = [...byId.values()];
  for (const cr of plan.create) {
    next.push({
      id: makeId(),
      clozeGroupKey: cr.clozeGroupKey,
      contentFingerprint: cr.fingerprint,
      status: "active",
      variant: cr.variant,
    });
  }
  return next;
}
