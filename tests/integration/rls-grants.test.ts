import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decks, reviewLogs, auditLogs } from "@/db/schema";
import { createTestDatabase, expectDbError, type TestDatabase } from "./helpers/testdb";

/**
 * Aceites F1#5 e F1#6: atributos dos roles, grants append-only e
 * capacidade/limite do role de serviço.
 */
describe("Roles e grants", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    userA = await db.createUser("alice@test.dev");
    userB = await db.createUser("bob@test.dev");
    for (const [user, name] of [
      [userA, "Deck A"],
      [userB, "Deck B"],
    ] as const) {
      await db.clients.withUserTransaction(user, (tx) =>
        tx.insert(decks).values({ ownerUserId: user, name }),
      );
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  it("runtime não é superuser e não tem BYPASSRLS; service não é superuser", async () => {
    const rows = await db.ownerQuery<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname IN ('flashcards_app', 'flashcards_service', 'flashcards_owner')`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.rolname, r]));
    expect(byName.flashcards_app?.rolsuper).toBe(false);
    expect(byName.flashcards_app?.rolbypassrls).toBe(false);
    expect(byName.flashcards_owner?.rolsuper).toBe(false);
    expect(byName.flashcards_owner?.rolbypassrls).toBe(false);
    expect(byName.flashcards_service?.rolsuper).toBe(false);
    expect(byName.flashcards_service?.rolbypassrls).toBe(true);
  });

  it("app não faz UPDATE/DELETE em review_logs (append-only)", async () => {
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) =>
        tx.update(reviewLogs).set({ durationMs: 1 }),
      ),
      /permission denied/i,
    );
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) => tx.delete(reviewLogs)),
      /permission denied/i,
    );
  });

  it("app não faz UPDATE/DELETE em audit_logs (append-only)", async () => {
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) =>
        tx.update(auditLogs).set({ action: "adulterado" }),
      ),
      /permission denied/i,
    );
    await expectDbError(
      db.clients.withUserTransaction(userA, (tx) => tx.delete(auditLogs)),
      /permission denied/i,
    );
  });

  it("app não lê tabelas Auth.js (sessions/users sem grant)", async () => {
    await expectDbError(
      db.clients.dbApp.execute(sql`SELECT * FROM sessions`),
      /permission denied/i,
    );
    await expectDbError(
      db.clients.dbApp.execute(sql`SELECT * FROM users`),
      /permission denied/i,
    );
  });

  it("service (jobs de sistema) lê dados de DOIS usuários; app sem GUC lê zero", async () => {
    const all = await db.clients.withServiceTransaction((tx) =>
      tx.select({ id: decks.id, owner: decks.ownerUserId }).from(decks),
    );
    expect(new Set(all.map((d) => d.owner))).toEqual(new Set([userA, userB]));

    const none = await db.clients.dbApp.select({ id: decks.id }).from(decks);
    expect(none).toHaveLength(0);
  });

  it("service não escreve em tabelas de domínio sem grant (ex.: decks)", async () => {
    await expectDbError(
      db.clients.withServiceTransaction((tx) =>
        tx.insert(decks).values({ ownerUserId: userA, name: "via service" }),
      ),
      /permission denied/i,
    );
  });
});
