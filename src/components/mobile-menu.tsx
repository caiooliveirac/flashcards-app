"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { IconMorph } from "@/lib/motion/icon-morph";

const itemClass =
  "block w-full px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-150 ease-out hover:bg-surface";

/**
 * Menu de navegação mobile (`sm:hidden`) — no desktop a nav fica inline no
 * SiteHeader. Mesmo disclosure do DeckMenu (aria-expanded + Escape + clique
 * fora) e mesmo visual: raio zero, painel bg-background com régua
 * border-divider. Expõe Painel/Assistente/Sair, inacessíveis no celular antes.
 */
export function MobileMenu({ isAdmin = false }: { isAdmin?: boolean }) {
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

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Abrir menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-ms-ripple="ink"
        className="flex h-11 w-11 items-center justify-center border border-border text-sm leading-none transition-colors duration-150 ease-out hover:bg-surface"
      >
        <IconMorph variant="menu" />
      </button>

      {open ? (
        <nav
          id={panelId}
          aria-label="Menu principal"
          className="absolute right-0 z-50 mt-1 w-48 border border-divider bg-background p-1 shadow-lg"
        >
          <Link href="/" data-ms-ripple="ink" className={itemClass} onClick={close}>
            Baralhos
          </Link>
          <Link href="/painel" data-ms-ripple="ink" className={itemClass} onClick={close}>
            Painel
          </Link>
          <Link href="/assistente" data-ms-ripple="ink" className={itemClass} onClick={close}>
            ✳ Assistente
          </Link>
          {isAdmin ? (
            <Link href="/admin" data-ms-ripple="ink" className={itemClass} onClick={close}>
              Admin
            </Link>
          ) : null}
          <form action={signOutAction} className="mt-1 border-t border-border pt-1">
            <button type="submit" data-ms-ripple="ink" className={itemClass}>
              Sair
            </button>
          </form>
        </nav>
      ) : null}
    </div>
  );
}
