import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  cardProgress,
  cards,
  decks,
  mediaAssets,
  mediaReferences,
  notes,
  noteTags,
  reviewLogs,
} from "@/db/schema";
import {
  createNote,
  deleteNote,
  duplicateNote,
  listNotes,
  moveNote,
  restoreNote,
  updateNote,
} from "@/features/notes/service";
import { deriveCards, parseNoteContent } from "@/lib/content";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * Aceites F2#2 (persistência + preservação de progresso na reedição) e
 * F2#5 (vazamento de media_asset) via serviço de notas.
 */

// --- builders de NoteContentV1 ---

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = (assetId: string, alt?: string) => ({
  type: "image",
  assetId,
  ...(alt === undefined ? {} : { alt }),
});

function basic(front: unknown[], back: unknown[]): unknown {
  return { schemaVersion: 1, kind: "basic", front, back };
}

function basicText(front: string, back: string): unknown {
  return basic([para(front)], [para(back)]);
}

type ClozePart = string | { g: string; text: string };

function cloze(parts: ClozePart[]): unknown {
  return {
    schemaVersion: 1,
    kind: "cloze",
    text: [
      {
        type: "paragraph",
        content: parts.map((p) =>
          typeof p === "string"
            ? { type: "text", text: p }
            : { type: "cloze", groupKey: p.g, content: [{ type: "text", text: p.text }] },
        ),
      },
    ],
  };
}

describe("notes service (criação, reedição com preservação de progresso, mídia, RLS)", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;
  let deckA: string;
  let deckA2: string;
  let deckB: string;
  let run: TestDatabase["clients"]["withUserTransaction"];

  async function createDeckFor(ownerId: string, name: string): Promise<string> {
    return run(ownerId, async (tx) => {
      const [d] = await tx
        .insert(decks)
        .values({ ownerUserId: ownerId, name })
        .returning({ id: decks.id });
      return d!.id;
    });
  }

  async function createAsset(
    ownerId: string,
    status: "pending" | "ready" | "failed" = "ready",
  ): Promise<string> {
    const id = randomUUID();
    await run(ownerId, (tx) =>
      tx.insert(mediaAssets).values({
        id,
        ownerUserId: ownerId,
        storageKey: `test/${id}`,
        mimeType: "image/png",
        status,
      }),
    );
    return id;
  }

  const cardsOf = (ownerId: string, noteId: string) =>
    run(ownerId, (tx) =>
      tx
        .select({
          id: cards.id,
          variant: cards.variant,
          clozeGroupKey: cards.clozeGroupKey,
          status: cards.status,
          contentFingerprint: cards.contentFingerprint,
        })
        .from(cards)
        .where(eq(cards.noteId, noteId))
        .orderBy(asc(cards.variant)),
    );

  const refsOf = (ownerId: string, noteId: string) =>
    run(ownerId, (tx) =>
      tx
        .select({
          mediaAssetId: mediaReferences.mediaAssetId,
          slot: mediaReferences.slot,
          altText: mediaReferences.altText,
        })
        .from(mediaReferences)
        .where(eq(mediaReferences.noteId, noteId))
        .orderBy(asc(mediaReferences.slot)),
    );

  const progressOf = (ownerId: string, cardId: string) =>
    run(ownerId, (tx) =>
      tx
        .select({
          state: cardProgress.state,
          reps: cardProgress.reps,
          lapses: cardProgress.lapses,
          stability: cardProgress.stability,
        })
        .from(cardProgress)
        .where(eq(cardProgress.cardId, cardId)),
    );

  async function insertProgress(ownerId: string, cardId: string): Promise<void> {
    await run(ownerId, (tx) =>
      tx.insert(cardProgress).values({
        userId: ownerId,
        cardId,
        state: "review",
        reps: 3,
        lapses: 1,
        stability: 12.5,
        difficulty: 4.3,
        dueAt: new Date("2026-08-01T00:00:00Z"),
        lastReviewedAt: new Date("2026-07-01T00:00:00Z"),
      }),
    );
  }

  async function insertReviewLog(ownerId: string, cardId: string): Promise<void> {
    await run(ownerId, (tx) =>
      tx.insert(reviewLogs).values({
        userId: ownerId,
        cardId,
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
        idempotencyKey: randomUUID(),
      }),
    );
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    run = db.clients.withUserTransaction;
    userA = await db.createUser("alice@notes.dev");
    userB = await db.createUser("bob@notes.dev");
    deckA = await createDeckFor(userA, "Deck A");
    deckA2 = await createDeckFor(userA, "Deck A2");
    deckB = await createDeckFor(userB, "Deck B");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("basic gera 1 card variant 1 com fingerprint estável (igual ao derivado da lib)", async () => {
    const content = basicText("Qual o maior osso do corpo humano?", "Fêmur");
    const res = await createNote(userA, { deckId: deckA, noteType: "basic", content }, run);
    expect(res.cardCount).toBe(1);
    expect(res.cardIds).toHaveLength(1);

    const rows = await cardsOf(userA, res.noteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.cardIds[0],
      variant: 1,
      clozeGroupKey: null,
      status: "active",
    });
    const expected = deriveCards(parseNoteContent(content))[0]!.fingerprint;
    expect(rows[0]!.contentFingerprint).toBe(expected);

    // Estabilidade: mesmo conteúdo em outra nota => mesmo fingerprint.
    const res2 = await createNote(userA, { deckId: deckA, noteType: "basic", content }, run);
    const rows2 = await cardsOf(userA, res2.noteId);
    expect(rows2[0]!.contentFingerprint).toBe(expected);
  });

  it("cloze com 2 grupos gera 2 cards na ordem de primeira aparição (F2#2)", async () => {
    const content = cloze([
      "A capital da ",
      { g: "g1", text: "França" },
      " é ",
      { g: "g2", text: "Paris" },
    ]);
    const res = await createNote(userA, { deckId: deckA, noteType: "cloze", content }, run);
    expect(res.cardCount).toBe(2);

    const rows = await cardsOf(userA, res.noteId);
    expect(rows.map((c) => c.variant)).toEqual([1, 2]);
    expect(rows.map((c) => c.clozeGroupKey)).toEqual(["g1", "g2"]);
    expect(rows.map((c) => c.status)).toEqual(["active", "active"]);
    expect(rows[0]!.contentFingerprint).not.toBe(rows[1]!.contentFingerprint);
  });

  it("noteType divergente do kind do conteúdo é rejeitado (create e update)", async () => {
    await expect(
      createNote(
        userA,
        { deckId: deckA, noteType: "cloze", content: basicText("a", "b") },
        run,
      ),
    ).rejects.toThrow("não corresponde");

    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basicText("pergunta", "resposta") },
      run,
    );
    await expect(
      updateNote(
        userA,
        { noteId: res.noteId, content: cloze(["x ", { g: "g1", text: "y" }]) },
        run,
      ),
    ).rejects.toThrow("não corresponde");
  });

  it("editar mantendo o groupKey preserva o card e o progresso; fingerprint atualiza", async () => {
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "cloze",
        content: cloze([
          "A organela ",
          { g: "g1", text: "mitocôndria" },
          " produz ",
          { g: "g2", text: "ATP" },
        ]),
      },
      run,
    );
    const before = await cardsOf(userA, res.noteId);
    const g1Card = before.find((c) => c.clozeGroupKey === "g1")!;
    await insertProgress(userA, g1Card.id);

    // Edita o TEXTO do g1 mantendo a key.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze([
          "A organela ",
          { g: "g1", text: "mitocôndria (usina da célula)" },
          " produz ",
          { g: "g2", text: "ATP" },
        ]),
      },
      run,
    );

    const after = await cardsOf(userA, res.noteId);
    const g1After = after.find((c) => c.clozeGroupKey === "g1")!;
    expect(g1After.id).toBe(g1Card.id); // MESMO card
    expect(g1After.status).toBe("active");
    expect(g1After.contentFingerprint).not.toBe(g1Card.contentFingerprint); // fingerprint novo

    const progress = await progressOf(userA, g1Card.id);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ state: "review", reps: 3, lapses: 1, stability: 12.5 });
  });

  it("apagar-e-recriar ocultação idêntica com key NOVA preserva o card via fingerprint (F2#2)", async () => {
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "cloze",
        content: cloze([
          "A insulina é produzida no ",
          { g: "g1", text: "pâncreas" },
          " pela porção ",
          { g: "g2", text: "endócrina" },
        ]),
      },
      run,
    );
    const before = await cardsOf(userA, res.noteId);
    const g1Card = before.find((c) => c.clozeGroupKey === "g1")!;
    await insertProgress(userA, g1Card.id);

    // Mesmo conteúdo, key nova (g9): o editor recriou o node — resgate por fingerprint.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze([
          "A insulina é produzida no ",
          { g: "g9", text: "pâncreas" },
          " pela porção ",
          { g: "g2", text: "endócrina" },
        ]),
      },
      run,
    );

    const after = await cardsOf(userA, res.noteId);
    expect(after).toHaveLength(2); // nenhum card novo criado
    const transferred = after.find((c) => c.clozeGroupKey === "g9")!;
    expect(transferred.id).toBe(g1Card.id); // MESMO card, key transferida
    expect(transferred.status).toBe("active");
    expect(transferred.contentFingerprint).toBe(g1Card.contentFingerprint);

    const progress = await progressOf(userA, g1Card.id);
    expect(progress).toHaveLength(1);
    expect(progress[0]!.reps).toBe(3);
  });

  it("grupo removido vira 'removed' (progresso/logs intactos); re-adicionar reativa o MESMO card", async () => {
    const original = cloze([
      "O nervo ",
      { g: "g1", text: "vago" },
      " inerva o ",
      { g: "g2", text: "coração" },
    ]);
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "cloze", content: original },
      run,
    );
    const before = await cardsOf(userA, res.noteId);
    const g2Card = before.find((c) => c.clozeGroupKey === "g2")!;
    await insertProgress(userA, g2Card.id);
    await insertReviewLog(userA, g2Card.id);

    // Remove o grupo g2 (texto vira plano).
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze(["O nervo ", { g: "g1", text: "vago" }, " inerva o coração"]),
      },
      run,
    );

    const removedState = await cardsOf(userA, res.noteId);
    const g2Removed = removedState.find((c) => c.id === g2Card.id)!;
    expect(g2Removed.status).toBe("removed");
    expect(g2Removed.variant).toBe(2); // variant não muda

    const progressKept = await progressOf(userA, g2Card.id);
    expect(progressKept).toHaveLength(1);
    const logsKept = await run(userA, (tx) =>
      tx.select({ id: reviewLogs.id }).from(reviewLogs).where(eq(reviewLogs.cardId, g2Card.id)),
    );
    expect(logsKept).toHaveLength(1);

    // Re-adiciona o grupo => reactivate do MESMO card (id e variant preservados).
    await updateNote(userA, { noteId: res.noteId, content: original }, run);
    const reactivated = await cardsOf(userA, res.noteId);
    expect(reactivated).toHaveLength(2);
    const g2Back = reactivated.find((c) => c.clozeGroupKey === "g2")!;
    expect(g2Back.id).toBe(g2Card.id);
    expect(g2Back.status).toBe("active");
    expect(g2Back.variant).toBe(2);
    expect((await progressOf(userA, g2Card.id))[0]!.reps).toBe(3);
  });

  it("key reciclada pelo editor NÃO ressuscita progresso: card novo, removed intocado (#3)", async () => {
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "cloze",
        content: cloze([
          "O fêmur articula com a ",
          { g: "g1", text: "tíbia" },
          " e o ",
          { g: "g2", text: "quadril" },
        ]),
      },
      run,
    );
    const before = await cardsOf(userA, res.noteId);
    const g2Card = before.find((c) => c.clozeGroupKey === "g2")!;
    await insertProgress(userA, g2Card.id);

    // Edição 1: remove o grupo g2 e salva => card do g2 vira 'removed'.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze(["O fêmur articula com a ", { g: "g1", text: "tíbia" }, " e o quadril"]),
      },
      run,
    );

    // Edição 2: ocultação NOVA (conteúdo diferente) recebe a key g2 — payload
    // como o editor antigo geraria (menor key livre olhando SÓ o doc).
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze([
          "O fêmur articula com a ",
          { g: "g1", text: "tíbia" },
          " e o quadril; é o osso mais ",
          { g: "g2", text: "longo" },
        ]),
      },
      run,
    );

    const after = await cardsOf(userA, res.noteId);
    expect(after).toHaveLength(3); // card NOVO criado; nada foi deletado
    // O card removed fica INTOCADO (status, key e fingerprint originais).
    const oldCard = after.find((c) => c.id === g2Card.id)!;
    expect(oldCard.status).toBe("removed");
    expect(oldCard.clozeGroupKey).toBe("g2");
    expect(oldCard.contentFingerprint).toBe(g2Card.contentFingerprint);
    // O conteúdo novo com a key reciclada vira card NOVO (variant max+1).
    const newCard = after.find((c) => c.clozeGroupKey === "g2" && c.id !== g2Card.id)!;
    expect(newCard.status).toBe("active");
    expect(newCard.variant).toBe(3);
    // Progresso NÃO herdado: o card novo nasce 'new' (sem card_progress);
    // o progresso do antigo permanece no antigo.
    expect(await progressOf(userA, newCard.id)).toHaveLength(0);
    expect((await progressOf(userA, g2Card.id))[0]!.reps).toBe(3);
  });

  it("updateNote tolera asset quebrado JÁ referenciado; referência NOVA quebrada é rejeitada (#12)", async () => {
    const referenced = await createAsset(userA, "ready");
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic([para("qual a estrutura?"), image(referenced, "figura")], [para("resposta")]),
      },
      run,
    );

    // O asset quebra DEPOIS de referenciado (worker marcou 'failed').
    await run(userA, (tx) =>
      tx.update(mediaAssets).set({ status: "failed" }).where(eq(mediaAssets.id, referenced)),
    );

    // Edição de texto mantendo a imagem quebrada passa; a referência permanece.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: basic(
          [para("qual a estrutura anatômica?"), image(referenced, "figura")],
          [para("resposta")],
        ),
      },
      run,
    );
    expect(await refsOf(userA, res.noteId)).toEqual([
      { mediaAssetId: referenced, slot: "front:0", altText: "figura" },
    ]);

    // Referência NOVA a outro asset 'failed' continua rejeitada (tx inteira volta).
    const otherFailed = await createAsset(userA, "failed");
    await expect(
      updateNote(
        userA,
        {
          noteId: res.noteId,
          content: basic(
            [para("qual a estrutura anatômica?"), image(referenced, "figura")],
            [para("resposta"), image(otherFailed)],
          ),
        },
        run,
      ),
    ).rejects.toThrow("falhou no processamento");
    expect(await refsOf(userA, res.noteId)).toEqual([
      { mediaAssetId: referenced, slot: "front:0", altText: "figura" },
    ]);

    // Soft-deletado JÁ referenciado também é tolerado…
    await run(userA, (tx) =>
      tx.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, referenced)),
    );
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: basic(
          [para("qual a estrutura anatômica (rev.)?"), image(referenced, "figura")],
          [para("resposta")],
        ),
      },
      run,
    );
    // …mas referência NOVA a soft-deletado tem a mensagem uniforme de inexistente.
    const otherDeleted = await createAsset(userA, "ready");
    await run(userA, (tx) =>
      tx.update(mediaAssets).set({ deletedAt: new Date() }).where(eq(mediaAssets.id, otherDeleted)),
    );
    await expect(
      updateNote(
        userA,
        {
          noteId: res.noteId,
          content: basic(
            [para("qual a estrutura anatômica (rev.)?"), image(referenced, "figura")],
            [para("resposta"), image(otherDeleted)],
          ),
        },
        run,
      ),
    ).rejects.toThrow("imagem referenciada não encontrada");
  });

  it("variant nunca é reutilizado após ciclos de edição", async () => {
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "cloze",
        content: cloze(["Fases: ", { g: "g1", text: "alfa" }, " ", { g: "g2", text: "beta" }]),
      },
      run,
    );

    // Ciclo 1: remove g2.
    await updateNote(
      userA,
      { noteId: res.noteId, content: cloze(["Fases: ", { g: "g1", text: "alfa" }]) },
      run,
    );
    // Ciclo 2: adiciona g3 (conteúdo diferente => sem resgate).
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze(["Fases: ", { g: "g1", text: "alfa" }, " ", { g: "g3", text: "gama" }]),
      },
      run,
    );
    // Ciclo 3: troca g3 por g4 (conteúdo diferente).
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: cloze(["Fases: ", { g: "g1", text: "alfa" }, " ", { g: "g4", text: "delta" }]),
      },
      run,
    );

    const all = await cardsOf(userA, res.noteId);
    expect(all).toHaveLength(4);
    // Variants monotônicos e ÚNICOS — nenhum variant de card removed é herdado.
    expect(all.map((c) => c.variant)).toEqual([1, 2, 3, 4]);
    expect(new Set(all.map((c) => c.variant)).size).toBe(4);
    const byKey = new Map(all.map((c) => [c.clozeGroupKey, c.status]));
    expect(byKey.get("g1")).toBe("active");
    expect(byKey.get("g2")).toBe("removed");
    expect(byKey.get("g3")).toBe("removed");
    expect(byKey.get("g4")).toBe("active");
  });

  it("media_references sincronizadas em create/update com slots posicionais", async () => {
    const assetId = await createAsset(userA, "ready");
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic(
          [para("Qual estrutura aparece na imagem?"), image(assetId, "radiografia do tórax")],
          [para("Clavícula")],
        ),
      },
      run,
    );
    expect(await refsOf(userA, res.noteId)).toEqual([
      { mediaAssetId: assetId, slot: "front:0", altText: "radiografia do tórax" },
    ]);

    // Move a imagem para o verso => slot antigo deletado, novo inserido.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: basic(
          [para("Qual estrutura aparece na imagem?")],
          [para("Clavícula"), image(assetId, "radiografia do tórax")],
        ),
      },
      run,
    );
    expect(await refsOf(userA, res.noteId)).toEqual([
      { mediaAssetId: assetId, slot: "back:0", altText: "radiografia do tórax" },
    ]);

    // Remove a imagem => zero referências.
    await updateNote(
      userA,
      {
        noteId: res.noteId,
        content: basicText("Qual estrutura aparece na imagem?", "Clavícula"),
      },
      run,
    );
    expect(await refsOf(userA, res.noteId)).toEqual([]);
  });

  it("A não referencia media_asset de B nem asset failed — nada é criado (F2#5)", async () => {
    const assetOfB = await createAsset(userB, "ready");
    const notesBefore = await run(userA, (tx) => tx.select({ id: notes.id }).from(notes));

    await expect(
      createNote(
        userA,
        {
          deckId: deckA,
          noteType: "basic",
          content: basic([para("frente"), image(assetOfB)], [para("verso")]),
        },
        run,
      ),
    ).rejects.toThrow("imagem referenciada não encontrada");

    // Nada criado: nem nota, nem referência.
    const notesAfter = await run(userA, (tx) => tx.select({ id: notes.id }).from(notes));
    expect(notesAfter).toHaveLength(notesBefore.length);

    // Asset do próprio usuário em 'failed' também é rejeitado.
    const failedAsset = await createAsset(userA, "failed");
    await expect(
      createNote(
        userA,
        {
          deckId: deckA,
          noteType: "basic",
          content: basic([para("frente"), image(failedAsset)], [para("verso")]),
        },
        run,
      ),
    ).rejects.toThrow("falhou no processamento");

    // updateNote também bloqueia asset alheio (nota intacta).
    const ok = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basicText("f", "v") },
      run,
    );
    await expect(
      updateNote(
        userA,
        {
          noteId: ok.noteId,
          content: basic([para("f"), image(assetOfB)], [para("v")]),
        },
        run,
      ),
    ).rejects.toThrow("imagem referenciada não encontrada");
    expect(await refsOf(userA, ok.noteId)).toEqual([]);
  });

  it("moveNote: deck próprio funciona; deck de outro usuário é erro", async () => {
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basicText("mover", "ok") },
      run,
    );

    await expect(
      moveNote(userA, { noteId: res.noteId, targetDeckId: deckB }, run),
    ).rejects.toThrow("baralho não encontrado");

    await moveNote(userA, { noteId: res.noteId, targetDeckId: deckA2 }, run);
    const [row] = await run(userA, (tx) =>
      tx.select({ deckId: notes.deckId }).from(notes).where(eq(notes.id, res.noteId)),
    );
    expect(row!.deckId).toBe(deckA2);

    // Cards não mudam ao mover.
    const cardRows = await cardsOf(userA, res.noteId);
    expect(cardRows).toHaveLength(1);
    expect(cardRows[0]!.status).toBe("active");
  });

  it("duplicateNote: cards novos com progresso zero, tags e media_references copiadas", async () => {
    const assetId = await createAsset(userA, "ready");
    const source = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic([para("original"), image(assetId, "figura")], [para("resposta")]),
        tagNames: ["anatomia", "fisiologia"],
      },
      run,
    );
    await insertProgress(userA, source.cardIds[0]!);

    const copy = await duplicateNote(userA, { noteId: source.noteId }, run);
    expect(copy.noteId).not.toBe(source.noteId);
    expect(copy.cardCount).toBe(1);
    expect(copy.cardIds[0]).not.toBe(source.cardIds[0]);

    const sourceCards = await cardsOf(userA, source.noteId);
    const copyCards = await cardsOf(userA, copy.noteId);
    expect(copyCards[0]!.variant).toBe(1);
    expect(copyCards[0]!.contentFingerprint).toBe(sourceCards[0]!.contentFingerprint);

    // Progresso ZERO no card novo (ausência de card_progress = new).
    expect(await progressOf(userA, copy.cardIds[0]!)).toHaveLength(0);

    // Mesmo deck, tags e referências copiadas.
    const [noteRow] = await run(userA, (tx) =>
      tx.select({ deckId: notes.deckId }).from(notes).where(eq(notes.id, copy.noteId)),
    );
    expect(noteRow!.deckId).toBe(deckA);
    const sourceTagIds = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.noteId, source.noteId)),
    );
    const copyTagIds = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.noteId, copy.noteId)),
    );
    expect(new Set(copyTagIds.map((t) => t.tagId))).toEqual(
      new Set(sourceTagIds.map((t) => t.tagId)),
    );
    expect(await refsOf(userA, copy.noteId)).toEqual([
      { mediaAssetId: assetId, slot: "front:0", altText: "figura" },
    ]);
  });

  it("RLS + serviço: B não lê/edita/apaga/move/duplica nota de A", async () => {
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basicText("privado", "de A") },
      run,
    );

    await expect(
      updateNote(userB, { noteId: res.noteId, content: basicText("hack", "hack") }, run),
    ).rejects.toThrow("nota não encontrada");
    await expect(deleteNote(userB, { noteId: res.noteId }, run)).rejects.toThrow(
      "nota não encontrada",
    );
    await expect(duplicateNote(userB, { noteId: res.noteId }, run)).rejects.toThrow(
      "nota não encontrada",
    );
    await expect(
      moveNote(userB, { noteId: res.noteId, targetDeckId: deckB }, run),
    ).rejects.toThrow("nota não encontrada");
    await expect(listNotes(userB, { deckId: deckA }, run)).rejects.toThrow(
      "baralho não encontrado",
    );

    // Nota intacta.
    const [row] = await run(userA, (tx) =>
      tx
        .select({ deckId: notes.deckId, deletedAt: notes.deletedAt })
        .from(notes)
        .where(eq(notes.id, res.noteId)),
    );
    expect(row!.deckId).toBe(deckA);
    expect(row!.deletedAt).toBeNull();
  });

  it("deleteNote/restoreNote: soft delete some da listagem e volta no restore", async () => {
    const deck = await createDeckFor(userA, "Deck delete");
    const res = await createNote(
      userA,
      { deckId: deck, noteType: "basic", content: basicText("efêmera", "sim") },
      run,
    );

    expect((await listNotes(userA, { deckId: deck }, run)).map((n) => n.id)).toEqual([res.noteId]);

    await deleteNote(userA, { noteId: res.noteId }, run);
    expect(await listNotes(userA, { deckId: deck }, run)).toEqual([]);
    // Cards intocados pelo soft delete.
    const cardRows = await cardsOf(userA, res.noteId);
    expect(cardRows[0]!.status).toBe("active");
    // Nota deletada não é editável.
    await expect(
      updateNote(userA, { noteId: res.noteId, content: basicText("x", "y") }, run),
    ).rejects.toThrow("nota não encontrada");

    await restoreNote(userA, { noteId: res.noteId }, run);
    expect((await listNotes(userA, { deckId: deck }, run)).map((n) => n.id)).toEqual([res.noteId]);

    await expect(restoreNote(userA, { noteId: res.noteId }, run)).rejects.toThrow(
      "a nota não está excluída",
    );
  });

  it("listNotes: preview ~200 chars e contagem só de cards ativos", async () => {
    const deck = await createDeckFor(userA, "Deck listagem");
    const longText = "palavra ".repeat(60).trim(); // > 200 chars após canonicalização
    await createNote(
      userA,
      { deckId: deck, noteType: "basic", content: basicText(longText, "curto") },
      run,
    );
    const clozeRes = await createNote(
      userA,
      {
        deckId: deck,
        noteType: "cloze",
        content: cloze(["Par: ", { g: "g1", text: "um" }, " ", { g: "g2", text: "dois" }]),
      },
      run,
    );
    // Remove um grupo => contagem de ativos cai para 1.
    await updateNote(
      userA,
      { noteId: clozeRes.noteId, content: cloze(["Par: ", { g: "g1", text: "um" }, " dois"]) },
      run,
    );

    const list = await listNotes(userA, { deckId: deck }, run);
    expect(list).toHaveLength(2);
    const basicItem = list.find((n) => n.noteType === "basic")!;
    expect(basicItem.preview.length).toBeLessThanOrEqual(200);
    expect(basicItem.preview.startsWith("palavra palavra")).toBe(true);
    expect(basicItem.cardCount).toBe(1);
    const clozeItem = list.find((n) => n.noteType === "cloze")!;
    expect(clozeItem.cardCount).toBe(1); // só ativos (o removed fica fora)
    // Ordenação: a nota editada por último vem primeiro.
    expect(list[0]!.id).toBe(clozeRes.noteId);
  });

  it("audit_logs registra toda mutação de nota com o actor certo", async () => {
    const deck = await createDeckFor(userA, "Deck audit");
    const res = await createNote(
      userA,
      { deckId: deck, noteType: "basic", content: basicText("auditada", "sim") },
      run,
    );
    await updateNote(userA, { noteId: res.noteId, content: basicText("auditada!", "sim") }, run);
    await moveNote(userA, { noteId: res.noteId, targetDeckId: deckA }, run);
    const copy = await duplicateNote(userA, { noteId: res.noteId }, run);
    await deleteNote(userA, { noteId: res.noteId }, run);
    await restoreNote(userA, { noteId: res.noteId }, run);

    const logs = await run(userA, (tx) =>
      tx
        .select({ action: auditLogs.action, actorUserId: auditLogs.actorUserId })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, res.noteId)),
    );
    const actions = logs.map((l) => l.action);
    for (const expected of [
      "note.create",
      "note.update",
      "note.move",
      "note.delete",
      "note.restore",
    ]) {
      expect(actions).toContain(expected);
    }
    expect(logs.every((l) => l.actorUserId === userA)).toBe(true);

    const dupLogs = await run(userA, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, copy.noteId)),
    );
    expect(dupLogs.map((l) => l.action)).toContain("note.duplicate");
  });
});
