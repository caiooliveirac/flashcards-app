import type { JSONContent } from "@tiptap/core";
import type {
  Block,
  Inline,
  InlineNoCloze,
  ListBlock,
  NoteContent,
  TextInline,
} from "@/lib/content/schema";

/**
 * Parse blocks do NoteContentV1 → doc ProseMirror (arquitetura §4, D1).
 * Conversão TOTAL (nunca lança) e recíproca de serialize.ts sobre o que o
 * EDITOR produz. Nós sem UI de editor na Fase 2 têm representação
 * determinística e LOSSY (débito registrado — não fazem round-trip):
 *
 * - math inline  → text node com o latex literal;
 * - formula      → parágrafo com o latex em texto;
 * - callout      → filhos achatados no nível do pai (variant perdido).
 *
 * Normalizações próprias do parse:
 * - blocks vazios → doc com um parágrafo vazio (doc PM exige >= 1 bloco);
 * - item de lista cujo primeiro bloco não é parágrafo ganha um parágrafo
 *   vazio inicial (listItem PM exige 'paragraph block*');
 * - content vazio é omitido (forma canônica PM);
 * - language/hint/alt ausentes viram null nos attrs (defaults do schema PM);
 * - marks são deduplicados, emitidos na ordem de rank do schema PM
 *   (bold, italic, highlight) e `code` é EXCLUSIVO (Tiptap Code tem
 *   excludes '_'): se presente, os demais marks são descartados — sem isso
 *   o doc não valida no schema real do editor.
 */

/** Ordem de rank dos marks no schema PM gerado por editorExtensions. */
const PM_MARK_ORDER = ["bold", "italic", "highlight"] as const;

function pmMarks(marks: TextInline["marks"]): JSONContent["marks"] {
  if (!marks || marks.length === 0) return undefined;
  const present = new Set<string>(marks);
  // Code exclui os demais no schema do editor (excludes '_').
  if (present.has("code")) return [{ type: "code" }];
  const ordered = PM_MARK_ORDER.filter((m) => present.has(m));
  return ordered.length > 0 ? ordered.map((m) => ({ type: m })) : undefined;
}

function textToPm(t: TextInline): JSONContent {
  const marks = pmMarks(t.marks);
  return marks !== undefined
    ? { type: "text", text: t.text, marks }
    : { type: "text", text: t.text };
}

function inlinesToPm(inlines: Array<Inline | InlineNoCloze>): JSONContent[] {
  const out: JSONContent[] = [];
  for (const inline of inlines) {
    if (inline.type === "text") {
      out.push(textToPm(inline));
    } else if (inline.type === "cloze") {
      out.push({
        type: "cloze",
        attrs: { groupKey: inline.groupKey, hint: inline.hint ?? null },
        content: inline.content.map(textToPm),
      });
    } else {
      // math: sem UI na F2 — latex vira texto literal (lossy, documentado acima).
      out.push({ type: "text", text: inline.latex });
    }
  }
  return out;
}

function listToPm(list: ListBlock<Inline | InlineNoCloze>): JSONContent {
  const items: JSONContent[] = list.items.map((item) => {
    let blocks = blocksToPm(item.blocks);
    if (blocks.length === 0 || blocks[0]?.type !== "paragraph") {
      // listItem PM exige parágrafo inicial ('paragraph block*').
      blocks = [{ type: "paragraph" }, ...blocks];
    }
    return { type: "listItem", content: blocks };
  });
  return list.ordered
    ? { type: "orderedList", attrs: { start: 1 }, content: items }
    : { type: "bulletList", content: items };
}

function blocksToPm(blocks: Array<Block<Inline | InlineNoCloze>>): JSONContent[] {
  const out: JSONContent[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        out.push(
          block.content.length > 0
            ? { type: "paragraph", content: inlinesToPm(block.content) }
            : { type: "paragraph" },
        );
        break;
      }
      case "heading": {
        const node: JSONContent = { type: "heading", attrs: { level: block.level } };
        if (block.content.length > 0) node.content = inlinesToPm(block.content);
        out.push(node);
        break;
      }
      case "list": {
        out.push(listToPm(block));
        break;
      }
      case "codeBlock": {
        const node: JSONContent = {
          type: "codeBlock",
          attrs: { language: block.language ?? null },
        };
        if (block.text.length > 0) node.content = [{ type: "text", text: block.text }];
        out.push(node);
        break;
      }
      case "image": {
        out.push({ type: "image", attrs: { assetId: block.assetId, alt: block.alt ?? null } });
        break;
      }
      case "formula": {
        // formula: sem UI na F2 — parágrafo com latex literal (lossy).
        out.push({ type: "paragraph", content: [{ type: "text", text: block.latex }] });
        break;
      }
      case "callout": {
        // callout: sem UI na F2 — filhos achatados (lossy).
        out.push(...blocksToPm(block.content));
        break;
      }
    }
  }
  return out;
}

/** blocks NoteContentV1 → doc PM. Total, nunca lança. */
export function parseBlocksToPmDoc(
  blocks: Array<Block<Inline>> | Array<Block<InlineNoCloze>>,
): JSONContent {
  const content = blocksToPm(blocks);
  return {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}

export interface NotePmDocs {
  front?: JSONContent;
  back?: JSONContent;
  text?: JSONContent;
}

/** NoteContent completo → docs PM por campo (inverso de pmDocsToNoteContent). */
export function noteContentToPmDocs(content: NoteContent): NotePmDocs {
  if (content.kind === "basic") {
    return {
      front: parseBlocksToPmDoc(content.front),
      back: parseBlocksToPmDoc(content.back),
    };
  }
  return { text: parseBlocksToPmDoc(content.text) };
}
