import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decks } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * O wrapper é a peça que impede o vazamento clássico de RLS com pool:
 * contexto tem que morrer no COMMIT (set_config transaction-local).
 * O pool de teste tem max=1 — a próxima query REUSA a mesma conexão física.
 */
describe("withUserTransaction", () => {
  let db: TestDatabase;
  let userA: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    userA = await db.createUser("alice@test.dev");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("contexto não vaza para a próxima query da mesma conexão do pool", async () => {
    await db.clients.withUserTransaction(userA, async (tx) => {
      const inside = await tx.execute(
        sql`SELECT current_setting('app.current_user_id', true) AS uid`,
      );
      expect(inside.rows[0]?.uid).toBe(userA);
    });

    const after = await db.clients.dbApp.execute(
      sql`SELECT current_setting('app.current_user_id', true) AS uid`,
    );
    // pool max=1: mesma conexão física; sem o 3º arg true isto vazaria.
    expect([null, ""]).toContain(after.rows[0]?.uid);
  });

  it("rejeita userId vazio", async () => {
    await expect(db.clients.withUserTransaction("", async () => 1)).rejects.toThrow(
      /userId/,
    );
  });

  it("erro no callback faz rollback completo", async () => {
    await expect(
      db.clients.withUserTransaction(userA, async (tx) => {
        await tx.insert(decks).values({ ownerUserId: userA, name: "vai sumir" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await db.clients.withUserTransaction(userA, (tx) =>
      tx.select({ id: decks.id }).from(decks),
    );
    expect(rows).toHaveLength(0);
  });
});
