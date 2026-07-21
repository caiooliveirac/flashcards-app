import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { withServiceTransaction } from "@/db/runtime";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";

/**
 * Autorização de admin: além do role no JWT, revalida no banco a cada uso —
 * rebaixar um admin tem efeito imediato, sem esperar expirar o token.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const role = await withServiceTransaction(async (tx) => {
    const [row] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    return row?.role;
  });
  if (role !== "admin") {
    redirect("/");
  }
  return session;
}
