import { generatorParameters } from "ts-fsrs";
import type { Tx } from "@/db/client";
import { withServiceTransaction } from "@/db/runtime";
import { auditLogs, fsrsProfiles, userPreferences, userProfiles } from "@/db/schema";

type ServiceRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * Cria as linhas 1:1 de um usuário recém-registrado (profile, preferences e
 * perfil FSRS default v1 com os 21 parâmetros do FSRS-6 vindos do ts-fsrs).
 * Roda como serviço (evento createUser do Auth.js — antes de existir sessão).
 * Idempotente: onConflictDoNothing.
 */
export async function bootstrapNewUser(
  userId: string,
  runService: ServiceRunner = withServiceTransaction,
): Promise<void> {
  const params = generatorParameters();
  await runService(async (tx) => {
    await tx.insert(userProfiles).values({ userId }).onConflictDoNothing();
    await tx.insert(userPreferences).values({ userId }).onConflictDoNothing();
    await tx
      .insert(fsrsProfiles)
      .values({
        userId,
        version: 1,
        parameters: [...params.w],
        desiredRetention: params.request_retention,
        source: "default",
        active: true,
      })
      .onConflictDoNothing();
    await tx.insert(auditLogs).values({
      actorUserId: null,
      action: "user.bootstrap",
      entityType: "user",
      entityId: userId,
    });
  });
}
