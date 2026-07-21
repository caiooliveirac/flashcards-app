import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cards, decks, mediaAssets, notes, reviewLogs, tags } from "@/db/schema";
import { createTestDatabase, expectDbError, type TestDatabase } from "./helpers/testdb";

/**
 * Aceite F1#2: usuário A nunca lê/edita/insere/apaga dados privados de B.
 * Testa DIRETO no role runtime (abaixo da aplicação) — se isso passar,
 * nenhum bug de aplicação expõe dados de outro usuário.
 */
describe("RLS: isolamento entre usuários", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;
  let deckA: string;
  let deckB: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    userA = await db.createUser("alice@test.dev");
    userB = await db.createUser("bob@test.dev");

    deckA = await db.clients.withUserTransaction(userA, async (tx) => {
      const [d] = await tx
        .insert(decks)
        .values({ ownerUserId: userA, name: "Deck A" })
        .returning({ id: decks.id });
      return d!.id;
    });
    deckB = await db.clients.withUserTransaction(userB, async (tx) => {
      const [d] = await tx
        .insert(decks)
        .values({ ownerUserId: userB, name: "Deck B" })
        .returning({ id: decks.id });
      return d!.id;
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("A não lê decks de B (SELECT filtrado pela policy)", async () => {
    const visible = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select({ id: decks.id }).from(decks),
    );
    expect(visible.map((d) => d.id)).toEqual([deckA]);
  });

  it("A não atualiza deck de B (0 linhas afetadas)", async () => {
    const updated = await db.clients.withUserTransaction(userA, (tx) =>
      tx
        .update(decks)
        .set({ name: "hackeado" })
        .where(eq(decks.id, deckB))
        .returning({ id: decks.id }),
    );
    expect(updated).toHaveLength(0);

    const intact = await db.clients.withUserTransaction(userB, (tx) =>
      tx.select({ name: decks.name }).from(decks).where(eq(decks.id, deckB)),
    );
    expect(intact[0]?.name).toBe("Deck B");
  });

  it("A não apaga deck de B", async () => {
    const deleted = await db.clients.withUserTransaction(userA, (tx) =>
      tx.delete(decks).where(eq(decks.id, deckB)).returning({ id: decks.id }),
    );
    expect(deleted).toHaveLength(0);
  });

  it("A não insere linha com owner B (WITH CHECK)", async () => {
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) =>
        tx.insert(decks).values({ ownerUserId: userB, name: "forjado" }),
      ),
      /row-level security/i,
    );
  });

  it("A não injeta deck_id de B ao criar nota (WITH CHECK na nota + owner)", async () => {
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) =>
        tx.insert(notes).values({
          ownerUserId: userB,
          deckId: deckB,
          noteType: "basic",
          contentJson: { v: 1 },
        }),
      ),
      /row-level security/i,
    );
  });

  it("A não lê notas/cards/mídia/tags/review_logs de B", async () => {
    await db.clients.withUserTransaction(userB, async (tx) => {
      const [note] = await tx
        .insert(notes)
        .values({ ownerUserId: userB, deckId: deckB, noteType: "basic", contentJson: { v: 1 } })
        .returning({ id: notes.id });
      const [card] = await tx
        .insert(cards)
        .values({ noteId: note!.id, ownerUserId: userB, variant: 0, contentFingerprint: "fp" })
        .returning({ id: cards.id });
      await tx.insert(mediaAssets).values({ ownerUserId: userB, storageKey: "b/key1" });
      await tx.insert(tags).values({ ownerUserId: userB, name: "cardio" });
      await tx.insert(reviewLogs).values({
        userId: userB,
        cardId: card!.id,
        rating: 3,
        stateBefore: "new",
        stateAfter: "learning",
        stabilityBefore: 0,
        stabilityAfter: 1,
        difficultyBefore: 0,
        difficultyAfter: 5,
        learningStepBefore: 0,
        learningStepAfter: 1,
        repsBefore: 0,
        lapsesBefore: 0,
        fsrsVersion: "test",
        parametersVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      });
    });

    const visibleToA = await db.clients.withUserTransaction(userA, async (tx) => ({
      notes: await tx.select({ id: notes.id }).from(notes),
      cards: await tx.select({ id: cards.id }).from(cards),
      media: await tx.select({ id: mediaAssets.id }).from(mediaAssets),
      tags: await tx.select({ id: tags.id }).from(tags),
      logs: await tx.select({ id: reviewLogs.id }).from(reviewLogs),
    }));
    expect(visibleToA.notes).toHaveLength(0);
    expect(visibleToA.cards).toHaveLength(0);
    expect(visibleToA.media).toHaveLength(0);
    expect(visibleToA.tags).toHaveLength(0);
    expect(visibleToA.logs).toHaveLength(0);
  });

  it("sem GUC de usuário: default-deny (zero linhas, sem erro)", async () => {
    const rows = await db.clients.dbApp.select({ id: decks.id }).from(decks);
    expect(rows).toHaveLength(0);
  });
});
