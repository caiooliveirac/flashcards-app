import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool de proposta de card (§9.2). O modelo PROPÕE o conteúdo; ele nunca cria
 * nada sozinho — o aluno confirma e escolhe o baralho na UI (mutação exige
 * confirmação). Por isso a proposta não tem deckId: o destino vem do usuário.
 */

export interface CardDraftProposal {
  kind: "basic" | "cloze";
  front?: string;
  back?: string;
  text?: string;
  tags?: string[];
}

export const SUGERIR_CARD_TOOL: Anthropic.Tool = {
  name: "sugerir_card",
  description:
    "Propõe um flashcard para o aluno criar. Chame quando o aluno pedir para " +
    "criar, registrar ou 'fazer um card' sobre algo. NÃO cria nada: o aluno " +
    "confirma e escolhe o baralho depois. Prefira o padrão vinheta→decisão " +
    "(pergunta objetiva na frente, conduta + porquê no verso).",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["basic", "cloze"],
        description: "basic = frente/verso; cloze = frase com ocultações",
      },
      front: { type: "string", description: "basic: a pergunta/vinheta" },
      back: { type: "string", description: "basic: a resposta objetiva + porquê" },
      text: {
        type: "string",
        description:
          "cloze: frase com {{ocultações}} ou {{trecho::dica}} (só limiar/dose/sequência)",
      },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["kind"],
  },
};

/** Normaliza o input (unknown) da tool numa proposta válida, ou null. */
export function parseCardDraft(input: unknown): CardDraftProposal | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (raw.kind !== "basic" && raw.kind !== "cloze") return null;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v : undefined;
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 20)
    : undefined;
  return {
    kind: raw.kind,
    front: str(raw.front),
    back: str(raw.back),
    text: str(raw.text),
    tags: tags && tags.length ? tags : undefined,
  };
}
