import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke de PRODUÇÃO (fluxo MVP ponta a ponta em flashcards.mnrs.com.br).
 * Rodar manualmente: pnpm exec playwright test -c tests/e2e/prod.config.ts
 * Sem webServer — alvo é o deploy real.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /prod-smoke\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PROD_BASE_URL ?? "https://flashcards.mnrs.com.br",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
