import { randomBytes } from "node:crypto";
import os from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { createDbClients, type DbClients } from "@/db/client";
import { users } from "@/db/schema";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;

const TEST_ROLE_PASSWORD = "flashcards_test";

/**
 * Espera que a promise falhe com erro de banco casando o pattern. O drizzle
 * embrulha o erro do Postgres (DrizzleQueryError) — inspeciona a cadeia .cause.
 */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  let failed = false;
  try {
    await p;
  } catch (err) {
    failed = true;
    const messages: string[] = [];
    let e: unknown = err;
    while (e instanceof Error) {
      messages.push(e.message);
      e = e.cause;
    }
    const all = messages.join(" | ");
    if (!pattern.test(all)) {
      throw new Error(`erro do banco não corresponde a ${pattern}: ${all}`);
    }
  }
  if (!failed) {
    throw new Error(`esperava erro ${pattern}, mas a operação foi permitida`);
  }
}

export interface TestDatabase {
  clients: DbClients;
  dbName: string;
  ownerUrl: string;
  /** Query arbitrária como owner (ex.: inspecionar pg_class). */
  ownerQuery: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Cria um usuário via service role e devolve o id. */
  createUser: (email: string) => Promise<string>;
  drop: () => Promise<void>;
}

function roleUrl(role: string, dbName: string): string {
  const parsed = new URL(ADMIN_URL.replace(/^postgres(ql)?:/, "http:"));
  const host = parsed.hostname || "localhost";
  const port = parsed.port || "5432";
  return `postgres://${role}:${TEST_ROLE_PASSWORD}@${host}:${port}/${dbName}`;
}

async function ensureRoles(admin: Client): Promise<void> {
  const roles: Array<[string, string]> = [
    ["flashcards_owner", "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"],
    ["flashcards_app", "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"],
    ["flashcards_service", "NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS"],
    ["flashcards_backup", "NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS"],
  ];
  for (const [name, attrs] of roles) {
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${name}') THEN
           CREATE ROLE ${name} LOGIN;
         END IF;
       END $$;`,
    );
    await admin.query(`ALTER ROLE ${name} LOGIN PASSWORD '${TEST_ROLE_PASSWORD}' ${attrs}`);
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const dbName = `flashcards_test_${randomBytes(6).toString("hex")}`;

  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await ensureRoles(admin);
  await admin.query(`CREATE DATABASE ${dbName} OWNER flashcards_owner`);
  await admin.end();

  const ownerUrl = roleUrl("flashcards_owner", dbName);
  const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
  await migrate(drizzle(ownerPool), { migrationsFolder: "src/db/migrations" });

  const clients = createDbClients({
    appUrl: roleUrl("flashcards_app", dbName),
    serviceUrl: roleUrl("flashcards_service", dbName),
    // max 1: torna determinístico o teste de vazamento de contexto no pool.
    appPoolMax: 1,
    servicePoolMax: 1,
  });

  return {
    clients,
    dbName,
    ownerUrl,
    ownerQuery: async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const res = await ownerPool.query(sql, params);
      return res.rows as T[];
    },
    createUser: async (email: string) => {
      const [row] = await clients.dbService
        .insert(users)
        .values({ email, name: email.split("@")[0] })
        .returning({ id: users.id });
      if (!row) throw new Error("falha ao criar usuário de teste");
      return row.id;
    },
    drop: async () => {
      await clients.end();
      await ownerPool.end();
      const admin2 = new Client({ connectionString: ADMIN_URL });
      await admin2.connect();
      await admin2.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin2.end();
    },
  };
}
