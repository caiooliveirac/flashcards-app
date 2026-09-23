/**
 * Configuração da IA (Fase 5). A IA é FACULTATIVA: se não houver
 * ANTHROPIC_API_KEY o recurso simplesmente não aparece disponível — nada
 * quebra, nenhum erro é logado para o usuário. Provider: Claude/Anthropic
 * (ANTHROPIC_API_KEY já existe no servidor; sem OPENAI_API_KEY — ver memória).
 */

/** Modelo padrão. Sobrescrevível por env para trocar custo/latência sem deploy. */
export const AI_MODEL = process.env.FLASHCARDS_AI_MODEL?.trim() || "claude-opus-5-5";

/** Recurso ligado só quando há chave. Verificado no servidor, nunca no client. */
export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Limites anti-abuso/custo (single-user por ora; teto diário é débito da Fase 5). */
export const AI_LIMITS = {
  /** Texto de entrada colado pelo usuário. */
  maxSourceChars: 8000,
  /** Feedback livre. */
  maxFeedbackChars: 1000,
  /** Máximo de cards por resposta (o modelo é instruído a ficar em 3–6). */
  maxCardsPerResponse: 8,
  /** Sugestões anteriores reenviadas na revisão. */
  maxPriorCards: 12,
} as const;
