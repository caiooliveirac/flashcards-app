/**
 * Fila da sessão de revisão — lógica pura.
 *
 * Estava espalhada em vários `useState` aninhados dentro do componente, o que
 * escondeu três defeitos ao mesmo tempo:
 *
 * 1. `advance()` chamava `setCurrent`/`setLearnQueue` DENTRO de um updater de
 *    `setMainQueue`. Updater de estado tem de ser puro; React pode reexecutá-lo,
 *    e a transição da fila ficava imprevisível.
 * 2. O `readyAt` de cada card reenfileirado era calculado e nunca comparado com
 *    o relógio: um card reagendado para 6 ou 10 minutos voltava na hora. Com
 *    "Difícil" — que no FSRS repete o passo de propósito — isso vira um loop
 *    visível, como se a sessão tivesse travado no mesmo card.
 * 3. Reapresentar o MESMO objeto de card não mudava a identidade do estado, o
 *    efeito que gerava a `idempotencyKey` não rodava, e a avaliação seguinte
 *    chegava ao servidor com a chave anterior — descartada como duplicata. Na
 *    prática, cliques em "Fácil" eram silenciosamente jogados fora.
 *
 * Aqui tudo isso é uma transição de estado única e testável, sem React.
 */

import type { SessionCard } from "./session-types";

/** Card em learning que pode reentrar na sessão quando `readyAt` chegar. */
export interface LearnItem {
  card: SessionCard;
  readyAt: number;
}

export interface QueueState {
  /** Cards ainda não apresentados. */
  main: SessionCard[];
  /** Cards em learning aguardando o horário de reentrada. */
  learn: LearnItem[];
  /** Card na tela; `null` encerra a sessão. */
  current: SessionCard | null;
  /**
   * Muda a CADA apresentação, mesmo quando o card é o mesmo objeto. É isto que
   * garante uma `idempotencyKey` nova por apresentação (defeito 3).
   */
  presentation: number;
}

/**
 * Learn-ahead (como no Anki): quando não há mais nada a fazer, cards de
 * learning que vencem dentro desta janela são antecipados. O que o Anki NÃO faz
 * — e nós fazíamos — é mostrá-los antes da hora.
 */
export const LEARN_AHEAD_MS = 20 * 60_000;

export function initialQueue(cards: SessionCard[]): QueueState {
  return {
    main: cards.slice(1),
    learn: [],
    current: cards[0] ?? null,
    presentation: 0,
  };
}

/** O card deve reentrar na sessão depois desta avaliação? */
export function shouldRequeue(state: string, dueAt: string | Date, now: number): boolean {
  if (state !== "learning" && state !== "relearning") return false;
  const dueInMs = new Date(dueAt).getTime() - now;
  return dueInMs <= LEARN_AHEAD_MS;
}

export interface AdvanceOptions {
  /** Card que acabou de ser avaliado e volta para a fila de learning. */
  requeue?: LearnItem;
  /**
   * Nota cujos irmãos saem da sessão. O servidor enterra os irmãos a cada
   * avaliação, mas a fila do cliente é um snapshot do carregamento da página —
   * sem isto, os outros cloze da MESMA nota continuavam aparecendo.
   */
  burySiblingsOfNote?: string;
  /** Card que não deve voltar (o que acabou de sair da tela). */
  exclude?: string;
  now?: number;
}

/**
 * Próxima apresentação. Puro: mesma entrada, mesma saída.
 *
 * Ordem: fila principal primeiro; depois learning que JÁ venceu (o mais antigo);
 * se nada estiver pronto, a sessão encerra — o aluno volta depois, em vez de
 * girar no mesmo card.
 */
export function advanceQueue(state: QueueState, options: AdvanceOptions = {}): QueueState {
  const { requeue, burySiblingsOfNote, exclude, now = Date.now() } = options;

  let main = state.main;
  let learn = requeue ? [...state.learn, requeue] : state.learn;

  if (burySiblingsOfNote) {
    // Irmãos da nota saem da sessão; o card avaliado em si pode reentrar via
    // learn-ahead, então ele é preservado pelo `exclude`.
    const isBuried = (c: SessionCard) => c.noteId === burySiblingsOfNote && c.cardId !== exclude;
    main = main.filter((c) => !isBuried(c));
    learn = learn.filter((l) => !isBuried(l.card));
  }

  const presentation = state.presentation + 1;

  if (main.length > 0) {
    return { main: main.slice(1), learn, current: main[0]!, presentation };
  }

  // Só entra quem realmente venceu — este é o conserto do "travou no mesmo card".
  let readyIdx = -1;
  for (let i = 0; i < learn.length; i++) {
    if (learn[i]!.readyAt > now) continue;
    if (readyIdx === -1 || learn[i]!.readyAt < learn[readyIdx]!.readyAt) readyIdx = i;
  }

  if (readyIdx === -1) {
    return { main, learn, current: null, presentation };
  }

  return {
    main,
    learn: learn.filter((_, i) => i !== readyIdx),
    current: learn[readyIdx]!.card,
    presentation,
  };
}

/** Reapresenta um card desfeito, devolvendo o atual ao topo da fila principal. */
export function undoQueue(state: QueueState, card: SessionCard): QueueState {
  return {
    main: state.current ? [state.current, ...state.main] : state.main,
    // O card volta para a tela, então some de qualquer reentrada pendente.
    learn: state.learn.filter((l) => l.card.cardId !== card.cardId),
    current: card,
    presentation: state.presentation + 1,
  };
}

/** Remove uma nota inteira da sessão (ação "Enterrar a nota inteira"). */
export function dropNote(state: QueueState, noteId: string): QueueState {
  return {
    ...state,
    main: state.main.filter((c) => c.noteId !== noteId),
    learn: state.learn.filter((l) => l.card.noteId !== noteId),
  };
}

/**
 * Aplica o conteúdo recém-editado a TODOS os cards de uma nota na sessão (o da
 * tela e os que ainda virão). O conteúdo é da nota, compartilhado pelos irmãos,
 * então todos são atualizados. Usado pelo modal "Editar card": o servidor já
 * persistiu; isto reflete a edição na hora sem recarregar a página.
 */
export function patchNoteContent(
  state: QueueState,
  noteId: string,
  content: SessionCard["content"],
): QueueState {
  const patch = (c: SessionCard): SessionCard =>
    c.noteId === noteId ? { ...c, content } : c;
  return {
    ...state,
    main: state.main.map(patch),
    learn: state.learn.map((l) => ({ ...l, card: patch(l.card) })),
    current: state.current ? patch(state.current) : null,
  };
}

/** Quantos cards ainda serão vistos, contando o da tela. */
export function remainingCount(state: QueueState): number {
  return state.main.length + state.learn.length + (state.current ? 1 : 0);
}
