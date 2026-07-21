import { defineConfig } from "drizzle-kit";

// `generate` não conecta ao banco; `migrate` usa src/db/migrate.ts (role owner).
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL_OWNER ??
      "postgres://flashcards_owner@localhost:5432/flashcards",
  },
});
