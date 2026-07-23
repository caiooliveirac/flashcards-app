"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { acceptSuggestionAction, suggestCardsAction } from "@/features/assistant/actions";
import type { AssistantSuggestion } from "@/features/assistant/service";

/**
 * Assistente de criação de cards (Fase 5). Fluxo simples para o dono
 * (não-técnico): cola texto → o assistente sugere cards → você dá nota,
 * pede ajustes ou mais, e adiciona os bons ao baralho. É FACULTATIVO: falhas
 * viram um aviso calmo, nunca um erro, e a criação manual continua disponível.
 */

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-text";

interface DeckOption {
  id: string;
  name: string;
}

interface Item extends AssistantSuggestion {
  id: string;
  rating: number | null;
  status: "pending" | "saving" | "saved";
}

let counter = 0;
function makeId(): string {
  counter += 1;
  return `s${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function toItems(suggestions: AssistantSuggestion[]): Item[] {
  return suggestions.map((s) => ({ ...s, id: makeId(), rating: null, status: "pending" }));
}

export function AssistantScreen({
  decks,
  aiEnabled,
}: {
  decks: DeckOption[];
  aiEnabled: boolean;
}) {
  const [sourceText, setSourceText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const priorFrom = (list: Item[]) =>
    list.map((i) => ({ front: i.preview.front, back: i.preview.back, rating: i.rating }));

  function run(mode: "initial" | "revise" | "more") {
    if (!sourceText.trim()) {
      setNotice("Cole um texto (uma questão, um resumo…) para começar.");
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const res = await suggestCardsAction({
        sourceText,
        mode,
        feedback: feedback.trim() || undefined,
        prior: mode === "initial" ? undefined : priorFrom(items),
      });
      if (!res.ok) {
        setNotice(res.message);
        return;
      }
      const fresh = toItems(res.suggestions);
      if (fresh.length === 0) {
        setNotice("Não consegui gerar cards úteis desse texto. Tente reformular.");
        return;
      }
      setItems((prev) => {
        if (mode === "more") return [...prev.filter((i) => i.status === "saved"), ...prev.filter((i) => i.status !== "saved"), ...fresh];
        // initial/revise: mantém os já adicionados, troca os pendentes.
        return [...prev.filter((i) => i.status === "saved"), ...fresh];
      });
      setFeedback("");
    });
  }

  function setRating(id: string, rating: number | null) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, rating } : i)));
  }

  function accept(item: Item) {
    if (!deckId) {
      setNotice("Escolha um baralho antes de adicionar.");
      return;
    }
    setNotice(null);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saving" } : i)));
    startTransition(async () => {
      const res = await acceptSuggestionAction({
        deckId,
        noteType: item.noteType,
        content: item.content,
        tagNames: item.tags,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: res.ok ? "saved" : "pending" } : i,
        ),
      );
      if (!res.ok) setNotice(res.message);
    });
  }

  function acceptAll() {
    const pendings = items.filter((i) => i.status === "pending");
    if (!deckId) {
      setNotice("Escolha um baralho antes de adicionar.");
      return;
    }
    if (pendings.length === 0) return;
    setNotice(null);
    startTransition(async () => {
      for (const item of pendings) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saving" } : i)));
        const res = await acceptSuggestionAction({
          deckId,
          noteType: item.noteType,
          content: item.content,
          tagNames: item.tags,
        });
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: res.ok ? "saved" : "pending" } : i,
          ),
        );
        if (!res.ok) {
          setNotice(res.message);
          break;
        }
      }
    });
  }

  const hasPending = items.some((i) => i.status === "pending");
  const savedCount = items.filter((i) => i.status === "saved").length;

  if (!aiEnabled) {
    return (
      <div className="border border-divider bg-surface p-5 text-sm">
        <p className="font-semibold">O assistente está indisponível no momento.</p>
        <p className="mt-2 text-muted-foreground">
          Sem problema — você pode{" "}
          <Link href="/" className="font-semibold text-primary-text underline-offset-4 hover:underline">
            criar seus cards normalmente
          </Link>
          . Quando o assistente voltar, ele aparece aqui.
        </p>
      </div>
    );
  }

  if (decks.length === 0) {
    return (
      <div className="border border-divider bg-surface p-5 text-sm">
        <p className="font-semibold">Você ainda não tem baralhos.</p>
        <p className="mt-2 text-muted-foreground">
          Crie um baralho primeiro na{" "}
          <Link href="/" className="font-semibold text-primary-text underline-offset-4 hover:underline">
            página inicial
          </Link>{" "}
          e volte aqui para gerar cards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Entrada */}
      <section className="space-y-3">
        <label htmlFor="source" className={KICKER}>
          Cole aqui o material
        </label>
        <textarea
          id="source"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={6}
          placeholder="Uma questão, um trecho de resumo, uma definição…"
          className="w-full border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => run("initial")}
            data-ms-magnetic
            data-ms-ripple="ink"
            disabled={pending}
            className="min-h-11 bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && items.length === 0 ? "Gerando…" : "Sugerir cards"}
          </button>
          <span className="text-xs text-muted-foreground">
            O assistente é opcional. Você pode revisar e ajustar tudo antes de adicionar.
          </span>
        </div>
      </section>

      {notice ? (
        <p className="border-l-2 border-primary bg-surface px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {/* Sugestões */}
      {items.length > 0 ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-divider pb-3">
            <p className={KICKER}>Sugestões</p>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="deck" className="text-muted-foreground">
                Baralho:
              </label>
              <select
                id="deck"
                value={deckId}
                onChange={(e) => setDeckId(e.target.value)}
                className="min-h-9 border border-border bg-background px-2 text-sm outline-none focus:border-primary"
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conteúdo clínico gerado por IA: confira antes de estudar. */}
          <p className="text-xs text-muted-foreground">
            Cards gerados por IA podem conter erros — confira o conteúdo com
            diretrizes e fontes oficiais antes de estudar.
          </p>

          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {item.noteType === "cloze" ? "Ocultar trecho" : "Pergunta e resposta"}
                  </span>
                  {item.status === "saved" ? (
                    <span className="text-xs font-semibold text-primary-text">Adicionado ✓</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold">{item.preview.front}</p>
                {item.preview.back ? (
                  <p className="mt-1 text-sm text-muted-foreground">{item.preview.back}</p>
                ) : null}
                {item.tags.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.tags.map((t) => `#${t}`).join(" ")}
                  </p>
                ) : null}

                {item.status !== "saved" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-divider pt-3">
                    <label className="text-xs text-muted-foreground">
                      Sua nota:{" "}
                      <select
                        value={item.rating ?? ""}
                        onChange={(e) =>
                          setRating(item.id, e.target.value === "" ? null : Number(e.target.value))
                        }
                        className="ml-1 min-h-8 border border-border bg-background px-1 text-sm outline-none focus:border-primary"
                      >
                        <option value="">—</option>
                        {Array.from({ length: 11 }, (_, n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => accept(item)}
                      data-ms-magnetic
                      data-ms-ripple="create"
                      disabled={pending || item.status === "saving"}
                      className="ml-auto min-h-9 border border-border px-3 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
                    >
                      {item.status === "saving" ? "Adicionando…" : "Adicionar ao baralho"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {savedCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {savedCount} card{savedCount > 1 ? "s" : ""} adicionado{savedCount > 1 ? "s" : ""} a
              este baralho.
            </p>
          ) : null}

          {/* Ajustes */}
          <div className="space-y-3 border-t-2 border-divider pt-4">
            <label htmlFor="feedback" className={KICKER}>
              Quer ajustar? (opcional)
            </label>
            <textarea
              id="feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="Ex.: respostas mais curtas, foque no mecanismo, use mais ocultações…"
              className="w-full border border-border bg-background p-3 text-sm outline-none focus:border-primary"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => run("revise")}
                data-ms-ripple="ink"
                disabled={pending}
                className="min-h-11 border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
              >
                Refazer com meu feedback
              </button>
              <button
                type="button"
                onClick={() => run("more")}
                data-ms-ripple="ink"
                disabled={pending}
                className="min-h-11 border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
              >
                Gerar mais
              </button>
              {hasPending ? (
                <button
                  type="button"
                  onClick={acceptAll}
                  data-ms-magnetic
                  data-ms-ripple="create"
                  disabled={pending}
                  className="ml-auto min-h-11 bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Adicionar todos
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
