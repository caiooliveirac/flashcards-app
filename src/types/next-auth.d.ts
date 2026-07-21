import type { DefaultSession } from "next-auth";

type AppRole = "user" | "admin";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: AppRole } & DefaultSession["user"];
  }
  interface User {
    role?: AppRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
  }
}
