"use client";

import { useState } from "react";
import {
  proposeLeechRewriteAction,
  replaceLeechAction,
} from "@/features/assistant/actions";
import type { AssistantSuggestion } from "@/features/assistant/service";

/**
 * "Reformular com IA" para card difícil (leech). O Preceptor diz por que o card
 * não gruda e propõe 1–3 cards novos; trocar cria os novos no mesmo baralho e
 * suspende o antigo (reativável). Montado com key={cardId}: estado zera por card.
 */

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "proposal"; diagnosis: string; suggestions: AssistantSuggestion[] }
  | { kind: "saving"; diagnosis: string; suggestions: AssistantSuggestion[] }
  | { kind: "error"; message: string };

export function LeechFix({
  cardId,
  lapses,
  onReplaced,
}: {
  cardId: string;
  lapses: number;
  onReplaced: (created: number) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const propose = async () => {
    setState({ kind: "loading" });
    const r = await proposeLeechRewriteAction({ cardId });
    setState(
      r.ok
        ? { kind: "proposal", diagnosis: r.diagnosis, suggestions: r.suggestions }
        : { kind: "error", message: r.message },
    );
  };

  const replace = async () => {
    if (state.kind !== "proposal") return;
    setState({ ...state, kind: "saving" });
    const r = await replaceLeechAction({
      cardId,
      suggestions: state.suggestions.map((s) => ({
        noteType: s.noteType,
        content: s.content,
        tagNames: s.tags,
      })),
    });
    if (r.ok) onReplaced(r.created);
    else setState({ kind: "error", message: r.message });
  };

  if (state.kind === "idle" || state.kind === "error") {
    return (
      <div className="mt-3 text-sm">
        {state.kind === "error" ? (
          <p role="alert" className="mb-2 text-primary-text">
            {state.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void propose()}
          data-ms-ripple="ink"
          className="font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          ✳ Errou {lapses}× — reformular com IA
        </button>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        O Preceptor está vendo por que este card não gruda…
      </p>
    );
  }

  const saving = state.kind === "saving";
  return (
    <section
      aria-label="Proposta de reformulação"
      className="mt-3 border-2 border-divider bg-background p-4 text-sm"
    >
      <p className="font-semibold">Por que não gruda</p>
      <p className="mt-1 text-pretty text-muted-foreground">{state.diagnosis}</p>

      <p className="mt-4 font-semibold">
        {state.suggestions.length === 1 ? "Versão proposta" : `${state.suggestions.length} cards propostos`}
      </p>
      <ol className="mt-2 space-y-3">
        {state.suggestions.map((s, i) => (
          <li key={i} className="border-l-2 border-divider pl-3">
            <p className="whitespace-pre-wrap">{s.preview.front}</p>
            {s.preview.back ? (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">→ {s.preview.back}</p>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void replace()}
          disabled={saving}
          data-ms-ripple="create"
          className="min-h-11 bg-primary px-4 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Trocando…" : state.suggestions.length === 1 ? "Trocar pelo novo" : "Trocar pelos novos"}
        </button>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          disabled={saving}
          className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-40"
        >
          Manter o atual
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        O card atual é suspenso (não apagado) e os novos entram como cards novos no mesmo baralho.
      </p>
    </section>
  );
}
