import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Persistência LEVE de uso diário de IA em arquivo (`.data/ai-usage/`, que é
 * gitignored), escolha consciente para não tocar no banco enquanto o outro
 * agente mexe em migrations. Suficiente para o teto de custo single-user (Duda);
 * migra depois para a tabela `ai_usage_events` do §9.3 sem mudar a interface.
 */

// Configurável porque em prod os releases são por diretório/symlink: apontar
// para fora do repo (ex.: /home/ubuntu/flashcards-data/ai-usage) evita zerar o
// teto de custo a cada deploy. Default relativo serve para dev.
const DIR =
  process.env.FLASHCARDS_AI_USAGE_DIR?.trim() ||
  path.join(process.cwd(), ".data", "ai-usage");

export interface DailyUsage {
  date: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** userId vem da sessão (uuid), mas sanitiza para nome de arquivo por garantia. */
function fileFor(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anon";
  return path.join(DIR, `${safe}-${today()}.json`);
}

function empty(): DailyUsage {
  return { date: today(), requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

export async function getDailyUsage(userId: string): Promise<DailyUsage> {
  try {
    const raw = await fs.readFile(fileFor(userId), "utf8");
    const parsed = JSON.parse(raw) as Partial<DailyUsage>;
    if (parsed.date !== today()) return empty();
    return { ...empty(), ...parsed, date: today() };
  } catch {
    return empty();
  }
}

export async function recordUsage(
  userId: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
): Promise<void> {
  const current = await getDailyUsage(userId);
  const next: DailyUsage = {
    date: today(),
    requests: current.requests + 1,
    tokensIn: current.tokensIn + usage.inputTokens,
    tokensOut: current.tokensOut + usage.outputTokens,
    costUsd: current.costUsd + usage.costUsd,
  };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(userId), JSON.stringify(next), "utf8");
}
