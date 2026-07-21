import { z } from "zod";

/**
 * NoteContentV1 — formato canônico do conteúdo das notas (arquitetura §4, D1).
 * Árvore JSON própria, versionada, validada com Zod. NUNCA HTML.
 * O editor Tiptap opera num schema ProseMirror restrito a estes nós;
 * parser/serializer vivem em src/lib/editor.
 *
 * V1 rejeita nested cloze POR CONSTRUÇÃO: o conteúdo de um nó cloze só
 * aceita inlines de texto (sem cloze/math aninhados).
 */

export const NOTE_CONTENT_SCHEMA_VERSION = 1 as const;

/** groupKey interno estável (equivalente a c1/c2 do Anki, jamais exposto ao usuário). */
export const CLOZE_GROUP_KEY_RE = /^g\d{1,4}$/;

// --- Inlines ---

export const markSchema = z.enum(["bold", "italic", "highlight", "code"]);

export const textInlineSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
    marks: z.array(markSchema).max(4).optional(),
  })
  .strict();

export const mathInlineSchema = z
  .object({
    type: z.literal("math"),
    latex: z.string().min(1).max(2000),
  })
  .strict();

export const clozeInlineSchema = z
  .object({
    type: z.literal("cloze"),
    groupKey: z.string().regex(CLOZE_GROUP_KEY_RE),
    hint: z.string().max(200).optional(),
    // Só texto dentro da ocultação — nested cloze rejeitado no V1 (débito consciente #2).
    content: z.array(textInlineSchema).min(1),
  })
  .strict();

/** Inlines permitidos em notas cloze (campo text). */
export const inlineSchema = z.discriminatedUnion("type", [
  textInlineSchema,
  clozeInlineSchema,
  mathInlineSchema,
]);

/** Inlines permitidos em notas basic (front/back) — sem cloze por construção. */
export const inlineNoClozeSchema = z.discriminatedUnion("type", [
  textInlineSchema,
  mathInlineSchema,
]);

export type Mark = z.infer<typeof markSchema>;
export type TextInline = z.infer<typeof textInlineSchema>;
export type MathInline = z.infer<typeof mathInlineSchema>;
export type ClozeInline = z.infer<typeof clozeInlineSchema>;
export type Inline = z.infer<typeof inlineSchema>;
export type InlineNoCloze = z.infer<typeof inlineNoClozeSchema>;

// --- Blocks (recursivos: list/callout contêm blocks) ---

export interface ParagraphBlock<I> {
  type: "paragraph";
  content: I[];
}
export interface HeadingBlock<I> {
  type: "heading";
  level: 1 | 2 | 3;
  content: I[];
}
export interface ListBlock<I> {
  type: "list";
  ordered: boolean;
  items: Array<{ blocks: Array<Block<I>> }>;
}
export interface CodeBlock {
  type: "codeBlock";
  language?: string;
  text: string;
}
/** Imagem referencia media_assets.id — a URL é resolvida na renderização (assinada/autenticada). */
export interface ImageBlock {
  type: "image";
  assetId: string;
  alt?: string;
}
export interface FormulaBlock {
  type: "formula";
  latex: string;
}
export interface CalloutBlock<I> {
  type: "callout";
  variant: "info" | "warning" | "success" | "danger";
  content: Array<Block<I>>;
}
export type Block<I> =
  | ParagraphBlock<I>
  | HeadingBlock<I>
  | ListBlock<I>
  | CodeBlock
  | ImageBlock
  | FormulaBlock
  | CalloutBlock<I>;

function makeBlockSchema<I extends z.ZodTypeAny>(
  inline: I,
): z.ZodType<Block<z.infer<I>>> {
  const block: z.ZodType<Block<z.infer<I>>> = z.lazy(() =>
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("paragraph"), content: z.array(inline) }).strict(),
      z
        .object({
          type: z.literal("heading"),
          level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
          content: z.array(inline),
        })
        .strict(),
      z
        .object({
          type: z.literal("list"),
          ordered: z.boolean(),
          items: z
            .array(z.object({ blocks: z.array(block).min(1) }).strict())
            .min(1)
            .max(100),
        })
        .strict(),
      z
        .object({
          type: z.literal("codeBlock"),
          language: z.string().max(40).optional(),
          text: z.string().max(20_000),
        })
        .strict(),
      z
        .object({
          type: z.literal("image"),
          assetId: z.uuid(),
          alt: z.string().max(500).optional(),
        })
        .strict(),
      z
        .object({ type: z.literal("formula"), latex: z.string().min(1).max(5000) })
        .strict(),
      z
        .object({
          type: z.literal("callout"),
          variant: z.enum(["info", "warning", "success", "danger"]),
          content: z.array(block).min(1),
        })
        .strict(),
    ]),
  ) as z.ZodType<Block<z.infer<I>>>;
  return block;
}

export const blockSchema = makeBlockSchema(inlineSchema);
export const blockNoClozeSchema = makeBlockSchema(inlineNoClozeSchema);

export type ClozeBlock = z.infer<typeof blockSchema>;
export type BasicBlock = z.infer<typeof blockNoClozeSchema>;

// --- Nota completa ---

const basicNoteContentObject = z
  .object({
    schemaVersion: z.literal(NOTE_CONTENT_SCHEMA_VERSION),
    kind: z.literal("basic"),
    front: z.array(blockNoClozeSchema).min(1).max(200),
    back: z.array(blockNoClozeSchema).max(200),
  })
  .strict();

const clozeNoteContentObject = z
  .object({
    schemaVersion: z.literal(NOTE_CONTENT_SCHEMA_VERSION),
    kind: z.literal("cloze"),
    text: z.array(blockSchema).min(1).max(200),
  })
  .strict();

export type BasicNoteContent = z.infer<typeof basicNoteContentObject>;
export type ClozeNoteContent = z.infer<typeof clozeNoteContentObject>;
export type NoteContent = BasicNoteContent | ClozeNoteContent;

/** Limites estruturais globais (anti-abuso; validados no superRefine). */
export const MAX_TREE_DEPTH = 6;
export const MAX_TOTAL_TEXT_LENGTH = 50_000;

function blockDepth(b: Block<unknown>): number {
  switch (b.type) {
    case "list":
      return 1 + Math.max(...b.items.map((i) => Math.max(...i.blocks.map(blockDepth))));
    case "callout":
      return 1 + Math.max(...b.content.map(blockDepth));
    default:
      return 1;
  }
}

export function collectClozeInlines(blocks: Array<Block<Inline>>): ClozeInline[] {
  const found: ClozeInline[] = [];
  const walkBlocks = (bs: Array<Block<Inline>>) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") {
        for (const inline of b.content) {
          if (inline.type === "cloze") found.push(inline);
        }
      } else if (b.type === "list") {
        for (const item of b.items) walkBlocks(item.blocks);
      } else if (b.type === "callout") {
        walkBlocks(b.content);
      }
    }
  };
  walkBlocks(blocks);
  return found;
}

function totalTextLength(blocks: Array<Block<Inline | InlineNoCloze>>): number {
  let total = 0;
  const walkInlines = (inlines: Array<Inline | InlineNoCloze>) => {
    for (const i of inlines) {
      if (i.type === "text") total += i.text.length;
      else if (i.type === "math") total += i.latex.length;
      else if (i.type === "cloze") for (const t of i.content) total += t.text.length;
    }
  };
  const walkBlocks = (bs: Array<Block<Inline | InlineNoCloze>>) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") walkInlines(b.content);
      else if (b.type === "codeBlock") total += b.text.length;
      else if (b.type === "formula") total += b.latex.length;
      else if (b.type === "list") for (const item of b.items) walkBlocks(item.blocks);
      else if (b.type === "callout") walkBlocks(b.content);
    }
  };
  walkBlocks(blocks);
  return total;
}

export const noteContentSchema = z
  .discriminatedUnion("kind", [basicNoteContentObject, clozeNoteContentObject])
  .superRefine((content, ctx) => {
    const allBlocks =
      content.kind === "basic" ? [...content.front, ...content.back] : content.text;
    for (const b of allBlocks) {
      if (blockDepth(b as Block<unknown>) > MAX_TREE_DEPTH) {
        ctx.addIssue({
          code: "custom",
          message: `Profundidade máxima da árvore é ${MAX_TREE_DEPTH}`,
        });
        return;
      }
    }
    if (totalTextLength(allBlocks as Array<Block<Inline>>) > MAX_TOTAL_TEXT_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `Conteúdo excede ${MAX_TOTAL_TEXT_LENGTH} caracteres`,
      });
      return;
    }
    if (content.kind === "cloze" && collectClozeInlines(content.text).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Nota cloze precisa de pelo menos uma ocultação",
      });
    }
  });

export function parseNoteContent(json: unknown): NoteContent {
  return noteContentSchema.parse(json);
}

export function safeParseNoteContent(json: unknown) {
  return noteContentSchema.safeParse(json);
}

/** assetIds de imagem referenciados, com slot posicional determinístico (media_references). */
export function collectImageReferences(
  content: NoteContent,
): Array<{ assetId: string; slot: string; alt?: string }> {
  const refs: Array<{ assetId: string; slot: string; alt?: string }> = [];
  const walk = (bs: Array<Block<Inline | InlineNoCloze>>, field: string) => {
    let i = 0;
    const inner = (blocks: Array<Block<Inline | InlineNoCloze>>) => {
      for (const b of blocks) {
        if (b.type === "image") {
          refs.push({ assetId: b.assetId, slot: `${field}:${i}`, alt: b.alt });
          i += 1;
        } else if (b.type === "list") {
          for (const item of b.items) inner(item.blocks);
        } else if (b.type === "callout") {
          inner(b.content);
        }
      }
    };
    inner(bs);
  };
  if (content.kind === "basic") {
    walk(content.front, "front");
    walk(content.back, "back");
  } else {
    walk(content.text, "text");
  }
  return refs;
}
