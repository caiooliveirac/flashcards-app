import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, cardProgress, cards, decks, fsrsProfiles, notes, reviewLogs } from "@/db/schema";
import type { NoteContent } from "@/lib/content";

/**
 * MVP de revisão (Fase 3 mínima): fila vencidos→novos, submit idempotente com
 * ts-fsrs (FSRS-6, perfil do usuário) persistindo estado/dificuldade/
 * estabilidade/reps/lapses/última revisão/próximo due. Sem undo, sem sibling
 * burial, sem limites diários por timezone — ver POST_MVP.md.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const NEW_CARDS_PER_SESSION = 20;
export const MAX_DUE_PER_SESSION = 100;

export interface ReviewQueueCard {
  cardId: string;
  noteType: "basic" | "cloze";
  clozeGroupKey: string | null;
  content: NoteContent;
  isNew: boolean;
}

export interface ReviewQueue {
  deckId: string;
  deckName: string;
  dueCount: number;
  newCount: number;
  cards: ReviewQueueCard[];
}

const FSRS_VERSION = "ts-fsrs-5/FSRS-6";

/** Predicados compartilhados: card ativo de nota viva do deck vivo do usuário. */
function liveCardJoin(tx: Tx, userId: string, deckId?: string) {
  return tx
    .select({
      cardId: cards.id,
      noteType: notes.noteType,
      clozeGroupKey: cards.clozeGroupKey,
      contentJson: notes.contentJson,
      deckId: notes.deckId,
      state: cardProgress.state,
      dueAt: cardProgress.dueAt,
      suspendedAt: cardProgress.suspendedAt,
      buriedUntil: cardProgress.buriedUntil,
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
    const rows = await liveCardJoin(tx, userId, input.deckId).orderBy(
      asc(cards.createdAt),
      asc(cards.variant),
    );

    const usable = rows.filter(
      (r) =>
        !r.suspendedAt && (!r.buriedUntil || r.buriedUntil <= now),
    );
    const due = usable
      .filter((r) => r.state && r.state !== "new" && r.dueAt && r.dueAt <= now)
      .sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())
      .slice(0, MAX_DUE_PER_SESSION);
    const fresh = usable
      .filter((r) => !r.state || r.state === "new")
      .slice(0, NEW_CARDS_PER_SESSION);

    const toCard = (r: (typeof rows)[number], isNew: boolean): ReviewQueueCard => ({
      cardId: r.cardId,
      noteType: r.noteType,
      clozeGroupKey: r.clozeGroupKey,
      content: r.contentJson as NoteContent,
      isNew,
    });

    return {
      deckId: deck.id,
      deckName: deck.name,
      dueCount: due.length,
      newCount: fresh.length,
      cards: [...due.map((r) => toCard(r, false)), ...fresh.map((r) => toCard(r, true))],
    };
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

const stateToDb: Record<State, "new" | "learning" | "review" | "relearning"> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
const stateFromDb: Record<"new" | "learning" | "review" | "relearning", State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export interface SubmitReviewInput {
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  idempotencyKey: string;
  durationMs?: number;
  clientTimezone?: string;
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
      .select({ cardId: cards.id })
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
    const w = (profile?.parameters as number[] | undefined) ?? undefined;
    const desiredRetention = profile?.desiredRetention ?? 0.9;

    const now = new Date();
    const before: FsrsCard = progress
      ? {
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
        }
      : createEmptyCard(now);

    const scheduler = fsrs(
      generatorParameters({
        ...(w && w.length >= 17 ? { w } : {}),
        request_retention: desiredRetention,
        enable_fuzz: false,
      }),
    );
    const { card: after } = scheduler.next(before, now, input.rating as Grade);

    // Idempotência: o log é a fonte da verdade do double-submit (unique
    // (user_id, idempotency_key)); conflito => já processado, devolve o estado atual.
    const inserted = await tx
      .insert(reviewLogs)
      .values({
        userId,
        cardId: input.cardId,
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
