"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { buryCard, suspendCard } from "./manage";
import { submitReview } from "./service";
import { getNextDueAt } from "./summary-queries";
import { undoLastReview } from "./undo";

const submitSchema = z.object({
  cardId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  idempotencyKey: z.uuid(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  clientTimezone: z.string().max(64).optional(),
  studySessionId: z.uuid().optional(),
});

export type SubmitReviewActionResult =
  | { ok: true; duplicate: boolean; state: string; dueAt: string }
  | { ok: false; error: string };

export async function submitReviewAction(input: unknown): Promise<SubmitReviewActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "sessão expirada — recarregue a página" };
  }
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "avaliação inválida" };
  }
  try {
    const result = await submitReview(session.user.id, parsed.data);
    return {
      ok: true,
      duplicate: result.duplicate,
      state: result.state,
      dueAt: result.dueAt.toISOString(),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "erro ao salvar revisão" };
  }
}

const undoSchema = z.object({ cardId: z.uuid() });

export type UndoReviewActionResult =
  | { ok: true; cardId: string; state: string }
  | { ok: false; error: string };

/** Desfaz a última avaliação de um card (evento compensatório, §7.2). */
export async function undoReviewAction(input: unknown): Promise<UndoReviewActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "sessão expirada — recarregue a página" };
  }
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "requisição inválida" };
  }
  try {
    const result = await undoLastReview(session.user.id, parsed.data);
    return { ok: true, cardId: result.cardId, state: result.state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "erro ao desfazer" };
  }
}

const manageSchema = z.object({
  cardId: z.uuid(),
  includeSiblings: z.boolean().optional(),
});

export type ManageCardActionResult = { ok: true } | { ok: false; error: string };

/** Suspende um card (sai da fila até reativar). */
export async function suspendCardAction(input: unknown): Promise<ManageCardActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sessão expirada — recarregue a página" };
  const parsed = manageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "requisição inválida" };
  try {
    await suspendCard(session.user.id, { cardId: parsed.data.cardId });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "erro ao suspender" };
  }
}

/** Enterra um card (e opcionalmente os irmãos) até o próximo dia de estudo. */
export async function buryCardAction(input: unknown): Promise<ManageCardActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "sessão expirada — recarregue a página" };
  const parsed = manageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "requisição inválida" };
  try {
    await buryCard(session.user.id, {
      cardId: parsed.data.cardId,
      includeSiblings: parsed.data.includeSiblings,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "erro ao enterrar" };
  }
}

const nextReviewSchema = z.object({ deckId: z.uuid() });

export type NextReviewActionResult =
  | { ok: true; nextDueAt: string | null }
  | { ok: false };

/** Próxima revisão do deck (min due_at futuro) para o resumo da sessão. */
export async function nextReviewAtAction(input: unknown): Promise<NextReviewActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false };
  }
  const parsed = nextReviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    const nextDueAt = await getNextDueAt(session.user.id, parsed.data);
    return { ok: true, nextDueAt: nextDueAt ? nextDueAt.toISOString() : null };
  } catch {
    return { ok: false };
  }
}
