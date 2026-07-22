/**
 * Motion System — barramento de coreografias (handoff §6).
 *
 * O app emite fatos ("o card foi aceito"), não animações. Quem escuta decide a
 * coreografia. Isso mantém a Camada de Vida desacoplada: apagar um listener
 * apaga o efeito, nunca o fluxo — revisão FSRS, criação e undo seguem iguais.
 */

import type { FieldMode } from "./tokens";

export interface MotionEventMap {
  /** Resposta revelada → flip com espessura + obturador (4b). */
  "review:reveal": { cardId: string };
  /** Avaliação enviada → ripple + dock reage quando é "Errei". */
  "review:rated": { cardId: string; rating: 1 | 2 | 3 | 4 };
  /** Card aceito → carimbo + trail até o deck + contador flipa. */
  "card:accepted": { sourceEl?: Element | null; deckEl?: Element | null };
  /** Nota salva → trail da prévia até o contador. */
  "card:saved": { sourceEl?: Element | null; deckEl?: Element | null };
  /** Aprovação em lote → trails em stagger de 80ms. */
  "cards:batchApproved": { count: number };
  /** Sessão concluída → microcelebração (4h). */
  "session:done": { reviewed: number; variant?: "streak" | "rescue" | "leech" | "first" };
  /** State machine do ✳ (4f). */
  "ai:state": { mode: FieldMode | "executa" };
}

export type MotionEventName = keyof MotionEventMap;

const PREFIX = "ms:";

/** Dispara uma coreografia. No servidor é um no-op silencioso. */
export function emitMotion<K extends MotionEventName>(name: K, detail: MotionEventMap[K]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFIX + name, { detail }));
}

/** Assina uma coreografia; devolve o cleanup (pronto para `useEffect`). */
export function onMotion<K extends MotionEventName>(
  name: K,
  handler: (detail: MotionEventMap[K]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<MotionEventMap[K]>).detail);
  window.addEventListener(PREFIX + name, listener);
  return () => window.removeEventListener(PREFIX + name, listener);
}
