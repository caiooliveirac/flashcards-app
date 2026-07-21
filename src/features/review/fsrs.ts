import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from "ts-fsrs";

/**
 * Camada FSRS compartilhada (arquitetura §7.1): construção do scheduler a partir
 * do perfil do usuário, mapeamento estado↔db, e cálculo dos intervalos previstos
 * para os 4 botões. Isola o uso de `ts-fsrs` — submit e a fila usam os MESMOS
 * parâmetros (sem isso os intervalos previstos divergiriam do agendamento real).
 */

export type DbState = "new" | "learning" | "review" | "relearning";

export const FSRS_VERSION = "ts-fsrs-5/FSRS-6";

export const stateToDb: Record<State, DbState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

export const stateFromDb: Record<DbState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export interface FsrsProfileInput {
  parameters?: unknown;
  desiredRetention?: number | null;
}

export interface Scheduler {
  fsrs: FSRS;
  desiredRetention: number;
}

/** Scheduler determinístico (fuzz off) com os parâmetros do perfil ativo. */
export function buildScheduler(profile: FsrsProfileInput | undefined): Scheduler {
  const w = (profile?.parameters as number[] | undefined) ?? undefined;
  const desiredRetention = profile?.desiredRetention ?? 0.9;
  const instance = fsrs(
    generatorParameters({
      ...(w && w.length >= 17 ? { w } : {}),
      request_retention: desiredRetention,
      enable_fuzz: false,
    }),
  );
  return { fsrs: instance, desiredRetention };
}

/** Reconstrói o `Card` do ts-fsrs a partir do progresso persistido (ou vazio). */
export function toFsrsCard(
  progress:
    | {
        dueAt: Date | null;
        stability: number;
        difficulty: number;
        elapsedDays: number;
        scheduledDays: number;
        reps: number;
        lapses: number;
        learningStep: number;
        state: DbState;
        lastReviewedAt: Date | null;
      }
    | null
    | undefined,
  now: Date,
): FsrsCard {
  if (!progress) return createEmptyCard(now);
  return {
    due: progress.dueAt ?? now,
    stability: progress.stability,
    difficulty: progress.difficulty,
    elapsed_days: progress.elapsedDays,
    scheduled_days: progress.scheduledDays,
    reps: progress.reps,
    lapses: progress.lapses,
    learning_steps: progress.learningStep,
    state: stateFromDb[progress.state],
    last_review: progress.lastReviewedAt ?? undefined,
  };
}

export type PreviewMs = [again: number, hard: number, good: number, easy: number];

/**
 * Milissegundos até o próximo vencimento para cada um dos 4 ratings, a partir do
 * estado atual do card. Alimenta os intervalos nos botões (aceite F3). Usa o
 * MESMO scheduler do submit — o que o botão promete é o que o submit agenda.
 */
export function previewMs(scheduler: Scheduler, before: FsrsCard, now: Date): PreviewMs {
  const records = scheduler.fsrs.repeat(before, now);
  const dueFor = (g: Grade): number =>
    Math.max(0, records[g].card.due.getTime() - now.getTime());
  return [dueFor(Rating.Again), dueFor(Rating.Hard), dueFor(Rating.Good), dueFor(Rating.Easy)];
}
