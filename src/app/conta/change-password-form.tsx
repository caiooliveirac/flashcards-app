"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  changePasswordAction,
  type ChangePasswordState,
} from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/features/account/constants";

const INPUT =
  "mt-2 block w-full border-0 border-b-2 border-divider bg-surface px-3 py-3";
const LABEL = "block text-[11px] font-semibold tracking-[0.1em] uppercase";

const INITIAL: ChangePasswordState = { status: "idle" };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    INITIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Ao dar certo, limpa os campos (não deixa senha digitada no DOM).
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="mt-8 max-w-sm space-y-6">
      {state.status !== "idle" && state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`text-sm font-semibold ${
            state.status === "error" ? "text-primary-text" : "text-foreground"
          }`}
        >
          {state.status === "success" ? "✓ " : ""}
          {state.message}
        </p>
      ) : null}

      <div>
        <label htmlFor="currentPassword" className={LABEL}>
          Senha atual
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="newPassword" className={LABEL}>
          Nova senha
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          className={INPUT}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Pelo menos {MIN_PASSWORD_LENGTH} caracteres.
        </p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className={LABEL}>
          Confirmar nova senha
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className={INPUT}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        data-ms-magnetic
        data-ms-ripple="ink"
        className="min-h-12 w-full bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Salvando…" : "Trocar senha"}
      </button>
    </form>
  );
}
