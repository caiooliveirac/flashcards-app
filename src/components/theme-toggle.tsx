"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Alterna claro/escuro. Fonte da verdade: classe `.dark` no <html> (aplicada
 * antes da 1ª pintura pelo script inline do layout, sem flash). A escolha
 * explícita fica em localStorage['theme'] = 'light' | 'dark'; sem escolha,
 * segue o sistema. Mental model leigo: um botão só, "claro ↔ escuro".
 *
 * Lemos a classe do <html> via useSyncExternalStore — é estado externo ao
 * React, então nada de setState em effect (evita mismatch de hidratação e o
 * flip de ícone é imperceptível).
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

// No servidor não sabemos o tema; assume claro (o script inline corrige antes da pintura).
function isDarkServer() {
  return false;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, isDarkServer);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage indisponível (modo privado): o tema vale só nesta sessão.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      data-ms-ripple="ink"
      aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={dark ? "Tema claro" : "Tema escuro"}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-primary-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
