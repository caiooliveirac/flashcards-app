"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deckStatus } from "@/db/schema";
import {
  createDeck,
  deleteDeck,
  reorderDeck,
  updateDeck,
  updateDeckSettings,
} from "@/features/decks/service";
import { auth } from "@/lib/auth";

/** userId SEMPRE da sessão (nunca do cliente). */
async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect("/login");
  }
  return userId;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "erro inesperado";
}

/** FormData.get devolve null p/ campo ausente — normaliza para undefined. */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

// Campo numérico opcional de formulário: "" => null (limpa o override).
const nullableNumber = z.preprocess(
  (v) => (v === "" || v === undefined ? null : Number(v)),
  z.number({ message: "valor numérico inválido" }).nullable(),
);

const createDeckSchema = z.object({
  name: z.string({ message: "informe o nome do baralho" }),
  description: z.string().optional(),
});

const updateDeckSchema = z.object({
  deckId: z.uuid({ message: "baralho inválido" }),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(deckStatus.enumValues, { message: "status inválido" }).optional(),
});

const updateDeckSettingsSchema = z.object({
  deckId: z.uuid({ message: "baralho inválido" }),
  desiredRetentionOverride: nullableNumber,
  newPerDayOverride: nullableNumber,
  maxReviewsPerDayOverride: nullableNumber,
  weeklyNewCardsGoal: nullableNumber,
  suggestionsEnabled: z.enum(["on", "off"]),
  examDate: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().nullable(),
  ),
});

const deckIdSchema = z.object({ deckId: z.uuid({ message: "baralho inválido" }) });

const reorderSchema = z.object({
  deckId: z.uuid({ message: "baralho inválido" }),
  direction: z.enum(["up", "down"], { message: "direção inválida" }),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "dados inválidos";
}

export async function createDeckAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = createDeckSchema.safeParse({
    name: field(formData, "name"),
    description: field(formData, "description"),
  });
  if (!parsed.success) {
    redirect(`/decks/new?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  let failure: string | null = null;
  try {
    await createDeck(userId, parsed.data);
  } catch (err) {
    failure = errorMessage(err);
  }
  if (failure) {
    redirect(`/decks/new?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath("/");
  redirect("/");
}

export async function updateDeckAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = updateDeckSchema.safeParse({
    deckId: field(formData, "deckId"),
    name: field(formData, "name"),
    description: field(formData, "description"),
    status: field(formData, "status"),
  });
  if (!parsed.success) {
    redirect(`/?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  const { deckId, name, description, status } = parsed.data;
  let failure: string | null = null;
  try {
    await updateDeck(userId, { deckId, name, description, status });
  } catch (err) {
    failure = errorMessage(err);
  }
  if (failure) {
    redirect(`/decks/${deckId}/edit?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath("/");
  redirect("/");
}

export async function updateDeckSettingsAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = updateDeckSettingsSchema.safeParse({
    deckId: field(formData, "deckId"),
    desiredRetentionOverride: field(formData, "desiredRetentionOverride"),
    newPerDayOverride: field(formData, "newPerDayOverride"),
    maxReviewsPerDayOverride: field(formData, "maxReviewsPerDayOverride"),
    weeklyNewCardsGoal: field(formData, "weeklyNewCardsGoal"),
    // Checkbox com hidden fallback "off": o valor marcado vem por último.
    suggestionsEnabled: formData.getAll("suggestionsEnabled").at(-1) ?? "off",
    examDate: field(formData, "examDate"),
  });
  if (!parsed.success) {
    redirect(`/?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  const { deckId, suggestionsEnabled, ...overrides } = parsed.data;
  let failure: string | null = null;
  try {
    await updateDeckSettings(userId, {
      deckId,
      ...overrides,
      suggestionsEnabled: suggestionsEnabled === "on",
    });
  } catch (err) {
    failure = errorMessage(err);
  }
  if (failure) {
    redirect(`/decks/${deckId}/edit?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath("/");
  redirect(`/decks/${deckId}/edit?saved=1`);
}

export async function deleteDeckAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = deckIdSchema.safeParse({ deckId: field(formData, "deckId") });
  if (!parsed.success) {
    redirect(`/?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  let failure: string | null = null;
  try {
    await deleteDeck(userId, parsed.data);
  } catch (err) {
    failure = errorMessage(err);
  }
  if (failure) {
    redirect(`/?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath("/");
  redirect("/");
}

export async function reorderDeckAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = reorderSchema.safeParse({
    deckId: field(formData, "deckId"),
    direction: field(formData, "direction"),
  });
  if (!parsed.success) {
    redirect(`/?error=${encodeURIComponent(firstIssue(parsed.error))}`);
  }
  let failure: string | null = null;
  try {
    await reorderDeck(userId, parsed.data);
  } catch (err) {
    failure = errorMessage(err);
  }
  if (failure) {
    redirect(`/?error=${encodeURIComponent(failure)}`);
  }
  revalidatePath("/");
}
