import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, cards, decks, deckSettings, deckStatus, notes } from "@/db/schema";

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type DeckStatus = (typeof deckStatus.enumValues)[number];

const DECK_STATUSES: readonly string[] = deckStatus.enumValues;

export interface DeckListItem {
  id: string;
  name: string;
  description: string | null;
  status: DeckStatus;
  position: number;
  noteCount: number;
  cardCount: number;
  updatedAt: Date;
}

export interface DeckWithSettings {
  id: string;
  name: string;
  description: string | null;
  status: DeckStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    desiredRetentionOverride: number | null;
    newPerDayOverride: number | null;
    maxReviewsPerDayOverride: number | null;
    suggestionsEnabled: boolean;
    weeklyNewCardsGoal: number | null;
    examDate: string | null;
  };
}

export interface DeckSettingsInput {
  deckId: string;
  desiredRetentionOverride?: number | null;
  newPerDayOverride?: number | null;
  maxReviewsPerDayOverride?: number | null;
  suggestionsEnabled?: boolean;
  weeklyNewCardsGoal?: number | null;
  examDate?: string | null;
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("informe o nome do baralho");
  }
  if (trimmed.length > 120) {
    throw new Error("o nome do baralho deve ter no máximo 120 caracteres");
  }
  return trimmed;
}

function validateDescription(description: string | null): string | null {
  if (description == null) return null;
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 2000) {
    throw new Error("a descrição deve ter no máximo 2000 caracteres");
  }
  return trimmed;
}

function validateNullableInt(value: number | null | undefined, label: string): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} deve ser um número inteiro maior ou igual a zero`);
  }
}

/**
 * Autorização na camada de serviço (arquitetura §6.3): ownership explícito do
 * deckId recebido, além da RLS. Deck deletado (soft) conta como inexistente.
 */
async function requireOwnedDeck(
  tx: Tx,
  userId: string,
  deckId: string,
): Promise<{ id: string; status: DeckStatus; position: number }> {
  const [deck] = await tx
    .select({ id: decks.id, status: decks.status, position: decks.position })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerUserId, userId), isNull(decks.deletedAt)))
    .limit(1);
  if (!deck) {
    throw new Error("baralho não encontrado");
  }
  return deck;
}

export async function createDeck(
  userId: string,
  input: { name: string; description?: string | null },
  runUser: UserRunner = withUserTransaction,
): Promise<{ deckId: string }> {
  const name = validateName(input.name);
  const description = validateDescription(input.description ?? null);

  return runUser(userId, async (tx) => {
    // max sobre TODOS os decks do usuário (inclusive soft-deleted) — evita
    // colisão de position ao restaurar/reordenar no futuro.
    const [row] = await tx
      .select({ max: sql<number | null>`max(${decks.position})` })
      .from(decks)
      .where(eq(decks.ownerUserId, userId));
    const position = (row?.max ?? 0) + 1;

    const [deck] = await tx
      .insert(decks)
      .values({ ownerUserId: userId, name, description, position })
      .returning({ id: decks.id });
    if (!deck) throw new Error("falha ao criar o baralho");

    // deck_settings 1:1 na MESMA tx (defaults do schema: suggestions_enabled
    // true, overrides null).
    await tx.insert(deckSettings).values({ deckId: deck.id, ownerUserId: userId });

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "deck.create",
      entityType: "deck",
      entityId: deck.id,
      metadata: { name },
    });

    return { deckId: deck.id };
  });
}

export async function updateDeck(
  userId: string,
  input: {
    deckId: string;
    name?: string;
    description?: string | null;
    status?: DeckStatus;
  },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  const patch: Partial<{
    name: string;
    description: string | null;
    status: DeckStatus;
  }> = {};
  if (input.name !== undefined) {
    patch.name = validateName(input.name);
  }
  if (input.description !== undefined) {
    patch.description = validateDescription(input.description);
  }
  if (input.status !== undefined) {
    if (!DECK_STATUSES.includes(input.status)) {
      throw new Error("status inválido");
    }
    patch.status = input.status;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("nada para atualizar");
  }

  await runUser(userId, async (tx) => {
    await requireOwnedDeck(tx, userId, input.deckId);
    await tx.update(decks).set(patch).where(eq(decks.id, input.deckId));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "deck.update",
      entityType: "deck",
      entityId: input.deckId,
      metadata: patch,
    });
  });
}

export async function updateDeckSettings(
  userId: string,
  input: DeckSettingsInput,
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  if (input.desiredRetentionOverride != null) {
    const r = input.desiredRetentionOverride;
    if (Number.isNaN(r) || r < 0.7 || r > 0.98) {
      throw new Error("a retenção desejada deve estar entre 0,70 e 0,98");
    }
  }
  validateNullableInt(input.newPerDayOverride, "o limite de cards novos por dia");
  validateNullableInt(input.maxReviewsPerDayOverride, "o limite de revisões por dia");
  validateNullableInt(input.weeklyNewCardsGoal, "a meta semanal de cards novos");
  if (input.examDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.examDate)) {
    throw new Error("data de prova inválida");
  }

  const patch: Partial<{
    desiredRetentionOverride: number | null;
    newPerDayOverride: number | null;
    maxReviewsPerDayOverride: number | null;
    suggestionsEnabled: boolean;
    weeklyNewCardsGoal: number | null;
    examDate: string | null;
  }> = {};
  if (input.desiredRetentionOverride !== undefined) {
    patch.desiredRetentionOverride = input.desiredRetentionOverride;
  }
  if (input.newPerDayOverride !== undefined) patch.newPerDayOverride = input.newPerDayOverride;
  if (input.maxReviewsPerDayOverride !== undefined) {
    patch.maxReviewsPerDayOverride = input.maxReviewsPerDayOverride;
  }
  if (input.suggestionsEnabled !== undefined) patch.suggestionsEnabled = input.suggestionsEnabled;
  if (input.weeklyNewCardsGoal !== undefined) patch.weeklyNewCardsGoal = input.weeklyNewCardsGoal;
  if (input.examDate !== undefined) patch.examDate = input.examDate;
  if (Object.keys(patch).length === 0) {
    throw new Error("nada para atualizar");
  }

  await runUser(userId, async (tx) => {
    await requireOwnedDeck(tx, userId, input.deckId);
    await tx.update(deckSettings).set(patch).where(eq(deckSettings.deckId, input.deckId));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "deck.update",
      entityType: "deck",
      entityId: input.deckId,
      metadata: { settings: patch },
    });
  });
}

export async function deleteDeck(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  await runUser(userId, async (tx) => {
    await requireOwnedDeck(tx, userId, input.deckId);
    // Soft delete: notas/cards ficam no banco; os joins de listagem/estudo
    // filtram por deleted_at is null.
    await tx.update(decks).set({ deletedAt: new Date() }).where(eq(decks.id, input.deckId));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "deck.delete",
      entityType: "deck",
      entityId: input.deckId,
    });
  });
}

export async function listDecks(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<DeckListItem[]> {
  return runUser(userId, (tx) =>
    tx
      .select({
        id: decks.id,
        name: decks.name,
        description: decks.description,
        status: decks.status,
        position: decks.position,
        noteCount: sql<number>`count(distinct ${notes.id}) filter (where ${notes.deletedAt} is null)`.mapWith(Number),
        cardCount: sql<number>`count(distinct ${cards.id}) filter (where ${notes.deletedAt} is null and ${cards.status} = 'active')`.mapWith(Number),
        updatedAt: decks.updatedAt,
      })
      .from(decks)
      .leftJoin(notes, eq(notes.deckId, decks.id))
      .leftJoin(cards, eq(cards.noteId, notes.id))
      .where(and(eq(decks.ownerUserId, userId), isNull(decks.deletedAt)))
      .groupBy(decks.id)
      .orderBy(asc(decks.position), asc(decks.createdAt)),
  );
}

export async function getDeck(
  userId: string,
  input: { deckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<DeckWithSettings> {
  return runUser(userId, async (tx) => {
    const [row] = await tx
      .select({
        id: decks.id,
        name: decks.name,
        description: decks.description,
        status: decks.status,
        position: decks.position,
        createdAt: decks.createdAt,
        updatedAt: decks.updatedAt,
        desiredRetentionOverride: deckSettings.desiredRetentionOverride,
        newPerDayOverride: deckSettings.newPerDayOverride,
        maxReviewsPerDayOverride: deckSettings.maxReviewsPerDayOverride,
        suggestionsEnabled: deckSettings.suggestionsEnabled,
        weeklyNewCardsGoal: deckSettings.weeklyNewCardsGoal,
        examDate: deckSettings.examDate,
      })
      .from(decks)
      .innerJoin(deckSettings, eq(deckSettings.deckId, decks.id))
      .where(
        and(eq(decks.id, input.deckId), eq(decks.ownerUserId, userId), isNull(decks.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw new Error("baralho não encontrado");
    }
    const {
      desiredRetentionOverride,
      newPerDayOverride,
      maxReviewsPerDayOverride,
      suggestionsEnabled,
      weeklyNewCardsGoal,
      examDate,
      ...deck
    } = row;
    return {
      ...deck,
      settings: {
        desiredRetentionOverride,
        newPerDayOverride,
        maxReviewsPerDayOverride,
        suggestionsEnabled,
        weeklyNewCardsGoal,
        examDate,
      },
    };
  });
}

export async function reorderDeck(
  userId: string,
  input: { deckId: string; direction: "up" | "down" },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  await runUser(userId, async (tx) => {
    const deck = await requireOwnedDeck(tx, userId, input.deckId);

    const neighborWhere = and(
      eq(decks.ownerUserId, userId),
      isNull(decks.deletedAt),
      input.direction === "up"
        ? lt(decks.position, deck.position)
        : gt(decks.position, deck.position),
    );
    const [neighbor] = await tx
      .select({ id: decks.id, position: decks.position })
      .from(decks)
      .where(neighborWhere)
      .orderBy(input.direction === "up" ? desc(decks.position) : asc(decks.position))
      .limit(1);
    if (!neighbor) return; // já está na ponta — no-op

    // Troca de positions com o vizinho na MESMA tx.
    await tx.update(decks).set({ position: neighbor.position }).where(eq(decks.id, deck.id));
    await tx.update(decks).set({ position: deck.position }).where(eq(decks.id, neighbor.id));

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "deck.update",
      entityType: "deck",
      entityId: deck.id,
      metadata: { reorder: input.direction, swappedWith: neighbor.id },
    });
  });
}
