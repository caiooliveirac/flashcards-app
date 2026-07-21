/**
 * lib/editor — schema Tiptap restrito ao NoteContentV1 + parser/serializer.
 *
 * parse.ts/serialize.ts são server-safe (funções puras sobre JSON).
 * Código server que só precisa das conversões pode importar direto de
 * "@/lib/editor/parse" / "@/lib/editor/serialize" para não puxar os pacotes
 * de extensão do Tiptap no bundle.
 */
export * from "./cloze-node";
export * from "./extensions";
export * from "./parse";
export * from "./serialize";
