/**
 * Seed idempotente para os testes E2E (Playwright).
 * Uso: pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-e2e.ts
 *
 * Garante os usuários 'e2e' e 'e2e-b' (senha '1234') com bootstrap completo,
 * seguindo o padrão de scripts/create-admin.ts. NÃO cria decks — cada run de
 * teste cria os seus com nomes únicos (Date.now()).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/runtime";
import { users } from "@/db/schema";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { hashPassword } from "@/lib/auth/password";

const USERS: Array<{ username: string; password: string }> = [
  { username: "e2e", password: "1234" },
  { username: "e2e-b", password: "1234" },
];

const db = getDb();

for (const { username, password } of USERS) {
  const passwordHash = await hashPassword(password);
  const userId = await db.withServiceTransaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (existing) {
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, existing.id));
      return existing.id;
    }
    const [created] = await tx
      .insert(users)
      .values({ username, passwordHash, role: "admin", name: username, email: null })
      .returning({ id: users.id });
    if (!created) throw new Error(`insert de '${username}' falhou`);
    return created.id;
  });
  await bootstrapNewUser(userId, db.withServiceTransaction);
  console.log(`e2e user '${username}' pronto (id ${userId})`);
}

await db.end();
