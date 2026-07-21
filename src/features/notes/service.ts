import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import {
  auditLogs,
  cards,
  decks,
  mediaAssets,
  mediaReferences,
  notes,
  noteTags,
  noteType as noteTypeEnum,
  tags,
} from "@/db/schema";
import {
  collectImageReferences,
  deriveCards,
  deriveSearchText,
  matchDerivedToExisting,
  parseNoteContent,
  safeParseNoteContent,
  type ExistingCardInfo,
  type NoteContent,
} from "@/lib/content";
import { validateTagName } from "@/features/tags/service";

/**
 * Serviço de notas/cards (arquitetura §3.3, §5, §6.2/6.3, fluxos §13.1-2).
 * TODA operação roda numa única withUserTransaction; userId vem SEMPRE da
 * sessão; ownership de ids recebidos é checado explicitamente ANTES de agir
 * (RLS é rede de segurança, não a única barreira). Cards NUNCA são deletados
 * fisicamente — remoção é status 'removed' (progresso e review_logs intactos).
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type NoteType = (typeof noteTypeEnum.enumValues)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} inválido`);
  }
}

function validatePagination(
  limit: number | undefined,
  offset: number | undefined,
): { limit: number; offset: number } {
  const l = limit ?? 50;
  const o = offset ?? 0;
  if (!Number.isInteger(l) || l < 1 || l > 200) {
    throw new Error("limite de paginação inválido (entre 1 e 200)");
  }
  if (!Number.isInteger(o) || o < 0) {
    throw new Error("offset de paginação inválido");
  }
  return { limit: l, offset: o };
}

/** Valida o content com o Zod do NoteContentV1 e exige kind === noteType. */
function parseContentAs(noteType: NoteType, raw: unknown): NoteContent {
  const parsed = safeParseNoteContent(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`conteúdo da nota inválido: ${first?.message ?? "formato desconhecido"}`);
  }
  if (parsed.data.kind !== noteType) {
    throw new Error(
      `o tipo da nota (${noteType}) não corresponde ao conteúdo (${parsed.data.kind})`,
    );
  }
  return parsed.data;
}

/** Autorização em camada de serviço (§6.3): deck do usuário, não deletado. */
async function requireOwnedDeck(tx: Tx, userId: string, deckId: string): Promise<void> {
  const [deck] = await tx
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.ownerUserId, userId), isNull(decks.deletedAt)))
    .limit(1);
  if (!deck) {
    throw new Error("baralho não encontrado");
  }
}

interface OwnedNote {
  id: string;
  deckId: string;
  noteType: NoteType;
  contentJson: unknown;
  sourceType: "human" | "ai" | "import";
  aiGenerationId: string | null;
  deletedAt: Date | null;
}

async function requireOwnedNote(
  tx: Tx,
  userId: string,
  noteId: string,
  opts?: { allowDeleted?: boolean },
): Promise<OwnedNote> {
  const [note] = await tx
    .select({
      id: notes.id,
      deckId: notes.deckId,
      noteType: notes.noteType,
      contentJson: notes.contentJson,
      sourceType: notes.sourceType,
      aiGenerationId: notes.aiGenerationId,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.ownerUserId, userId)))
    .limit(1);
  if (!note || (note.deletedAt !== null && opts?.allowDeleted !== true)) {
    throw new Error("nota não encontrada");
  }
  return note;
}

type MediaRef = ReturnType<typeof collectImageReferences>[number];

/**
 * Aceite F2#5: todo asset referenciado precisa existir, ser DO USUÁRIO e não
 * estar 'failed' nem deletado. Asset alheio, inexistente e soft-deletado têm a
 * MESMA mensagem (não vaza existência de mídia de terceiros).
 *
 * `alreadyReferenced` (#12): assetIds que JÁ constam nas media_references
 * ATUAIS da nota são tolerados sem validação — editar texto/tags de nota que
 * ficou com imagem quebrada ('failed'/soft-deletada depois de referenciada)
 * não pode ser bloqueado; a rejeição vale só para referências NOVAS.
 *
 * FOR SHARE (#1/#8): serializa contra o FOR UPDATE do GC de mídia órfã — ou
 * esta tx espera o GC e revê a linha com deleted_at setado (erro limpo de
 * "não encontrada"), ou o GC espera e o recheck dele vê a referência inserida.
 * O lock vive até o COMMIT, cobrindo a janela validação → insert da referência.
 */
async function requireUsableAssets(
  tx: Tx,
  userId: string,
  refs: MediaRef[],
  alreadyReferenced?: ReadonlySet<string>,
): Promise<void> {
  const assetIds = [...new Set(refs.map((r) => r.assetId))].filter(
    (id) => !(alreadyReferenced?.has(id) ?? false),
  );
  if (assetIds.length === 0) return;
  const rows = await tx
    .select({ id: mediaAssets.id, status: mediaAssets.status })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.id, assetIds),
        eq(mediaAssets.ownerUserId, userId),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .for("share");
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  for (const id of assetIds) {
    const status = statusById.get(id);
    if (status === undefined) {
      throw new Error(`imagem referenciada não encontrada: ${id}`);
    }
    if (status === "failed") {
      throw new Error(`imagem referenciada falhou no processamento: ${id}`);
    }
  }
}

/**
 * Sincroniza media_references com os slots derivados do conteúdo: deleta os
 * (asset, slot) que sumiram, insere os novos, atualiza alt_text dos mantidos.
 */
async function syncMediaReferences(
  tx: Tx,
  userId: string,
  noteId: string,
  desired: MediaRef[],
): Promise<void> {
  const current = await tx
    .select({
      mediaAssetId: mediaReferences.mediaAssetId,
      slot: mediaReferences.slot,
      altText: mediaReferences.altText,
    })
    .from(mediaReferences)
    .where(eq(mediaReferences.noteId, noteId));

  const keyOf = (assetId: string, slot: string) => `${assetId}|${slot}`;
  const desiredByKey = new Map(desired.map((r) => [keyOf(r.assetId, r.slot), r]));
  const currentByKey = new Map(current.map((r) => [keyOf(r.mediaAssetId, r.slot), r]));

  for (const [key, row] of currentByKey) {
    if (!desiredByKey.has(key)) {
      await tx
        .delete(mediaReferences)
        .where(
          and(
            eq(mediaReferences.noteId, noteId),
            eq(mediaReferences.mediaAssetId, row.mediaAssetId),
            eq(mediaReferences.slot, row.slot),
          ),
        );
    }
  }

  const toInsert: Array<typeof mediaReferences.$inferInsert> = [];
  for (const [key, ref] of desiredByKey) {
    const existing = currentByKey.get(key);
    if (existing === undefined) {
      toInsert.push({
        mediaAssetId: ref.assetId,
        noteId,
        slot: ref.slot,
        ownerUserId: userId,
        altText: ref.alt ?? null,
      });
    } else if ((existing.altText ?? null) !== (ref.alt ?? null)) {
      await tx
        .update(mediaReferences)
        .set({ altText: ref.alt ?? null })
        .where(
          and(
            eq(mediaReferences.noteId, noteId),
            eq(mediaReferences.mediaAssetId, ref.assetId),
            eq(mediaReferences.slot, ref.slot),
          ),
        );
    }
  }
  if (toInsert.length > 0) {
    await tx.insert(mediaReferences).values(toInsert);
  }
}

/**
 * Upsert de tags por nome normalizado (trim + colapsa espaços; caixa
 * preservada — unicidade (owner, name)) e sincronização de note_tags.
 */
async function syncNoteTags(
  tx: Tx,
  userId: string,
  noteId: string,
  tagNames: string[],
): Promise<void> {
  const names = [...new Set(tagNames.map(validateTagName))];

  let desiredIds: string[] = [];
  if (names.length > 0) {
    await tx
      .insert(tags)
      .values(names.map((name) => ({ ownerUserId: userId, name })))
      .onConflictDoNothing({ target: [tags.ownerUserId, tags.name] });
    const rows = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.ownerUserId, userId), inArray(tags.name, names)));
    desiredIds = rows.map((r) => r.id);
  }

  const current = await tx
    .select({ tagId: noteTags.tagId })
    .from(noteTags)
    .where(eq(noteTags.noteId, noteId));
  const currentIds = new Set(current.map((r) => r.tagId));
  const desiredSet = new Set(desiredIds);

  const toAdd = desiredIds.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desiredSet.has(id));
  if (toAdd.length > 0) {
    await tx
      .insert(noteTags)
      .values(toAdd.map((tagId) => ({ noteId, tagId, ownerUserId: userId })));
  }
  if (toRemove.length > 0) {
    await tx
      .delete(noteTags)
      .where(and(eq(noteTags.noteId, noteId), inArray(noteTags.tagId, toRemove)));
  }
}

async function activeCardIdsOf(tx: Tx, noteId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.noteId, noteId), eq(cards.status, "active")))
    .orderBy(asc(cards.variant));
  return rows.map((r) => r.id);
}

export interface NoteMutationResult {
  noteId: string;
  cardIds: string[];
  cardCount: number;
}

export interface CreateNoteInput {
  deckId: string;
  noteType: NoteType;
  content: unknown;
  tagNames?: string[];
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
  runUser: UserRunner = withUserTransaction,
): Promise<NoteMutationResult> {
  requireUuid(input.deckId, "baralho");
  // Validações puras ANTES de abrir transação (falha barata, sem conexão).
  const content = parseContentAs(input.noteType, input.content);
  const searchText = deriveSearchText(content);
  const derived = deriveCards(content);
  const imageRefs = collectImageReferences(content);
  const tagNames = input.tagNames?.map(validateTagName);

  return runUser(userId, async (tx) => {
    await requireOwnedDeck(tx, userId, input.deckId);
    await requireUsableAssets(tx, userId, imageRefs);

    const [note] = await tx
      .insert(notes)
      .values({
        ownerUserId: userId,
        deckId: input.deckId,
        noteType: input.noteType,
        contentJson: content,
        searchText,
        createdByUserId: userId,
      })
      .returning({ id: notes.id });
    if (!note) throw new Error("falha ao criar a nota");

    // Variants 1..n na ordem de deriveCards (§3.3: contador monotônico por nota).
    const insertedCards = await tx
      .insert(cards)
      .values(
        derived.map((d, i) => ({
          noteId: note.id,
          ownerUserId: userId,
          variant: i + 1,
          clozeGroupKey: d.clozeGroupKey,
          contentFingerprint: d.fingerprint,
        })),
      )
      .returning({ id: cards.id, variant: cards.variant });
    const cardIds = [...insertedCards].sort((a, b) => a.variant - b.variant).map((c) => c.id);

    await syncMediaReferences(tx, userId, note.id, imageRefs);
    if (tagNames !== undefined) {
      await syncNoteTags(tx, userId, note.id, tagNames);
    }

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.create",
      entityType: "note",
      entityId: note.id,
      metadata: { deckId: input.deckId, noteType: input.noteType, cardCount: cardIds.length },
    });

    return { noteId: note.id, cardIds, cardCount: cardIds.length };
  });
}

export interface UpdateNoteInput {
  noteId: string;
  content: unknown;
  tagNames?: string[];
}

/**
 * Reedição com preservação de progresso (§5, aceite F2#2): SELECT ... FOR
 * UPDATE dos cards, matching em duas passadas (keep/transfer/reactivate/
 * create/remove) e aplicação do plano na MESMA transação.
 */
export async function updateNote(
  userId: string,
  input: UpdateNoteInput,
  runUser: UserRunner = withUserTransaction,
): Promise<NoteMutationResult> {
  requireUuid(input.noteId, "identificador da nota");
  const tagNames = input.tagNames?.map(validateTagName);

  return runUser(userId, async (tx) => {
    const note = await requireOwnedNote(tx, userId, input.noteId);
    // noteType NUNCA muda numa edição — erro claro se o kind divergir.
    const content = parseContentAs(note.noteType, input.content);
    const searchText = deriveSearchText(content);
    const derived = deriveCards(content);
    const imageRefs = collectImageReferences(content);

    // #12: assets que a nota JÁ referencia são tolerados mesmo 'failed'/
    // soft-deletados (imagem que quebrou DEPOIS de referenciada não pode
    // impedir a edição); só referências NOVAS passam pela validação.
    const currentRefs = await tx
      .select({ mediaAssetId: mediaReferences.mediaAssetId })
      .from(mediaReferences)
      .where(eq(mediaReferences.noteId, note.id));
    const alreadyReferenced = new Set(currentRefs.map((r) => r.mediaAssetId));
    await requireUsableAssets(tx, userId, imageRefs, alreadyReferenced);

    // FOR UPDATE: trava os cards da nota contra edição concorrente até o COMMIT.
    // Inclui os removed — o plano precisa deles para nunca reutilizar variant.
    const existing: ExistingCardInfo[] = await tx
      .select({
        id: cards.id,
        clozeGroupKey: cards.clozeGroupKey,
        contentFingerprint: cards.contentFingerprint,
        status: cards.status,
        variant: cards.variant,
      })
      .from(cards)
      .where(eq(cards.noteId, note.id))
      .for("update");

    const plan = matchDerivedToExisting(existing, derived);

    for (const k of plan.keep) {
      await tx
        .update(cards)
        .set({ contentFingerprint: k.fingerprint })
        .where(eq(cards.id, k.cardId));
    }
    for (const t of plan.transfer) {
      await tx
        .update(cards)
        .set({ clozeGroupKey: t.newGroupKey, contentFingerprint: t.fingerprint })
        .where(eq(cards.id, t.cardId));
    }
    for (const r of plan.reactivate) {
      await tx
        .update(cards)
        .set({ status: "active", clozeGroupKey: r.newGroupKey, contentFingerprint: r.fingerprint })
        .where(eq(cards.id, r.cardId));
    }
    if (plan.create.length > 0) {
      await tx.insert(cards).values(
        plan.create.map((c) => ({
          noteId: note.id,
          ownerUserId: userId,
          variant: c.variant,
          clozeGroupKey: c.clozeGroupKey,
          contentFingerprint: c.fingerprint,
        })),
      );
    }
    if (plan.remove.length > 0) {
      // NUNCA deleta fisicamente: 'removed' preserva progresso e review_logs.
      await tx.update(cards).set({ status: "removed" }).where(inArray(cards.id, plan.remove));
    }

    await tx
      .update(notes)
      .set({ contentJson: content, searchText })
      .where(eq(notes.id, note.id));

    await syncMediaReferences(tx, userId, note.id, imageRefs);
    if (tagNames !== undefined) {
      await syncNoteTags(tx, userId, note.id, tagNames);
    }

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.update",
      entityType: "note",
      entityId: note.id,
      metadata: {
        kept: plan.keep.length,
        transferred: plan.transfer.length,
        reactivated: plan.reactivate.length,
        created: plan.create.length,
        removed: plan.remove.length,
      },
    });

    const cardIds = await activeCardIdsOf(tx, note.id);
    return { noteId: note.id, cardIds, cardCount: cardIds.length };
  });
}

/** Soft delete (deleted_at) — cards intocados; é o "desfazer criação" do fluxo contínuo. */
export async function deleteNote(
  userId: string,
  input: { noteId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  requireUuid(input.noteId, "identificador da nota");
  await runUser(userId, async (tx) => {
    const note = await requireOwnedNote(tx, userId, input.noteId);
    await tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, note.id));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.delete",
      entityType: "note",
      entityId: note.id,
    });
  });
}

/** Undo do delete: limpa deleted_at. */
export async function restoreNote(
  userId: string,
  input: { noteId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  requireUuid(input.noteId, "identificador da nota");
  await runUser(userId, async (tx) => {
    const note = await requireOwnedNote(tx, userId, input.noteId, { allowDeleted: true });
    if (note.deletedAt === null) {
      throw new Error("a nota não está excluída");
    }
    await tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, note.id));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.restore",
      entityType: "note",
      entityId: note.id,
    });
  });
}

/**
 * Nova nota no MESMO deck com o mesmo conteúdo: cards novos com progresso
 * zero (variants 1..n), tags e media_references copiadas.
 */
export async function duplicateNote(
  userId: string,
  input: { noteId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<NoteMutationResult> {
  requireUuid(input.noteId, "identificador da nota");
  return runUser(userId, async (tx) => {
    const source = await requireOwnedNote(tx, userId, input.noteId);
    const content = parseContentAs(source.noteType, source.contentJson);
    const searchText = deriveSearchText(content);
    const derived = deriveCards(content);

    const [copy] = await tx
      .insert(notes)
      .values({
        ownerUserId: userId,
        deckId: source.deckId,
        noteType: source.noteType,
        contentJson: content,
        searchText,
        // Proveniência preservada na cópia (§9.3).
        sourceType: source.sourceType,
        aiGenerationId: source.aiGenerationId,
        createdByUserId: userId,
      })
      .returning({ id: notes.id });
    if (!copy) throw new Error("falha ao duplicar a nota");

    const insertedCards = await tx
      .insert(cards)
      .values(
        derived.map((d, i) => ({
          noteId: copy.id,
          ownerUserId: userId,
          variant: i + 1,
          clozeGroupKey: d.clozeGroupKey,
          contentFingerprint: d.fingerprint,
        })),
      )
      .returning({ id: cards.id, variant: cards.variant });
    const cardIds = [...insertedCards].sort((a, b) => a.variant - b.variant).map((c) => c.id);

    // Cópia literal das associações da nota de origem (mesma tx).
    const sourceTags = await tx
      .select({ tagId: noteTags.tagId })
      .from(noteTags)
      .where(eq(noteTags.noteId, source.id));
    if (sourceTags.length > 0) {
      await tx
        .insert(noteTags)
        .values(sourceTags.map((t) => ({ noteId: copy.id, tagId: t.tagId, ownerUserId: userId })));
    }
    const sourceRefs = await tx
      .select({
        mediaAssetId: mediaReferences.mediaAssetId,
        slot: mediaReferences.slot,
        altText: mediaReferences.altText,
      })
      .from(mediaReferences)
      .where(eq(mediaReferences.noteId, source.id));
    if (sourceRefs.length > 0) {
      await tx.insert(mediaReferences).values(
        sourceRefs.map((r) => ({
          mediaAssetId: r.mediaAssetId,
          noteId: copy.id,
          slot: r.slot,
          ownerUserId: userId,
          altText: r.altText,
        })),
      );
    }

    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.duplicate",
      entityType: "note",
      entityId: copy.id,
      metadata: { sourceNoteId: source.id },
    });

    return { noteId: copy.id, cardIds, cardCount: cardIds.length };
  });
}

/** Move a nota para outro deck DO USUÁRIO; cards não mudam. */
export async function moveNote(
  userId: string,
  input: { noteId: string; targetDeckId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  requireUuid(input.noteId, "identificador da nota");
  requireUuid(input.targetDeckId, "baralho");
  await runUser(userId, async (tx) => {
    const note = await requireOwnedNote(tx, userId, input.noteId);
    await requireOwnedDeck(tx, userId, input.targetDeckId);
    if (note.deckId === input.targetDeckId) return; // já está lá — no-op
    await tx.update(notes).set({ deckId: input.targetDeckId }).where(eq(notes.id, note.id));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "note.move",
      entityType: "note",
      entityId: note.id,
      metadata: { fromDeckId: note.deckId, toDeckId: input.targetDeckId },
    });
  });
}

export interface NoteListItem {
  id: string;
  noteType: NoteType;
  preview: string;
  cardCount: number;
  updatedAt: Date;
}

/** Notas não deletadas do deck (dono checado), updated_at desc, com contagem de cards ativos. */
export async function listNotes(
  userId: string,
  input: { deckId: string; limit?: number; offset?: number },
  runUser: UserRunner = withUserTransaction,
): Promise<NoteListItem[]> {
  requireUuid(input.deckId, "baralho");
  const { limit, offset } = validatePagination(input.limit, input.offset);
  return runUser(userId, async (tx) => {
    await requireOwnedDeck(tx, userId, input.deckId);
    return tx
      .select({
        id: notes.id,
        noteType: notes.noteType,
        preview: sql<string>`left(${notes.searchText}, 200)`,
        cardCount: sql<number>`count(${cards.id})`.mapWith(Number),
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .leftJoin(cards, and(eq(cards.noteId, notes.id), eq(cards.status, "active")))
      .where(
        and(eq(notes.deckId, input.deckId), eq(notes.ownerUserId, userId), isNull(notes.deletedAt)),
      )
      .groupBy(notes.id)
      .orderBy(desc(notes.updatedAt))
      .limit(limit)
      .offset(offset);
  });
}

export interface NoteSearchItem {
  id: string;
  deckId: string;
  noteType: NoteType;
  preview: string;
  updatedAt: Date;
}

/**
 * Busca FTS em português no acervo próprio (aceite F2#7). A expressão do WHERE
 * é EXATAMENTE a do índice GIN notes_search_idx — to_tsvector('portuguese',
 * search_text) — para o planner poder usá-lo (Bitmap Index Scan).
 */
export async function searchNotes(
  userId: string,
  input: { query: string; deckId?: string; limit?: number; offset?: number },
  runUser: UserRunner = withUserTransaction,
): Promise<NoteSearchItem[]> {
  const query = input.query.trim();
  if (query.length === 0) {
    throw new Error("informe o termo de busca");
  }
  if (input.deckId !== undefined) requireUuid(input.deckId, "baralho");
  const { limit, offset } = validatePagination(input.limit, input.offset);

  return runUser(userId, async (tx) => {
    const conditions: SQL[] = [
      eq(notes.ownerUserId, userId),
      isNull(notes.deletedAt),
      sql`to_tsvector('portuguese', ${notes.searchText}) @@ websearch_to_tsquery('portuguese', ${query})`,
    ];
    if (input.deckId !== undefined) {
      await requireOwnedDeck(tx, userId, input.deckId);
      conditions.push(eq(notes.deckId, input.deckId));
    }
    return tx
      .select({
        id: notes.id,
        deckId: notes.deckId,
        noteType: notes.noteType,
        preview: sql<string>`left(${notes.searchText}, 200)`,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(...conditions))
      .orderBy(desc(notes.updatedAt))
      .limit(limit)
      .offset(offset);
  });
}

export interface NoteForEdit {
  noteId: string;
  deckId: string;
  noteType: NoteType;
  content: NoteContent;
  tagNames: string[];
  /**
   * Keys históricas de TODOS os cards da nota (qualquer status, INCLUINDO
   * 'removed') — achado #9a: o editor une esse conjunto às keys do doc ao
   * gerar key nova, para nunca reciclar key de card removed (colidiria no
   * matching do §5 com o card antigo em vez de virar card novo).
   */
  clozeGroupKeys: string[];
}

/**
 * Nota do usuário (não deletada) com conteúdo parseado e tags — leitura das
 * páginas do editor (server components). MESMO padrão das mutações:
 * withUserTransaction + ownership explícito (owner_user_id no WHERE).
 */
export async function getNoteForEdit(
  userId: string,
  noteId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<NoteForEdit> {
  if (!UUID_RE.test(noteId)) {
    throw new Error("nota não encontrada");
  }
  return runUser(userId, async (tx) => {
    const [note] = await tx
      .select({
        id: notes.id,
        deckId: notes.deckId,
        noteType: notes.noteType,
        contentJson: notes.contentJson,
      })
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.ownerUserId, userId), isNull(notes.deletedAt)))
      .limit(1);
    if (!note) {
      throw new Error("nota não encontrada");
    }
    const content = parseNoteContent(note.contentJson);
    const tagRows = await tx
      .select({ name: tags.name })
      .from(noteTags)
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(and(eq(noteTags.noteId, note.id), eq(noteTags.ownerUserId, userId)))
      .orderBy(asc(tags.name));
    const keyRows = await tx
      .selectDistinct({ clozeGroupKey: cards.clozeGroupKey })
      .from(cards)
      .where(
        and(
          eq(cards.noteId, note.id),
          eq(cards.ownerUserId, userId),
          isNotNull(cards.clozeGroupKey),
        ),
      );
    return {
      noteId: note.id,
      deckId: note.deckId,
      noteType: note.noteType,
      content,
      tagNames: tagRows.map((r) => r.name),
      clozeGroupKeys: keyRows
        .map((r) => r.clozeGroupKey)
        .filter((k): k is string => k !== null)
        .sort(),
    };
  });
}

/** Tags por nota (uma query) — chips da listagem do deck detail. */
export async function tagsForNotes(
  userId: string,
  noteIds: string[],
  runUser: UserRunner = withUserTransaction,
): Promise<Record<string, string[]>> {
  const valid = noteIds.filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return {};
  const rows = await runUser(userId, (tx) =>
    tx
      .select({ noteId: noteTags.noteId, name: tags.name })
      .from(noteTags)
      .innerJoin(tags, eq(tags.id, noteTags.tagId))
      .where(and(inArray(noteTags.noteId, valid), eq(noteTags.ownerUserId, userId)))
      .orderBy(asc(tags.name)),
  );
  const byNote: Record<string, string[]> = {};
  for (const row of rows) {
    (byNote[row.noteId] ??= []).push(row.name);
  }
  return byNote;
}
