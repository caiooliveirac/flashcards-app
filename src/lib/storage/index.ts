import { createLocalDriver } from "./local";
import { createS3Driver } from "./s3";
import type { StorageDriver } from "./types";

// Singleton lazy por processo (sobrevive a HMR em dev — mesmo padrão de
// db/runtime). O driver ativo vem de STORAGE_DRIVER; default "local" enquanto
// não há API key Magalu (débito registrado, D19).
const globalForStorage = globalThis as unknown as { __flashcardsStorage?: StorageDriver };

export function getStorage(): StorageDriver {
  if (!globalForStorage.__flashcardsStorage) {
    globalForStorage.__flashcardsStorage = createStorageFromEnv();
  }
  return globalForStorage.__flashcardsStorage;
}

/** Factory sem cache — para testes que precisam de driver isolado por env. */
export function createStorageFromEnv(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") return createS3Driver();
  if (driver === "local") return createLocalDriver();
  throw new Error(`STORAGE_DRIVER inválido: "${driver}" (use "local" ou "s3")`);
}

export { createLocalDriver } from "./local";
export { createS3Driver, encodeCopySource, type S3DriverConfig } from "./s3";
export * from "./types";
