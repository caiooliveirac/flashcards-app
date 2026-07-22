import { suggestCards, type PriorCard, type SuggestMode } from "@/lib/ai/card-suggester";
import { isAiEnabled } from "@/lib/ai/config";
import type { SuggestedCard } from "@/lib/ai/suggestion-schema";
import { convertSuggestion } from "@/lib/ai/to-note-content";
import type { NoteContent } from "@/lib/content";
import { createNote, type NoteType } from "@/features/notes/service";

/**
 * Serviço do Assistente de criação de cards (Fase 5). Orquestra o suggester e
 * a persistência via createNote (sourceType='ai'). userId vem SEMPRE da sessão.
 */

export interface AssistantSuggestion {
  noteType: NoteType;
  content: NoteContent;
  tags: string[];
  preview: { front: string; back: string };
}

export interface SuggestInput {
  sourceText: string;
  mode: SuggestMode;
  feedback?: string;
  prior?: PriorCard[];
}

export async function suggestForUser(input: SuggestInput): Promise<AssistantSuggestion[]> {
  if (!isAiEnabled()) {
    throw new AssistantDisabledError();
  }
  const { cards } = await suggestCards({
    sourceText: input.sourceText,
    mode: input.mode,
    feedback: input.feedback,
    prior: input.prior,
  });
  return cards.map((c) => ({
    noteType: c.noteType,
    content: c.content,
    tags: c.tags,
    preview: c.preview,
  }));
}

export class AssistantDisabledError extends Error {
  constructor() {
    super("assistente desativado");
    this.name = "AssistantDisabledError";
  }
}

export interface AcceptInput {
  deckId: string;
  noteType: NoteType;
  /** Árvore NoteContentV1 — revalidada por createNote na fronteira do service. */
  content: unknown;
  tagNames?: string[];
}

/**
 * HANDOFF (costura nº1) para o assistente tira-dúvidas do outro agente.
 * Cria um card a partir de um rascunho em TEXTO SIMPLES — o chamador não precisa
 * conhecer a árvore NoteContentV1. Faz a conversão determinística e persiste com
 * sourceType='ai'. Lança se o rascunho não formar um card válido.
 *
 * - kind "basic": use `front` (pergunta) e `back` (resposta).
 * - kind "cloze": use `text` com ocultações {{assim}} ou {{assim::dica}}.
 */
export interface CardDraft {
  deckId: string;
  kind: "basic" | "cloze";
  front?: string;
  back?: string;
  text?: string;
  tags?: string[];
}

export async function createCardFromDraft(
  userId: string,
  input: CardDraft,
): Promise<{ noteId: string; cardCount: number; noteType: NoteType }> {
  const draft: SuggestedCard = {
    kind: input.kind,
    front: input.front ?? "",
    back: input.back ?? "",
    text: input.text ?? "",
    tags: input.tags ?? [],
  };
  const converted = convertSuggestion(draft);
  if (!converted) {
    throw new Error(
      "rascunho inválido: basic precisa de frente; cloze precisa de ao menos uma {{ocultação}}",
    );
  }
  const result = await createNote(userId, {
    deckId: input.deckId,
    noteType: converted.noteType,
    content: converted.content,
    tagNames: converted.tags,
    source: { type: "ai" },
  });
  return { noteId: result.noteId, cardCount: result.cardCount, noteType: converted.noteType };
}

/** Persiste uma sugestão como nota com proveniência de IA (aceite 2). */
export async function acceptSuggestion(
  userId: string,
  input: AcceptInput,
): Promise<{ noteId: string; cardCount: number }> {
  const result = await createNote(userId, {
    deckId: input.deckId,
    noteType: input.noteType,
    content: input.content,
    tagNames: input.tagNames,
    source: { type: "ai" },
  });
  return { noteId: result.noteId, cardCount: result.cardCount };
}
