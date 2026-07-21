import os from "node:os";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decks } from "@/db/schema";
import { createNote, deleteNote, searchNotes } from "@/features/notes/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * Aceite F2#7: busca textual no acervo próprio via FTS português usa o índice
 * GIN notes_search_idx (verificado por EXPLAIN como role app COM contexto).
 */

const basic = (front: string, back: string): unknown => ({
  schemaVersion: 1,
  kind: "basic",
  front: [{ type: "paragraph", content: [{ type: "text", text: front }] }],
  back: [{ type: "paragraph", content: [{ type: "text", text: back }] }],
});

const clozeOne = (before: string, hidden: string): unknown => ({
  schemaVersion: 1,
  kind: "cloze",
  text: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: before },
        { type: "cloze", groupKey: "g1", content: [{ type: "text", text: hidden }] },
      ],
    },
  ],
});

/**
 * PRÉ-REQUISITO DE PRODUÇÃO (achado deste teste, PG 16+): sob RLS, um qual do
 * usuário só vira condição de índice se o operador for LEAKPROOF — e
 * ts_match_vq (operador @@ do tsearch) NÃO é por default. Sem isto, a busca
 * como flashcards_app faz Seq Scan SEMPRE (mesmo com enable_seqscan=off o
 * plano sai "Disabled"), enquanto o mesmo SQL sem RLS usa o GIN. O clause
 * inteiro precisa ser leakproof — inclui o to_tsvector aplicado sobre a
 * coluna. Correção: duas linhas de superusuário POR BANCO (mesmo runbook do
 * setup-database.sql):
 *   ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF;
 *   ALTER FUNCTION pg_catalog.to_tsvector(regconfig, text) LEAKPROOF;
 * Aqui aplicamos no banco descartável via a conexão admin do harness (que já
 * precisa ser superuser para criar roles BYPASSRLS).
 */
async function markTsMatchLeakproof(dbName: string): Promise<void> {
  const adminUrl =
    process.env.TEST_ADMIN_DATABASE_URL ??
    `postgres://${os.userInfo().username}@localhost:5432/postgres`;
  const parsed = new URL(adminUrl.replace(/^postgres(ql)?:/, "http:"));
  const client = new Client({
    host: parsed.hostname || "localhost",
    port: Number(parsed.port || 5432),
    user: parsed.username !== "" ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password !== "" ? decodeURIComponent(parsed.password) : undefined,
    database: dbName,
  });
  await client.connect();
  await client.query("ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF");
  await client.query("ALTER FUNCTION pg_catalog.to_tsvector(regconfig, text) LEAKPROOF");
  await client.end();
}

interface PlanNode {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
}

function findIndexNode(node: PlanNode, indexName: string): PlanNode | null {
  if (node["Index Name"] === indexName) return node;
  for (const child of node.Plans ?? []) {
    const hit = findIndexNode(child, indexName);
    if (hit) return hit;
  }
  return null;
}

describe("notes search (FTS português + índice GIN)", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;
  let deckA: string;
  let deckA2: string;
  let deckB: string;
  let heartNoteId: string;
  let clozeNoteId: string;
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

  beforeAll(async () => {
    db = await createTestDatabase();
    run = db.clients.withUserTransaction;
    userA = await db.createUser("alice@search.dev");
    userB = await db.createUser("bob@search.dev");
    deckA = await createDeckFor(userA, "Deck busca");
    deckA2 = await createDeckFor(userA, "Deck busca 2");
    deckB = await createDeckFor(userB, "Deck B");

    heartNoteId = (
      await createNote(
        userA,
        {
          deckId: deckA,
          noteType: "basic",
          content: basic("O coração humano tem quantas câmaras?", "Quatro câmaras"),
        },
        run,
      )
    ).noteId;
    await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic("Onde ocorre a fotossíntese?", "Nos cloroplastos"),
      },
      run,
    );
    clozeNoteId = (
      await createNote(
        userA,
        {
          deckId: deckA2,
          noteType: "cloze",
          content: clozeOne("O órgão que produz insulina é o ", "pâncreas"),
        },
        run,
      )
    ).noteId;
    // Nota de B com o mesmo termo — NUNCA pode aparecer para A.
    await createNote(
      userB,
      {
        deckId: deckB,
        noteType: "basic",
        content: basic("O coração do boi é grande?", "Sim"),
      },
      run,
    );
  });

  afterAll(async () => {
    await db.drop();
  });

  it("acha a nota certa entre >= 3 notas e nunca vaza nota de outro usuário", async () => {
    const results = await searchNotes(userA, { query: "coração" }, run);
    expect(results.map((r) => r.id)).toEqual([heartNoteId]);
    expect(results[0]).toMatchObject({ deckId: deckA, noteType: "basic" });
    expect(results[0]!.preview).toContain("coração");

    // B só encontra a própria nota.
    const resultsB = await searchNotes(userB, { query: "coração" }, run);
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0]!.id).not.toBe(heartNoteId);
  });

  it("busca acha conteúdo de cloze REVELADO (search_text derivado)", async () => {
    const results = await searchNotes(userA, { query: "pâncreas" }, run);
    expect(results.map((r) => r.id)).toEqual([clozeNoteId]);
  });

  it("websearch: múltiplas palavras (AND) e termo inexistente", async () => {
    expect(
      (await searchNotes(userA, { query: "coração câmaras" }, run)).map((r) => r.id),
    ).toEqual([heartNoteId]);
    expect(await searchNotes(userA, { query: "mitocôndria" }, run)).toEqual([]);
  });

  it("filtro por deckId restringe e exige deck do usuário", async () => {
    expect(
      (await searchNotes(userA, { query: "coração", deckId: deckA }, run)).map((r) => r.id),
    ).toEqual([heartNoteId]);
    expect(await searchNotes(userA, { query: "coração", deckId: deckA2 }, run)).toEqual([]);
    await expect(searchNotes(userA, { query: "coração", deckId: deckB }, run)).rejects.toThrow(
      "baralho não encontrado",
    );
  });

  it("nota deletada (soft) sai da busca; query vazia é erro", async () => {
    const res = await createNote(
      userA,
      {
        deckId: deckA,
        noteType: "basic",
        content: basic("O hipotálamo regula o quê?", "Homeostase"),
      },
      run,
    );
    expect((await searchNotes(userA, { query: "hipotálamo" }, run)).map((r) => r.id)).toEqual([
      res.noteId,
    ]);
    await deleteNote(userA, { noteId: res.noteId }, run);
    expect(await searchNotes(userA, { query: "hipotálamo" }, run)).toEqual([]);

    await expect(searchNotes(userA, { query: "   " }, run)).rejects.toThrow(
      "informe o termo de busca",
    );
  });

  it("EXPLAIN como role app com contexto usa o GIN notes_search_idx (F2#7)", async () => {
    // Sem LEAKPROOF no @@ a RLS impede o uso do índice (ver comentário acima).
    await markTsMatchLeakproof(db.dbName);
    // Estatísticas atualizadas antes do EXPLAIN (planner informado).
    await db.ownerQuery("ANALYZE notes");

    const planRows = await run(userA, async (tx) => {
      // Volume mínimo de linhas faria o planner escolher seqscan mesmo com o
      // índice utilizável; enable_seqscan=off (transaction-local) força a
      // decisão a revelar se o índice É usável — documentado no aceite F2#7.
      await tx.execute(sql`select set_config('enable_seqscan', 'off', true)`);
      // MESMA expressão do serviço searchNotes e do índice notes_search_idx:
      // to_tsvector('portuguese', search_text) @@ websearch_to_tsquery(...).
      const res = await tx.execute(
        sql`explain (format json)
            select id from notes
            where owner_user_id = current_setting('app.current_user_id', true)
              and deleted_at is null
              and to_tsvector('portuguese', search_text) @@ websearch_to_tsquery('portuguese', 'coração')`,
      );
      return res.rows;
    });

    const raw = planRows[0]?.["QUERY PLAN"];
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Array<{ Plan: PlanNode }>;
    const root = parsed[0]?.Plan;
    expect(root).toBeDefined();

    const indexNode = findIndexNode(root!, "notes_search_idx");
    expect(indexNode).not.toBeNull();
    expect(indexNode!["Node Type"]).toBe("Bitmap Index Scan");
  });
});
