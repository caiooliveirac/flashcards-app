import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createS3Driver, encodeCopySource } from "@/lib/storage/s3";

/**
 * Sem rede: presigned URLs são computadas localmente (getSignedUrl não faz
 * requisição) e os comandos são inspecionados via client com `send` stubado.
 */

const cfg = {
  endpoint: "https://br-se1.magaluobjects.test",
  region: "br-se1",
  bucket: "flashcards-media",
  accessKeyId: "AKIAFAKEFAKEFAKE",
  secretAccessKey: "segredo-fake-para-assinatura",
};

interface SentCommand {
  name: string;
  input: Record<string, unknown>;
}

/** Driver com client real (assinatura offline) mas send interceptado. */
function stubbedDriver(respond: (cmd: SentCommand) => unknown) {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const sent: SentCommand[] = [];
  client.send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const cmd: SentCommand = { name: command.constructor.name, input: command.input };
    sent.push(cmd);
    return respond(cmd);
  }) as unknown as typeof client.send;
  return { driver: createS3Driver({ ...cfg, client }), sent };
}

describe("storage s3 driver (Magalu)", () => {
  it("kind é 's3'", () => {
    const { driver } = stubbedDriver(() => ({}));
    expect(driver.kind).toBe("s3");
  });

  it("createUploadTarget: presigned PUT path-style com expiração, sem x-amz-acl", async () => {
    const driver = createS3Driver(cfg);
    const before = Date.now();
    const target = await driver.createUploadTarget("staging/abc-123", {
      expiresSeconds: 60,
      contentType: "image/png",
    });
    if (target.mode !== "presigned-put") throw new Error("esperava presigned-put");

    const url = new URL(target.url);
    expect(url.host).toBe("br-se1.magaluobjects.test");
    // forcePathStyle: bucket no path, não no host
    expect(url.pathname).toBe("/flashcards-media/staging/abc-123");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Credential")).toContain(cfg.accessKeyId);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("host");
    // bucket privado: ACL jamais entra na URL/assinatura
    expect(target.url.toLowerCase()).not.toContain("x-amz-acl");
    expect(target.headers).toEqual({ "Content-Type": "image/png" });

    const expiresAt = Date.parse(target.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 55_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 65_000);
  });

  it("createDownloadTarget: presigned GET com mode redirect", async () => {
    const driver = createS3Driver(cfg);
    const target = await driver.createDownloadTarget("media/u1/abc-123", {
      expiresSeconds: 600,
    });
    if (target.mode !== "redirect") throw new Error("esperava redirect");
    const url = new URL(target.url);
    expect(url.host).toBe("br-se1.magaluobjects.test");
    expect(url.pathname).toBe("/flashcards-media/media/u1/abc-123");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("head: HeadObjectCommand com Bucket/Key; devolve size", async () => {
    const { driver, sent } = stubbedDriver(() => ({ ContentLength: 1234 }));
    expect(await driver.head("media/u1/x")).toEqual({ size: 1234 });
    expect(sent).toEqual([
      { name: "HeadObjectCommand", input: { Bucket: "flashcards-media", Key: "media/u1/x" } },
    ]);
  });

  it("head: null em NotFound/404", async () => {
    const notFound = Object.assign(new Error("NotFound"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    const { driver } = stubbedDriver(() => {
      throw notFound;
    });
    expect(await driver.head("media/u1/sumido")).toBeNull();
  });

  it("head: outros erros propagam", async () => {
    const denied = Object.assign(new Error("AccessDenied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
    const { driver } = stubbedDriver(() => {
      throw denied;
    });
    await expect(driver.head("media/u1/x")).rejects.toThrow("AccessDenied");
  });

  it("getRange: GetObjectCommand com Range inclusivo", async () => {
    const { driver, sent } = stubbedDriver(() => ({
      Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3, 4]) },
    }));
    const buf = await driver.getRange("staging/abc", 10, 13);
    expect([...buf]).toEqual([1, 2, 3, 4]);
    expect(sent[0]).toEqual({
      name: "GetObjectCommand",
      input: { Bucket: "flashcards-media", Key: "staging/abc", Range: "bytes=10-13" },
    });
  });

  it("copy: CopyObjectCommand com CopySource 'bucket/key' encodado", async () => {
    const { driver, sent } = stubbedDriver(() => ({}));
    await driver.copy("staging/abc-123", "media/u1/abc-123");
    expect(sent[0]).toEqual({
      name: "CopyObjectCommand",
      input: {
        Bucket: "flashcards-media",
        CopySource: "flashcards-media/staging/abc-123",
        Key: "media/u1/abc-123",
      },
    });
  });

  it("encodeCopySource: encoda por segmento preservando as barras", () => {
    expect(encodeCopySource("b", "media/u 1/a+b")).toBe("b/media/u%201/a%2Bb");
    expect(encodeCopySource("b", "staging/abc")).toBe("b/staging/abc");
  });

  it("delete: DeleteObjectCommand com Bucket/Key", async () => {
    const { driver, sent } = stubbedDriver(() => ({}));
    await driver.delete("staging/abc");
    expect(sent[0]).toEqual({
      name: "DeleteObjectCommand",
      input: { Bucket: "flashcards-media", Key: "staging/abc" },
    });
  });

  it("putObject: PutObjectCommand com Body e ContentType", async () => {
    const { driver, sent } = stubbedDriver(() => ({}));
    const body = Buffer.from("dados");
    await driver.putObject("staging/abc", body, "image/webp");
    expect(sent[0]?.name).toBe("PutObjectCommand");
    expect(sent[0]?.input.Bucket).toBe("flashcards-media");
    expect(sent[0]?.input.Key).toBe("staging/abc");
    expect(sent[0]?.input.Body).toBe(body);
    expect(sent[0]?.input.ContentType).toBe("image/webp");
  });

  it("config incompleta sem client injetado falha com erro claro", () => {
    const prev = { ...process.env };
    delete process.env.MAGALU_S3_BUCKET;
    delete process.env.MAGALU_S3_ENDPOINT;
    try {
      expect(() => createS3Driver()).toThrow(/MAGALU_S3_BUCKET/);
    } finally {
      process.env = prev;
    }
  });
});
