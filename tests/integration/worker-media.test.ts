import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, decks, mediaAssets, mediaReferences, notes } from "@/db/schema";
import { finalKey, stagingKey, thumbnailKey, type StorageDriver } from "@/lib/storage/types";
import { handleMediaGc } from "@/workers/handlers/media-gc";
import { handleMediaValidate, type MediaHandlerDeps } from "@/workers/handlers/media-validate";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

/**
 * Handlers do worker chamados DIRETO com deps injetadas (driver local em
 * tmpdir + clients do banco descartável) — pg-boss fica só no worker-boss.test.
 * Cobre o aceite F2#3: validação real (tamanho + magic bytes), staging não
 * confirmada varrida pelo GC.
 */

const HOUR_MS = 3_600_000;

/** Driver local mínimo p/ teste — independente do shim do worker e da fábrica de @/lib/storage. */
function createTmpStorageDriver(rootDir: string): StorageDriver {
  const resolveKey = (key: string): string => path.resolve(rootDir, key);
  return {
    kind: "local",
    async createUploadTarget() {
      return { mode: "direct" };
    },
    async putObject(key, body) {
      const filePath = resolveKey(key);
      await mkdir(path.dirname(filePath), { recursive: true });
      if (Buffer.isBuffer(body)) {
        await writeFile(filePath, body);
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer | string>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        await writeFile(filePath, Buffer.concat(chunks));
      }
    },
    async head(key) {
      try {
        const info = await stat(resolveKey(key));
        return { size: info.size };
      } catch {
        return null;
      }
    },
    async getRange(key, start, end) {
      const handle = await open(resolveKey(key), "r");
      try {
        const length = end - start + 1;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    async getStream(key) {
      const filePath = resolveKey(key);
      await stat(filePath);
      return createReadStream(filePath);
    },
    async copy(srcKey, dstKey) {
      const dst = resolveKey(dstKey);
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(resolveKey(srcKey), dst);
    },
    async delete(key) {
      await rm(resolveKey(key), { force: true });
    },
    async createDownloadTarget() {
      return { mode: "stream" };
    },
  };
}

let db: TestDatabase;
let tmpDir: string;
let storage: StorageDriver;
let deps: MediaHandlerDeps;
let userId: string;
let pngBuffer: Buffer;
let jpegBuffer: Buffer;

async function insertAsset(
  overrides: Partial<typeof mediaAssets.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.clients.withUserTransaction(userId, async (tx) => {
    await tx.insert(mediaAssets).values({
      id,
      ownerUserId: userId,
      storageKey: stagingKey(id),
      mimeType: "image/png",
      status: "pending",
      ...overrides,
    });
  });
  return id;
}

async function getAsset(id: string): Promise<typeof mediaAssets.$inferSelect> {
  const [row] = await db.clients.withServiceTransaction((tx) =>
    tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)),
  );
  if (!row) throw new Error(`asset ${id} não encontrado`);
  return row;
}

async function getAuditActions(assetId: string): Promise<string[]> {
  const rows = await db.clients.withServiceTransaction((tx) =>
    tx
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, assetId)),
  );
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  db = await createTestDatabase();
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "flashcards-media-"));
  storage = createTmpStorageDriver(tmpDir);
  deps = { storage, clients: db.clients };
  userId = await db.createUser("media-worker@example.com");
  // Fixtures REAIS geradas em memória (bytes de PNG/JPEG válidos).
  pngBuffer = await sharp({
    create: { width: 4, height: 3, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  jpegBuffer = await sharp({
    create: { width: 8, height: 5, channels: 3, background: { r: 10, g: 200, b: 90 } },
  })
    .jpeg()
    .toBuffer();
});

afterAll(async () => {
  await db.drop();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("handleMediaValidate (pipeline §10)", () => {
  it("fluxo feliz PNG: pending+staging => ready com sha256/dimensões/mime reais, thumbnail e copy staging→final", async () => {
    const assetId = await insertAsset();
    await storage.putObject(stagingKey(assetId), pngBuffer);

    await handleMediaValidate(assetId, deps);

    const asset = await getAsset(assetId);
    expect(asset.status).toBe("ready");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.byteSize).toBe(pngBuffer.length);
    expect(asset.sha256).toBe(createHash("sha256").update(pngBuffer).digest("hex"));
    expect(asset.width).toBe(4);
    expect(asset.height).toBe(3);
    expect(asset.storageKey).toBe(finalKey(userId, assetId));
    expect(asset.thumbnailKey).toBe(thumbnailKey(userId, assetId));

    // staging SUMIU; final e thumbnail existem
    expect(await storage.head(stagingKey(assetId))).toBeNull();
    expect(await storage.head(finalKey(userId, assetId))).toEqual({ size: pngBuffer.length });
    const thumbHead = await storage.head(thumbnailKey(userId, assetId));
    expect(thumbHead).not.toBeNull();

    expect(await getAuditActions(assetId)).toContain("media.validated");
  });

  it("JPEG com mime declarado errado: o mime REAL detectado prevalece", async () => {
    const assetId = await insertAsset({ mimeType: "image/png" });
    await storage.putObject(stagingKey(assetId), jpegBuffer);

    await handleMediaValidate(assetId, deps);

    const asset = await getAsset(assetId);
    expect(asset.status).toBe("ready");
    expect(asset.mimeType).toBe("image/jpeg");
    expect(asset.width).toBe(8);
    expect(asset.height).toBe(5);
  });

  it("lixo com mime declarado image/png => failed + staging apagada + audit media.rejected", async () => {
    const assetId = await insertAsset({ mimeType: "image/png" });
    await storage.putObject(
      stagingKey(assetId),
      Buffer.from("isto definitivamente não é uma imagem png válida"),
    );

    await handleMediaValidate(assetId, deps);

    const asset = await getAsset(assetId);
    expect(asset.status).toBe("failed");
    expect(await storage.head(stagingKey(assetId))).toBeNull();
    expect(await getAuditActions(assetId)).toContain("media.rejected");
  });

  it("oversize (head > MEDIA_MAX_BYTES) => failed + staging apagada", async () => {
    const assetId = await insertAsset();
    await storage.putObject(stagingKey(assetId), pngBuffer);

    const previous = process.env.MEDIA_MAX_BYTES;
    process.env.MEDIA_MAX_BYTES = "8";
    try {
      await handleMediaValidate(assetId, deps);
    } finally {
      if (previous === undefined) delete process.env.MEDIA_MAX_BYTES;
      else process.env.MEDIA_MAX_BYTES = previous;
    }

    const asset = await getAsset(assetId);
    expect(asset.status).toBe("failed");
    expect(await storage.head(stagingKey(assetId))).toBeNull();
  });

  it("staging ausente (upload nunca subiu) => failed", async () => {
    const assetId = await insertAsset();

    await handleMediaValidate(assetId, deps);

    const asset = await getAsset(assetId);
    expect(asset.status).toBe("failed");
    expect(await getAuditActions(assetId)).toContain("media.rejected");
  });

  it("re-execução em asset ready => no-op (retries do pg-boss são seguros)", async () => {
    const assetId = await insertAsset();
    await storage.putObject(stagingKey(assetId), pngBuffer);
    await handleMediaValidate(assetId, deps);
    const before = await getAsset(assetId);
    expect(before.status).toBe("ready");

    await handleMediaValidate(assetId, deps);

    const after = await getAsset(assetId);
    expect(after).toEqual(before);
    expect(await storage.head(finalKey(userId, assetId))).not.toBeNull();
    const validated = (await getAuditActions(assetId)).filter((a) => a === "media.validated");
    expect(validated).toHaveLength(1);
  });
});

describe("handleMediaGc (idempotente, carências)", () => {
  it("varre pending velho, soft-deleta ready órfão, preserva referenciado/recentes e limpa staging de failed antigo", async () => {
    // a) pending além da carência de staging (6h) — key nunca confirmada
    const stalePendingId = await insertAsset({
      createdAt: new Date(Date.now() - 7 * HOUR_MS),
    });
    await storage.putObject(stagingKey(stalePendingId), pngBuffer);

    // pending recente: intocado
    const freshPendingId = await insertAsset();
    await storage.putObject(stagingKey(freshPendingId), pngBuffer);

    // b) ready órfão além da carência (24h)
    const orphanReadyId = randomUUID();
    await db.clients.withUserTransaction(userId, async (tx) => {
      await tx.insert(mediaAssets).values({
        id: orphanReadyId,
        ownerUserId: userId,
        storageKey: finalKey(userId, orphanReadyId),
        mimeType: "image/png",
        status: "ready",
        thumbnailKey: thumbnailKey(userId, orphanReadyId),
        createdAt: new Date(Date.now() - 26 * HOUR_MS),
      });
    });
    await storage.putObject(finalKey(userId, orphanReadyId), pngBuffer);
    await storage.putObject(thumbnailKey(userId, orphanReadyId), pngBuffer);

    // ready velho COM referência: intocado
    const referencedReadyId = randomUUID();
    const deckId = randomUUID();
    const noteId = randomUUID();
    await db.clients.withUserTransaction(userId, async (tx) => {
      await tx.insert(mediaAssets).values({
        id: referencedReadyId,
        ownerUserId: userId,
        storageKey: finalKey(userId, referencedReadyId),
        mimeType: "image/png",
        status: "ready",
        thumbnailKey: thumbnailKey(userId, referencedReadyId),
        createdAt: new Date(Date.now() - 26 * HOUR_MS),
      });
      await tx.insert(decks).values({ id: deckId, ownerUserId: userId, name: "GC deck" });
      await tx.insert(notes).values({
        id: noteId,
        ownerUserId: userId,
        deckId,
        noteType: "basic",
        contentJson: { version: 1 },
      });
      await tx.insert(mediaReferences).values({
        mediaAssetId: referencedReadyId,
        noteId,
        slot: "front:0",
        ownerUserId: userId,
      });
    });
    await storage.putObject(finalKey(userId, referencedReadyId), pngBuffer);
    await storage.putObject(thumbnailKey(userId, referencedReadyId), pngBuffer);

    // c) failed antigo (> 7 dias) com staging remanescente
    const oldFailedId = await insertAsset({
      status: "failed",
      createdAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
    });
    await storage.putObject(stagingKey(oldFailedId), pngBuffer);

    await handleMediaGc(deps);

    // a) pending velho => failed + staging apagada + audit
    const stalePending = await getAsset(stalePendingId);
    expect(stalePending.status).toBe("failed");
    expect(await storage.head(stagingKey(stalePendingId))).toBeNull();
    expect(await getAuditActions(stalePendingId)).toContain("media.gc_staging");

    // pending recente segue intocado
    const freshPending = await getAsset(freshPendingId);
    expect(freshPending.status).toBe("pending");
    expect(await storage.head(stagingKey(freshPendingId))).not.toBeNull();

    // b) órfão: mark-and-sweep — 1ª execução só MARCA (objetos intactos);
    // sweep exige orphan_seen_at envelhecido além da carência.
    let orphanReady = await getAsset(orphanReadyId);
    expect(orphanReady.status).toBe("ready");
    expect(orphanReady.deletedAt).toBeNull();
    expect(orphanReady.orphanSeenAt).not.toBeNull();
    expect(await storage.head(finalKey(userId, orphanReadyId))).not.toBeNull();

    // Envelhece a marca via service (BYPASSRLS) — FORCE RLS zera o owner.
    await deps.clients.withServiceTransaction((tx) =>
      tx
        .update(mediaAssets)
        .set({ orphanSeenAt: new Date(Date.now() - 25 * HOUR_MS) })
        .where(eq(mediaAssets.id, orphanReadyId)),
    );
    await handleMediaGc(deps);
    orphanReady = await getAsset(orphanReadyId);
    expect(orphanReady.status).toBe("ready");
    expect(orphanReady.deletedAt).not.toBeNull();
    expect(await storage.head(finalKey(userId, orphanReadyId))).toBeNull();
    expect(await storage.head(thumbnailKey(userId, orphanReadyId))).toBeNull();
    expect(await getAuditActions(orphanReadyId)).toContain("media.gc_orphan");

    // ready COM referência => intocado
    const referencedReady = await getAsset(referencedReadyId);
    expect(referencedReady.status).toBe("ready");
    expect(referencedReady.deletedAt).toBeNull();
    expect(await storage.head(finalKey(userId, referencedReadyId))).not.toBeNull();
    expect(await storage.head(thumbnailKey(userId, referencedReadyId))).not.toBeNull();

    // c) failed antigo: staging some, linha fica para auditoria
    const oldFailed = await getAsset(oldFailedId);
    expect(oldFailed.status).toBe("failed");
    expect(oldFailed.deletedAt).toBeNull();
    expect(await storage.head(stagingKey(oldFailedId))).toBeNull();
  });

  it("re-execução do GC é no-op estável", async () => {
    await handleMediaGc(deps);
    await handleMediaGc(deps);
  });
});
