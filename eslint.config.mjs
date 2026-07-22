import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  {
    // handoff/: protótipos de referência do design (HTML+JS exportado), não é código do app.
    ignores: [".next/**", "node_modules/**", "src/db/migrations/**", "dist/**", "handoff/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);
