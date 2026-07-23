import type { NoteContent } from "@/lib/content";

/**
 * Card apresentado na sessão de revisão.
 *
 * Vive fora de `review-session.tsx` para que a lógica pura da fila
 * (`session-queue.ts`) possa ser importada e testada sem carregar React.
 */
export interface SessionCard {
  cardId: string;
  noteId: string;
  noteType: "basic" | "cloze";
  clozeGroupKey: string | null;
  content: NoteContent;
  isNew: boolean;
  /** ms até vencer para [Errei, Difícil, Bom, Fácil]. */
  previewMs: [number, number, number, number];
  lapses: number;
  isLeech: boolean;
}
