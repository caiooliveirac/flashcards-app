"use client";

import { useEffect, useRef, useState } from "react";
import { NoteEditorScreen } from "@/features/editor/note-editor-screen";
import {
  getNoteEditorDataAction,
  type NoteEditorData,
} from "@/features/notes/actions";
import type { NoteContent } from "@/lib/content";

/**
 * Modal "Editar card" da sessão de revisão. Ao notar um erro no card durante o
 * estudo, o aluno corrige na hora sem perder a fila da sessão (fluxo escolhido:
 * overlay por cima da revisão, não navegação).
 *
 * Carrega os dados de edição sob demanda ao abrir (getNoteEditorDataAction) e
 * embute o NoteEditorScreen em modo edição. Ao salvar, o editor devolve o
 * conteúdo por callback e a sessão atualiza o card na hora — o servidor já
 * persistiu via updateNoteAction.
 */
export function EditCardModal({
  noteId,
  deckId,
  deckName,
  onClose,
  onSaved,
}: {
  noteId: string;
  deckId: string;
  deckName: string;
  onClose: () => void;
  onSaved: (content: NoteContent, cardCount: number) => void;
}) {
  const [data, setData] = useState<NoteEditorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Carrega os dados de edição da nota ao abrir.
  useEffect(() => {
    let cancelled = false;
    void getNoteEditorDataAction({ noteId }).then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // Esc fecha; trava o scroll do body enquanto o modal está aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar card"
      className="fixed inset-0 z-50 flex flex-col bg-background/80 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
    >
      {/* Backdrop: clique fora fecha (só na área de fundo, não no painel). */}
      <button
        type="button"
        aria-label="Fechar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 -z-10 cursor-default"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-divider bg-background outline-none sm:max-h-[88dvh] sm:max-w-[720px] sm:flex-none sm:border-2"
      >
        <header className="flex items-center justify-between gap-4 border-b-2 border-divider px-5 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Editar card
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar edição"
            className="min-h-9 min-w-9 text-lg text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          {error ? (
            <div className="py-10">
              <p role="alert" className="text-sm text-primary-text">
                {error}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 min-h-11 border-2 border-divider px-5 text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface"
              >
                Fechar
              </button>
            </div>
          ) : !data ? (
            <p className="py-10 text-sm text-muted-foreground">Carregando o card…</p>
          ) : (
            <NoteEditorScreen
              deckId={deckId}
              deckName={deckName}
              maxBytes={data.maxBytes}
              tagSuggestions={data.tagSuggestions}
              editNote={{
                noteId,
                noteType: data.noteType,
                initialDocs: data.initialDocs,
                initialTags: data.initialTags,
                clozeGroupKeys: data.clozeGroupKeys,
              }}
              onEditSaved={onSaved}
              onCancel={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
