import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withServiceTransaction } from "@/db/runtime";
import { auditLogs, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { MIN_PASSWORD_LENGTH } from "./constants";

type ServiceRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type ChangePasswordError =
  | "wrong_current"
  | "too_short"
  | "same_as_current"
  | "no_password";

/**
 * Troca a própria senha: exige a senha atual (defesa contra sessão sequestrada)
 * e registra em audit_logs com o próprio usuário como actor. Escopo estrito ao
 * `userId` da sessão — nunca recebe um alvo arbitrário como o fluxo do admin.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  runService: ServiceRunner = withServiceTransaction,
): Promise<{ ok: true } | { ok: false; error: ChangePasswordError }> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "too_short" };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "same_as_current" };
  }

  return runService(async (tx) => {
    const [row] = await tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row?.passwordHash) {
      // Conta sem senha (ex.: só OAuth): não há "senha atual" para conferir.
      return { ok: false as const, error: "no_password" as const };
    }
    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      return { ok: false as const, error: "wrong_current" as const };
    }

    const passwordHash = await hashPassword(newPassword);
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx.insert(auditLogs).values({
      actorUserId: userId,
      action: "user.change_password",
      entityType: "user",
      entityId: userId,
    });
    return { ok: true as const };
  });
}
