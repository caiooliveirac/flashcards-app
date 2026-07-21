import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, cardProgress, cards, reviewLogs } from "@/db/schema";

/**
 * Undo compensatório (arquitetura §7.2, D6). NUNCA apaga linha de review_logs:
 * insere um log `origin='undo'` (rating NULL, reverted_log_id apontando o log
 * desfeito) e reverte `card_progress` ao snapshot `*_before` completo do log —
 * incluindo learning_step/reps/lapses e o last_reviewed_at do log ANTERIOR
 * (sem isso, um card em learning não volta ao step certo). Idempotente por
 * natureza: um log já referenciado por um undo não é desfeito de novo.
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface UndoResult {
  cardId: string;
  /** Estado restaurado ('new' quando o card volta a nunca-revisado). */
  state: "new" | "learning" | "review" | "relearning";
}

export async function undoLastReview(
  userId: string,
  input: { cardId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<UndoResult> {
  return runUser(userId, async (tx) => {
    // Ownership explícito (RLS é rede de segurança).
    const [card] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.ownerUserId, userId)))
      .limit(1);
    if (!card) {
      throw new Error("card não encontrado");
    }

    // Serializa contra submit/undo concorrentes do mesmo card.
    await tx
      .select({ cardId: cardProgress.cardId })
      .from(cardProgress)
      .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)))
      .for("update");

    // Último log real (não-undo) do card. Se o mais recente JÁ é 'undo', a
    // última ação foi desfeita — nada a fazer (evita "des-desfazer" acidental).
    const [latest] = await tx
      .select({ id: reviewLogs.id, origin: reviewLogs.origin })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.cardId, input.cardId)))
      .orderBy(desc(reviewLogs.id))
      .limit(1);
    if (!latest || latest.origin === "undo") {
      throw new Error("nada para desfazer");
    }

    const [target] = await tx
      .select()
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.id, latest.id)))
      .limit(1);
    if (!target) {
      throw new Error("nada para desfazer");
    }

    // Log real imediatamente anterior a este (p/ restaurar last_reviewed_at).
    const [previous] = await tx
      .select({ reviewedAt: reviewLogs.reviewedAt })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          eq(reviewLogs.cardId, input.cardId),
          lt(reviewLogs.id, target.id),
          ne(reviewLogs.origin, "undo"),
        ),
      )
      .orderBy(desc(reviewLogs.id))
      .limit(1);

    const now = new Date();

    // Log compensatório: espelha o snapshot (before=estado atual, after=restaurado).
    await tx.insert(reviewLogs).values({
      userId,
      cardId: input.cardId,
      studySessionId: target.studySessionId,
      rating: null,
      stateBefore: target.stateAfter,
      stateAfter: target.stateBefore,
      dueBefore: target.dueAfter,
      dueAfter: target.dueBefore,
      stabilityBefore: target.stabilityAfter,
      stabilityAfter: target.stabilityBefore,
      difficultyBefore: target.difficultyAfter,
      difficultyAfter: target.difficultyBefore,
      learningStepBefore: target.learningStepAfter,
      learningStepAfter: target.learningStepBefore,
      repsBefore: target.repsBefore,
      lapsesBefore: target.lapsesBefore,
      scheduledDaysBefore: target.scheduledDaysAfter,
      scheduledDaysAfter: target.scheduledDaysBefore,
      fsrsVersion: target.fsrsVersion,
      parametersVersion: target.parametersVersion,
      idempotencyKey: crypto.randomUUID(),
      origin: "undo",
      revertedLogId: target.id,
    });

    // Se o log desfeito foi a PRIMEIRA revisão do card (sem log anterior e
    // reps_before=0 vindo de new), o card volta a nunca-revisado → remove o
    // progresso. Caso contrário, restaura o snapshot completo.
    const wasFirstReview = !previous && target.stateBefore === "new" && target.repsBefore === 0;
    if (wasFirstReview) {
      await tx
        .delete(cardProgress)
        .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)));
    } else {
      await tx
        .update(cardProgress)
        .set({
          state: target.stateBefore,
          dueAt: target.dueBefore,
          stability: target.stabilityBefore,
          difficulty: target.difficultyBefore,
          scheduledDays: target.scheduledDaysBefore,
          reps: target.repsBefore,
          lapses: target.lapsesBefore,
          learningStep: target.learningStepBefore,
          lastReviewedAt: previous?.reviewedAt ?? null,
          updatedAt: now,
        })
        .where(and(eq(cardProgress.userId, userId), eq(cardProgress.cardId, input.cardId)));
    }

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "review.undo",
      entityType: "card",
      entityId: input.cardId,
      metadata: { revertedLogId: target.id, restoredState: target.stateBefore },
    });

    return { cardId: input.cardId, state: target.stateBefore };
  });
}
