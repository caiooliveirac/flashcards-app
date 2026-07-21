import type { JSONContent } from "@tiptap/core";
import {
  CLOZE_GROUP_KEY_RE,
  NOTE_CONTENT_SCHEMA_VERSION,
  type BasicNoteContent,
  type Block,
  type ClozeInline,
  type ClozeNoteContent,
  type Inline,
  type InlineNoCloze,
  type Mark,
  type TextInline,
} from "@/lib/content/schema";

/**
 * Serialização doc ProseMirror → blocks do NoteContentV1 (arquitetura §4, D1).
 * Conversão TOTAL (nunca lança) e recíproca de parse.ts módulo as
 * normalizações documentadas:
 *
 * 1. marks são deduplicados e reordenados para a ordem canônica MARK_ORDER;
 * 2. text nodes adjacentes com marks idênticos são mesclados;
 * 3. no MÁXIMO UM parágrafo vazio final do doc é descartado (TrailingNode do
 *    editor) — exceto se for o único bloco;
 * 4. imagem sem assetId é DESCARTADA (upload incompleto);
 * 5. cloze vazio (sem texto) é descartado; cloze com groupKey inválido é
 *    desembrulhado para texto; cloze em nota basic é desembrulhado;
 * 6. hint/alt null viram ausentes (undefined); "" é preservado;
 * 7. nós/marks desconhecidos do schema restrito são descartados;
 * 8. em pmDocsToNoteContent, verso basic composto de um único parágrafo vazio
 *    normaliza para [].
 */

/** Ordem canônica de marks no NoteContentV1 (espelha markSchema). */
export const MARK_ORDER: readonly Mark[] = ["bold", "italic", "highlight", "code"];

const KNOWN_MARKS = new Set<string>(MARK_ORDER);

function normalizeMarks(pmMarks: JSONContent["marks"]): Mark[] {
  if (!pmMarks || pmMarks.length === 0) return [];
  const present = new Set<string>();
  for (const mark of pmMarks) {
    if (KNOWN_MARKS.has(mark.type)) present.add(mark.type);
  }
  return MARK_ORDER.filter((m) => present.has(m));
}

function textInline(text: string, marks: Mark[]): TextInline {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((m, i) => m === right[i]);
}

/** Empilha mesclando text nodes adjacentes com marks idênticos (normalização 2). */
function pushInline<T extends Inline>(out: T[], inline: T): void {
  const prev = out[out.length - 1];
  if (
    inline.type === "text" &&
    prev !== undefined &&
    prev.type === "text" &&
    sameMarks(prev.marks, inline.marks)
  ) {
    out[out.length - 1] = textInline(prev.text + inline.text, prev.marks ?? []) as T;
    return;
  }
  out.push(inline);
}

function serializeClozeTexts(nodes: JSONContent[] | undefined): TextInline[] {
  const out: TextInline[] = [];
  for (const node of nodes ?? []) {
    if (node.type !== "text") continue;
    if (typeof node.text !== "string" || node.text.length === 0) continue;
    pushInline(out, textInline(node.text, normalizeMarks(node.marks)));
  }
  return out;
}

function serializeInlineNodes(
  nodes: JSONContent[] | undefined,
  allowCloze: boolean,
): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text") {
      if (typeof node.text === "string" && node.text.length > 0) {
        pushInline(out, textInline(node.text, normalizeMarks(node.marks)));
      }
      continue;
    }
    if (node.type === "cloze") {
      const texts = serializeClozeTexts(node.content);
      if (texts.length === 0) continue; // cloze vazio descartado (normalização 5)
      const groupKeyRaw: unknown = node.attrs?.groupKey;
      const hintRaw: unknown = node.attrs?.hint;
      const groupKey = typeof groupKeyRaw === "string" ? groupKeyRaw : "";
      if (!allowCloze || !CLOZE_GROUP_KEY_RE.test(groupKey)) {
        // basic ou groupKey inválido: desembrulha para texto (normalização 5)
        for (const t of texts) pushInline(out, t);
        continue;
      }
      const cloze: ClozeInline =
        typeof hintRaw === "string"
          ? { type: "cloze", groupKey, hint: hintRaw, content: texts }
          : { type: "cloze", groupKey, content: texts };
      out.push(cloze);
      continue;
    }
    // Nó inline desconhecido do schema restrito: descartado (normalização 7).
  }
  return out;
}

function codeBlockText(nodes: JSONContent[] | undefined): string {
  let text = "";
  for (const node of nodes ?? []) {
    if (node.type === "text" && typeof node.text === "string") text += node.text;
  }
  return text;
}

function serializeBlockNodes(
  nodes: JSONContent[] | undefined,
  allowCloze: boolean,
): Array<Block<Inline>> {
  const out: Array<Block<Inline>> = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph": {
        out.push({ type: "paragraph", content: serializeInlineNodes(node.content, allowCloze) });
        break;
      }
      case "heading": {
        const raw: unknown = node.attrs?.level;
        const level = raw === 2 ? 2 : raw === 3 ? 3 : 1;
        out.push({ type: "heading", level, content: serializeInlineNodes(node.content, allowCloze) });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items: Array<{ blocks: Array<Block<Inline>> }> = [];
        for (const li of node.content ?? []) {
          if (li.type !== "listItem") continue;
          const blocks = serializeBlockNodes(li.content, allowCloze);
          items.push({
            blocks: blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }],
          });
        }
        if (items.length > 0) {
          out.push({ type: "list", ordered: node.type === "orderedList", items });
        }
        break;
      }
      case "codeBlock": {
        const langRaw: unknown = node.attrs?.language;
        const language =
          typeof langRaw === "string" && langRaw.length > 0 ? langRaw : undefined;
        const text = codeBlockText(node.content);
        out.push(
          language !== undefined
            ? { type: "codeBlock", language, text }
            : { type: "codeBlock", text },
        );
        break;
      }
      case "image": {
        const assetIdRaw: unknown = node.attrs?.assetId;
        if (typeof assetIdRaw !== "string" || assetIdRaw.length === 0) {
          break; // sem assetId = upload incompleto → descartada (normalização 4)
        }
        const altRaw: unknown = node.attrs?.alt;
        out.push(
          typeof altRaw === "string"
            ? { type: "image", assetId: assetIdRaw, alt: altRaw }
            : { type: "image", assetId: assetIdRaw },
        );
        break;
      }
      default:
        // Nó de bloco desconhecido do schema restrito: descartado (normalização 7).
        break;
    }
  }
  return out;
}

/** doc PM → blocks NoteContentV1. Total, nunca lança. */
export function serializePmToBlocks(pmDoc: JSONContent): Array<Block<Inline>> {
  const blocks = serializeBlockNodes(pmDoc.content, true);
  // TrailingNode do editor: no máximo UM parágrafo vazio final descartado (normalização 3).
  if (blocks.length > 1) {
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.type === "paragraph" && last.content.length === 0) {
      blocks.pop();
    }
  }
  return blocks;
}

function stripClozeInlines(inlines: Inline[]): InlineNoCloze[] {
  const out: InlineNoCloze[] = [];
  for (const inline of inlines) {
    if (inline.type === "cloze") {
      for (const t of inline.content) pushInline(out, t);
    } else {
      pushInline(out, inline);
    }
  }
  return out;
}

function stripClozeBlocks(blocks: Array<Block<Inline>>): Array<Block<InlineNoCloze>> {
  return blocks.map((block): Block<InlineNoCloze> => {
    switch (block.type) {
      case "paragraph":
        return { type: "paragraph", content: stripClozeInlines(block.content) };
      case "heading":
        return { type: "heading", level: block.level, content: stripClozeInlines(block.content) };
      case "list":
        return {
          type: "list",
          ordered: block.ordered,
          items: block.items.map((item) => ({ blocks: stripClozeBlocks(item.blocks) })),
        };
      case "callout":
        return {
          type: "callout",
          variant: block.variant,
          content: stripClozeBlocks(block.content),
        };
      default:
        return block;
    }
  });
}

function ensureNonEmpty<I>(blocks: Array<Block<I>>): Array<Block<I>> {
  return blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }];
}

function isSingleEmptyParagraph(blocks: Array<Block<InlineNoCloze>>): boolean {
  const first = blocks[0];
  return (
    blocks.length === 1 &&
    first !== undefined &&
    first.type === "paragraph" &&
    first.content.length === 0
  );
}

/** docs PM dos campos da nota → NoteContent completo (com schemaVersion/kind). */
export function pmDocsToNoteContent(
  kind: "basic",
  docs: { front: JSONContent; back: JSONContent },
): BasicNoteContent;
export function pmDocsToNoteContent(
  kind: "cloze",
  docs: { text: JSONContent },
): ClozeNoteContent;
export function pmDocsToNoteContent(
  kind: "basic" | "cloze",
  docs: { front?: JSONContent; back?: JSONContent; text?: JSONContent },
): BasicNoteContent | ClozeNoteContent {
  if (kind === "basic") {
    // Em basic o node cloze nem existe no schema; se aparecer, desembrulha (normalização 5).
    const front = ensureNonEmpty(
      stripClozeBlocks(serializePmToBlocks(docs.front ?? { type: "doc" })),
    );
    const backRaw = stripClozeBlocks(serializePmToBlocks(docs.back ?? { type: "doc" }));
    const back = isSingleEmptyParagraph(backRaw) ? [] : backRaw;
    return { schemaVersion: NOTE_CONTENT_SCHEMA_VERSION, kind: "basic", front, back };
  }
  const text = ensureNonEmpty(serializePmToBlocks(docs.text ?? { type: "doc" }));
  return { schemaVersion: NOTE_CONTENT_SCHEMA_VERSION, kind: "cloze", text };
}
