import "server-only";
import { ASSISTANT_LIMITS } from "./config";
import { getDailyUsage } from "./usage-store";

/**
 * Rate limit em 3 camadas (§9.3: "rate limit por usuário e teto diário"):
 *   1. tamanho da entrada (chars) — barra payload absurdo antes de gastar token;
 *   2. requisições por minuto — janela deslizante em memória (anti-rajada);
 *   3. teto de custo diário — soma estimada do dia (persistida em arquivo).
 * Camada 2 reseta em restart do processo (aceitável para controle de abuso);
 * camada 3 sobrevive porque o custo é o que realmente importa no bolso.
 */

export type GateResult =
  | { ok: true }
  | { ok: false; code: "chars" | "rpm" | "daily"; message: string };

const rpmBuckets = new Map<string, number[]>();

function checkRpm(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (rpmBuckets.get(userId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= ASSISTANT_LIMITS.requestsPerMinute) {
    rpmBuckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  rpmBuckets.set(userId, recent);
  return true;
}

export async function checkRateLimit(
  userId: string,
  input: { messageChars: number; contextChars: number },
): Promise<GateResult> {
  if (input.messageChars > ASSISTANT_LIMITS.maxMessageChars) {
    return {
      ok: false,
      code: "chars",
      message: `Pergunta muito longa (máx. ${ASSISTANT_LIMITS.maxMessageChars} caracteres).`,
    };
  }
  if (input.contextChars > ASSISTANT_LIMITS.maxContextChars) {
    return {
      ok: false,
      code: "chars",
      message: "Contexto do card grande demais para o assistente.",
    };
  }

  if (!checkRpm(userId)) {
    return {
      ok: false,
      code: "rpm",
      message: "Muitas perguntas em pouco tempo. Espere alguns segundos.",
    };
  }

  const usage = await getDailyUsage(userId);
  if (usage.costUsd >= ASSISTANT_LIMITS.dailyUsdCap) {
    return {
      ok: false,
      code: "daily",
      message:
        "Teto de uso de IA de hoje atingido. O assistente volta amanhã (ou aumente o limite nas configurações).",
    };
  }

  return { ok: true };
}
