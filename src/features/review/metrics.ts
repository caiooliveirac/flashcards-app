import { and, gte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { dailyStudyMetrics, reviewLogs, userProfiles } from "@/db/schema";
import { studyDayKey, type StudyDayConfig } from "@/lib/study-day";

/**
 * Agregação de `daily_study_metrics` a partir de `review_logs` (job noturno,
 * §7.4). Roda como flashcards_service (BYPASSRLS): varre todos os usuários.
 * Regra de consumo (§3.3): ignora logs `origin='undo'` E os logs que eles
 * revertem — métricas não contam revisões retratadas. "Retenção real" = acertos
 * (rating≥3) sobre a PRIMEIRA revisão de cada card no dia de estudo.
 * Idempotente (upsert por (user, study_day)): rodar de novo recomputa igual.
 */

export type ServiceRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

interface DayAgg {
  reviewsCount: number;
  newCount: number;
  againCount: number;
  timeMs: number;
  firstRatingByCard: Map<string, number>;
}

export async function aggregateDailyMetrics(
  runService: ServiceRunner,
  opts: { lookbackDays?: number; now?: Date } = {},
): Promise<{ users: number; days: number }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.lookbackDays ?? 3) * 86_400_000);

  const userRows = await runService((tx) =>
    tx
      .selectDistinct({ userId: reviewLogs.userId })
      .from(reviewLogs)
      .where(gte(reviewLogs.reviewedAt, cutoff)),
  );

  let daysWritten = 0;
  for (const { userId } of userRows) {
    const [profile] = await runService((tx) =>
      tx
        .select({ timezone: userProfiles.timezone, dayStartHour: userProfiles.dayStartHour })
        .from(userProfiles)
        .where(sql`${userProfiles.userId} = ${userId}`)
        .limit(1),
    );
    const config: StudyDayConfig = {
      timezone: profile?.timezone ?? "America/Sao_Paulo",
      dayStartHour: profile?.dayStartHour ?? 4,
    };

    const logs = await runService((tx) =>
      tx
        .select({
          id: reviewLogs.id,
          cardId: reviewLogs.cardId,
          reviewedAt: reviewLogs.reviewedAt,
          rating: reviewLogs.rating,
          stateBefore: reviewLogs.stateBefore,
          durationMs: reviewLogs.durationMs,
          origin: reviewLogs.origin,
          revertedLogId: reviewLogs.revertedLogId,
        })
        .from(reviewLogs)
        .where(and(sql`${reviewLogs.userId} = ${userId}`, gte(reviewLogs.reviewedAt, cutoff)))
        .orderBy(reviewLogs.reviewedAt),
    );

    const reverted = new Set<number>();
    for (const l of logs) {
      if (l.origin === "undo" && l.revertedLogId != null) reverted.add(l.revertedLogId);
    }

    const byDay = new Map<string, DayAgg>();
    for (const l of logs) {
      if (l.origin === "undo" || reverted.has(l.id)) continue;
      const day = studyDayKey(l.reviewedAt, config);
      let agg = byDay.get(day);
      if (!agg) {
        agg = { reviewsCount: 0, newCount: 0, againCount: 0, timeMs: 0, firstRatingByCard: new Map() };
        byDay.set(day, agg);
      }
      if (l.stateBefore === "new") agg.newCount += 1;
      else agg.reviewsCount += 1;
      if (l.rating === 1) agg.againCount += 1;
      agg.timeMs += l.durationMs ?? 0;
      // logs já vêm ordenados por reviewed_at → o primeiro visto é o do dia.
      if (!agg.firstRatingByCard.has(l.cardId)) {
        agg.firstRatingByCard.set(l.cardId, l.rating ?? 0);
      }
    }

    for (const [day, agg] of byDay) {
      const den = agg.firstRatingByCard.size;
      let num = 0;
      for (const r of agg.firstRatingByCard.values()) if (r >= 3) num += 1;
      await runService((tx) =>
        tx
          .insert(dailyStudyMetrics)
          .values({
            userId,
            studyDay: day,
            reviewsCount: agg.reviewsCount,
            newCount: agg.newCount,
            againCount: agg.againCount,
            timeMs: agg.timeMs,
            retentionNum: num,
            retentionDen: den,
          })
          .onConflictDoUpdate({
            target: [dailyStudyMetrics.userId, dailyStudyMetrics.studyDay],
            set: {
              reviewsCount: agg.reviewsCount,
              newCount: agg.newCount,
              againCount: agg.againCount,
              timeMs: agg.timeMs,
              retentionNum: num,
              retentionDen: den,
              computedAt: sql`now()`,
            },
          }),
      );
      daysWritten += 1;
    }
  }

  return { users: userRows.length, days: daysWritten };
}
