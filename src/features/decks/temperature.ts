import { and, eq, isNull, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import {
  cardProgress,
  cards,
  deckSettings,
  decks,
  fsrsProfiles,
  notes,
  userPreferences,
} from "@/db/schema";
import { buildScheduler, toFsrsCard } from "@/features/review/fsrs";

/**
 * Temperatura de revisão por deck (arquitetura §8) — quão "quente" (frágil/
 * pressionado) está a memória do baralho AGORA. Composição ponderada validada
 * no plano; retrievability (R) via ts-fsrs (curva de potência FSRS-6).
 *
 * DECISÃO (Fase 4): computado NA LEITURA (sem tabela deck_stats nem job de 30min
 * ainda) — na escala atual (poucos decks/usuário) é barato e evita infra
 * prematura. Materializar em deck_stats vira débito se ficar pesado.
 */

export const TEMP_WEIGHTS = {
  /** pressão de vencidos ponderada pelo déficit de retrievability */
  deficit: 0.45,
  /** proporção de cards vencidos */
  overdue: 0.2,
  /** carga prevista nas próximas 72h */
  load72h: 0.15,
  /** tempo desde a última revisão do deck */
  staleness: 0.1,
  /** urgência configurada (prova/prazo do deck) */
  urgency: 0.1,
} as const;

const STALE_DAYS_FULL = 14; // sem revisar há ≥14d satura o componente
const EXAM_HORIZON_DAYS = 30; // prova a ≤0d satura; a ≥30d não pesa

export type TempTier = "frio" | "morno" | "quente" | "muito-quente" | "critico";

export interface DeckTemperature {
  score: number; // 0–100
  tier: TempTier;
  label: string;
}

const TIER_LABEL: Record<TempTier, string> = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
  "muito-quente": "Muito quente",
  critico: "Crítico",
};

/** Mapa score→faixa (§8): Frio <20 ≤ Morno <40 ≤ Quente <60 ≤ Muito quente <80 ≤ Crítico. */
export function temperatureTier(score: number): TempTier {
  if (score < 20) return "frio";
  if (score < 40) return "morno";
  if (score < 60) return "quente";
  if (score < 80) return "muito-quente";
  return "critico";
}

export interface TemperatureInput {
  activeCount: number;
  dueCount: number;
  dueNext72h: number;
  /** Σ sobre os vencidos de max(0, R_desejada − R_atual). */
  retrievabilityDeficitSum: number;
  desiredRetention: number;
  daysSinceLastReview: number | null;
  daysUntilExam: number | null;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Função pura de score (testável isoladamente). */
export function deckTemperatureScore(input: TemperatureInput): number {
  const { activeCount } = input;
  if (activeCount <= 0) {
    // Sem cards em revisão: temperatura só reflete urgência de prova, se houver.
    const urgencyOnly =
      input.daysUntilExam == null
        ? 0
        : clamp01((EXAM_HORIZON_DAYS - input.daysUntilExam) / EXAM_HORIZON_DAYS);
    return 100 * TEMP_WEIGHTS.urgency * urgencyOnly;
  }

  const deficit = clamp01(
    input.retrievabilityDeficitSum / (activeCount * Math.max(0.01, input.desiredRetention)),
  );
  const overdue = clamp01(input.dueCount / activeCount);
  const load72h = clamp01(input.dueNext72h / activeCount);
  const staleness =
    input.daysSinceLastReview == null ? 0 : clamp01(input.daysSinceLastReview / STALE_DAYS_FULL);
  const urgency =
    input.daysUntilExam == null
      ? 0
      : clamp01((EXAM_HORIZON_DAYS - input.daysUntilExam) / EXAM_HORIZON_DAYS);

  const score =
    100 *
    (TEMP_WEIGHTS.deficit * deficit +
      TEMP_WEIGHTS.overdue * overdue +
      TEMP_WEIGHTS.load72h * load72h +
      TEMP_WEIGHTS.staleness * staleness +
      TEMP_WEIGHTS.urgency * urgency);
  return Math.round(score);
}

export function toDeckTemperature(input: TemperatureInput): DeckTemperature {
  const score = deckTemperatureScore(input);
  const tier = temperatureTier(score);
  return { score, tier, label: TIER_LABEL[tier] };
}

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

const HOURS_72_MS = 72 * 3_600_000;

/** Temperatura de revisão de todos os decks vivos do usuário. */
export async function deckTemperatures(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<Map<string, DeckTemperature>> {
  return runUser(userId, async (tx) => {
    const now = new Date();

    const [profile] = await tx
      .select({ parameters: fsrsProfiles.parameters, desiredRetention: fsrsProfiles.desiredRetention })
      .from(fsrsProfiles)
      .where(and(eq(fsrsProfiles.userId, userId), eq(fsrsProfiles.active, true)))
      .orderBy(fsrsProfiles.version)
      .limit(1);
    const scheduler = buildScheduler(profile);

    const [prefs] = await tx
      .select({ desiredRetention: userPreferences.desiredRetention })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const baseRetention = profile?.desiredRetention ?? prefs?.desiredRetention ?? 0.9;

    const settingsRows = await tx
      .select({
        deckId: deckSettings.deckId,
        override: deckSettings.desiredRetentionOverride,
        examDate: deckSettings.examDate,
      })
      .from(deckSettings)
      .where(eq(deckSettings.ownerUserId, userId));
    const settingsByDeck = new Map(settingsRows.map((s) => [s.deckId, s]));

    const rows = await tx
      .select({
        deckId: notes.deckId,
        state: cardProgress.state,
        dueAt: cardProgress.dueAt,
        lastReviewedAt: cardProgress.lastReviewedAt,
        stability: cardProgress.stability,
        difficulty: cardProgress.difficulty,
        elapsedDays: cardProgress.elapsedDays,
        scheduledDays: cardProgress.scheduledDays,
        reps: cardProgress.reps,
        lapses: cardProgress.lapses,
        learningStep: cardProgress.learningStep,
      })
      .from(cardProgress)
      .innerJoin(cards, eq(cards.id, cardProgress.cardId))
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .innerJoin(decks, eq(decks.id, notes.deckId))
      .where(
        and(
          eq(cardProgress.userId, userId),
          eq(cards.status, "active"),
          isNull(notes.deletedAt),
          isNull(decks.deletedAt),
          isNull(cardProgress.suspendedAt),
          ne(cardProgress.state, "new"),
        ),
      );

    interface Acc {
      active: number;
      due: number;
      due72: number;
      deficit: number;
      lastReviewed: number | null;
    }
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      let a = acc.get(r.deckId);
      if (!a) {
        a = { active: 0, due: 0, due72: 0, deficit: 0, lastReviewed: null };
        acc.set(r.deckId, a);
      }
      a.active += 1;
      const lr = r.lastReviewedAt?.getTime() ?? null;
      if (lr != null && (a.lastReviewed == null || lr > a.lastReviewed)) a.lastReviewed = lr;

      const dueMs = r.dueAt?.getTime() ?? now.getTime();
      const overdue = dueMs <= now.getTime();
      if (overdue) {
        a.due += 1;
        const retention = settingsByDeck.get(r.deckId)?.override ?? baseRetention;
        const R = scheduler.fsrs.get_retrievability(toFsrsCard(r, now), now, false);
        a.deficit += Math.max(0, retention - R);
      } else if (dueMs <= now.getTime() + HOURS_72_MS) {
        a.due72 += 1;
      }
    }

    const result = new Map<string, DeckTemperature>();
    for (const [deckId, a] of acc) {
      const s = settingsByDeck.get(deckId);
      const retention = s?.override ?? baseRetention;
      const daysUntilExam = s?.examDate
        ? Math.max(0, Math.ceil((new Date(s.examDate).getTime() - now.getTime()) / 86_400_000))
        : null;
      const daysSinceLastReview =
        a.lastReviewed == null ? null : (now.getTime() - a.lastReviewed) / 86_400_000;
      result.set(
        deckId,
        toDeckTemperature({
          activeCount: a.active,
          dueCount: a.due,
          dueNext72h: a.due72,
          retrievabilityDeficitSum: a.deficit,
          desiredRetention: retention,
          daysSinceLastReview,
          daysUntilExam,
        }),
      );
    }
    return result;
  });
}
