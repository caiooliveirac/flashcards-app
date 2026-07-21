import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * Invariante transversal (roda em TODA fase): qualquer tabela nova fora da
 * allowlist precisa nascer com RLS + FORCE RLS. No Drizzle 0.45 uma tabela
 * sem pgPolicy nasce SEM RLS e fica 100% acessível ao runtime — este teste
 * é o que acusa o esquecimento.
 */
const RLS_ALLOWLIST = new Set([
  // Auth.js: acessadas só pelo flashcards_service (sem grants ao app)
  "users",
  "accounts",
  "sessions",
  "verification_tokens",
]);

describe("RLS: invariante de cobertura", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.drop();
  });

  it("toda tabela fora da allowlist tem RLS + FORCE RLS", async () => {
    const rows = await db.ownerQuery<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY c.relname`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const missing = rows.filter(
      (r) => !RLS_ALLOWLIST.has(r.relname) && !(r.relrowsecurity && r.relforcerowsecurity),
    );
    expect(
      missing.map((m) => m.relname),
      "tabelas sem RLS+FORCE (adicione pgPolicy + FORCE na migration do MESMO PR)",
    ).toEqual([]);
  });

  it("toda tabela protegida tem ao menos uma policy", async () => {
    const rows = await db.ownerQuery<{ relname: string; polcount: string }>(
      `SELECT c.relname, count(p.oid) AS polcount
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        GROUP BY c.relname`,
    );
    const missing = rows.filter(
      (r) => !RLS_ALLOWLIST.has(r.relname) && Number(r.polcount) === 0,
    );
    expect(missing.map((m) => m.relname)).toEqual([]);
  });
});
