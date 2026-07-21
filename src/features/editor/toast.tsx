"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Toasts mínimos do fluxo contínuo (criado/desfazer/erro). Sem dependência:
 * host fixo acima da toolbar sticky, sucesso/info em role=status, erro em
 * role=alert; ação opcional ("Desfazer") focável por teclado.
 */

export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 6000;
const AUTO_DISMISS_ERROR_MS = 10_000;

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      const ttl = toast.kind === "error" ? AUTO_DISMISS_ERROR_MS : AUTO_DISMISS_MS;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastHost({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
            toast.kind === "error"
              ? "border-destructive bg-card text-destructive"
              : "border-border bg-card text-card-foreground"
          }`}
        >
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                dismiss(toast.id);
              }}
              className="shrink-0 font-medium text-primary underline-offset-4 outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => dismiss(toast.id)}
            className="shrink-0 text-muted-foreground outline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
