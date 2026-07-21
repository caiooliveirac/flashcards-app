import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, decks, notes, noteTags, tags } from "@/db/schema";
import { createNote, deleteNote, restoreNote, updateNote } from "@/features/notes/service";
import { deleteTag, listTags, renameTag } from "@/features/tags/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

const basic = (front: string, back: string): unknown => ({
  schemaVersion: 1,
  kind: "basic",
  front: [{ type: "paragraph", content: [{ type: "text", text: front }] }],
  back: [{ type: "paragraph", content: [{ type: "text", text: back }] }],
});

describe("tags service (upsert por nome normalizado, contagem, rename/delete, RLS)", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;
  let deckA: string;
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

  async function tagIdByName(ownerId: string, name: string): Promise<string> {
    const all = await listTags(ownerId, run);
    const tag = all.find((t) => t.name === name);
    if (!tag) throw new Error(`tag ${name} não encontrada no teste`);
    return tag.id;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    run = db.clients.withUserTransaction;
    userA = await db.createUser("alice@tags.dev");
    userB = await db.createUser("bob@tags.dev");
    deckA = await createDeckFor(userA, "Deck A");
    deckB = await createDeckFor(userB, "Deck B");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("createNote normaliza nomes (trim + espaços colapsados, caixa PRESERVADA) e deduplica", async () => {
    await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic("tags 1", "ok"),
        tagNames: ["  Cardio ", "cardio", "Cardio", "Sistema   Nervoso"],
      },
      run,
    );

    const list = await listTags(userA, run);
    const names = list.map((t) => t.name);
    // "Cardio" e "cardio" são tags DISTINTAS (unicidade exata, sem case-fold).
    expect(names).toContain("Cardio");
    expect(names).toContain("cardio");
    expect(names).toContain("Sistema Nervoso"); // espaços internos colapsados
    expect(list.filter((t) => t.name === "Cardio")).toHaveLength(1); // dedupe do input

    // Nome vazio após normalização é erro claro.
    await expect(
      createNote(
        userA,
        { deckId: deckA, noteType: "basic", content: basic("x", "y"), tagNames: ["   "] },
        run,
      ),
    ).rejects.toThrow("informe o nome da tag");
  });

  it("upsert reutiliza a tag existente do usuário (mesmo id, contagem sobe)", async () => {
    const cardioId = await tagIdByName(userA, "Cardio");
    await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basic("tags 2", "ok"), tagNames: ["Cardio"] },
      run,
    );
    expect(await tagIdByName(userA, "Cardio")).toBe(cardioId); // sem duplicar
    const list = await listTags(userA, run);
    expect(list.find((t) => t.id === cardioId)?.noteCount).toBe(2);
  });

  it("updateNote com tagNames re-sincroniza; sem tagNames mantém", async () => {
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basic("sync", "ok"), tagNames: ["Neuro"] },
      run,
    );
    // Sem tagNames => associações intactas.
    await updateNote(userA, { noteId: res.noteId, content: basic("sync!", "ok") }, run);
    let assoc = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.noteId, res.noteId)),
    );
    expect(assoc).toHaveLength(1);

    // Com tagNames => troca Neuro por Endócrino.
    await updateNote(
      userA,
      { noteId: res.noteId, content: basic("sync!", "ok"), tagNames: ["Endócrino"] },
      run,
    );
    assoc = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.noteId, res.noteId)),
    );
    const endocrinoId = await tagIdByName(userA, "Endócrino");
    expect(assoc.map((a) => a.tagId)).toEqual([endocrinoId]);

    const list = await listTags(userA, run);
    expect(list.find((t) => t.name === "Neuro")?.noteCount).toBe(0); // tag fica, contagem zera

    // tagNames: [] remove todas as associações.
    await updateNote(
      userA,
      { noteId: res.noteId, content: basic("sync!", "ok"), tagNames: [] },
      run,
    );
    assoc = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.noteId, res.noteId)),
    );
    expect(assoc).toHaveLength(0);
  });

  it("listTags conta apenas notas NÃO deletadas", async () => {
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basic("renal", "ok"), tagNames: ["Renal"] },
      run,
    );
    expect((await listTags(userA, run)).find((t) => t.name === "Renal")?.noteCount).toBe(1);

    await deleteNote(userA, { noteId: res.noteId }, run);
    expect((await listTags(userA, run)).find((t) => t.name === "Renal")?.noteCount).toBe(0);

    await restoreNote(userA, { noteId: res.noteId }, run);
    expect((await listTags(userA, run)).find((t) => t.name === "Renal")?.noteCount).toBe(1);
  });

  it("renameTag normaliza, bloqueia colisão e é isolado por usuário", async () => {
    await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic("rename", "ok"),
        tagNames: ["Velho", "Ocupado"],
      },
      run,
    );
    const velhoId = await tagIdByName(userA, "Velho");

    await renameTag(userA, { tagId: velhoId, name: "  Novo   Nome " }, run);
    const list = await listTags(userA, run);
    expect(list.find((t) => t.id === velhoId)?.name).toBe("Novo Nome");
    expect(list.map((t) => t.name)).not.toContain("Velho");

    await expect(renameTag(userA, { tagId: velhoId, name: "Ocupado" }, run)).rejects.toThrow(
      "já existe uma tag com esse nome",
    );
    await expect(renameTag(userA, { tagId: velhoId, name: "   " }, run)).rejects.toThrow(
      "informe o nome da tag",
    );
    // B não renomeia tag de A (mesma mensagem de inexistente — sem vazar).
    await expect(renameTag(userB, { tagId: velhoId, name: "Roubada" }, run)).rejects.toThrow(
      "tag não encontrada",
    );
    // Renomear para o próprio nome é aceito (no-op).
    await renameTag(userA, { tagId: velhoId, name: "Novo Nome" }, run);
  });

  it("deleteTag remove note_tags na mesma tx; nota permanece; B não apaga tag de A", async () => {
    const res = await createNote(
      userA,
      { deckId: deckA, noteType: "basic", content: basic("temp", "ok"), tagNames: ["Temp"] },
      run,
    );
    const tempId = await tagIdByName(userA, "Temp");

    await expect(deleteTag(userB, { tagId: tempId }, run)).rejects.toThrow("tag não encontrada");

    await deleteTag(userA, { tagId: tempId }, run);
    const list = await listTags(userA, run);
    expect(list.map((t) => t.name)).not.toContain("Temp");
    const assoc = await run(userA, (tx) =>
      tx.select({ tagId: noteTags.tagId }).from(noteTags).where(eq(noteTags.tagId, tempId)),
    );
    expect(assoc).toHaveLength(0);
    // A nota sobrevive à remoção da tag.
    const noteRows = await run(userA, (tx) =>
      tx.select({ deletedAt: notes.deletedAt }).from(notes).where(eq(notes.id, res.noteId)),
    );
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0]!.deletedAt).toBeNull();
  });

  it("RLS: A não vê tags de B via listTags nem via SELECT direto", async () => {
    await createNote(
      userB,
      { deckId: deckB, noteType: "basic", content: basic("segredo", "ok"), tagNames: ["Secreta"] },
      run,
    );
    expect((await listTags(userA, run)).map((t) => t.name)).not.toContain("Secreta");
    expect((await listTags(userB, run)).map((t) => t.name)).toContain("Secreta");

    const direct = await run(userA, (tx) =>
      tx.select({ name: tags.name }).from(tags).where(eq(tags.name, "Secreta")),
    );
    expect(direct).toHaveLength(0);
  });

  it("audit_logs registra rename e delete de tag", async () => {
    const logs = await run(userA, (tx) =>
      tx
        .select({ action: auditLogs.action, entityType: auditLogs.entityType })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "tag")),
    );
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("tag.rename");
    expect(actions).toContain("tag.delete");
  });
});
