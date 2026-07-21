import { desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withServiceTransaction } from "@/db/runtime";
import { auditLogs, cards, decks, notes, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

type ServiceRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Backoffice do administrador (dono do produto). TODA leitura de conteúdo de
 * usuário e toda troca de senha gera linha em audit_logs com o actor — o
 * acesso existe, mas nunca é silencioso (decisão D24).
 */

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  role: "user" | "admin";
  hasPassword: boolean;
  createdAt: Date;
}

export async function listUsers(
  runService: ServiceRunner = withServiceTransaction,
): Promise<AdminUserRow[]> {
  return runService(async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        username: users.username,
        role: users.role,
        hasPassword: isNotNull(users.passwordHash),
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return rows.map((r) => ({ ...r, hasPassword: Boolean(r.hasPassword) }));
  });
}

export async function setUserPassword(
  adminUserId: string,
  targetUserId: string,
  newPassword: string,
  runService: ServiceRunner = withServiceTransaction,
): Promise<void> {
  if (newPassword.length < 4) {
    throw new Error("senha muito curta");
  }
  const passwordHash = await hashPassword(newPassword);
  await runService(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, targetUserId))
      .returning({ id: users.id });
    if (!updated) throw new Error("usuário não encontrado");
    await tx.insert(auditLogs).values({
      actorUserId: adminUserId,
      action: "admin.set_password",
      entityType: "user",
      entityId: targetUserId,
    });
  });
}

export interface AdminUserContent {
  user: { id: string; name: string | null; email: string | null; username: string | null };
  decks: Array<{
    id: string;
    name: string;
    status: string;
    noteCount: number;
    cardCount: number;
  }>;
}

export async function getUserFlashcards(
  adminUserId: string,
  targetUserId: string,
  runService: ServiceRunner = withServiceTransaction,
): Promise<AdminUserContent> {
  return runService(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!user) throw new Error("usuário não encontrado");

    const deckRows = await tx
      .select({
        id: decks.id,
        name: decks.name,
        status: decks.status,
        noteCount: sql<number>`count(distinct ${notes.id})`.mapWith(Number),
        cardCount: sql<number>`count(distinct ${cards.id})`.mapWith(Number),
      })
      .from(decks)
      .leftJoin(notes, eq(notes.deckId, decks.id))
      .leftJoin(cards, eq(cards.noteId, notes.id))
      .where(eq(decks.ownerUserId, targetUserId))
      .groupBy(decks.id)
      .orderBy(decks.name);

    await tx.insert(auditLogs).values({
      actorUserId: adminUserId,
      action: "admin.view_flashcards",
      entityType: "user",
      entityId: targetUserId,
    });

    return { user, decks: deckRows };
  });
}
