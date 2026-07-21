import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, cards, decks, deckSettings, notes } from "@/db/schema";
import {
  createDeck,
  deleteDeck,
  getDeck,
  listDecks,
  reorderDeck,
  updateDeck,
  updateDeckSettings,
  type DeckStatus,
} from "@/features/decks/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

describe("decks service (CRUD + RLS + audit)", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;
  // Injeta o runner do banco descartável no lugar do singleton de runtime.
  let run: TestDatabase["clients"]["withUserTransaction"];

  beforeAll(async () => {
    db = await createTestDatabase();
    userA = await db.createUser("alice@decks.dev");
    userB = await db.createUser("bob@decks.dev");
    run = db.clients.withUserTransaction;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("createDeck incrementa position e cria deck_settings 1:1 na mesma tx", async () => {
    const { deckId: first } = await createDeck(userA, { name: "  Cardiologia  " }, run);
    const { deckId: second } = await createDeck(
      userA,
      { name: "Pneumo", description: "Deck de pneumologia" },
      run,
    );

    const rows = await run(userA, (tx) =>
      tx
        .select({ id: decks.id, name: decks.name, position: decks.position })
        .from(decks)
        .orderBy(asc(decks.position)),
    );
    expect(rows.map((r) => r.id)).toEqual([first, second]);
    expect(rows[0]?.name).toBe("Cardiologia"); // trim aplicado
    expect(rows.map((r) => r.position)).toEqual([1, 2]);

    const settings = await run(userA, (tx) =>
      tx.select().from(deckSettings).where(eq(deckSettings.deckId, first)),
    );
    expect(settings).toHaveLength(1);
    expect(settings[0]?.suggestionsEnabled).toBe(true);
    expect(settings[0]?.desiredRetentionOverride).toBeNull();
  });

  it("createDeck valida nome e descrição com mensagens pt-BR", async () => {
    await expect(createDeck(userA, { name: "   " }, run)).rejects.toThrow(
      "informe o nome do baralho",
    );
    await expect(createDeck(userA, { name: "x".repeat(121) }, run)).rejects.toThrow(
      "no máximo 120",
    );
    await expect(
      createDeck(userA, { name: "ok", description: "y".repeat(2001) }, run),
    ).rejects.toThrow("no máximo 2000");
  });

  it("listDecks conta notas não deletadas e cards ativos em uma query", async () => {
    const { deckId } = await createDeck(userA, { name: "Contagem" }, run);

    await run(userA, async (tx) => {
      const [aliveNote] = await tx
        .insert(notes)
        .values({
          ownerUserId: userA,
          deckId,
          noteType: "basic",
          contentJson: { v: 1 },
        })
        .returning({ id: notes.id });
      const [deadNote] = await tx
        .insert(notes)
        .values({
          ownerUserId: userA,
          deckId,
          noteType: "basic",
          contentJson: { v: 1 },
          deletedAt: new Date(),
        })
        .returning({ id: notes.id });

      await tx.insert(cards).values([
        {
          noteId: aliveNote!.id,
          ownerUserId: userA,
          variant: 1,
          status: "active",
          contentFingerprint: "fp1",
        },
        {
          noteId: aliveNote!.id,
          ownerUserId: userA,
          variant: 2,
          status: "removed",
          contentFingerprint: "fp2",
        },
        // Card ativo de nota deletada não conta.
        {
          noteId: deadNote!.id,
          ownerUserId: userA,
          variant: 1,
          status: "active",
          contentFingerprint: "fp3",
        },
      ]);
    });

    const list = await listDecks(userA, run);
    const counted = list.find((d) => d.id === deckId);
    expect(counted?.noteCount).toBe(1);
    expect(counted?.cardCount).toBe(1);
  });

  it("updateDeck altera nome/descrição/status e rejeita status inválido", async () => {
    const { deckId } = await createDeck(userA, { name: "Renomear" }, run);
    await updateDeck(
      userA,
      { deckId, name: "Renomeado", description: "nova descrição", status: "paused" },
      run,
    );

    const deck = await getDeck(userA, { deckId }, run);
    expect(deck.name).toBe("Renomeado");
    expect(deck.description).toBe("nova descrição");
    expect(deck.status).toBe("paused");

    await expect(
      updateDeck(userA, { deckId, status: "turbo" as DeckStatus }, run),
    ).rejects.toThrow("status inválido");
  });

  it("updateDeckSettings valida ranges e persiste overrides", async () => {
    const { deckId } = await createDeck(userA, { name: "Settings" }, run);

    await expect(
      updateDeckSettings(userA, { deckId, desiredRetentionOverride: 0.5 }, run),
    ).rejects.toThrow("entre 0,70 e 0,98");
    await expect(
      updateDeckSettings(userA, { deckId, newPerDayOverride: -1 }, run),
    ).rejects.toThrow("maior ou igual a zero");
    await expect(
      updateDeckSettings(userA, { deckId, maxReviewsPerDayOverride: 2.5 }, run),
    ).rejects.toThrow("inteiro");

    await updateDeckSettings(
      userA,
      {
        deckId,
        desiredRetentionOverride: 0.85,
        newPerDayOverride: 10,
        suggestionsEnabled: false,
        weeklyNewCardsGoal: 30,
        examDate: "2026-12-01",
      },
      run,
    );
    const deck = await getDeck(userA, { deckId }, run);
    expect(deck.settings.desiredRetentionOverride).toBeCloseTo(0.85);
    expect(deck.settings.newPerDayOverride).toBe(10);
    expect(deck.settings.suggestionsEnabled).toBe(false);
    expect(deck.settings.weeklyNewCardsGoal).toBe(30);
    expect(deck.settings.examDate).toBe("2026-12-01");
  });

  it("deleteDeck é soft: some da listagem, linha permanece com deleted_at", async () => {
    const { deckId } = await createDeck(userA, { name: "Efêmero" }, run);
    await deleteDeck(userA, { deckId }, run);

    const list = await listDecks(userA, run);
    expect(list.map((d) => d.id)).not.toContain(deckId);
    await expect(getDeck(userA, { deckId }, run)).rejects.toThrow("baralho não encontrado");

    const [raw] = await db.ownerQuery<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM decks WHERE id = $1",
      [deckId],
    );
    expect(raw?.deleted_at).not.toBeNull();
  });

  it("reorderDeck troca positions com o vizinho; ponta é no-op", async () => {
    const before = await listDecks(userA, run);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const [top, second] = before;

    await reorderDeck(userA, { deckId: second!.id, direction: "up" }, run);
    let after = await listDecks(userA, run);
    expect(after[0]?.id).toBe(second!.id);
    expect(after[0]?.position).toBe(top!.position);
    expect(after[1]?.id).toBe(top!.id);
    expect(after[1]?.position).toBe(second!.position);

    // Topo subindo de novo: no-op (sem erro, ordem intacta).
    await reorderDeck(userA, { deckId: second!.id, direction: "up" }, run);
    after = await listDecks(userA, run);
    expect(after[0]?.id).toBe(second!.id);
  });

  it("autorização/RLS: B não lê, edita, reordena nem deleta deck de A", async () => {
    const { deckId } = await createDeck(userA, { name: "Privado de A" }, run);

    const listB = await listDecks(userB, run);
    expect(listB.map((d) => d.id)).not.toContain(deckId);

    await expect(getDeck(userB, { deckId }, run)).rejects.toThrow("baralho não encontrado");
    await expect(updateDeck(userB, { deckId, name: "hackeado" }, run)).rejects.toThrow(
      "baralho não encontrado",
    );
    await expect(
      updateDeckSettings(userB, { deckId, suggestionsEnabled: false }, run),
    ).rejects.toThrow("baralho não encontrado");
    await expect(reorderDeck(userB, { deckId, direction: "up" }, run)).rejects.toThrow(
      "baralho não encontrado",
    );
    await expect(deleteDeck(userB, { deckId }, run)).rejects.toThrow("baralho não encontrado");

    const intact = await getDeck(userA, { deckId }, run);
    expect(intact.name).toBe("Privado de A");
  });

  it("audit_logs registra create/update/delete com o actor", async () => {
    const { deckId } = await createDeck(userA, { name: "Auditado" }, run);
    await updateDeck(userA, { deckId, status: "completed" }, run);
    await deleteDeck(userA, { deckId }, run);

    const logs = await run(userA, (tx) =>
      tx
        .select({ action: auditLogs.action, actor: auditLogs.actorUserId })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, deckId))
        .orderBy(asc(auditLogs.id)),
    );
    expect(logs.map((l) => l.action)).toEqual(["deck.create", "deck.update", "deck.delete"]);
    expect(logs.every((l) => l.actor === userA)).toBe(true);
  });
});
