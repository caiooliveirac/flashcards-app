import {
  safeParseNoteContent,
  NOTE_CONTENT_SCHEMA_VERSION,
  type Block,
  type Inline,
  type InlineNoCloze,
  type NoteContent,
} from "@/lib/content";
import type { SuggestedCard } from "./suggestion-schema";

/** Tipo de nota (kind do NoteContentV1). Local para não acoplar lib/ai a features. */
type NoteType = "basic" | "cloze";

/**
 * Conversão determinística sugestão-simples → NoteContentV1 (arquitetura §4).
 * PURA e testável. Cards inválidos viram null e são DESCARTADOS em silêncio
 * pelo chamador — o usuário nunca vê erro de formato de um card ruim.
 */

export interface ConvertedCard {
  noteType: NoteType;
  content: NoteContent;
  tags: string[];
  /** Texto plano para exibição na revisão (não persiste). */
  preview: { front: string; back: string };
}

const MARK_CLOZE = "[…]";

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** String plana → parágrafos (notas basic: sem cloze). Linhas vazias são puladas. */
function textToBasicBlocks(raw: string): Block<InlineNoCloze>[] {
  const blocks: Block<InlineNoCloze>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = collapse(line);
    if (!t) continue;
    blocks.push({ type: "paragraph", content: [{ type: "text", text: t }] });
  }
  return blocks;
}

interface ClozeParse {
  blocks: Block<Inline>[];
  clozeCount: number;
  masked: string;
  answers: string[];
}

/** Texto com {{ocultações}} → parágrafos com inlines cloze (groupKeys g1..gn). */
function parseClozeText(raw: string): ClozeParse {
  const blocks: Block<Inline>[] = [];
  const answers: string[] = [];
  const maskedLines: string[] = [];
  let group = 0;
  const re = /\{\{(.+?)\}\}/g;

  for (const line of raw.split(/\r?\n/)) {
    const t = collapse(line);
    if (!t) continue;
    const inlines: Inline[] = [];
    let maskedLine = "";
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(t)) !== null) {
      const before = t.slice(last, m.index);
      if (before) {
        inlines.push({ type: "text", text: before });
        maskedLine += before;
      }
      const inner = m[1] ?? "";
      const sep = inner.indexOf("::");
      const answerRaw = sep >= 0 ? inner.slice(0, sep) : inner;
      const hintRaw = sep >= 0 ? inner.slice(sep + 2) : "";
      const answer = collapse(answerRaw);
      if (answer) {
        group += 1;
        const cloze: Inline = {
          type: "cloze",
          groupKey: `g${group}`,
          content: [{ type: "text", text: answer }],
        };
        const hint = collapse(hintRaw).slice(0, 200);
        if (hint) (cloze as { hint?: string }).hint = hint;
        inlines.push(cloze);
        answers.push(answer);
        maskedLine += MARK_CLOZE;
      } else {
        // Ocultação vazia: ignora, mantém o texto literal fora das chaves.
      }
      last = m.index + m[0].length;
    }
    const tail = t.slice(last);
    if (tail) {
      inlines.push({ type: "text", text: tail });
      maskedLine += tail;
    }
    if (inlines.length > 0) {
      blocks.push({ type: "paragraph", content: inlines });
      maskedLines.push(maskedLine);
    }
  }

  return { blocks, clozeCount: group, masked: maskedLines.join(" "), answers };
}

/** tags: normaliza, remove vazias/duplicadas, corta comprimento e quantidade. */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = collapse(raw).slice(0, 200);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Converte um card sugerido. Retorna null se o resultado não formar um
 * NoteContentV1 válido (front vazio, cloze sem ocultação, etc.) — descartado.
 */
export function convertSuggestion(card: SuggestedCard): ConvertedCard | null {
  const tags = normalizeTags(card.tags ?? []);

  if (card.kind === "basic") {
    const front = textToBasicBlocks(card.front);
    if (front.length === 0) return null;
    const back = textToBasicBlocks(card.back);
    const content = {
      schemaVersion: NOTE_CONTENT_SCHEMA_VERSION,
      kind: "basic" as const,
      front,
      back,
    };
    const parsed = safeParseNoteContent(content);
    if (!parsed.success) return null;
    return {
      noteType: "basic",
      content: parsed.data,
      tags,
      preview: { front: collapse(card.front), back: collapse(card.back) },
    };
  }

  const { blocks, clozeCount, masked, answers } = parseClozeText(card.text);
  if (blocks.length === 0 || clozeCount === 0) return null;
  const content = {
    schemaVersion: NOTE_CONTENT_SCHEMA_VERSION,
    kind: "cloze" as const,
    text: blocks,
  };
  const parsed = safeParseNoteContent(content);
  if (!parsed.success) return null;
  return {
    noteType: "cloze",
    content: parsed.data,
    tags,
    preview: { front: masked, back: answers.join(" · ") },
  };
}
