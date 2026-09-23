/**
 * Ponte "Explicar este card": a sessão de revisão não conhece o painel do
 * Preceptor (montado no layout raiz), então pede a explicação por um evento de
 * janela. O painel escuta, abre e mantém o card como contexto da conversa.
 */

export const EXPLAIN_EVENT = "preceptor:explain";

export interface CardContext {
  deckName: string;
  cardText: string;
  lapses: number;
}

export function requestExplain(ctx: CardContext): void {
  window.dispatchEvent(new CustomEvent<CardContext>(EXPLAIN_EVENT, { detail: ctx }));
}
