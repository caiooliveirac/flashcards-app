"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteTag, listTags, renameTag, type TagListItem } from "@/features/tags/service";
import { auth } from "@/lib/auth";

/** Actions finas sobre o serviço de tags. userId vem SEMPRE da sessão. */

export type ActionFailure = { ok: false; error: string };
export type ListTagsActionResult = { ok: true; tags: TagListItem[] } | ActionFailure;
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

/** Sugestões atualizadas para o input de tags do editor. */
export async function listTagsAction(): Promise<ListTagsActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  try {
    return { ok: true, tags: await listTags(userId) };
  } catch (err) {
    return failure(err);
  }
}

const renameTagSchema = z.object({
  tagId: z.uuid({ message: "tag inválida" }),
  name: z.string({ message: "informe o nome da tag" }),
});

export async function renameTagAction(input: {
  tagId: string;
  name: string;
}): Promise<VoidActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = renameTagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await renameTag(userId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

const deleteTagSchema = z.object({ tagId: z.uuid({ message: "tag inválida" }) });

export async function deleteTagAction(input: { tagId: string }): Promise<VoidActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "não autenticado — recarregue a página" };
  const parsed = deleteTagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await deleteTag(userId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
