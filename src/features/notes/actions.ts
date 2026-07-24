"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createNote,
  deleteNote,
  duplicateNote,
  getNoteForEdit,
  moveNote,
  restoreNote,
  updateNote,
} from "@/features/notes/service";
import { listTags } from "@/features/tags/service";
import { auth } from "@/lib/auth";
import { noteContentToPmDocs, type NotePmDocs } from "@/lib/editor/parse";
import { mediaMaxBytes } from "@/lib/storage/types";

/**
 * Actions finas sobre o serviço de notas (fluxos §13.1-2). São chamadas
 * PROGRAMATICAMENTE pelo editor client (fluxo contínuo: salvar → toast →
 * limpar → foco, sem navegação), por isso devolvem resultado estruturado
 * em vez de redirect. userId vem SEMPRE da sessão.
 */

export type ActionFailure = { ok: false; error: string };
export type NoteMutationActionResult =
  | { ok: true; noteId: string; cardCount: number }
  | ActionFailure;
export type VoidActionResult = { ok: true } | ActionFailure;

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function failure(err: unknown): ActionFailure {
  return { ok: false, error: err instanceof Error ? err.message : "erro inesperado" };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "dados inválidos";
}

/** Mutações de nota mexem em contagens da home e nas listas de deck. */
function revalidateNoteViews(): void {
  revalidatePath("/", "layout");
}

const tagNamesSchema = z
  .array(z.string().max(200, { message: "tag longa demais" }))
  .max(50, { message: "no máximo 50 tags por nota" })
  .optional();

const createNoteSchema = z.object({
  deckId: z.uuid({ message: "baralho inválido" }),
  noteType: z.enum(["basic", "cloze"], { message: "tipo de nota inválido" }),
  // Árvore NoteContentV1 — o Zod completo roda na fronteira do service.
  content: z.unknown(),
  tagNames: tagNamesSchema,
});

export async function createNoteAction(input: {
  deckId: string;
  noteType: "basic" | "cloze";
  content: unknown;
  tagNames?: string[];
}): Promise<NoteMutationActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const result = await createNote(userId, {
      deckId: parsed.data.deckId,
      noteType: parsed.data.noteType,
      content: parsed.data.content,
      tagNames: parsed.data.tagNames,
    });
    revalidateNoteViews();
    return { ok: true, noteId: result.noteId, cardCount: result.cardCount };
  } catch (err) {
    return failure(err);
  }
}

const updateNoteSchema = z.object({
  noteId: z.uuid({ message: "nota inválida" }),
  content: z.unknown(),
  tagNames: tagNamesSchema,
});

export async function updateNoteAction(input: {
  noteId: string;
  content: unknown;
  tagNames?: string[];
}): Promise<NoteMutationActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const result = await updateNote(userId, {
      noteId: parsed.data.noteId,
      content: parsed.data.content,
      tagNames: parsed.data.tagNames,
    });
    revalidateNoteViews();
    return { ok: true, noteId: result.noteId, cardCount: result.cardCount };
  } catch (err) {
    return failure(err);
  }
}

const noteIdSchema = z.object({ noteId: z.uuid({ message: "nota inválida" }) });

export async function deleteNoteAction(input: { noteId: string }): Promise<VoidActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await deleteNote(userId, parsed.data);
    revalidateNoteViews();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function restoreNoteAction(input: { noteId: string }): Promise<VoidActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await restoreNote(userId, parsed.data);
    revalidateNoteViews();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function duplicateNoteAction(input: {
  noteId: string;
}): Promise<NoteMutationActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const result = await duplicateNote(userId, parsed.data);
    revalidateNoteViews();
    return { ok: true, noteId: result.noteId, cardCount: result.cardCount };
  } catch (err) {
    return failure(err);
  }
}

const moveNoteSchema = z.object({
  noteId: z.uuid({ message: "nota inválida" }),
  targetDeckId: z.uuid({ message: "baralho inválido" }),
});

export async function moveNoteAction(input: {
  noteId: string;
  targetDeckId: string;
}): Promise<VoidActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = moveNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await moveNote(userId, parsed.data);
    revalidateNoteViews();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export type NoteEditorData = {
  noteType: "basic" | "cloze";
  initialDocs: NotePmDocs;
  initialTags: string[];
  clozeGroupKeys: string[];
  maxBytes: number;
  tagSuggestions: string[];
};

export type NoteEditorDataActionResult =
  | { ok: true; data: NoteEditorData }
  | ActionFailure;

/**
 * Dados para abrir o editor de uma nota FORA da rota /notes/[id]/edit — hoje só
 * o modal "Editar card" da sessão de revisão. Empacota o que o server component
 * da página de edição monta (docs PM + tags + sugestões + limite de mídia) para
 * o modal, que é client, poder carregar sob demanda ao abrir. userId da sessão.
 */
export async function getNoteEditorDataAction(input: {
  noteId: string;
}): Promise<NoteEditorDataActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    const [note, tags] = await Promise.all([
      getNoteForEdit(userId, parsed.data.noteId),
      listTags(userId),
    ]);
    return {
      ok: true,
      data: {
        noteType: note.noteType,
        initialDocs: noteContentToPmDocs(note.content),
        initialTags: note.tagNames,
        clozeGroupKeys: note.clozeGroupKeys,
        maxBytes: mediaMaxBytes(),
        tagSuggestions: tags.map((t) => t.name),
      },
    };
  } catch (err) {
    return failure(err);
  }
}
