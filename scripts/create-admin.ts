/**
 * Cria/atualiza um usuário admin com login por senha e bootstrap completo.
 * Uso: pnpm tsx --env-file=.env scripts/create-admin.ts <username> <senha> [email]
 * (no servidor o .env do app já tem DATABASE_URL_APP/SERVICE)
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/runtime";
import { users } from "@/db/schema";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { hashPassword } from "@/lib/auth/password";

const [username, password, email] = process.argv.slice(2);
if (!username || !password) {
  console.error("uso: tsx scripts/create-admin.ts <username> <senha> [email]");
  process.exit(1);
}

const db = getDb();
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
      .set({ passwordHash, role: "admin" })
      .where(eq(users.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(users)
    .values({ username, passwordHash, role: "admin", name: username, email: email ?? null })
    .returning({ id: users.id });
  if (!created) throw new Error("insert falhou");
  return created.id;
});

await bootstrapNewUser(userId, db.withServiceTransaction);
console.log(`admin '${username}' pronto (id ${userId})`);
await db.end();
