import { createHash } from "node:crypto";
import {
  collectClozeInlines,
  type Block,
  type ClozeInline,
  type ClozeNoteContent,
  type Inline,
  type InlineNoCloze,
  type NoteContent,
} from "./schema";

/**
 * Derivação pura de conteúdo (arquitetura §4/§5, fluxos §13.1-2):
 * search_text para FTS, cards derivados com fingerprint estável e
 * preview de cards cloze. Nenhum acesso a banco — biblioteca pura.
 */

export interface DerivedCard {
  clozeGroupKey: string | null;
  fingerprint: string;
}

/** NFC + whitespace colapsado em espaço único + trim. NÃO baixa caixa. */
export function canonicalizeText(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Texto interno de uma ocultação (concatenação direta dos inlines de texto). */
function clozeInnerText(c: ClozeInline): string {
  return c.content.map((t) => t.text).join("");
}

/**
 * Como tratar ocultações ao linearizar blocks:
 * - "reveal": texto interno revelado (search_text e grupos NÃO ocultos);
 * - { hide: g }: ocultações do grupo g viram "[...]", demais reveladas.
 * Hints são SEMPRE ignorados na linearização.
 */
type ClozeMode = "reveal" | { hide: string };

/**
 * Linearização canônica de blocks para fingerprint: placeholders
 * determinísticos — imagem => [img:assetId], math/formula => [math:latex].
 * Blocos são separados por espaço; inlines concatenados diretamente.
 */
function canonicalizeBlocks(
  blocks: Array<Block<Inline | InlineNoCloze>>,
  mode: ClozeMode,
): string {
  const parts: string[] = [];
  const walkInlines = (inlines: Array<Inline | InlineNoCloze>): string => {
    let out = "";
    for (const i of inlines) {
      if (i.type === "text") out += i.text;
      else if (i.type === "math") out += "[math:" + i.latex + "]";
      else if (i.type === "cloze") {
        out +=
          mode !== "reveal" && i.groupKey === mode.hide
            ? "[...]"
            : clozeInnerText(i);
      }
    }
    return out;
  };
  const walkBlocks = (bs: Array<Block<Inline | InlineNoCloze>>) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") {
        parts.push(walkInlines(b.content));
      } else if (b.type === "codeBlock") {
        parts.push(b.text);
      } else if (b.type === "image") {
        parts.push("[img:" + b.assetId + "]");
      } else if (b.type === "formula") {
        parts.push("[math:" + b.latex + "]");
      } else if (b.type === "list") {
        for (const item of b.items) walkBlocks(item.blocks);
      } else {
        walkBlocks(b.content);
      }
    }
  };
  walkBlocks(blocks);
  return canonicalizeText(parts.join(" "));
}

/**
 * Linearização para busca textual (FTS): cloze REVELADO, hints ignorados,
 * alt de imagens e latex de math/formula incluídos, codeBlock incluído.
 * `markGroup` (só para o contexto da IA) envolve as ocultações desse grupo em
 * [[...]] para indicar qual trecho o card cobra.
 */
function searchTextOfBlocks(
  blocks: Array<Block<Inline | InlineNoCloze>>,
  markGroup?: string,
): string {
  const parts: string[] = [];
  const walkInlines = (inlines: Array<Inline | InlineNoCloze>): string => {
    let out = "";
    for (const i of inlines) {
      if (i.type === "text") out += i.text;
      else if (i.type === "math") out += i.latex;
      else if (i.type === "cloze") {
        out += i.groupKey === markGroup ? `[[${clozeInnerText(i)}]]` : clozeInnerText(i);
      }
    }
    return out;
  };
  const walkBlocks = (bs: Array<Block<Inline | InlineNoCloze>>) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") {
        parts.push(walkInlines(b.content));
      } else if (b.type === "codeBlock") {
        parts.push(b.text);
      } else if (b.type === "image") {
        if (b.alt !== undefined) parts.push(b.alt);
      } else if (b.type === "formula") {
        parts.push(b.latex);
      } else if (b.type === "list") {
        for (const item of b.items) walkBlocks(item.blocks);
      } else {
        walkBlocks(b.content);
      }
    }
  };
  walkBlocks(blocks);
  return canonicalizeText(parts.join(" "));
}

/** Texto concatenado normalizado para FTS — campos na ordem front, back (basic) ou text (cloze). */
export function deriveSearchText(content: NoteContent): string {
  if (content.kind === "basic") {
    return canonicalizeText(
      searchTextOfBlocks(content.front) + " " + searchTextOfBlocks(content.back),
    );
  }
  return searchTextOfBlocks(content.text);
}

/**
 * Texto do card para a IA (explicar/reformular): basic vira "Frente/Verso";
 * cloze vem revelado com o trecho cobrado por ESTE card entre [[...]].
 */
export function cardTextForAi(content: NoteContent, clozeGroupKey: string | null): string {
  if (content.kind === "basic") {
    return `Frente: ${searchTextOfBlocks(content.front)}\nVerso: ${searchTextOfBlocks(content.back)}`;
  }
  return `Cloze (o trecho entre [[ ]] é o que o card cobra): ${searchTextOfBlocks(
    content.text,
    clozeGroupKey ?? undefined,
  )}`;
}

/** groupKeys distintos na ordem de PRIMEIRA aparição no documento. */
function distinctGroupKeys(content: ClozeNoteContent): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const c of collectClozeInlines(content.text)) {
    if (!seen.has(c.groupKey)) {
      seen.add(c.groupKey);
      keys.push(c.groupKey);
    }
  }
  return keys;
}

/**
 * Resposta de um grupo: textos das ocultações do grupo na ordem do documento
 * (separados por espaço para não fundir palavras; canonicalizado).
 */
function clozeGroupAnswer(content: ClozeNoteContent, groupKey: string): string {
  return canonicalizeText(
    collectClozeInlines(content.text)
      .filter((c) => c.groupKey === groupKey)
      .map(clozeInnerText)
      .join(" "),
  );
}

/**
 * Cards derivados do conteúdo (§5). Fingerprint = chave do resgate:
 * estabilidade total — mesmo conteúdo => mesmo hash, sempre.
 * - basic: 1 card, sha256(canonical(front) + "\u0000" + canonical(back)).
 * - cloze: 1 card por groupKey distinto (ordem de primeira aparição);
 *   sha256(canonical(texto com o grupo oculto) + "\u0000" + canonical(resposta)).
 */
export function deriveCards(content: NoteContent): DerivedCard[] {
  if (content.kind === "basic") {
    const front = canonicalizeBlocks(content.front, "reveal");
    const back = canonicalizeBlocks(content.back, "reveal");
    return [
      { clozeGroupKey: null, fingerprint: sha256hex(front + "\u0000" + back) },
    ];
  }
  return distinctGroupKeys(content).map((groupKey) => {
    const hidden = canonicalizeBlocks(content.text, { hide: groupKey });
    const answer = clozeGroupAnswer(content, groupKey);
    return {
      clozeGroupKey: groupKey,
      fingerprint: sha256hex(hidden + "\u0000" + answer),
    };
  });
}

/** Preview de N cards no editor: frontText com [...] no grupo, demais revelados. */
export function clozePreviewCards(
  content: ClozeNoteContent,
): Array<{ groupKey: string; frontText: string; answerText: string; hint?: string }> {
  const clozes = collectClozeInlines(content.text);
  return distinctGroupKeys(content).map((groupKey) => {
    const firstHint = clozes.find(
      (c) => c.groupKey === groupKey && c.hint !== undefined,
    )?.hint;
    const preview: {
      groupKey: string;
      frontText: string;
      answerText: string;
      hint?: string;
    } = {
      groupKey,
      frontText: canonicalizeBlocks(content.text, { hide: groupKey }),
      answerText: clozeGroupAnswer(content, groupKey),
    };
    if (firstHint !== undefined) preview.hint = firstHint;
    return preview;
  });
}

/** Menor gN livre (N >= 1) SEM reutilizar nenhum da lista. */
export function nextGroupKey(existing: string[]): string {
  const used = new Set<number>();
  for (const key of existing) {
    if (/^g\d+$/.test(key)) used.add(Number.parseInt(key.slice(1), 10));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return "g" + String(n);
}
