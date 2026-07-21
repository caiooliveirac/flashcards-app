import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { fsrsProfiles, userPreferences, userProfiles } from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

describe("bootstrap de usuário novo (evento createUser)", () => {
  let db: TestDatabase;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    userId = await db.createUser("nova@test.dev");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("cria profile, preferences e perfil FSRS v1 (21 parâmetros)", async () => {
    await bootstrapNewUser(userId, db.clients.withServiceTransaction);

    const result = await db.clients.withUserTransaction(userId, async (tx) => ({
      profile: await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
      prefs: await tx
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId)),
      fsrs: await tx.select().from(fsrsProfiles).where(eq(fsrsProfiles.userId, userId)),
    }));

    expect(result.profile).toHaveLength(1);
    expect(result.profile[0]?.timezone).toBe("America/Sao_Paulo");
    expect(result.profile[0]?.dayStartHour).toBe(4);
    expect(result.prefs).toHaveLength(1);
    expect(result.prefs[0]?.desiredRetention).toBeCloseTo(0.9);
    expect(result.fsrs).toHaveLength(1);
    expect(result.fsrs[0]?.version).toBe(1);
    expect(result.fsrs[0]?.parameters).toHaveLength(21);
  });

  it("é idempotente (segundo signup do mesmo id não duplica nem falha)", async () => {
    await bootstrapNewUser(userId, db.clients.withServiceTransaction);
    const fsrs = await db.clients.withUserTransaction(userId, (tx) =>
      tx.select().from(fsrsProfiles).where(eq(fsrsProfiles.userId, userId)),
    );
    expect(fsrs).toHaveLength(1);
  });
});
