import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password (scrypt)", () => {
  it("hash e verificação fazem round-trip", async () => {
    const hash = await hashPassword("senha-forte-123");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("senha-forte-123", hash)).toBe(true);
  });

  it("senha errada não verifica", async () => {
    const hash = await hashPassword("correta");
    expect(await verifyPassword("errada", hash)).toBe(false);
  });

  it("dois hashes da mesma senha diferem (salt aleatório)", async () => {
    const a = await hashPassword("x");
    const b = await hashPassword("x");
    expect(a).not.toBe(b);
    expect(await verifyPassword("x", a)).toBe(true);
    expect(await verifyPassword("x", b)).toBe(true);
  });

  it("hash adulterado/malformado não verifica nem lança", async () => {
    expect(await verifyPassword("x", "lixo")).toBe(false);
    expect(await verifyPassword("x", "scrypt:16384:8:1::")).toBe(false);
    const hash = await hashPassword("x");
    const tampered = hash.slice(0, -4) + "AAAA";
    expect(await verifyPassword("x", tampered)).toBe(false);
  });
});
