/**
 * lib/content — formato NoteContentV1 (schema Zod), derivação pura
 * (search_text, cards, fingerprint, preview cloze) e matching de cards
 * na reedição (§5). Ponto de entrada único: import de "@/lib/content".
 */
export * from "./schema";
export * from "./derive";
export * from "./match";
