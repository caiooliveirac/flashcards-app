import type { AssistantTier } from "./config";

/**
 * Roteador HEURÍSTICO (sem chamada extra de LLM) que escolhe o modelo pela
 * dificuldade aparente da dúvida. O usuário pode forçar o topo com o botão
 * "Aprofundar" (forceDeep). Barato e previsível; erra para baixo (mais barato)
 * em caso de dúvida — o botão corrige quando a resposta rasa não bastar.
 */

/** Marcadores de DECISÃO clínica (a alma do card da Duda) → sobem o nível. */
const DECISION_MARKERS = [
  "conduta",
  "próximo passo",
  "proximo passo",
  "o que fazer",
  "contraindica",
  "diagnóstico diferencial",
  "diagnostico diferencial",
  "fisiopatolog",
  "mecanismo",
  "por que",
  "porque",
  "por quê",
  "interação",
  "interacao",
  "ajuste de dose",
  "quando indic",
  "diferença entre",
  "diferenca entre",
  "compare",
  "versus",
  " vs ",
  "prioridade",
  "pegadinha",
];

/** Pedido explícito de profundidade. */
const DEPTH_MARKERS = [
  "aprofund",
  "detalhad",
  "passo a passo",
  "raciocínio",
  "raciocinio",
  "explique bem",
  "por completo",
];

/** Perguntas de definição/recall → puxam para o rápido. */
const SIMPLE_MARKERS = [
  "o que é",
  "o que e ",
  "o que significa",
  "defina",
  "definição",
  "definicao",
  "sigla",
  "abreviaç",
];

export function routeTier(
  message: string,
  opts?: { forceDeep?: boolean; hasContext?: boolean },
): AssistantTier {
  if (opts?.forceDeep) return "deep";

  const text = message.toLowerCase();
  const len = message.trim().length;
  let score = 0;

  if (len > 320) score += 2;
  else if (len > 140) score += 1;

  if (DECISION_MARKERS.some((m) => text.includes(m))) score += 2;
  if (DEPTH_MARKERS.some((m) => text.includes(m))) score += 2;

  // Múltiplas perguntas na mesma mensagem = mais trabalho.
  const questionMarks = (message.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) score += 1;

  if (SIMPLE_MARKERS.some((m) => text.includes(m))) score -= 1;

  if (score <= 0) return "fast";
  if (score <= 2) return "mid";
  return "deep";
}
