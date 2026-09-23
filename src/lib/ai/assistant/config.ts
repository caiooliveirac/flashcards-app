import "server-only";

/**
 * Configuração do ASSISTENTE (tira-dúvidas da Fase 5), separada do criador de
 * cards para não colidir com o outro track de IA. Três perfis roteáveis por
 * dificuldade (§9.1: fast/deep — aqui em três níveis). Modelos Claude/Anthropic;
 * IDs sobrescrevíveis por env para trocar custo/latência sem deploy.
 */

export type AssistantTier = "fast" | "mid" | "deep";

export interface TierConfig {
  tier: AssistantTier;
  /** ID do modelo Anthropic. */
  model: string;
  /** Rótulo exibido no chip da resposta. */
  label: string;
  /** Teto de saída (streaming, então pode ser generoso sem risco de timeout). */
  maxTokens: number;
  /** Shaping do request (Messages API). Omitido onde o modelo não suporta. */
  thinking?: { type: "adaptive" } | { type: "disabled" };
  effort?: "low" | "medium" | "high";
  /** Preço US$ por 1M tokens — alimenta o teto de custo diário. */
  priceInPerM: number;
  priceOutPerM: number;
}

const env = (k: string): string | undefined => process.env[k]?.trim() || undefined;

/**
 * fast=Haiku 4.5 ($1/$5), mid=Sonnet 5 ($2/$10), deep=Opus 5.5 ($4/$20).
 * Haiku 4.5 não aceita `effort` nem thinking adaptativo — por isso ficam vazios.
 * Opus 5.5 recusa thinking desligado (400) e tem effort default `medium` —
 * por isso o deep declara os dois explicitamente.
 */
export const TIERS: Record<AssistantTier, TierConfig> = {
  fast: {
    tier: "fast",
    model: env("FLASHCARDS_AI_FAST_MODEL") ?? "claude-haiku-4-5",
    label: "Rápido",
    maxTokens: 1024,
    priceInPerM: 1,
    priceOutPerM: 5,
  },
  mid: {
    tier: "mid",
    model: env("FLASHCARDS_AI_MID_MODEL") ?? "claude-sonnet-5",
    label: "Equilibrado",
    maxTokens: 1536,
    thinking: { type: "disabled" },
    effort: "low",
    priceInPerM: 2,
    priceOutPerM: 10,
  },
  deep: {
    tier: "deep",
    model: env("FLASHCARDS_AI_DEEP_MODEL") ?? "claude-opus-5-5",
    label: "Aprofundado",
    maxTokens: 3072,
    thinking: { type: "adaptive" },
    effort: "high",
    priceInPerM: 4,
    priceOutPerM: 20,
  },
};

/** Limites anti-abuso/custo. Overrides por env; defaults conservadores. */
export const ASSISTANT_LIMITS = {
  /** Pergunta do usuário. */
  maxMessageChars: 4000,
  /** Contexto do card/deck injetado. */
  maxContextChars: 8000,
  /** Pares user/assistant reenviados (janela de conversa). */
  maxHistoryTurns: 12,
  /** Requisições por minuto por usuário (janela deslizante em memória). */
  requestsPerMinute: Number(env("FLASHCARDS_AI_RPM") ?? 8),
  /** Teto de custo estimado por usuário por dia (US$). */
  dailyUsdCap: Number(env("FLASHCARDS_AI_DAILY_USD_CAP") ?? 1.5),
} as const;

/** Custo estimado (conservador: tokens de cache contam a preço cheio). */
export function estimateCostUsd(
  tier: AssistantTier,
  inputTokens: number,
  outputTokens: number,
): number {
  const t = TIERS[tier];
  return (
    (inputTokens / 1_000_000) * t.priceInPerM +
    (outputTokens / 1_000_000) * t.priceOutPerM
  );
}
