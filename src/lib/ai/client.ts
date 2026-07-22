import Anthropic from "@anthropic-ai/sdk";

/**
 * Cliente Anthropic preguiçoso. Só é importado por código de servidor
 * (services/actions). Instanciado sob demanda para não exigir a chave em
 * build/import. Chamadores devem checar isAiEnabled() antes.
 */
let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY ausente");
  }
  if (!cached) {
    cached = new Anthropic({ apiKey });
  }
  return cached;
}
