import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Google from "next-auth/providers/google";
import { getDb } from "@/db/runtime";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { bootstrapNewUser } from "./bootstrap";

// Config em forma de função: o adapter (e o pool de serviço) só é criado na
// primeira request, nunca no build. O adapter usa EXCLUSIVAMENTE o role
// flashcards_service — flashcards_app não tem grant nas tabelas Auth.js.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb().dbService, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [Google],
  pages: { signIn: "/login" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
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
