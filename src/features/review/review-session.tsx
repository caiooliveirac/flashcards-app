"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent } from "@/lib/content";
import { renderBlocks, renderNoteContent } from "@/lib/render";
import { nextReviewAtAction, submitReviewAction } from "./actions";

export interface SessionCard {
  cardId: string;
  noteType: "basic" | "cloze";
  clozeGroupKey: string | null;
  content: NoteContent;
  isNew: boolean;
}

const RATINGS = [
  { value: 1, label: "Errei", key: "1", sub: "de novo em breve" },
  { value: 2, label: "Difícil", key: "2", sub: null },
  { value: 3, label: "Bom", key: "3", sub: null },
  { value: 4, label: "Fácil", key: "4", sub: null },
] as const;

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.08em]";

function mediaUrl(assetId: string, thumb?: boolean): string {
  return `/api/media/${assetId}${thumb ? "?thumb=1" : ""}`;
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 minuto";
  return `${min} ${min === 1 ? "minuto" : "minutos"}`;
}

function formatNextDue(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 60_000) return "em instantes";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `em ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `em ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `em ${days} ${days === 1 ? "dia" : "dias"}`;
}

function SessionChrome({
  deckName,
  counter,
  progressPct,
}: {
  deckName: string;
  counter: string;
  progressPct: number;
}) {
  return (
    <header className="px-6 pt-5">
      <div className={`flex items-baseline justify-between gap-4 text-muted-foreground ${KICKER}`}>
        <span className="truncate">{deckName}</span>
        <span aria-live="polite" className="shrink-0">
          {counter}
        </span>
      </div>
      <div className="mt-2 h-[3px] bg-track">
        <div
          className="h-full bg-primary transition-[width] duration-[250ms] ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </header>
  );
}

export function ReviewSession({
  deckId,
  deckName,
  cards,
}: {
  deckId: string;
  deckName: string;
  cards: SessionCard[];
}) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  // Uma key por APRESENTAÇÃO do card: retry do mesmo card reusa a key
  // (idempotência no servidor); avançar gera key nova.
  const keyRef = useRef<string>("");
  const shownAtRef = useRef<number>(0);

  const card = idx < cards.length ? cards[idx] : undefined;
  const total = cards.length;
  const reviewed = Object.values(tally).reduce((a, b) => a + b, 0);
  const done = !card;

  useEffect(() => {
    keyRef.current = crypto.randomUUID();
    shownAtRef.current = Date.now();
  }, [idx]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || pending) return;
      setPending(true);
      setError(null);
      const durationMs = Math.min(Date.now() - shownAtRef.current, 3_600_000);
      const result = await submitReviewAction({
        cardId: card.cardId,
        rating,
        idempotencyKey: keyRef.current,
        durationMs,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setTally((t) => ({ ...t, [rating]: (t[rating] ?? 0) + 1 }));
      setElapsedMs((ms) => ms + durationMs);
      setRevealed(false);
      setIdx((i) => i + 1);
      setPending(false);
    },
    [card, pending],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, rate]);

  // Fim da sessão: busca a próxima revisão do deck (omitida se indisponível).
  useEffect(() => {
    if (!done) return;
    let cancelled = false;
    void nextReviewAtAction({ deckId }).then((result) => {
      if (!cancelled && result.ok) setNextDueAt(result.nextDueAt);
    });
    return () => {
      cancelled = true;
    };
  }, [done, deckId]);

  if (!card) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SessionChrome deckName={deckName} counter={`${total} de ${total}`} progressPct={100} />
        <main className="flex flex-1 flex-col justify-center px-6 py-10">
          <p className={`text-muted-foreground ${KICKER}`}>Sessão concluída</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.15] text-pretty sm:text-[40px]">
            {reviewed} {reviewed === 1 ? "card" : "cards"} em {formatDuration(elapsedMs)}
          </h2>
          <dl className="mt-8 space-y-4 border-t-2 border-divider pt-6">
            {RATINGS.map((r) => {
              const count = tally[r.value] ?? 0;
              const pct = reviewed > 0 ? (count / reviewed) * 100 : 0;
              return (
                <div key={r.value}>
                  <div className="flex items-baseline justify-between text-sm">
                    <dt className={`font-extrabold ${r.value === 1 ? "text-primary-text" : ""}`}>
                      {r.label}
                    </dt>
                    <dd className="text-muted-foreground">{count}</dd>
                  </div>
                  <div className="mt-1.5 h-[3px] bg-track">
                    <div
                      className={`h-full ${r.value === 1 ? "bg-primary" : "bg-foreground"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </dl>
          {nextDueAt ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Próxima revisão deste baralho {formatNextDue(nextDueAt)}.
            </p>
          ) : null}
        </main>
        <div className="px-6 pb-6">
          <Link
            href="/"
            className="flex min-h-14 w-full items-center justify-center border-2 border-divider px-6 text-[15px] font-semibold transition-colors duration-150 ease-out hover:bg-surface"
          >
            Voltar aos baralhos
          </Link>
          <div className="mt-4 text-center">
            <Link
              href={`/decks/${deckId}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Abrir o baralho
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const renderOpts = {
    mediaUrl,
    cloze:
      card.noteType === "cloze"
        ? {
            hiddenGroups: revealed
              ? ("none" as const)
              : new Set(card.clozeGroupKey ? [card.clozeGroupKey] : []),
            showHints: true,
          }
        : undefined,
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <SessionChrome
        deckName={deckName}
        counter={`${Math.min(idx + 1, total)} de ${total}`}
        progressPct={total > 0 ? (reviewed / total) * 100 : 0}
      />

      <main className="flex flex-1 items-center px-6 py-8">
        <div
          className={`review-card w-full font-semibold leading-[1.45] text-pretty ${
            revealed ? "text-[21px] sm:text-2xl" : "text-2xl sm:text-[29px]"
          }`}
        >
          {card.isNew ? (
            <p className={`mb-3 text-primary-text ${KICKER}`}>Novo</p>
          ) : null}
          {card.noteType === "basic" ? (
            <>
              <div className="note-front">
                {renderBlocks(card.content.kind === "basic" ? card.content.front : [], renderOpts)}
              </div>
              {revealed && card.content.kind === "basic" && card.content.back.length > 0 ? (
                <div className="note-back">{renderBlocks(card.content.back, renderOpts)}</div>
              ) : null}
            </>
          ) : (
            renderNoteContent(card.content, renderOpts)
          )}
        </div>
      </main>

      <div className="px-6 pb-6">
        {error ? (
          <p role="alert" className="mb-3 border-2 border-divider px-3 py-2 text-sm text-primary-text">
            {error} — tente de novo.
          </p>
        ) : null}

        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="min-h-14 w-full cursor-pointer bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            Mostrar resposta<span className="hidden sm:inline"> (Espaço)</span>
          </button>
        ) : (
          <div
            role="group"
            aria-label="Avaliar resposta"
            className="grid grid-cols-2 gap-[2px] border-2 border-divider bg-divider sm:grid-cols-4"
          >
            {RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={pending}
                onClick={() => void rate(r.value)}
                className="min-h-[56px] cursor-pointer bg-background p-4 text-left transition-colors duration-150 ease-out hover:bg-surface disabled:cursor-default disabled:opacity-50"
              >
                <span
                  className={`block text-[15px] font-extrabold leading-tight ${
                    r.value === 1 ? "text-primary-text" : ""
                  }`}
                >
                  {r.label}
                </span>
                {r.sub ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{r.sub}</span>
                ) : (
                  <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                    {r.key}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 text-center">
          <Link
            href={`/decks/${deckId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Encerrar sessão
          </Link>
        </div>
      </div>
    </div>
  );
}
