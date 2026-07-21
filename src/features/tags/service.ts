import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withUserTransaction } from "@/db/runtime";
import { auditLogs, notes, noteTags, tags } from "@/db/schema";

type UserRunner = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Serviço de tags (arquitetura §3.3/§6.2): tags são POR USUÁRIO
 * (UNIQUE(owner_user_id, name)); userId vem SEMPRE da sessão. Ownership
 * checado explicitamente além da RLS (§6.3).
 */

export const MAX_TAG_NAME_LENGTH = 120;

/**
 * Normalização canônica de nome de tag: trim + colapsa whitespace em espaço
 * único. Caixa PRESERVADA — a unicidade (owner, name) é exata, não case-fold.
 */
export function normalizeTagName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Normaliza e valida com mensagens pt-BR; retorna o nome canônico. */
export function validateTagName(name: string): string {
  const normalized = normalizeTagName(name);
  if (normalized.length === 0) {
    throw new Error("informe o nome da tag");
  }
  if (normalized.length > MAX_TAG_NAME_LENGTH) {
    throw new Error(`o nome da tag deve ter no máximo ${MAX_TAG_NAME_LENGTH} caracteres`);
  }
  return normalized;
}

async function requireOwnedTag(
  tx: Tx,
  userId: string,
  tagId: string,
): Promise<{ id: string; name: string }> {
  const [tag] = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.ownerUserId, userId)))
    .limit(1);
  if (!tag) {
    throw new Error("tag não encontrada");
  }
  return tag;
}

export interface TagListItem {
  id: string;
  name: string;
  noteCount: number;
}

/** Tags do usuário com contagem de notas NÃO deletadas associadas. */
export async function listTags(
  userId: string,
  runUser: UserRunner = withUserTransaction,
): Promise<TagListItem[]> {
  return runUser(userId, (tx) =>
    tx
      .select({
        id: tags.id,
        name: tags.name,
        noteCount: sql<number>`count(${notes.id}) filter (where ${notes.deletedAt} is null)`.mapWith(
          Number,
        ),
      })
      .from(tags)
      .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
      .leftJoin(notes, eq(notes.id, noteTags.noteId))
      .where(eq(tags.ownerUserId, userId))
      .groupBy(tags.id)
      .orderBy(asc(tags.name)),
  );
}

export async function renameTag(
  userId: string,
  input: { tagId: string; name: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  const name = validateTagName(input.name);
  await runUser(userId, async (tx) => {
    const tag = await requireOwnedTag(tx, userId, input.tagId);
    if (tag.name !== name) {
      const [conflict] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.ownerUserId, userId), eq(tags.name, name), ne(tags.id, tag.id)))
        .limit(1);
      if (conflict) {
        throw new Error("já existe uma tag com esse nome");
      }
      await tx.update(tags).set({ name }).where(eq(tags.id, tag.id));
    }
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "tag.rename",
      entityType: "tag",
      entityId: tag.id,
      metadata: { from: tag.name, to: name },
    });
  });
}

/** Apaga a tag e as associações note_tags na MESMA transação. */
export async function deleteTag(
  userId: string,
  input: { tagId: string },
  runUser: UserRunner = withUserTransaction,
): Promise<void> {
  await runUser(userId, async (tx) => {
    const tag = await requireOwnedTag(tx, userId, input.tagId);
    await tx.delete(noteTags).where(eq(noteTags.tagId, tag.id));
    await tx.delete(tags).where(eq(tags.id, tag.id));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "tag.delete",
      entityType: "tag",
      entityId: tag.id,
      metadata: { name: tag.name },
    });
  });
}
