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
import { IconMorph } from "@/lib/motion/icon-morph";

/**
 * Lista de notas do deck detail com menu por nota (Editar/Duplicar/Mover/
 * Excluir com desfazer). Client component: o toast "Desfazer" precisa
 * sobreviver ao refresh da lista — o host vive aqui, não no item.
 *
 * Redesign "Editorial Cognition": índice de regras (linhas separadas por
 * réguas de 1px, sem caixas) — desktop em grid 90px/1fr/200px/150px
 * (nº+tipo · conteúdo · tags · edição) + coluna estreita para o menu.
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

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.1em]";

const itemClass =
  "block w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 ease-out hover:bg-surface";

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
        data-ms-ripple="ink"
        className="flex h-11 w-11 items-center justify-center border border-border text-sm leading-none transition-colors duration-150 ease-out hover:bg-surface"
      >
        <IconMorph variant="menu" />
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-30 mt-1 w-56 border border-divider bg-background p-1 shadow-lg"
        >
          <Link href={`/notes/${note.id}/edit`} data-ms-ripple="ink" className={itemClass}>
            Editar
          </Link>
          <button
            type="button"
            data-ms-ripple="create"
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
              data-ms-ripple="ink"
              className={itemClass}
              onClick={() => setMoving((v) => !v)}
            >
              Mover para…
            </button>
          ) : null}
          {moving ? (
            <div className="space-y-2 px-3 py-2">
              <label
                htmlFor={selectId}
                className={`block ${KICKER} text-muted-foreground`}
              >
                Baralho de destino
              </label>
              <select
                id={selectId}
                value={targetDeck}
                onChange={(e) => setTargetDeck(e.target.value)}
                className="min-h-11 w-full border-b border-border bg-surface px-2 py-1.5 text-sm"
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
                data-ms-magnetic
                data-ms-ripple="ink"
                className="min-h-11 bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover disabled:opacity-50"
              >
                Mover
              </button>
            </div>
          ) : null}
          <button
            type="button"
            data-ms-ripple="danger"
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
      <div
        aria-hidden="true"
        className={`mt-10 hidden border-b-2 border-divider pb-2 text-muted-foreground md:grid md:grid-cols-[90px_minmax(0,1fr)_200px_150px_44px] md:gap-x-4 ${KICKER}`}
      >
        <span>Nº</span>
        <span>Conteúdo</span>
        <span>Tags</span>
        <span>Edição</span>
        <span />
      </div>
      <ul className="mt-4 md:mt-0">
        {notes.map((note, index) => {
          const number = `#${String(index + 1).padStart(2, "0")}`;
          return (
            <li
              key={note.id}
              className="ms-reveal ms-lift border-b border-border transition-colors duration-150 ease-out hover:bg-surface"
            >
              <div className="flex items-start gap-3 py-4 md:grid md:grid-cols-[90px_minmax(0,1fr)_200px_150px_44px] md:gap-x-4">
                <div className="hidden md:block">
                  <p className="text-sm font-extrabold tabular-nums">{number}</p>
                  <p className={`mt-1 ${KICKER} text-muted-foreground`}>{note.typeLabel}</p>
                  {note.cardCount !== null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {note.cardCount} {note.cardCount === 1 ? "card" : "cards"}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-relaxed">
                    {note.preview || <span className="text-muted-foreground">(sem texto)</span>}
                  </p>
                  <p className={`mt-2 ${KICKER} text-muted-foreground md:hidden`}>
                    {[
                      `${number} · ${note.typeLabel}`,
                      note.cardCount !== null
                        ? `${note.cardCount} ${note.cardCount === 1 ? "card" : "cards"}`
                        : null,
                      note.tags.length > 0 ? note.tags.join(", ") : null,
                      note.updatedAtLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="hidden truncate text-xs text-muted-foreground md:block">
                  {note.tags.length > 0 ? note.tags.join(", ") : "—"}
                </p>
                <p className="hidden text-xs tabular-nums text-muted-foreground md:block">
                  {note.updatedAtLabel}
                </p>
                <NoteMenu
                  note={note}
                  decks={decks}
                  onDuplicate={(id) => void handleDuplicate(id)}
                  onMove={(id, target) => void handleMove(id, target)}
                  onDelete={(id) => void handleDelete(id)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </>
  );
}
