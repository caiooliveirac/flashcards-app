import { AI_LIMITS, AI_MODEL } from "./config";
import { getAnthropic } from "./client";
import { SUGGESTION_JSON_SCHEMA, suggestionResponseSchema } from "./suggestion-schema";
import { convertSuggestion, type ConvertedCard } from "./to-note-content";

/**
 * Assistente de criação de cards (Fase 5, aceite 2). Recebe material colado
 * pelo usuário e devolve cards prontos para revisão. Provider: Claude/Anthropic
 * via structured output (JSON garantido). A função de geração é INJETÁVEL para
 * testar sem chamada real (estratégia de testes: IA sempre mockada no CI).
 */

export type SuggestMode = "initial" | "revise" | "more";

export interface PriorCard {
  front: string;
  back: string;
  /** Nota 0–10 que o usuário deu (opcional). */
  rating: number | null;
}

export interface SuggestParams {
  sourceText: string;
  mode: SuggestMode;
  /** Feedback livre do usuário (o que mudar). */
  feedback?: string;
  /** Cards atualmente na tela — para revisar (revise) ou evitar repetir (more). */
  prior?: PriorCard[];
}

/** Assinatura injetável: recebe prompt, devolve o JSON cru do modelo. */
export type GenerateFn = (req: { system: string; user: string }) => Promise<string>;

const SYSTEM_PROMPT = [
  "Você é um especialista em criar flashcards para estudo com repetição espaçada (SRS).",
  "Gere cards a partir do material fornecido pelo usuário.",
  "",
  "Princípios:",
  "- Atomicidade: cada card cobre UM fato/ideia. Prefira vários cards pequenos a um grande.",
  "- Clareza e ausência de ambiguidade: a pergunta deve ter uma resposta certa e curta.",
  "- Sem 'pergunta-lista' gigante; quebre listas em cards menores quando fizer sentido.",
  "- Escreva no MESMO idioma do material (normalmente português).",
  "- Não invente fatos que não estejam no material; extraia e reorganize.",
  "",
  "Tipos:",
  '- "basic": pergunta e resposta. Use front (pergunta) e back (resposta). text = "".',
  '- "cloze": ocultar um trecho dentro de uma frase. Use text com a(s) ocultação(ões)',
  "  marcada(s) com chaves duplas: {{trecho oculto}} ou {{trecho::dica}}. front e back = \"\".",
  "  Prefira cloze para definições, datas, valores e termos dentro de uma frase.",
  "",
  "Quantidade: gere de 3 a 6 cards por vez, só o que for realmente útil.",
  "Devolva SOMENTE os cards no formato estruturado pedido — sem explicações.",
].join("\n");

function renderPrior(prior: PriorCard[]): string {
  return prior
    .slice(0, AI_LIMITS.maxPriorCards)
    .map((c, i) => {
      const nota = c.rating === null ? "sem nota" : `nota ${c.rating}/10`;
      const back = c.back ? ` → ${c.back}` : "";
      return `${i + 1}. (${nota}) ${c.front}${back}`;
    })
    .join("\n");
}

function buildUser(params: SuggestParams): string {
  const source = params.sourceText.slice(0, AI_LIMITS.maxSourceChars).trim();
  const feedback = params.feedback?.slice(0, AI_LIMITS.maxFeedbackChars).trim();
  const parts: string[] = [`Material:\n"""\n${source}\n"""`];

  if (params.mode === "revise" && params.prior?.length) {
    parts.push(
      "Cards atuais (com a nota que o usuário deu):\n" + renderPrior(params.prior),
    );
    parts.push(
      "Refaça os cards: melhore ou substitua os de nota baixa, mantenha os bons," +
        " e aplique o pedido abaixo. Devolva o conjunto revisado completo.",
    );
    if (feedback) parts.push(`Pedido do usuário: ${feedback}`);
  } else if (params.mode === "more") {
    if (params.prior?.length) {
      parts.push("Cards que JÁ existem (não repita nem faça equivalentes):\n" + renderPrior(params.prior));
    }
    parts.push("Gere cards NOVOS a partir do material, cobrindo pontos ainda não abordados.");
    if (feedback) parts.push(`Pedido do usuário: ${feedback}`);
  } else {
    parts.push("Crie os melhores cards a partir do material.");
    if (feedback) parts.push(`Pedido do usuário: ${feedback}`);
  }

  return parts.join("\n\n");
}

/** Geração real via Anthropic (structured output → JSON garantido no 1º bloco). */
const defaultGenerate: GenerateFn = async ({ system, user }) => {
  const client = getAnthropic();
  const res = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SUGGESTION_JSON_SCHEMA },
    },
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.find((b) => b.type === "text");
  return text ? text.text : "";
};

export interface SuggestResult {
  cards: ConvertedCard[];
}

/**
 * Ponto de entrada do assistente. Lança em falha de rede/parse — o chamador
 * (action) captura e degrada com mensagem calma, sem logar erro pro usuário.
 */
export async function suggestCards(
  params: SuggestParams,
  generate: GenerateFn = defaultGenerate,
): Promise<SuggestResult> {
  const raw = await generate({ system: SYSTEM_PROMPT, user: buildUser(params) });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("resposta da IA em formato inesperado");
  }
  const parsed = suggestionResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("resposta da IA fora do formato esperado");
  }
  const cards = parsed.data.cards
    .map(convertSuggestion)
    .filter((c): c is ConvertedCard => c !== null)
    .slice(0, AI_LIMITS.maxCardsPerResponse);
  return { cards };
}
