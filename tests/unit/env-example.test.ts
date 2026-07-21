import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gate transversal do plano: toda env referenciada em src/ precisa estar
 * documentada no .env.example (no mesmo PR).
 */
const ROOT = path.resolve(import.meta.dirname, "../..");

// Envs de runtime do Next/Node que não pertencem ao .env.example.
const IGNORED = new Set(["NODE_ENV", "NEXT_RUNTIME", "CI"]);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe(".env.example", () => {
  it("documenta toda process.env.X usada em src/", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const used = new Set<string>();
    for (const file of listSourceFiles(path.join(ROOT, "src"))) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        used.add(match[1]!);
      }
    }
    const undocumented = [...used].filter(
      (name) => !IGNORED.has(name) && !example.includes(name),
    );
    expect(undocumented, "adicione ao .env.example (com comentário)").toEqual([]);
  });
});
