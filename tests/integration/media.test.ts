import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, mediaAssets } from "@/db/schema";
import type { JobEnqueuer } from "@/lib/jobs/types";
import { finalKey, mediaMaxBytes } from "@/lib/storage/types";
import {
  confirmUpload,
  getAssetStatus,
  getPendingUploadAsset,
  getServableAsset,
  MediaNotFoundError,
  MediaValidationError,
  requestUpload,
} from "@/features/media/service";
import { createTestDatabase, type TestDatabase } from "./helpers/testdb";

// Driver local isolado ANTES de qualquer chamada ao singleton getStorage().
process.env.STORAGE_DRIVER = "local";

interface EnqueueCall {
  queue: string;
  payload: unknown;
  opts?: { singletonKey?: string; singletonSeconds?: number; startAfterSeconds?: number };
}

function fakeEnqueuer(calls: EnqueueCall[]): JobEnqueuer {
  return {
    async enqueue(queue, payload, opts) {
      calls.push({ queue, payload, opts });
    },
  };
}

describe("media service (aceites F2#3 parcial e F2#5)", () => {
  let db: TestDatabase;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    process.env.STORAGE_LOCAL_DIR = await fs.mkdtemp(
      path.join(os.tmpdir(), "flashcards-media-int-"),
    );
    db = await createTestDatabase();
    userA = await db.createUser("alice-media@test.dev");
    userB = await db.createUser("bob-media@test.dev");
  });

  afterAll(async () => {
    await db.drop();
    if (process.env.STORAGE_LOCAL_DIR) {
      await fs.rm(process.env.STORAGE_LOCAL_DIR, { recursive: true, force: true });
    }
  });

  it("requestUpload cria asset pending com a key final certa + audit", async () => {
    const { assetId, target } = await requestUpload(
      userA,
      { fileName: "print.png", declaredMime: "image/png", declaredBytes: 1024 },
      db.clients.withUserTransaction,
    );
    expect(target).toEqual({ mode: "direct" }); // driver local

    const row = await db.clients.withUserTransaction(userA, async (tx) => {
      const [asset] = await tx
        .select({
          storageKey: mediaAssets.storageKey,
          status: mediaAssets.status,
          mimeType: mediaAssets.mimeType,
          byteSize: mediaAssets.byteSize,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, assetId));
      return asset;
    });
    expect(row).toEqual({
      storageKey: finalKey(userA, assetId),
      status: "pending",
      mimeType: "image/png",
      byteSize: 1024,
    });

    const audits = await db.clients.withUserTransaction(userA, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, "media.request_upload"), eq(auditLogs.entityId, assetId)),
        ),
    );
    expect(audits).toHaveLength(1);
  });

  it("rejeita mime não permitido com erro pt-BR", async () => {
    await expect(
      requestUpload(
        userA,
        { declaredMime: "application/pdf", declaredBytes: 100 },
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(MediaValidationError);
    await expect(
      requestUpload(
        userA,
        { declaredMime: "image/svg+xml", declaredBytes: 100 },
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(/não permitido/);
  });

  it("rejeita bytes acima do cap e tamanhos inválidos", async () => {
    await expect(
      requestUpload(
        userA,
        { declaredMime: "image/png", declaredBytes: mediaMaxBytes() + 1 },
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(/limite/);
    await expect(
      requestUpload(
        userA,
        { declaredMime: "image/png", declaredBytes: 0 },
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(MediaValidationError);
  });

  it("confirmUpload enfileira media.validate com singletonKey do asset + audit", async () => {
    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/jpeg", declaredBytes: 2048 },
      db.clients.withUserTransaction,
    );

    const calls: EnqueueCall[] = [];
    const result = await confirmUpload(
      userA,
      { assetId },
      fakeEnqueuer(calls),
      db.clients.withUserTransaction,
    );
    expect(result).toEqual({ status: "validating" });
    expect(calls).toEqual([
      {
        queue: "media.validate",
        payload: { assetId },
        opts: { singletonKey: assetId, singletonSeconds: 60 },
      },
    ]);

    const audits = await db.clients.withUserTransaction(userA, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "media.confirm"), eq(auditLogs.entityId, assetId))),
    );
    expect(audits).toHaveLength(1);
  });

  it("confirmUpload de asset inexistente ou não-pending falha sem enfileirar", async () => {
    const calls: EnqueueCall[] = [];
    await expect(
      confirmUpload(
        userA,
        { assetId: crypto.randomUUID() },
        fakeEnqueuer(calls),
        db.clients.withUserTransaction,
      ),
    ).rejects.toThrow(MediaNotFoundError);

    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/png", declaredBytes: 10 },
      db.clients.withUserTransaction,
    );
    await db.clients.dbService
      .update(mediaAssets)
      .set({ status: "ready" })
      .where(eq(mediaAssets.id, assetId));
    await expect(
      confirmUpload(userA, { assetId }, fakeEnqueuer(calls), db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
    expect(calls).toHaveLength(0);
  });

  it("getAssetStatus devolve status/dimensões/mime", async () => {
    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/webp", declaredBytes: 5 },
      db.clients.withUserTransaction,
    );
    expect(
      await getAssetStatus(userA, { assetId }, db.clients.withUserTransaction),
    ).toEqual({ status: "pending", width: null, height: null, mimeType: "image/webp" });

    await expect(
      getAssetStatus(userA, { assetId: crypto.randomUUID() }, db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
  });

  it("F2#5: B não vê nem opera sobre media_asset de A", async () => {
    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/png", declaredBytes: 42 },
      db.clients.withUserTransaction,
    );

    // service layer: 404 uniforme para B (nunca 403 — não vaza existência)
    await expect(
      getAssetStatus(userB, { assetId }, db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
    await expect(
      confirmUpload(userB, { assetId }, fakeEnqueuer([]), db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
    await expect(
      getPendingUploadAsset(userB, { assetId }, db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
    expect(
      await getServableAsset(userB, { assetId }, db.clients.withUserTransaction),
    ).toBeNull();

    // RLS por baixo da aplicação: SELECT de B não devolve linhas de A
    const visibleToB = await db.clients.withUserTransaction(userB, (tx) =>
      tx.select({ id: mediaAssets.id }).from(mediaAssets),
    );
    expect(visibleToB).toHaveLength(0);
  });

  it("asset pending/failed não é servível; ready serve key final e thumbnail", async () => {
    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/png", declaredBytes: 7 },
      db.clients.withUserTransaction,
    );

    // pending: nunca servível (validação do worker ainda não rodou)
    expect(
      await getServableAsset(userA, { assetId }, db.clients.withUserTransaction),
    ).toBeNull();

    await db.clients.dbService
      .update(mediaAssets)
      .set({ status: "failed" })
      .where(eq(mediaAssets.id, assetId));
    expect(
      await getServableAsset(userA, { assetId }, db.clients.withUserTransaction),
    ).toBeNull();

    // worker terminou: ready → servível
    await db.clients.dbService
      .update(mediaAssets)
      .set({ status: "ready" })
      .where(eq(mediaAssets.id, assetId));
    expect(
      await getServableAsset(userA, { assetId }, db.clients.withUserTransaction),
    ).toEqual({ key: finalKey(userA, assetId), mimeType: "image/png" });

    // thumb sem thumbnail_key ainda → 404; com key → webp
    expect(
      await getServableAsset(userA, { assetId, thumb: true }, db.clients.withUserTransaction),
    ).toBeNull();
    await db.clients.dbService
      .update(mediaAssets)
      .set({ thumbnailKey: `${finalKey(userA, assetId)}.thumb.webp` })
      .where(eq(mediaAssets.id, assetId));
    expect(
      await getServableAsset(userA, { assetId, thumb: true }, db.clients.withUserTransaction),
    ).toEqual({ key: `${finalKey(userA, assetId)}.thumb.webp`, mimeType: "image/webp" });
  });

  it("getPendingUploadAsset só aceita asset pending do próprio usuário", async () => {
    const { assetId } = await requestUpload(
      userA,
      { declaredMime: "image/gif", declaredBytes: 3 },
      db.clients.withUserTransaction,
    );
    expect(
      await getPendingUploadAsset(userA, { assetId }, db.clients.withUserTransaction),
    ).toEqual({ assetId });

    await db.clients.dbService
      .update(mediaAssets)
      .set({ status: "ready" })
      .where(eq(mediaAssets.id, assetId));
    await expect(
      getPendingUploadAsset(userA, { assetId }, db.clients.withUserTransaction),
    ).rejects.toThrow(MediaNotFoundError);
  });
});
