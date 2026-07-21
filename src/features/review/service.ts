import { and, asc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import type { Grade } from "ts-fsrs";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import {
  auditLogs,
  cardProgress,
  cards,
  deckSettings,
  decks,
  fsrsProfiles,
  notes,
  reviewLogs,
  studySessions,
  userPreferences,
} from "@/db/schema";
import type { NoteContent } from "@/lib/content";
import {
  nextStudyDayStart,
  studyDayKey,
  studyDayStart,
  type StudyDayConfig,
} from "@/lib/study-day";
import {
  buildScheduler,
  FSRS_VERSION,
  previewMs,
  stateToDb,
  toFsrsCard,
  type PreviewMs,
} from "./fsrs";
import { loadStudyDayConfig } from "./study-day-config";

export interface DailyRemaining {
  newRemaining: number;
  reviewRemaining: number;
}

/**
 * Orçamento restante do DIA DE ESTUDO (§7.4) para o deck: limite (override do
 * deck ▸ preferência do usuário) menos o que já foi feito desde o corte do dia.
 * Contar desde `studyDayStart` faz o limite NÃO resetar ao cruzar a meia-noite
 * (só reseta no corte das 4h) — aceite F3#7. Descontos de undo mantêm a conta
 * honesta (introdução/revisão desfeita libera orçamento).
 */
async function dailyRemaining(
  tx: Tx,
  userId: string,
  deckId: string,
  config: StudyDayConfig,
): Promise<DailyRemaining> {
  const dayStart = studyDayStart(new Date(), config);
  const [prefs] = await tx
    .select({
      newPerDay: userPreferences.newCardsPerDay,
      maxReviews: userPreferences.maxReviewsPerDay,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const [settings] = await tx
    .select({
      newOverride: deckSettings.newPerDayOverride,
      reviewOverride: deckSettings.maxReviewsPerDayOverride,
    })
    .from(deckSettings)
    .where(eq(deckSettings.deckId, deckId))
    .limit(1);

  const newLimit = settings?.newOverride ?? prefs?.newPerDay ?? NEW_CARDS_PER_SESSION;
  const reviewLimit = settings?.reviewOverride ?? prefs?.maxReviews ?? MAX_DUE_PER_SESSION;

  // Contadores do dia para ESTE deck: introduções (state_before='new') e
  // revisões (state_before<>'new'), líquidos dos undos correspondentes.
  const [counts] = await tx
    .select({
      newDone: sql<number>`
        count(*) filter (where ${reviewLogs.origin} = 'web' and ${reviewLogs.stateBefore} = 'new')
        - count(*) filter (where ${reviewLogs.origin} = 'undo' and ${reviewLogs.stateAfter} = 'new')`.mapWith(
        Number,
      ),
      reviewsDone: sql<number>`
        count(*) filter (where ${reviewLogs.origin} = 'web' and ${reviewLogs.stateBefore} <> 'new')
        - count(*) filter (where ${reviewLogs.origin} = 'undo' and ${reviewLogs.stateAfter} <> 'new')`.mapWith(
        Number,
      ),
    })
    .from(reviewLogs)
    .innerJoin(cards, eq(cards.id, reviewLogs.cardId))
    .innerJoin(notes, eq(notes.id, cards.noteId))
    .where(
      and(
        eq(reviewLogs.userId, userId),
        eq(notes.deckId, deckId),
        gte(reviewLogs.reviewedAt, dayStart),
      ),
    );

  return {
    newRemaining: Math.max(0, newLimit - (counts?.newDone ?? 0)),
    reviewRemaining: Math.max(0, reviewLimit - (counts?.reviewsDone ?? 0)),
  };
}

/**
 * Sibling burial (§7.2): ao revisar um card, os IRMÃOS (mesma nota, ainda
 * ativos e não suspensos) recebem `buried_until` = início do próximo dia de
 * estudo — responder um cloze não pode revelar/inflar os outros grupos da nota.
 * Cria linha de progresso p/ irmãos novos (state 'new' + buried_until). Nunca
 * ENCURTA um enterro já mais distante (greatest).
 */
async function burySiblings(
  tx: Tx,
  userId: string,
  noteId: string,
  exceptCardId: string,
  until: Date,
): Promise<void> {
  const siblings = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.noteId, noteId),
        eq(cards.ownerUserId, userId),
        eq(cards.status, "active"),
        ne(cards.id, exceptCardId),
      ),
    );
  if (siblings.length === 0) return;
  await tx
    .insert(cardProgress)
    .values(
      siblings.map((s) => ({ userId, cardId: s.id, state: "new" as const, buriedUntil: until })),
    )
    .onConflictDoUpdate({
      target: [cardProgress.userId, cardProgress.cardId],
      // Só enterra quem não está suspenso; mantém o enterro mais distante.
      set: {
        buriedUntil: sql`greatest(coalesce(${cardProgress.buriedUntil}, ${until}), ${until})`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${cardProgress.suspendedAt} is null`,
    });
}

/**
 * MVP de revisão (Fase 3 mínima): fila vencidos→novos, submit idempotente com
 * ts-fsrs (FSRS-6, perfil do usuário) persistindo estado/dificuldade/
 * estabilidade/reps/lapses/última revisão/próximo due. Sem undo, sem sibling
 * burial, sem limites diários por timezone — ver POST_MVP.md.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const NEW_CARDS_PER_SESSION = 20;
export const MAX_DUE_PER_SESSION = 100;
/** Lapses acumulados a partir dos quais o card é sinalizado como leech (Anki=8). */
export const LEECH_THRESHOLD = 8;

export interface ReviewQueueCard {
  cardId: string;
  noteId: string;
  noteType: "basic" | "cloze";
  clozeGroupKey: string | null;
  content: NoteContent;
  isNew: boolean;
  /** ms até o próximo vencimento para [Errei, Difícil, Bom, Fácil] (aceite F3). */
  previewMs: PreviewMs;
  /** lapses acumulados — leech quando ≥ limiar (aceite F3, ver LEECH_THRESHOLD). */
  lapses: number;
  isLeech: boolean;
}

export interface ReviewQueue {
  deckId: string;
  deckName: string;
  dueCount: number;
  newCount: number;
  cards: ReviewQueueCard[];
}

/**
 * Distribui os cards de forma que nenhum par consecutivo compartilhe o mesmo
 * noteId. Usa uma fila de prioridade simples (round-robin por nota):
 * pega sempre o card cuja nota não foi usada no slot anterior, priorizando
 * a nota com mais cards restantes. Quando é impossível evitar (ex.: só cards
 * de uma nota), aceita o empate em vez de travar.
 */
function spreadSameNote(input: ReviewQueueCard[]): ReviewQueueCard[] {
  if (input.length <= 1) return input;

  // Agrupa por noteId mantendo a ordem original dentro de cada grupo.
  const byNote = new Map<string, ReviewQueueCard[]>();
  for (const card of input) {
    const bucket = byNote.get(card.noteId);
    if (bucket) bucket.push(card);
    else byNote.set(card.noteId, [card]);
  }

  const buckets = [...byNote.values()];
  const result: ReviewQueueCard[] = [];
  let lastNoteId: string | null = null;

  while (result.length < input.length) {
    // Candidatos: buckets não-vazios cuja nota difere da última usada (se possível).
    const eligible = buckets
      .filter((b) => b.length > 0 && b[0]!.noteId !== lastNoteId)
      .sort((a, b) => b.length - a.length); // maior bucket primeiro

    const chosen =
      eligible[0] ??
      // Impossível evitar colisão (todos os restantes são da mesma nota).
      buckets.find((b) => b.length > 0);

    const card = chosen!.shift()!;
    result.push(card);
    lastNoteId = card.noteId;
  }

  return result;
}

/** Predicados compartilhados: card ativo de nota viva do deck vivo do usuário. */
function liveCardJoin(tx: Tx, userId: string, deckId?: string) {
  return tx
    .select({
      cardId: cards.id,
      noteId: notes.id,
      noteType: notes.noteType,
      clozeGroupKey: cards.clozeGroupKey,
      contentJson: notes.contentJson,
      deckId: notes.deckId,
      state: cardProgress.state,
      dueAt: cardProgress.dueAt,
      suspendedAt: cardProgress.suspendedAt,
      buriedUntil: cardProgress.buriedUntil,
      stability: cardProgress.stability,
      difficulty: cardProgress.difficulty,
      elapsedDays: cardProgress.elapsedDays,
      scheduledDays: cardProgress.scheduledDays,
      reps: cardProgress.reps,
      lapses: cardProgress.lapses,
      learningStep: cardProgress.learningStep,
      lastReviewedAt: cardProgress.lastReviewedAt,
    })
    .from(cards)
    .innerJoin(notes, eq(notes.id, cards.noteId))
    .innerJoin(decks, eq(decks.id, notes.deckId))
    .leftJoin(
      cardProgress,
      and(eq(cardProgress.cardId, cards.id), eq(cardProgress.userId, userId)),
    )
    .where(
      and(
        eq(cards.ownerUserId, userId),
        eq(cards.status, "active"),
        isNull(notes.deletedAt),
        isNull(decks.deletedAt),
        deckId ? eq(notes.deckId, deckId) : undefined,
      ),
    );
}

export async function getReviewQueue(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<ReviewQueue> {
  return runUser(userId, async (tx) => {
    const [deck] = await tx
      .select({ id: decks.id, name: decks.name })
      .from(decks)
      .where(and(eq(decks.id, input.deckId), eq(decks.ownerUserId, userId), isNull(decks.deletedAt)))
      .limit(1);
    if (!deck) {
      throw new Error("baralho não encontrado");
    }

    const now = new Date();
    const config = await loadStudyDayConfig(tx, userId);
    const { newRemaining, reviewRemaining } = await dailyRemaining(tx, userId, input.deckId, config);

    // Perfil FSRS ativo → scheduler compartilhado p/ os intervalos previstos.
    const [profile] = await tx
      .select({ parameters: fsrsProfiles.parameters, desiredRetention: fsrsProfiles.desiredRetention })
      .from(fsrsProfiles)
      .where(and(eq(fsrsProfiles.userId, userId), eq(fsrsProfiles.active, true)))
      .orderBy(sql`${fsrsProfiles.version} desc`)
      .limit(1);
    const scheduler = buildScheduler(profile);

    const rows = await liveCardJoin(tx, userId, input.deckId).orderBy(
      asc(cards.createdAt),
      asc(cards.variant),
    );

    const usable = rows.filter(
      (r) =>
        !r.suspendedAt && (!r.buriedUntil || r.buriedUntil <= now),
    );
    // Limite diário (§7.4) manda; o cap de sessão é um teto secundário.
    const due = usable
      .filter((r) => r.state && r.state !== "new" && r.dueAt && r.dueAt <= now)
      .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())
      .slice(0, Math.min(MAX_DUE_PER_SESSION, reviewRemaining));
    const fresh = usable
      .filter((r) => !r.state || r.state === "new")
      .slice(0, Math.min(NEW_CARDS_PER_SESSION, newRemaining));

    const toCard = (r: (typeof rows)[number], isNew: boolean): ReviewQueueCard => {
      const before = toFsrsCard(
        r.state
          ? {
              dueAt: r.dueAt,
              stability: r.stability ?? 0,
              difficulty: r.difficulty ?? 0,
              elapsedDays: r.elapsedDays ?? 0,
              scheduledDays: r.scheduledDays ?? 0,
              reps: r.reps ?? 0,
              lapses: r.lapses ?? 0,
              learningStep: r.learningStep ?? 0,
              state: r.state,
              lastReviewedAt: r.lastReviewedAt,
            }
          : null,
        now,
      );
      return {
        cardId: r.cardId,
        noteId: r.noteId,
        noteType: r.noteType,
        clozeGroupKey: r.clozeGroupKey,
        content: r.contentJson as NoteContent,
        isNew,
        previewMs: previewMs(scheduler, before, now),
        lapses: r.lapses ?? 0,
        isLeech: (r.lapses ?? 0) >= LEECH_THRESHOLD,
      };
    };

    const dueCards = due.map((r) => toCard(r, false));
    const freshCards = fresh.map((r) => toCard(r, true));

    return {
      deckId: deck.id,
      deckName: deck.name,
      dueCount: due.length,
      newCount: fresh.length,
      cards: [...spreadSameNote(dueCards), ...spreadSameNote(freshCards)],
    };
  });
}

/**
 * Abre (ou reaproveita) a sessão de estudo do dia para o deck. Reusa a sessão
 * ABERTA (ended_at null) do MESMO dia de estudo (§7.4) — cruzar a meia-noite
 * mantém a sessão; cruzar o corte das 4h abre uma nova. Os review_logs apontam
 * para ela; o job noturno agrega em daily_study_metrics.
 */
export async function startStudySession(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<string> {
  return runUser(userId, async (tx) => {
    const config = await loadStudyDayConfig(tx, userId);
    const today = studyDayKey(new Date(), config);
    const [open] = await tx
      .select({ id: studySessions.id })
      .from(studySessions)
      .where(
        and(
          eq(studySessions.userId, userId),
          eq(studySessions.deckId, input.deckId),
          eq(studySessions.studyDay, today),
          isNull(studySessions.endedAt),
        ),
      )
      .orderBy(sql`${studySessions.startedAt} desc`)
      .limit(1);
    if (open) return open.id;
    const [created] = await tx
      .insert(studySessions)
      .values({ userId, deckId: input.deckId, kind: "review", studyDay: today })
      .returning({ id: studySessions.id });
    return created!.id;
  });
}

export interface DeckReviewCounts {
  dueCount: number;
  newCount: number;
}

/** Contagens por deck para a home (vencidos agora + novos disponíveis). */
export async function reviewCountsByDeck(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<Map<string, DeckReviewCounts>> {
  return runUser(userId, async (tx) => {
    const rows = await tx
      .select({
        deckId: notes.deckId,
        dueCount: sql<number>`count(*) filter (where ${cardProgress.state} is not null and ${cardProgress.state} <> 'new' and ${cardProgress.dueAt} <= now() and ${cardProgress.suspendedAt} is null and (${cardProgress.buriedUntil} is null or ${cardProgress.buriedUntil} <= now()))`.mapWith(Number),
        newCount: sql<number>`count(*) filter (where (${cardProgress.state} is null or ${cardProgress.state} = 'new') and ${cardProgress.suspendedAt} is null)`.mapWith(Number),
      })
      .from(cards)
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .innerJoin(decks, eq(decks.id, notes.deckId))
      .leftJoin(
        cardProgress,
        and(eq(cardProgress.cardId, cards.id), eq(cardProgress.userId, userId)),
      )
      .where(
        and(
          eq(cards.ownerUserId, userId),
          eq(cards.status, "active"),
          isNull(notes.deletedAt),
          isNull(decks.deletedAt),
        ),
      )
      .groupBy(notes.deckId);
    return new Map(rows.map((r) => [r.deckId, { dueCount: r.dueCount, newCount: r.newCount }]));
  });
}

export interface SubmitReviewInput {
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  idempotencyKey: string;
  durationMs?: number;
  clientTimezone?: string;
  studySessionId?: string;
}

export interface SubmitReviewResult {
  duplicate: boolean;
  state: "new" | "learning" | "review" | "relearning";
  dueAt: Date;
}

export async function submitReview(
  userId: string,
  input: SubmitReviewInput,
  runUser: UserRunner = withUserTransaction,
): Promise<SubmitReviewResult> {
  if (![1, 2, 3, 4].includes(input.rating)) {
    throw new Error("avaliação inválida");
  }
  return runUser(userId, async (tx) => {
    // Card ativo do usuário (nota e deck vivos) — ownership explícito + RLS.
    const [card] = await tx
      .select({ cardId: cards.id, noteId: notes.id })
      .from(cards)
      .innerJoin(notes, eq(notes.id, cards.noteId))
      .innerJoin(decks, eq(decks.id, notes.deckId))
      .where(
        and(
          eq(cards.id, input.cardId),
          eq(cards.ownerUserId, userId),
          eq(cards.status, "active"),
          isNull(notes.deletedAt),
          isNull(decks.deletedAt),
        ),
      )
      .limit(1);
    if (!card) {
      throw new Error("card não encontrado");
    }

    // Lock por linha do progresso (se existir) — serializa double-submit.
    const [progress] = await tx
      .select()
      .from(cardProgress)
      .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)))
      .for("update");

    // Perfil FSRS ativo do usuário (bootstrap garante o v1 default).
    const [profile] = await tx
      .select({
        version: fsrsProfiles.version,
        parameters: fsrsProfiles.parameters,
        desiredRetention: fsrsProfiles.desiredRetention,
      })
      .from(fsrsProfiles)
      .where(and(eq(fsrsProfiles.userId, userId), eq(fsrsProfiles.active, true)))
      .orderBy(sql`${fsrsProfiles.version} desc`)
      .limit(1);
    const scheduler = buildScheduler(profile);
    const desiredRetention = scheduler.desiredRetention;

    const now = new Date();
    const before = toFsrsCard(progress ?? null, now);
    const { card: after } = scheduler.fsrs.next(before, now, input.rating as Grade);

    // Idempotência: o log é a fonte da verdade do double-submit (unique
    // (user_id, idempotency_key)); conflito => já processado, devolve o estado atual.
    const inserted = await tx
      .insert(reviewLogs)
      .values({
        userId,
        cardId: input.cardId,
        studySessionId: input.studySessionId ?? null,
        rating: input.rating,
        stateBefore: stateToDb[before.state],
        stateAfter: stateToDb[after.state],
        dueBefore: progress?.dueAt ?? null,
        dueAfter: after.due,
        stabilityBefore: before.stability,
        stabilityAfter: after.stability,
        difficultyBefore: before.difficulty,
        difficultyAfter: after.difficulty,
        learningStepBefore: before.learning_steps,
        learningStepAfter: after.learning_steps,
        repsBefore: before.reps,
        lapsesBefore: before.lapses,
        scheduledDaysBefore: before.scheduled_days,
        scheduledDaysAfter: after.scheduled_days,
        durationMs: input.durationMs ?? null,
        clientTimezone: input.clientTimezone ?? null,
        fsrsVersion: FSRS_VERSION,
        parametersVersion: profile?.version ?? 1,
        idempotencyKey: input.idempotencyKey,
        origin: "web",
      })
      .onConflictDoNothing({ target: [reviewLogs.userId, reviewLogs.idempotencyKey] })
      .returning({ id: reviewLogs.id });

    if (inserted.length === 0) {
      // Double-submit: o primeiro já atualizou o progresso.
      const [current] = await tx
        .select({ state: cardProgress.state, dueAt: cardProgress.dueAt })
        .from(cardProgress)
        .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)));
      return {
        duplicate: true,
        state: current?.state ?? "new",
        dueAt: current?.dueAt ?? now,
      };
    }

    await tx
      .insert(cardProgress)
      .values({
        userId,
        cardId: input.cardId,
        state: stateToDb[after.state],
        dueAt: after.due,
        lastReviewedAt: now,
        stability: after.stability,
        difficulty: after.difficulty,
        elapsedDays: after.elapsed_days,
        scheduledDays: after.scheduled_days,
        reps: after.reps,
        lapses: after.lapses,
        learningStep: after.learning_steps,
        fsrsVersion: FSRS_VERSION,
        parametersVersion: profile?.version ?? 1,
        desiredRetention,
      })
      .onConflictDoUpdate({
        target: [cardProgress.userId, cardProgress.cardId],
        set: {
          state: stateToDb[after.state],
          dueAt: after.due,
          lastReviewedAt: now,
          stability: after.stability,
          difficulty: after.difficulty,
          elapsedDays: after.elapsed_days,
          scheduledDays: after.scheduled_days,
          reps: after.reps,
          lapses: after.lapses,
          learningStep: after.learning_steps,
          parametersVersion: profile?.version ?? 1,
          desiredRetention,
          updatedAt: now,
        },
      });

    // Sibling burial: enterra os irmãos da nota até o próximo dia de estudo.
    const config = await loadStudyDayConfig(tx, userId);
    await burySiblings(tx, userId, card.noteId, input.cardId, nextStudyDayStart(now, config));

    // Contadores da sessão (desnormalização barata; verdade = review_logs).
    if (input.studySessionId) {
      const wasNew = !progress || progress.state === "new";
      await tx
        .update(studySessions)
        .set({
          reviewCount: wasNew ? sql`${studySessions.reviewCount}` : sql`${studySessions.reviewCount} + 1`,
          newCount: wasNew ? sql`${studySessions.newCount} + 1` : sql`${studySessions.newCount}`,
          againCount:
            input.rating === 1 ? sql`${studySessions.againCount} + 1` : sql`${studySessions.againCount}`,
          timeMs: sql`${studySessions.timeMs} + ${input.durationMs ?? 0}`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(studySessions.id, input.studySessionId), eq(studySessions.userId, userId)));
    }

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "review.submit",
      entityType: "card",
      entityId: input.cardId,
      metadata: { rating: input.rating, state: stateToDb[after.state] },
    });

    return { duplicate: false, state: stateToDb[after.state], dueAt: after.due };
  });
}
