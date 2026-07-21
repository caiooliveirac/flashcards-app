import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "src") },
        },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "src") },
        },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Bancos descartáveis por suite; execução serial evita competição de roles.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
