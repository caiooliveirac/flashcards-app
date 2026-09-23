"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_LIMITS } from "@/lib/ai/config";
import { auth } from "@/lib/auth";
import {
  AssistantDisabledError,
  acceptSuggestion,
  proposeLeechRewrite,
  replaceLeech,
  suggestForUser,
  type AssistantSuggestion,
} from "@/features/assistant/service";

/**
 * Actions do Assistente. Falhas degradam com mensagem CALMA (reason) e NUNCA
 * logam erro pro usuário nem bloqueiam a criação manual (requisito do dono).
 */

async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const priorSchema = z.array(
  z.object({
    front: z.string().max(4000),
    back: z.string().max(4000),
    rating: z.number().int().min(0).max(10).nullable(),
  }),
);

const suggestSchema = z.object({
  sourceText: z.string().trim().min(1).max(AI_LIMITS.maxSourceChars),
  mode: z.enum(["initial", "revise", "more"]),
  feedback: z.string().max(AI_LIMITS.maxFeedbackChars).optional(),
  prior: priorSchema.max(50).optional(),
});

export type SuggestActionResult =
  | { ok: true; suggestions: AssistantSuggestion[] }
  | { ok: false; reason: "auth" | "disabled" | "invalid" | "error"; message: string };

export async function suggestCardsAction(input: {
  sourceText: string;
  mode: "initial" | "revise" | "more";
  feedback?: string;
  prior?: Array<{ front: string; back: string; rating: number | null }>;
}): Promise<SuggestActionResult> {
  const userId = await sessionUserId();
  if (!userId) {
    return { ok: false, reason: "auth", message: "Sessão expirada — recarregue a página." };
  }
  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: "Cole algum texto para o assistente." };
  }
  try {
    const suggestions = await suggestForUser(parsed.data);
    return { ok: true, suggestions };
  } catch (err) {
    if (err instanceof AssistantDisabledError) {
      return {
        ok: false,
        reason: "disabled",
        message: "O assistente está indisponível no momento.",
      };
    }
    // Sem stack trace pro usuário; só um aviso de servidor discreto.
    console.warn("[assistant] falha ao sugerir cards:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      reason: "error",
      message: "Não consegui gerar agora. Tente de novo ou reformule o texto.",
    };
  }
}

const acceptSchema = z.object({
  deckId: z.uuid({ message: "baralho inválido" }),
  noteType: z.enum(["basic", "cloze"]),
  content: z.unknown(),
  tagNames: z.array(z.string().max(200)).max(50).optional(),
});

export type AcceptActionResult =
  | { ok: true; noteId: string; cardCount: number }
  | { ok: false; message: string };

export async function acceptSuggestionAction(input: {
  deckId: string;
  noteType: "basic" | "cloze";
  content: unknown;
  tagNames?: string[];
}): Promise<AcceptActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, message: "Sessão expirada — recarregue a página." };
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "dados inválidos" };
  }
  try {
    const result = await acceptSuggestion(userId, {
      deckId: parsed.data.deckId,
      noteType: parsed.data.noteType,
      content: parsed.data.content,
      tagNames: parsed.data.tagNames,
    });
    revalidatePath("/", "layout");
    return { ok: true, noteId: result.noteId, cardCount: result.cardCount };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "erro ao salvar" };
  }
}

export type LeechProposalResult =
  | { ok: true; diagnosis: string; suggestions: AssistantSuggestion[] }
  | { ok: false; message: string };

/** Diagnostica o card difícil e propõe a reescrita (nada é gravado). */
export async function proposeLeechRewriteAction(input: {
  cardId: string;
}): Promise<LeechProposalResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, message: "Sessão expirada — recarregue a página." };
  const parsed = z.object({ cardId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "card inválido" };
  try {
    const r = await proposeLeechRewrite(userId, parsed.data.cardId);
    return { ok: true, diagnosis: r.diagnosis, suggestions: r.suggestions };
  } catch (err) {
    if (err instanceof AssistantDisabledError) {
      return { ok: false, message: "O Preceptor está indisponível no momento." };
    }
    console.warn("[assistant] falha ao reformular leech:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Não consegui reformular agora. Tente de novo." };
  }
}

const replaceLeechSchema = z.object({
  cardId: z.uuid(),
  suggestions: z
    .array(
      z.object({
        noteType: z.enum(["basic", "cloze"]),
        content: z.unknown(),
        tagNames: z.array(z.string().max(200)).max(50).optional(),
      }),
    )
    .min(1)
    .max(3),
});

export type ReplaceLeechResult = { ok: true; created: number } | { ok: false; message: string };

/** Cria os cards novos no baralho do card difícil e suspende o antigo. */
export async function replaceLeechAction(input: {
  cardId: string;
  suggestions: Array<{ noteType: "basic" | "cloze"; content: unknown; tagNames?: string[] }>;
}): Promise<ReplaceLeechResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, message: "Sessão expirada — recarregue a página." };
  const parsed = replaceLeechSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "dados inválidos" };
  try {
    const r = await replaceLeech(userId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, created: r.created };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "erro ao salvar" };
  }
}
