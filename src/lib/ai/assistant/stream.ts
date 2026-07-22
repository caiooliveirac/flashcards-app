import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "../client";
import { TIERS, estimateCostUsd, type AssistantTier } from "./config";
import { routeTier } from "./router";
import {
  buildSystemPrompt,
  wrapContext,
  type AssistantContext,
} from "./prompt";
import {
  SUGERIR_CARD_TOOL,
  parseCardDraft,
  type CardDraftProposal,
} from "./tools";

/**
 * Orquestrador do turno do assistente: roteia o modelo pela dificuldade, monta
 * as mensagens (contexto do card delimitado no ÚLTIMO turno do usuário) e faz
 * streaming via Anthropic SDK, emitindo eventos que a rota traduz em SSE.
 */

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export type StreamEvent =
  | { type: "meta"; tier: AssistantTier; model: string }
  | { type: "delta"; text: string }
  | { type: "draft"; draft: CardDraftProposal }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    };

function buildMessages(
  history: AssistantTurn[],
  contextBlock: string | null,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  // Injeta o contexto (untrusted) como prefixo do último turno do usuário.
  if (contextBlock) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "user") {
        messages[i] = {
          role: "user",
          content: `${contextBlock}\n\n${msg.content as string}`,
        };
        break;
      }
    }
  }
  return messages;
}

export async function* streamAssistant(params: {
  history: AssistantTurn[];
  forceDeep?: boolean;
  context?: AssistantContext;
}): AsyncGenerator<StreamEvent> {
  const last = [...params.history].reverse().find((t) => t.role === "user");
  const tier = routeTier(last?.content ?? "", {
    forceDeep: params.forceDeep,
    hasContext: Boolean(params.context?.cardText),
  });
  const cfg = TIERS[tier];
  yield { type: "meta", tier, model: cfg.model };

  const messages = buildMessages(params.history, wrapContext(params.context));

  const client = getAnthropic();
  const request: Anthropic.MessageStreamParams = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: buildSystemPrompt(),
    messages,
    tools: [SUGERIR_CARD_TOOL],
    ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
    ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
  } as Anthropic.MessageStreamParams;

  const stream = client.messages.stream(request);
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "delta", text: event.delta.text };
    }
  }

  const final = await stream.finalMessage();

  // Proposta de card (tool sugerir_card) → vira evento draft; a criação real só
  // acontece após confirmação do usuário na UI (§9.2).
  const toolUse = final.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === SUGERIR_CARD_TOOL.name,
  );
  if (toolUse) {
    const draft = parseCardDraft(toolUse.input);
    if (draft) yield { type: "draft", draft };
  }

  const inputTokens =
    final.usage.input_tokens +
    (final.usage.cache_read_input_tokens ?? 0) +
    (final.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = final.usage.output_tokens;
  yield {
    type: "usage",
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(tier, inputTokens, outputTokens),
  };
}
