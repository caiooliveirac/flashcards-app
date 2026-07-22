"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_LIMITS } from "@/lib/ai/config";
import { auth } from "@/lib/auth";
import {
  AssistantDisabledError,
  acceptSuggestion,
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
