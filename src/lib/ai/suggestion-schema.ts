import { z } from "zod";

/**
 * Forma SIMPLES que o modelo devolve (não a árvore NoteContentV1). Campos de
 * texto plano são robustos para o LLM; a conversão determinística para o
 * formato canônico vive em to-note-content.ts. Manter simples e "strict-JSON"
 * compatível: sem opcionais, sem min/maxLength (limites do structured output).
 *
 * - kind "basic": usa front (pergunta) e back (resposta); text = "".
 * - kind "cloze": usa text com ocultações marcadas {{assim}} (ou {{assim::dica}});
 *   front e back = "".
 */

export const suggestedCardSchema = z
  .object({
    kind: z.enum(["basic", "cloze"]),
    front: z.string(),
    back: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
  })
  .strict();

export const suggestionResponseSchema = z
  .object({
    cards: z.array(suggestedCardSchema),
  })
  .strict();

export type SuggestedCard = z.infer<typeof suggestedCardSchema>;
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

/**
 * JSON Schema entregue à API (output_config.format = json_schema). Escrito à
 * mão — o structured output exige additionalProperties:false e todos os campos
 * em required (sem minLength/maxLength/const recursivo).
 */
export const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "front", "back", "text", "tags"],
        properties: {
          kind: { type: "string", enum: ["basic", "cloze"] },
          front: {
            type: "string",
            description: "Pergunta (só para kind=basic; senão string vazia).",
          },
          back: {
            type: "string",
            description: "Resposta (só para kind=basic; senão string vazia).",
          },
          text: {
            type: "string",
            description:
              "Frase com ocultações {{assim}} ou {{assim::dica}} (só para kind=cloze; senão string vazia).",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags curtas opcionais (pode ser lista vazia).",
          },
        },
      },
    },
  },
} as const;
