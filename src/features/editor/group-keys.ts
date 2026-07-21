import { nextGroupKey } from "@/lib/content/derive";

/**
 * Próxima key de ocultação considerando a UNIÃO das keys do doc ATUAL com as
 * keys históricas dos cards da nota (INCLUINDO status 'removed') — achado #9a.
 * Gerar key só a partir do doc recicla a key de um card removed; no matching
 * do §5 isso colidiria com o card antigo (progresso/variant) em vez de nascer
 * card novo. Em criação (nota nova) o histórico é vazio — união = keys do doc.
 */
export function nextGroupKeyWithHistory(
  historicalKeys: readonly string[],
  docKeys: readonly string[],
): string {
  return nextGroupKey([...historicalKeys, ...docKeys]);
}
