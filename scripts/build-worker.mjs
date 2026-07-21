#!/usr/bin/env node
// Bundle do worker (D22): esbuild => dist/worker.js. Deps ficam externas —
// sharp (binário nativo) e pg vêm do node_modules do release
// (pnpm install --prod --frozen-lockfile), nunca do bundle.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src/workers/index.ts")],
  outfile: path.join(root, "dist/worker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  // O alias "@" (tsconfig paths) é resolvido antes da checagem de external —
  // o código de src/ entra no bundle; imports bare continuam externos.
  alias: { "@": path.join(root, "src") },
  banner: {
    js: [
      "// dist/worker.js — gerado por scripts/build-worker.mjs (não editar).",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = globalThis.require ?? __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("build ok: dist/worker.js");
