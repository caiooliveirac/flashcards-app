import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Sempre executado como flashcards_owner (dono do schema). Nunca `drizzle-kit push`.
async function main() {
  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_OWNER (ou DATABASE_URL) não definida");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
    console.log("Migrations aplicadas.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
