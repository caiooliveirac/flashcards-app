import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { getDb } from "@/db/runtime";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { bootstrapNewUser } from "./bootstrap";
import { verifyPassword } from "./password";

/** Google só entra quando houver credencial real configurada. */
export function isGoogleEnabled(): boolean {
  const id = process.env.AUTH_GOOGLE_ID;
  return Boolean(id) && id !== "pendente-criar-no-gcp";
}

const credentialsSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

// Sessão JWT (não database): é o modo suportado para Credentials no Auth.js v5
// — o provider de senha não cria linha em `sessions`. O adapter continua
// persistindo users/accounts dos logins OAuth.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb().dbService, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    ...(isGoogleEnabled() ? [Google] : []),
    Credentials({
      name: "Usuário e senha",
      credentials: {
        username: { label: "Usuário" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const user = await getDb().withServiceTransaction(async (tx) => {
          const [row] = await tx
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.username, username))
            .limit(1);
          return row ?? null;
        });
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: "user" | "admin" }).role ?? "user";
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      session.user.role = (token.role as "user" | "admin" | undefined) ?? "user";
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) {
        await bootstrapNewUser(user.id);
      }
    },
  },
}));
