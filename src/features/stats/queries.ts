import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import {
  cardProgress,
  cards,
  dailyStudyMetrics,
  decks,
  fsrsProfiles,
  notes,
  reviewLogs,
  userPreferences,
} from "@/db/schema";
import { nextStudyDayStart, studyDayKey, studyDayStart } from "@/lib/study-day";
import { loadStudyDayConfig } from "@/features/review/study-day-config";

/**
 * Consultas do dashboard (Fase 4). Todas seguem a convenção do dia de estudo
 * (§7.4, corte 4h) e a regra de consumo (§3.3): retenção/contagens EXCLUEM
 * logs origin='undo' e os revertidos. Fonte da pesquisa em
 * docs/architecture/research/fase-4-dashboard-pesquisa.md.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Card maduro = intervalo agendado ≥ 21 dias (definição do manual do Anki). */
export const MATURE_INTERVAL_DAYS = 21;

export interface RetentionBucket {
  num: number;
  den: number;
  pct: number | null;
}
export interface TrueRetention {
  young: RetentionBucket;
  mature: RetentionBucket;
  overall: RetentionBucket;
  days: number;
}

function bucket(num: number, den: number): RetentionBucket {
  return { num, den, pct: den > 0 ? num / den : null };
}

/**
 * True retention (manual do Anki): sobre a PRIMEIRA revisão de cada card por dia
 * de estudo, Errei(1)=falha e Difícil/Bom/Fácil(≥2)=acerto. Segmentada por
 * maturidade (intervalo agendado antes da revisão ≥ 21d = maduro), pois a
 * retenção real difere muito entre jovem e maduro.
 */
export async function getTrueRetention(
  userId: string,
  opts: { days?: number } = {},
  runUser: UserRunner = withUserTransaction,
): Promise<TrueRetention> {
  const days = opts.days ?? 30;
  return runUser(userId, async (tx) => {
    const config = await loadStudyDayConfig(tx, userId);
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const logs = await tx
      .select({
        cardId: reviewLogs.cardId,
        reviewedAt: reviewLogs.reviewedAt,
        rating: reviewLogs.rating,
        scheduledDaysBefore: reviewLogs.scheduledDaysBefore,
        origin: reviewLogs.origin,
        id: reviewLogs.id,
        revertedLogId: reviewLogs.revertedLogId,
      })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, cutoff)))
      .orderBy(reviewLogs.reviewedAt);

    const reverted = new Set<number>();
    for (const l of logs) {
      if (l.origin === "undo" && l.revertedLogId != null) reverted.add(l.revertedLogId);
    }

    // Primeira revisão de cada (card, dia de estudo).
    const firstSeen = new Set<string>();
    let youngNum = 0, youngDen = 0, matureNum = 0, matureDen = 0;
    for (const l of logs) {
      if (l.origin === "undo" || reverted.has(l.id)) continue;
      const key = `${l.cardId}|${studyDayKey(l.reviewedAt, config)}`;
      if (firstSeen.has(key)) continue;
      firstSeen.add(key);
      const pass = (l.rating ?? 0) >= 2;
      if ((l.scheduledDaysBefore ?? 0) >= MATURE_INTERVAL_DAYS) {
        matureDen += 1;
        if (pass) matureNum += 1;
      } else {
        youngDen += 1;
        if (pass) youngNum += 1;
      }
    }
    return {
      young: bucket(youngNum, youngDen),
      mature: bucket(matureNum, matureDen),
      overall: bucket(youngNum + matureNum, youngDen + matureDen),
      days,
    };
  });
}

export interface ActivityDay {
  day: string; // YYYY-MM-DD (dia de estudo)
  reviews: number;
  timeMs: number;
}
export interface ActivitySummary {
  days: ActivityDay[];
  currentStreak: number;
  studiedToday: boolean;
  todayKey: string;
}

/**
 * Calendário de atividade (heatmap/streak/tempo) a partir de daily_study_metrics.
 * Streak = dias de estudo consecutivos terminando hoje (ou ontem, se hoje ainda
 * não estudou). Meta diária tem respaldo causal (RCT npj Science of Learning 2025).
 */
export async function getActivity(
  userId: string,
  opts: { days?: number } = {},
  runUser: UserRunner = withUserTransaction,
): Promise<ActivitySummary> {
  const days = opts.days ?? 140;
  return runUser(userId, async (tx) => {
    const config = await loadStudyDayConfig(tx, userId);
    const now = new Date();
    const cutoffKey = studyDayKey(new Date(now.getTime() - days * 86_400_000), config);

    const rows = await tx
      .select({
        day: dailyStudyMetrics.studyDay,
        reviews: dailyStudyMetrics.reviewsCount,
        newCount: dailyStudyMetrics.newCount,
        timeMs: dailyStudyMetrics.timeMs,
      })
      .from(dailyStudyMetrics)
      .where(and(eq(dailyStudyMetrics.userId, userId), gte(dailyStudyMetrics.studyDay, cutoffKey)))
      .orderBy(dailyStudyMetrics.studyDay);

    const byDay = new Map<string, ActivityDay>();
    for (const r of rows) {
      byDay.set(r.day, { day: r.day, reviews: r.reviews + r.newCount, timeMs: r.timeMs });
    }

    // Streak: caminha de hoje para trás enquanto houver atividade.
    const todayKey = studyDayKey(now, config);
    const yesterdayKey = studyDayKey(new Date(studyDayStart(now, config).getTime() - 1000), config);
    const studiedToday = (byDay.get(todayKey)?.reviews ?? 0) > 0;
    let streak = 0;
    let cursor = studiedToday ? now : new Date(studyDayStart(now, config).getTime() - 1000);
    // Se nem hoje nem ontem houve estudo, streak = 0.
    if (studiedToday || (byDay.get(yesterdayKey)?.reviews ?? 0) > 0) {
      for (;;) {
        const key = studyDayKey(cursor, config);
        if ((byDay.get(key)?.reviews ?? 0) > 0) {
          streak += 1;
          cursor = new Date(studyDayStart(cursor, config).getTime() - 1000);
        } else break;
      }
    }

    return { days: [...byDay.values()], currentStreak: streak, studiedToday, todayKey };
  });
}

export interface FutureDue {
  backlog: number; // vencidos ANTES do dia de estudo corrente
  buckets: { day: string; count: number }[];
}

/**
 * Future Due (estilo Anki): quantas revisões vencem por dia futuro, assumindo
 * nenhum card novo e nenhuma falha. Cards já atrasados NÃO entram nos buckets —
 * viram "backlog" separado (o Future Due nativo os omite; separamos para não
 * afogar nem esconder).
 */
export async function getFutureDue(
  userId: string,
  opts: { days?: number } = {},
  runUser: UserRunner = withUserTransaction,
): Promise<FutureDue> {
  const days = opts.days ?? 30;
  return runUser(userId, async (tx) => {
    const config = await loadStudyDayConfig(tx, userId);
    const now = new Date();
    const todayStart = studyDayStart(now, config);
    const horizonKey = studyDayKey(new Date(now.getTime() + days * 86_400_000), config);

    const rows = await tx
      .select({ dueAt: cardProgress.dueAt })
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
          ne(cardProgress.state, "new"),
          isNull(cardProgress.suspendedAt),
          or(isNull(cardProgress.buriedUntil), lte(cardProgress.buriedUntil, now)),
        ),
      );

    // Pré-monta os buckets dos próximos N dias de estudo (mantém dias vazios).
    const bucketOrder: string[] = [];
    const counts = new Map<string, number>();
    let cursor = todayStart;
    for (let i = 0; i <= days; i++) {
      const key = studyDayKey(cursor, config);
      bucketOrder.push(key);
      counts.set(key, 0);
      cursor = nextStudyDayStart(cursor, config);
    }

    let backlog = 0;
    for (const r of rows) {
      if (!r.dueAt) continue;
      if (r.dueAt < todayStart) {
        backlog += 1;
        continue;
      }
      const key = studyDayKey(r.dueAt, config);
      if (key > horizonKey) continue; // além do horizonte
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      backlog,
      buckets: bucketOrder.map((day) => ({ day, count: counts.get(day) ?? 0 })),
    };
  });
}

/** Retenção desejada atual do usuário (perfil FSRS ativo ▸ preferência). */
export async function getDesiredRetention(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<number> {
  return runUser(userId, async (tx) => {
    const [profile] = await tx
      .select({ desiredRetention: fsrsProfiles.desiredRetention })
      .from(fsrsProfiles)
      .where(and(eq(fsrsProfiles.userId, userId), eq(fsrsProfiles.active, true)))
      .orderBy(sql`${fsrsProfiles.version} desc`)
      .limit(1);
    if (profile?.desiredRetention != null) return profile.desiredRetention;
    const [prefs] = await tx
      .select({ desiredRetention: userPreferences.desiredRetention })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return prefs?.desiredRetention ?? 0.9;
  });
}
