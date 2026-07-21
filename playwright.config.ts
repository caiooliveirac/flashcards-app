import { defineConfig, devices } from "@playwright/test";

/**
 * E2E da Fase 2 (aceites F2#1–F2#4 + gate de a11y + vazamento básico de UI).
 *
 * Processos:
 * - Dev server (porta 3060): via `webServer` (reuseExistingServer: true).
 * - Worker (pg-boss, valida mídia → 'ready'): NÃO abre porta, então o
 *   webServer do Playwright não serve (exige port/url para readiness).
 *   Mecanismo escolhido: spawn em tests/e2e/global-setup.ts (aguarda a linha
 *   JSON `{"event":"started"}` no stdout) + kill do process group no
 *   global-teardown (PID persistido em tests/e2e/.tmp/worker.pid).
 *   Env do worker: .env.local (via tsx --env-file-if-exists) +
 *   STORAGE_DRIVER=local STORAGE_LOCAL_DIR=.data/media (default do dev server).
 *
 * O global-setup também roda scripts/seed-e2e.ts (usuários e2e / e2e-b) e gera
 * a fixture PNG de tests/e2e/fixtures/.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3060",
    // Sem actionTimeout, uma action sobre elemento inexistente espera o
    // timeout do teste inteiro (90s); 15s falha rápido com diagnóstico melhor.
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Pixel 7"],
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "pnpm dev",
    port: 3060,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
