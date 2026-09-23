"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestExplain } from "@/components/ai-assistant/explain";
import { LiveCount } from "@/lib/motion/components";
import { emitMotion } from "@/lib/motion/events";
import { renderBlocks, renderNoteContent } from "@/lib/render";
import {
  buryCardAction,
  nextReviewAtAction,
  submitReviewAction,
  suspendCardAction,
  undoReviewAction,
} from "./actions";
import { LeechFix } from "./leech-fix";
import {
  advanceQueue,
  dropNote,
  initialQueue,
  remainingCount,
  shouldRequeue,
  undoQueue,
} from "./session-queue";
import type { SessionCard } from "./session-types";

export type { SessionCard } from "./session-types";

const RATINGS = [
  { value: 1, label: "Errei", key: "1", magnetism: 8 },
  { value: 2, label: "Difícil", key: "2", magnetism: 6 },
  { value: 3, label: "Bom", key: "3", magnetism: 5 },
  { value: 4, label: "Fácil", key: "4", magnetism: 4 },
] as const;

const KICKER = "text-[11px] font-semibold uppercase tracking-[0.08em]";
// Mesma triagem da home: a partir daqui a sessão conta como resgate de backlog.
const TRIAGE_SIZE = 20;

function mediaUrl(assetId: string, thumb?: boolean): string {
  return `/api/media/${assetId}${thumb ? "?thumb=1" : ""}`;
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "menos de 1 minuto";
  return `${min} ${min === 1 ? "minuto" : "minutos"}`;
}

/** Intervalo curto para os botões: <1min, 12min, 3h, 5d. */
function formatInterval(ms: number): string {
  if (ms < 60_000) return "<1min";
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mês`;
  return `${Math.round(d / 365)}a`;
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
  done,
  remaining,
  progressPct,
  ticking,
}: {
  deckName: string;
  done: number;
  remaining: number | null;
  progressPct: number;
  /** Enquanto a sessão corre, a barra ganha o tick de presença (2b). */
  ticking?: boolean;
}) {
  return (
    <header className="px-6 pt-5">
      <div className={`flex items-baseline justify-between gap-4 text-muted-foreground ${KICKER}`}>
        <span className="truncate">{deckName}</span>
        {/* Contagem viva (2a): os números flipam, nunca trocam secos. */}
        <span aria-live="polite" className="shrink-0">
          {remaining === null ? (
            <>
              <LiveCount value={done} /> de {done}
            </>
          ) : (
            <>
              <LiveCount value={done} /> feitos · <LiveCount value={remaining} /> na fila
            </>
          )}
        </span>
      </div>
      <div className={`mt-2 h-[3px] bg-track ${ticking ? "ms-tick" : ""}`}>
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
  studySessionId,
  aiEnabled = false,
}: {
  deckId: string;
  deckName: string;
  cards: SessionCard[];
  studySessionId?: string;
  /** Preceptor disponível (chave de IA configurada) — liga Explicar/Reformular. */
  aiEnabled?: boolean;
}) {
  // Fila única com transição pura (session-queue.ts). Antes eram três estados
  // atualizados em updaters aninhados, o que tornava a transição imprevisível.
  const [queue, setQueue] = useState(() => initialQueue(cards));
  const { current } = queue;

  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [reviewedCount, setReviewedCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Última ação (undo de 1 nível, como o Anki).
  const lastActionRef = useRef<{ card: SessionCard; rating: number; durationMs: number } | null>(
    null,
  );
  const [canUndo, setCanUndo] = useState(false);

  const total = cards.length;
  // Espelho de reviewedCount para a celebração de fim de sessão ler sem virar
  // dependência do efeito (senão ele reemitiria a cada revisão).
  const reviewedRef = useRef(0);
  useEffect(() => {
    reviewedRef.current = reviewedCount;
  }, [reviewedCount]);
  const keyRef = useRef<string>("");
  const shownAtRef = useRef<number>(0);
  const done = current === null;

  // Nova apresentação → key idempotente nova + cronômetro (só refs, sem render).
  // A dependência é `presentation`, não `current`: reapresentar o MESMO objeto
  // de card não mudava a identidade do estado, a key ficava velha e o servidor
  // descartava a avaliação como duplicata — o card nunca progredia.
  useEffect(() => {
    if (!current) return;
    keyRef.current = crypto.randomUUID();
    shownAtRef.current = Date.now();
  }, [queue.presentation, current]);

  /**
   * Próxima apresentação. `requeue` devolve o card avaliado ao learn-ahead e
   * `burySiblingsOfNote` tira os irmãos da nota da sessão — o servidor já os
   * enterra, mas a fila do cliente é um snapshot do carregamento da página.
   */
  const advance = useCallback(
    (options: Parameters<typeof advanceQueue>[1] = {}) => {
      setRevealed(false);
      setMenuOpen(false);
      setQueue((q) => advanceQueue(q, options));
    },
    [],
  );

  /** Revela a resposta e anuncia a coreografia (flip + obturador). */
  const reveal = useCallback(() => {
    setRevealed(true);
    if (current) emitMotion("review:reveal", { cardId: current.cardId });
  }, [current]);

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      const card = current;
      if (!card || pending) return;
      setPending(true);
      setError(null);
      setNotice(null);
      const durationMs = Math.min(Date.now() - shownAtRef.current, 3_600_000);
      const result = await submitReviewAction({
        cardId: card.cardId,
        rating,
        idempotencyKey: keyRef.current,
        durationMs,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(studySessionId ? { studySessionId } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      // Fato, não animação: quem escuta decide a coreografia (dock, campo…).
      emitMotion("review:rated", { cardId: card.cardId, rating });
      setTally((t) => ({ ...t, [rating]: (t[rating] ?? 0) + 1 }));
      setReviewedCount((n) => n + 1);
      setElapsedMs((ms) => ms + durationMs);
      lastActionRef.current = { card, rating, durationMs };
      setCanUndo(true);

      // Reentrada intra-sessão: card em learning vencendo dentro da janela
      // volta à fila — mas só reaparece quando o horário chegar de fato.
      const now = Date.now();
      const dueInMs = new Date(result.dueAt).getTime() - now;
      setPending(false);
      advance({
        ...(shouldRequeue(result.state, result.dueAt, now)
          ? { requeue: { card, readyAt: now + Math.max(0, dueInMs) } }
          : {}),
        // Espelha o sibling burial que o servidor acabou de aplicar.
        burySiblingsOfNote: card.noteId,
        exclude: card.cardId,
        now,
      });
    },
    [current, pending, advance, studySessionId],
  );

  const undo = useCallback(async () => {
    const last = lastActionRef.current;
    if (!last || pending) return;
    setPending(true);
    setError(null);
    const result = await undoReviewAction({ cardId: last.card.cardId });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    // Reverte contadores e re-apresenta o card desfeito imediatamente.
    setTally((t) => ({ ...t, [last.rating]: Math.max(0, (t[last.rating] ?? 0) - 1) }));
    setReviewedCount((n) => Math.max(0, n - 1));
    setElapsedMs((ms) => Math.max(0, ms - last.durationMs));
    setRevealed(false);
    setMenuOpen(false);
    setQueue((q) => undoQueue(q, last.card));
    lastActionRef.current = null;
    setCanUndo(false);
    setPending(false);
    // `current` não é mais dependência: undoQueue devolve o card da tela à fila.
  }, [pending]);

  const manage = useCallback(
    async (kind: "suspend" | "bury", includeSiblings?: boolean) => {
      const card = current;
      if (!card || pending) return;
      setPending(true);
      setError(null);
      const result =
        kind === "suspend"
          ? await suspendCardAction({ cardId: card.cardId })
          : await buryCardAction({ cardId: card.cardId, includeSiblings });
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      // Card sai da sessão; enterrar irmãos também os remove das filas.
      lastActionRef.current = null;
      setCanUndo(false);
      if (includeSiblings) setQueue((q) => dropNote(q, card.noteId));
      setPending(false);
      advance();
    },
    [current, pending, advance],
  );

  /** Leech trocado por cards novos: o antigo já foi suspenso no servidor. */
  const onLeechReplaced = useCallback(
    (created: number) => {
      lastActionRef.current = null;
      setCanUndo(false);
      setNotice(
        `${created} ${created === 1 ? "card novo criado" : "cards novos criados"} no baralho — o antigo foi suspenso.`,
      );
      advance();
    },
    [advance],
  );

  // Atalhos de teclado: espaço revela; 1-4 avalia; U desfaz.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if ((e.key === "u" || e.key === "U") && canUndo && !pending) {
        e.preventDefault();
        void undo();
        return;
      }
      if (!current) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, revealed, rate, reveal, undo, canUndo, pending]);

  // Fim da sessão: busca a próxima revisão do deck (omitida se indisponível).
  useEffect(() => {
    if (!done) return;
    // Microcelebração: variante "resgate" quando a sessão zerou um backlog.
    // Lido por ref para não reemitir a cada revisão contabilizada.
    const reviewed = reviewedRef.current;
    emitMotion("session:done", {
      reviewed,
      ...(reviewed >= TRIAGE_SIZE ? { variant: "rescue" as const } : {}),
    });
    let cancelled = false;
    void nextReviewAtAction({ deckId }).then((result) => {
      if (!cancelled && result.ok) setNextDueAt(result.nextDueAt);
    });
    return () => {
      cancelled = true;
    };
  }, [done, deckId]);

  if (!current) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SessionChrome deckName={deckName} done={total} remaining={null} progressPct={100} />
        {/* Microcelebração (handoff §3 · 4h): as réguas IMPRIMEM em sequência,
            depois o número CARIMBA. Sem confete — o alívio é editorial. */}
        <main className="flex flex-1 flex-col justify-center px-6 py-10">
          <p className={`text-muted-foreground ${KICKER}`}>Sessão concluída</p>
          <h2 className="ms-stamp mt-3 text-[32px] font-semibold leading-[1.15] text-pretty sm:text-[40px]">
            {reviewedCount} {reviewedCount === 1 ? "revisão" : "revisões"} em{" "}
            {formatDuration(elapsedMs)}
          </h2>
          <dl className="mt-8 space-y-4 border-t-2 border-divider pt-6">
            {RATINGS.map((r, i) => {
              const count = tally[r.value] ?? 0;
              const pct = reviewedCount > 0 ? (count / reviewedCount) * 100 : 0;
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
                      className={`ms-print h-full ${r.value === 1 ? "bg-primary" : "bg-foreground"}`}
                      style={
                        {
                          width: `${pct}%`,
                          "--ms-i": i,
                        } as React.CSSProperties
                      }
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
            data-ms-press
            data-ms-magnetic
            data-ms-ripple="ink"
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

  const card = current;
  const remaining = remainingCount(queue);
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
        done={reviewedCount}
        remaining={remaining}
        ticking={pending}
        progressPct={total > 0 ? (reviewedCount / (reviewedCount + remaining)) * 100 : 0}
      />

      <main className="flex flex-1 items-center px-6 py-8">
        {/* Objeto-herói: matéria (lastro translateZ), brilho especular seguindo
            o cursor e tilt de 8° — o card é uma coisa, não um retângulo. */}
        <div
          key={card.cardId}
          data-ms-tilt="8"
          className={`review-card ms-matter ms-specular w-full p-5 font-semibold leading-[1.45] text-pretty ${
            revealed ? "ms-flip-impulse text-[21px] sm:text-2xl" : "text-2xl sm:text-[29px]"
          }`}
        >
          <div className={`mb-3 flex items-center gap-2 ${KICKER}`}>
            {card.isNew ? <span className="text-primary-text">Novo</span> : null}
            {card.isLeech ? (
              <span
                className="border border-primary-text px-1.5 py-0.5 text-primary-text"
                title={`Você errou este card ${card.lapses}× — vale reformular ou suspender`}
              >
                Card difícil
              </span>
            ) : null}
          </div>
          {card.noteType === "basic" ? (
            <>
              <div className="note-front">
                {renderBlocks(card.content.kind === "basic" ? card.content.front : [], renderOpts)}
              </div>
              {revealed && card.content.kind === "basic" && card.content.back.length > 0 ? (
                // Obturador: a resposta é descoberta por máscara, nunca por fade.
                <div className="note-back ms-shutter">
                  {renderBlocks(card.content.back, renderOpts)}
                </div>
              ) : null}
            </>
          ) : (
            renderNoteContent(card.content, renderOpts)
          )}
        </div>
      </main>

      <div className="px-6 pb-6">
        {notice ? (
          <p aria-live="polite" className="mb-3 border-2 border-divider px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}
        {aiEnabled && card.isLeech && revealed ? (
          // Depois de revelar: a proposta mostra respostas, não pode vazar antes.
          <div className="mb-3">
            <LeechFix key={card.cardId} cardId={card.cardId} lapses={card.lapses} onReplaced={onLeechReplaced} />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mb-3 border-2 border-divider px-3 py-2 text-sm text-primary-text">
            {error} — tente de novo.
          </p>
        ) : null}

        {!revealed ? (
          <button
            type="button"
            onClick={() => reveal()}
            data-ms-magnetic
            data-ms-ripple="ink"
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
            {RATINGS.map((r, i) => (
              <button
                key={r.value}
                type="button"
                disabled={pending}
                onClick={() => void rate(r.value)}
                // Magnetismo cresce com a urgência: "Errei" atrai mais, porque
                // o erro é o que pede atenção (handoff §7 · 4c).
                data-ms-magnetic={r.magnetism}
                data-ms-ripple={r.value === 1 ? "accent" : "ink"}
                className="min-h-[56px] cursor-pointer bg-background p-4 text-left transition-colors duration-150 ease-out hover:bg-surface disabled:cursor-default disabled:opacity-50"
              >
                <span
                  className={`block text-[15px] font-extrabold leading-tight ${
                    r.value === 1 ? "text-primary-text" : ""
                  }`}
                >
                  {r.label}
                </span>
                {/* Preview de intervalo flipa ao ser revelado (contagem viva, 2a) */}
                <span className="ms-flip mt-0.5 block text-xs text-muted-foreground">
                  {formatInterval(card.previewMs[i]!)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-4 text-sm">
          <button
            type="button"
            onClick={() => void undo()}
            disabled={!canUndo || pending}
            data-ms-ripple="danger"
            className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-40 disabled:hover:no-underline"
          >
            ↶ Desfazer<span className="hidden sm:inline"> (U)</span>
          </button>

          {aiEnabled && revealed ? (
            <button
              type="button"
              onClick={() =>
                requestExplain({ deckName, cardText: card.aiText, lapses: card.lapses })
              }
              data-ms-ripple="ink"
              className="font-semibold text-primary-text underline-offset-4 hover:underline"
            >
              ✳ Explicar
            </button>
          ) : null}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={pending}
              aria-expanded={menuOpen}
              className="text-muted-foreground underline-offset-4 hover:underline disabled:opacity-40"
            >
              Opções
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-full right-0 mb-2 w-52 border-2 border-divider bg-background p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void manage("bury")}
                  data-ms-ripple="ink"
                  className="block w-full px-3 py-2 text-left hover:bg-surface"
                >
                  Enterrar até amanhã
                </button>
                {card.noteType === "cloze" ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void manage("bury", true)}
                    data-ms-ripple="ink"
                    className="block w-full px-3 py-2 text-left hover:bg-surface"
                  >
                    Enterrar a nota inteira
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void manage("suspend")}
                  data-ms-ripple="danger"
                  className="block w-full px-3 py-2 text-left text-primary-text hover:bg-surface"
                >
                  Suspender card
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 text-center">
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
