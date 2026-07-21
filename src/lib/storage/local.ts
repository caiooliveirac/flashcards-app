import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { DownloadTarget, StorageDriver, UploadTarget } from "./types";

/**
 * Driver de filesystem local (fallback enquanto não há API key Magalu — débito
 * registrado, D19). Mesma interface do driver s3; upload entra pela rota
 * autenticada PUT /api/media/upload/[assetId] (mode "direct") e o serving é
 * streaming pela própria rota GET (mode "stream").
 */

const KEY_RE = /^[A-Za-z0-9._/-]+$/;

/** Anti path traversal: charset restrito, sem "..", sem caminho absoluto. */
function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || !KEY_RE.test(key)) {
    throw new Error(`storage key inválida: "${key}"`);
  }
}

export function createLocalDriver(baseDir?: string): StorageDriver {
  const base = path.resolve(baseDir ?? process.env.STORAGE_LOCAL_DIR ?? ".data/media");

  function resolveKey(key: string): string {
    assertSafeKey(key);
    const abs = path.resolve(base, key);
    // Cinto e suspensório: mesmo com a key validada, o path final precisa
    // continuar dentro do diretório base.
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new Error(`storage key inválida: "${key}"`);
    }
    return abs;
  }

  /** Escrita atômica: escreve em tmp no MESMO diretório e faz rename — o
   * arquivo na key final nunca existe parcial. */
  async function writeAtomic(dest: string, write: (tmp: string) => Promise<void>): Promise<void> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await write(tmp);
      await fs.rename(tmp, dest);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    kind: "local",

    async createUploadTarget(key): Promise<UploadTarget> {
      assertSafeKey(key);
      return { mode: "direct" };
    },

    async putObject(key, body): Promise<void> {
      const dest = resolveKey(key);
      await writeAtomic(dest, async (tmp) => {
        if (Buffer.isBuffer(body)) {
          await fs.writeFile(tmp, body, { flag: "wx" });
        } else {
          await pipeline(body, createWriteStream(tmp, { flags: "wx" }));
        }
      });
    },

    async head(key): Promise<{ size: number } | null> {
      const abs = resolveKey(key);
      try {
        const st = await fs.stat(abs);
        return { size: st.size };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async getRange(key, start, end): Promise<Buffer> {
      const abs = resolveKey(key);
      const chunks: Buffer[] = [];
      // createReadStream trata start/end como inclusivos — igual ao Range do S3.
      for await (const chunk of createReadStream(abs, { start, end })) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    },

    async getStream(key) {
      const abs = resolveKey(key);
      await fs.access(abs); // ENOENT vira erro imediato, não erro tardio no stream
      return createReadStream(abs);
    },

    async copy(srcKey, dstKey): Promise<void> {
      const src = resolveKey(srcKey);
      const dst = resolveKey(dstKey);
      await writeAtomic(dst, (tmp) => fs.copyFile(src, tmp));
    },

    async delete(key): Promise<void> {
      const abs = resolveKey(key);
      await fs.rm(abs, { force: true }); // idempotente: inexistente não é erro
    },

    async createDownloadTarget(key): Promise<DownloadTarget> {
      assertSafeKey(key);
      return { mode: "stream" };
    },
  };
}
