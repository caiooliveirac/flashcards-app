"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  deleteDeckAction,
  reorderDeckAction,
  updateDeckAction,
} from "@/features/decks/actions";
import type { DeckStatus } from "@/features/decks/service";

interface DeckMenuProps {
  deckId: string;
  deckName: string;
  status: DeckStatus;
}

const itemClass =
  "block w-full rounded-md px-3 py-1.5 text-left text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Menu de ações por deck. Disclosure simples (aria-expanded + Escape + clique
 * fora); cada item é um form de server action — funciona por teclado.
 */
export function DeckMenu({ deckId, deckName, status }: DeckMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
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

  const isPaused = status === "paused";
  const isArchived = status === "archived";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Ações do baralho ${deckName}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border px-2 py-1 text-sm leading-none outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-border bg-card p-1 text-card-foreground shadow-sm"
        >
          <Link href={`/decks/${deckId}/edit`} className={itemClass}>
            Editar
          </Link>

          <form action={updateDeckAction}>
            <input type="hidden" name="deckId" value={deckId} />
            <input type="hidden" name="status" value={isPaused || isArchived ? "active" : "paused"} />
            <button type="submit" className={itemClass}>
              {isPaused || isArchived ? "Reativar" : "Pausar"}
            </button>
          </form>

          {!isArchived ? (
            <form action={updateDeckAction}>
              <input type="hidden" name="deckId" value={deckId} />
              <input type="hidden" name="status" value="archived" />
              <button type="submit" className={itemClass}>
                Arquivar
              </button>
            </form>
          ) : null}

          <form action={reorderDeckAction}>
            <input type="hidden" name="deckId" value={deckId} />
            <input type="hidden" name="direction" value="up" />
            <button type="submit" className={itemClass}>
              Subir
            </button>
          </form>

          <form action={reorderDeckAction}>
            <input type="hidden" name="deckId" value={deckId} />
            <input type="hidden" name="direction" value="down" />
            <button type="submit" className={itemClass}>
              Descer
            </button>
          </form>

          <form
            action={deleteDeckAction}
            onSubmit={(e) => {
              if (!window.confirm(`Excluir o baralho "${deckName}"?`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="deckId" value={deckId} />
            <button type="submit" className={`${itemClass} text-destructive`}>
              Excluir
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
