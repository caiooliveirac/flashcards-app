import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { cards, notes, noteTags, tags } from "@/db/schema";
import { parseNoteContent, type NoteContent } from "@/lib/content";
import type { NoteType } from "@/features/notes/service";

/**
 * Queries de leitura das páginas do editor (server components). O serviço de
 * notas não expõe getNote com content_json (débito registrado no relatório do
 * orquestrador) — enquanto isso, as leituras vivem aqui, no MESMO padrão:
 * withUserTransaction + ownership explícito (owner_user_id no WHERE).
 */

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Nota do usuário (não deletada) com conteúdo parseado e tags — p/ o editor. */
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
