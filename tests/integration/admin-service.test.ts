import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getUserFlashcards, listUsers, setUserPassword } from "@/features/admin/service";
import { auditLogs, decks, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

describe("admin service (backoffice auditado)", () => {
  let db: TestDatabase;
  let adminId: string;
  let alvoId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    adminId = await db.createUser("admin@test.dev");
    alvoId = await db.createUser("alvo@test.dev");
    await db.clients.withServiceTransaction(async (tx) => {
      await tx.update(users).set({ role: "admin", username: "admin" }).where(eq(users.id, adminId));
    });
    await db.clients.withUserTransaction(alvoId, async (tx) => {
      await tx.insert(decks).values({ ownerUserId: alvoId, name: "Cardio" });
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("listUsers devolve todos com flag de senha", async () => {
    const rows = await listUsers(db.clients.withServiceTransaction);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.hasPassword === false)).toBe(true);
  });

  it("setUserPassword grava hash verificável e audita com o actor", async () => {
    await setUserPassword(adminId, alvoId, "nova-senha", db.clients.withServiceTransaction);

    const { hash, audit } = await db.clients.withServiceTransaction(async (tx) => {
      const [u] = await tx
        .select({ hash: users.passwordHash })
        .from(users)
        .where(eq(users.id, alvoId));
      const [a] = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "admin.set_password"))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      return { hash: u?.hash, audit: a };
    });

    expect(hash).toBeTruthy();
    expect(await verifyPassword("nova-senha", hash!)).toBe(true);
    expect(audit?.actorUserId).toBe(adminId);
    expect(audit?.entityId).toBe(alvoId);
  });

  it("setUserPassword rejeita senha curta e alvo inexistente", async () => {
    await expect(
      setUserPassword(adminId, alvoId, "123", db.clients.withServiceTransaction),
    ).rejects.toThrow(/curta/);
    await expect(
      setUserPassword(adminId, crypto.randomUUID(), "abcd", db.clients.withServiceTransaction),
    ).rejects.toThrow(/não encontrado/);
  });

  it("getUserFlashcards devolve os baralhos do alvo e audita a visualização", async () => {
    const content = await getUserFlashcards(adminId, alvoId, db.clients.withServiceTransaction);
    expect(content.user.id).toBe(alvoId);
    expect(content.decks.map((d) => d.name)).toEqual(["Cardio"]);

    const audit = await db.clients.withServiceTransaction((tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "admin.view_flashcards"))
        .orderBy(desc(auditLogs.id))
        .limit(1),
    );
    expect(audit[0]?.actorUserId).toBe(adminId);
    expect(audit[0]?.entityId).toBe(alvoId);
  });
});
