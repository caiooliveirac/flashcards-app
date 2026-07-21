"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ToastHost, useToasts } from "@/features/editor/toast";
import {
  deleteNoteAction,
  duplicateNoteAction,
  moveNoteAction,
  restoreNoteAction,
} from "@/features/notes/actions";

/**
 * Lista de notas do deck detail com menu por nota (Editar/Duplicar/Mover/
 * Excluir com desfazer). Client component: o toast "Desfazer" precisa
 * sobreviver ao refresh da lista — o host vive aqui, não no item.
 */

export interface NoteRow {
  id: string;
  typeLabel: string;
  preview: string;
  cardCount: number | null;
  tags: string[];
  updatedAtLabel: string;
}

export interface DeckOption {
  id: string;
  name: string;
}

export interface NotesListProps {
  notes: NoteRow[];
  decks: DeckOption[];
}

const itemClass =
  "block w-full rounded-md px-3 py-1.5 text-left text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

interface NoteMenuProps {
  note: NoteRow;
  decks: DeckOption[];
  onDuplicate: (noteId: string) => void;
  onMove: (noteId: string, targetDeckId: string) => void;
  onDelete: (noteId: string) => void;
}

function NoteMenu({ note, decks, onDuplicate, onMove, onDelete }: NoteMenuProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [targetDeck, setTargetDeck] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const selectId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMoving(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setMoving(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setMoving(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Ações da nota: ${note.preview.slice(0, 60) || note.typeLabel}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border px-2 py-1 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        ⋯
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <Link href={`/notes/${note.id}/edit`} className={itemClass}>
            Editar
          </Link>
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              close();
              onDuplicate(note.id);
            }}
          >
            Duplicar
          </button>
          {decks.length > 0 ? (
            <button
              type="button"
              aria-expanded={moving}
              className={itemClass}
              onClick={() => setMoving((v) => !v)}
            >
              Mover para…
            </button>
          ) : null}
          {moving ? (
            <div className="space-y-2 px-3 py-2">
              <label htmlFor={selectId} className="block text-xs font-medium">
                Baralho de destino
              </label>
              <select
                id={selectId}
                value={targetDeck}
                onChange={(e) => setTargetDeck(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option value="">Escolha…</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={targetDeck === ""}
                onClick={() => {
                  close();
                  onMove(note.id, targetDeck);
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground outline-offset-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                Mover
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`${itemClass} text-destructive`}
            onClick={() => {
              close();
              onDelete(note.id);
            }}
          >
            Excluir
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function NotesList({ notes, decks }: NotesListProps) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();

  async function handleDuplicate(noteId: string) {
    const res = await duplicateNoteAction({ noteId });
    if (res.ok) {
      push({ kind: "success", message: "nota duplicada" });
      router.refresh();
    } else {
      push({ kind: "error", message: res.error });
    }
  }

  async function handleMove(noteId: string, targetDeckId: string) {
    const res = await moveNoteAction({ noteId, targetDeckId });
    if (res.ok) {
      push({ kind: "success", message: "nota movida" });
      router.refresh();
    } else {
      push({ kind: "error", message: res.error });
    }
  }

  async function handleDelete(noteId: string) {
    if (!window.confirm("Excluir esta nota e seus cards?")) return;
    const res = await deleteNoteAction({ noteId });
    if (!res.ok) {
      push({ kind: "error", message: res.error });
      return;
    }
    router.refresh();
    push({
      kind: "info",
      message: "nota excluída",
      action: {
        label: "Desfazer",
        onClick: () => {
          void (async () => {
            const undo = await restoreNoteAction({ noteId });
            if (undo.ok) {
              push({ kind: "success", message: "nota restaurada" });
              router.refresh();
            } else {
              push({ kind: "error", message: undo.error });
            }
          })();
        },
      },
    });
  }

  return (
    <>
      <ul className="mt-4 space-y-3">
        {notes.map((note) => (
          <li
            key={note.id}
            className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="line-clamp-2 min-w-0 text-sm">
                {note.preview || <span className="text-muted-foreground">(sem texto)</span>}
              </p>
              <NoteMenu
                note={note}
                decks={decks}
                onDuplicate={(id) => void handleDuplicate(id)}
                onMove={(id, target) => void handleMove(id, target)}
                onDelete={(id) => void handleDelete(id)}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
                {note.typeLabel}
              </span>
              {note.cardCount !== null ? (
                <span>
                  {note.cardCount} {note.cardCount === 1 ? "card" : "cards"}
                </span>
              ) : null}
              {note.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5">
                  {tag}
                </span>
              ))}
              <span className="ml-auto">{note.updatedAtLabel}</span>
            </div>
          </li>
        ))}
      </ul>
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </>
  );
}
