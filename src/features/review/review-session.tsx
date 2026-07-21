"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteContent } from "@/lib/content";
import { renderBlocks, renderNoteContent } from "@/lib/render";
import { submitReviewAction } from "./actions";

export interface SessionCard {
  cardId: string;
  noteType: "basic" | "cloze";
  clozeGroupKey: string | null;
  content: NoteContent;
  isNew: boolean;
}

const RATINGS = [
  { value: 1, label: "Errei", key: "1", tone: "border-destructive text-destructive" },
  { value: 2, label: "Difícil", key: "2", tone: "border-amber-600 text-amber-700" },
  { value: 3, label: "Bom", key: "3", tone: "border-primary text-primary" },
  { value: 4, label: "Fácil", key: "4", tone: "border-emerald-700 text-emerald-800" },
] as const;

function mediaUrl(assetId: string, thumb?: boolean): string {
  return `/api/media/${assetId}${thumb ? "?thumb=1" : ""}`;
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
  // Uma key por APRESENTAÇÃO do card: retry do mesmo card reusa a key
  // (idempotência no servidor); avançar gera key nova.
  const keyRef = useRef<string>("");
  const shownAtRef = useRef<number>(0);

  const card = idx < cards.length ? cards[idx] : undefined;
  const total = cards.length;
  const reviewed = Object.values(tally).reduce((a, b) => a + b, 0);

  useEffect(() => {
    keyRef.current = crypto.randomUUID();
    shownAtRef.current = Date.now();
  }, [idx]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card || pending) return;
      setPending(true);
      setError(null);
      const result = await submitReviewAction({
        cardId: card.cardId,
        rating,
        idempotencyKey: keyRef.current,
        durationMs: Math.min(Date.now() - shownAtRef.current, 3_600_000),
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      setTally((t) => ({ ...t, [rating]: (t[rating] ?? 0) + 1 }));
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

  if (!card) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h2 className="text-xl font-semibold">Revisão concluída 🎉</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Você revisou {reviewed} {reviewed === 1 ? "card" : "cards"} de “{deckName}”.
        </p>
        <dl className="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-2 text-sm">
          {RATINGS.map((r) => (
            <div
              key={r.value}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium">{tally[r.value] ?? 0}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-offset-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Voltar aos baralhos
          </Link>
          <Link
            href={`/decks/${deckId}`}
            className="rounded-lg border border-border px-4 py-2 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Abrir o baralho
          </Link>
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
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Card {idx + 1} de {total}
          {card.isNew ? (
            <span className="ml-2 rounded-full border border-primary px-2 py-0.5 text-xs text-primary">
              novo
            </span>
          ) : null}
        </span>
        <span aria-hidden="true">
          {revealed ? "1–4 avalia" : "Espaço revela"}
        </span>
      </div>

      <div className="review-card mt-3 min-h-64 rounded-xl border border-border bg-card p-6 shadow-sm">
        {card.noteType === "basic" ? (
          <>
            <div className="note-front">{renderBlocks(card.content.kind === "basic" ? card.content.front : [], renderOpts)}</div>
            {revealed && card.content.kind === "basic" && card.content.back.length > 0 ? (
              <div className="note-back mt-4 border-t border-border pt-4">
                {renderBlocks(card.content.back, renderOpts)}
              </div>
            ) : null}
          </>
        ) : (
          renderNoteContent(card.content, renderOpts)
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
          {error} — tente de novo.
        </p>
      ) : null}

      <div className="mt-4">
        {!revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground outline-offset-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Mostrar resposta
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Avaliar resposta">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={pending}
                onClick={() => void rate(r.value)}
                className={`rounded-lg border bg-card px-3 py-3 text-sm font-medium outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${r.tone}`}
              >
                {r.label}
                <span className="mt-0.5 block text-xs text-muted-foreground">{r.key}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 text-center">
        <Link
          href={`/decks/${deckId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Encerrar e voltar ao baralho
        </Link>
      </div>
    </div>
  );
}
