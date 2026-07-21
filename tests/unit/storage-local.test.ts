import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalDriver } from "@/lib/storage/local";
import type { StorageDriver } from "@/lib/storage/types";

/** Lista recursiva de arquivos sob dir (paths relativos). */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)));
  }
  return out.sort();
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("storage local driver", () => {
  let base: string;
  let driver: StorageDriver;

  beforeAll(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "flashcards-storage-"));
    driver = createLocalDriver(base);
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("kind é 'local'; targets são direct/stream", async () => {
    expect(driver.kind).toBe("local");
    expect(await driver.createUploadTarget("staging/abc", { expiresSeconds: 60 })).toEqual({
      mode: "direct",
    });
    expect(await driver.createDownloadTarget("media/u1/abc", { expiresSeconds: 600 })).toEqual({
      mode: "stream",
    });
  });

  it("putObject(Buffer) + head + getStream", async () => {
    await driver.putObject("media/u1/asset1", Buffer.from("conteudo-1"));
    expect(await driver.head("media/u1/asset1")).toEqual({ size: 10 });
    expect((await readAll(await driver.getStream("media/u1/asset1"))).toString()).toBe(
      "conteudo-1",
    );
  });

  it("putObject(Readable) escreve o stream inteiro", async () => {
    const body = Readable.from([Buffer.from("abc"), Buffer.from("def")]);
    await driver.putObject("staging/stream1", body);
    expect(await driver.head("staging/stream1")).toEqual({ size: 6 });
  });

  it("head devolve null para key inexistente", async () => {
    expect(await driver.head("media/u1/nao-existe")).toBeNull();
  });

  it("getRange devolve bytes inclusivos [start, end]", async () => {
    await driver.putObject("media/u1/range", Buffer.from("0123456789"));
    expect((await driver.getRange("media/u1/range", 2, 5)).toString()).toBe("2345");
    expect((await driver.getRange("media/u1/range", 0, 0)).toString()).toBe("0");
  });

  it("copy duplica o conteúdo mantendo a origem", async () => {
    await driver.putObject("staging/tocopy", Buffer.from("copiavel"));
    await driver.copy("staging/tocopy", "media/u1/copiado");
    expect((await readAll(await driver.getStream("media/u1/copiado"))).toString()).toBe(
      "copiavel",
    );
    expect(await driver.head("staging/tocopy")).toEqual({ size: 8 });
  });

  it("delete remove e é idempotente", async () => {
    await driver.putObject("staging/todelete", Buffer.from("x"));
    await driver.delete("staging/todelete");
    expect(await driver.head("staging/todelete")).toBeNull();
    await expect(driver.delete("staging/todelete")).resolves.toBeUndefined();
  });

  it("escrita atômica: stream que falha no meio não deixa arquivo (nem parcial, nem tmp)", async () => {
    const bad = new Readable({
      read() {
        this.push(Buffer.alloc(2048, 1));
        this.destroy(new Error("falha no meio do stream"));
      },
    });
    await expect(driver.putObject("media/u1/parcial", bad)).rejects.toThrow(
      "falha no meio do stream",
    );
    expect(await driver.head("media/u1/parcial")).toBeNull();
    const leftovers = (await listFiles(base)).filter(
      (f) => f.includes("parcial") || f.endsWith(".tmp"),
    );
    expect(leftovers).toEqual([]);
  });

  it("path traversal rejeitado em todas as operações", async () => {
    const evil = ["../x", "/etc/passwd", "a/../../b"];
    for (const key of evil) {
      await expect(driver.putObject(key, Buffer.from("pwn"))).rejects.toThrow(
        /storage key inválida/,
      );
      await expect(driver.head(key)).rejects.toThrow(/storage key inválida/);
      await expect(driver.getRange(key, 0, 1)).rejects.toThrow(/storage key inválida/);
      await expect(driver.getStream(key)).rejects.toThrow(/storage key inválida/);
      await expect(driver.delete(key)).rejects.toThrow(/storage key inválida/);
      await expect(driver.copy(key, "media/u1/dst")).rejects.toThrow(/storage key inválida/);
      await expect(driver.copy("media/u1/asset1", key)).rejects.toThrow(
        /storage key inválida/,
      );
      await expect(
        driver.createUploadTarget(key, { expiresSeconds: 60 }),
      ).rejects.toThrow(/storage key inválida/);
      await expect(
        driver.createDownloadTarget(key, { expiresSeconds: 600 }),
      ).rejects.toThrow(/storage key inválida/);
    }
  });

  it("caracteres fora do charset são rejeitados; nada vazou para fora do base dir", async () => {
    await expect(driver.putObject("a\\..\\b", Buffer.from("x"))).rejects.toThrow(
      /storage key inválida/,
    );
    await expect(driver.putObject("a b", Buffer.from("x"))).rejects.toThrow(
      /storage key inválida/,
    );
    await expect(driver.putObject("", Buffer.from("x"))).rejects.toThrow(
      /storage key inválida/,
    );
    // nenhum arquivo suspeito criado fora/em cima do base
    const files = await listFiles(base);
    expect(files.every((f) => !f.startsWith(".."))).toBe(true);
  });
});
