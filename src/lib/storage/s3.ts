import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DownloadTarget, StorageDriver, UploadTarget } from "./types";

/**
 * Driver Magalu Object Storage (API compatível com S3, SigV4). @aws-sdk PINADO
 * em 3.677.0 (D20): a API da Magalu não aceita aws-chunked e SDKs >= 3.729
 * quebram uploads. Presigned URLs (só GET e PUT na Magalu) não usam
 * aws-chunked — por isso o upload do browser via presigned PUT é o caminho
 * seguro (D19). Bucket privado: NUNCA enviar x-amz-acl.
 */

export interface S3DriverConfig {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Cliente injetável para teste unitário sem rede. */
  client?: S3Client;
}

function requireConfig(value: string | undefined, envName: string): string {
  if (!value) {
    throw new Error(`variável ${envName} é obrigatória com STORAGE_DRIVER=s3`);
  }
  return value;
}

/** CopySource = "bucket/key" com a key URL-encodada por segmento (barras preservadas). */
export function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

export function createS3Driver(config: S3DriverConfig = {}): StorageDriver {
  const bucket = requireConfig(config.bucket ?? process.env.MAGALU_S3_BUCKET, "MAGALU_S3_BUCKET");
  const client =
    config.client ??
    new S3Client({
      endpoint: requireConfig(
        config.endpoint ?? process.env.MAGALU_S3_ENDPOINT,
        "MAGALU_S3_ENDPOINT",
      ),
      region: requireConfig(config.region ?? process.env.MAGALU_S3_REGION, "MAGALU_S3_REGION"),
      // Path-style é o formato dos exemplos oficiais da Magalu (.NET exige).
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireConfig(
          config.accessKeyId ?? process.env.MAGALU_S3_ACCESS_KEY_ID,
          "MAGALU_S3_ACCESS_KEY_ID",
        ),
        secretAccessKey: requireConfig(
          config.secretAccessKey ?? process.env.MAGALU_S3_SECRET_ACCESS_KEY,
          "MAGALU_S3_SECRET_ACCESS_KEY",
        ),
      },
    });

  return {
    kind: "s3",

    async createUploadTarget(key, opts): Promise<UploadTarget> {
      // SEM x-amz-acl: bucket privado (na Magalu a ACL da URL presigned nem é
      // aplicada — o header teria de ser reenviado pelo browser e assinado).
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: opts.contentType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: opts.expiresSeconds });
      return {
        mode: "presigned-put",
        url,
        headers: opts.contentType ? { "Content-Type": opts.contentType } : undefined,
        expiresAt: new Date(Date.now() + opts.expiresSeconds * 1000).toISOString(),
      };
    },

    async putObject(key, body, contentType): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async head(key): Promise<{ size: number } | null> {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: res.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async getRange(key, start, end): Promise<Buffer> {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      if (!res.Body) throw new Error(`objeto sem corpo no storage: ${key}`);
      return Buffer.from(await res.Body.transformToByteArray());
    },

    async getStream(key): Promise<Readable> {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!(res.Body instanceof Readable)) {
        throw new Error(`stream indisponível no storage para: ${key}`);
      }
      return res.Body;
    },

    async copy(srcKey, dstKey): Promise<void> {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: encodeCopySource(bucket, srcKey),
          Key: dstKey,
        }),
      );
    },

    async delete(key): Promise<void> {
      // DeleteObject devolve 204 mesmo para key inexistente — idempotente.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async createDownloadTarget(key, opts): Promise<DownloadTarget> {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: opts.expiresSeconds },
      );
      return { mode: "redirect", url };
    },
  };
}
