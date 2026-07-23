"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitMotion } from "@/lib/motion/events";
import { PreceptorGlyph, type GlyphState } from "@/lib/motion/preceptor-glyph";

/**
 * Painel do assistente (tira-dúvidas). Botão flutuante → chat com streaming SSE.
 * O roteador do servidor escolhe o modelo pela dificuldade; o botão "Aprofundar"
 * reenvia a última pergunta forçando o perfil mais parrudo (forceDeep).
 */

type Tier = "fast" | "mid" | "deep";

interface CardDraft {
  kind: "basic" | "cloze";
  front?: string;
  back?: string;
  text?: string;
  tags?: string[];
}

type DraftStatus = "pending" | "creating" | "created" | "error";
interface DeckOption {
  id: string;
  name: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tier?: Tier;
  streaming?: boolean;
  error?: boolean;
  draft?: CardDraft;
  draftDeckId?: string;
  draftStatus?: DraftStatus;
  draftInfo?: string;
}

const TIER_LABEL: Record<Tier, string> = {
  fast: "Rápido",
  mid: "Equilibrado",
  deep: "Aprofundado",
};

const TIER_CLASS: Record<Tier, string> = {
  fast: "bg-emerald-100 text-emerald-800",
  mid: "bg-sky-100 text-sky-800",
  deep: "bg-amber-100 text-amber-900",
};

/** Render seguro: preserva quebras de linha e resolve só **negrito** (sem HTML). */
function renderContent(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) => {
    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      return <strong key={i}>{chunk.slice(2, -2)}</strong>;
    }
    return <span key={i}>{chunk}</span>;
  });
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [decks, setDecks] = useState<DeckOption[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  // Baralhos p/ o seletor de confirmação — carregados na 1ª abertura.
  useEffect(() => {
    if (!open || decks !== null) return;
    let active = true;
    fetch("/api/ai/decks")
      .then(async (r) => (r.ok ? ((await r.json()) as DeckOption[]) : []))
      .then((d) => active && setDecks(d))
      .catch(() => active && setDecks([]));
    return () => {
      active = false;
    };
  }, [open, decks]);

  const updateAt = useCallback(
    (idx: number, fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m, i) => (i === idx ? fn(m) : m))),
    [],
  );

  /** Envia `history` ao backend e faz streaming da resposta (SSE sobre fetch). */
  const run = useCallback(
    async (history: ChatMessage[], forceDeep: boolean) => {
      setBusy(true);
      setNotice(null);
      // placeholder da resposta que vai sendo preenchida pelos deltas
      setMessages([...history, { role: "assistant", content: "", streaming: true }]);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            forceDeep,
          }),
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          setNotice(data?.error ?? "Não foi possível responder agora.");
          setMessages(history); // descarta o placeholder
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "message";

        const apply = (fn: (m: ChatMessage) => ChatMessage) =>
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) next[next.length - 1] = fn(last);
            return next;
          });

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(":")) continue; // heartbeat
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                const data = JSON.parse(line.slice(5).trim());
                if (currentEvent === "meta") {
                  apply((m) => ({ ...m, tier: data.tier as Tier }));
                } else if (currentEvent === "delta") {
                  apply((m) => ({ ...m, content: m.content + data.text }));
                } else if (currentEvent === "draft") {
                  apply((m) => ({
                    ...m,
                    draft: data as CardDraft,
                    draftStatus: "pending",
                  }));
                } else if (currentEvent === "error") {
                  apply((m) => ({
                    ...m,
                    content: data.message,
                    error: true,
                    streaming: false,
                  }));
                }
              }
            }
          }
        }
        apply((m) => ({ ...m, streaming: false }));
      } catch {
        setNotice("Conexão interrompida. Tente de novo.");
        setMessages(history);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    run([...messages, { role: "user", content: text }], false);
  }, [input, busy, messages, run]);

  /** Reenvia a última pergunta do usuário forçando o perfil aprofundado. */
  const deepen = useCallback(() => {
    if (busy) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    run(messages.slice(0, lastUserIdx + 1), true);
  }, [busy, messages, run]);

  /** Confirma e cria o card proposto no baralho escolhido (§9.2). */
  const createCard = useCallback(
    async (idx: number, sourceEl?: Element | null) => {
      const msg = messages[idx];
      if (!msg?.draft) return;
      const deckId = msg.draftDeckId ?? decks?.[0]?.id;
      if (!deckId) {
        updateAt(idx, (m) => ({
          ...m,
          draftStatus: "error",
          draftInfo: "Escolha um baralho.",
        }));
        return;
      }
      updateAt(idx, (m) => ({ ...m, draftStatus: "creating", draftInfo: undefined }));
      try {
        const res = await fetch("/api/ai/create-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId, ...msg.draft }),
        });
        const data = (await res.json().catch(() => null)) as
          | { cardCount?: number; error?: string }
          | null;
        if (res.ok) {
          const n = data?.cardCount ?? 1;
          // Trail de energia: o card viaja do chat até o baralho (4g).
          emitMotion("card:accepted", {
            sourceEl,
            deckEl: document.querySelector("[data-ms-trail-target]"),
          });
          updateAt(idx, (m) => ({
            ...m,
            draftStatus: "created",
            draftInfo: `Card criado · ${n} ${n === 1 ? "card" : "cards"}`,
          }));
        } else {
          updateAt(idx, (m) => ({
            ...m,
            draftStatus: "error",
            draftInfo: data?.error ?? "Falha ao criar o card.",
          }));
        }
      } catch {
        updateAt(idx, (m) => ({
          ...m,
          draftStatus: "error",
          draftInfo: "Conexão interrompida.",
        }));
      }
    },
    [messages, decks, updateAt],
  );

  const lastMsg = messages[messages.length - 1];

  // Estado do corpo da IA derivado do que ela está de fato fazendo (4f):
  // sem resposta ainda = raciocinando; texto escorrendo = executa; parada com
  // conversa aberta = observando; painel vazio = repouso.
  const glyphState: GlyphState = busy
    ? lastMsg?.content
      ? "executa"
      : "raciocinando"
    : messages.length > 0
      ? "observando"
      : "repouso";

  const canDeepen =
    !busy &&
    lastMsg?.role === "assistant" &&
    !lastMsg.error &&
    lastMsg.tier !== "deep";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir assistente de dúvidas"
        data-ms-magnetic="6"
        data-ms-ripple="ink"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-amber-800 text-white shadow-lg transition hover:bg-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        {/* O ✳ nunca fica parado: em repouso ele respira, e reage aos eventos. */}
        <PreceptorGlyph listen className="text-white" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[min(70vh,560px)] w-[min(92vw,384px)] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 shadow-2xl">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <PreceptorGlyph state={glyphState} />
          <div>
            <p className="text-sm font-semibold text-stone-900">Preceptor</p>
            <p className="text-xs text-stone-500">Tira-dúvidas de residência</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar assistente"
          data-ms-ripple="ink"
          className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
        >
          <CloseIcon />
        </button>
      </header>

      {busy ? <div className="ms-tick h-[2px] bg-track" aria-hidden="true" /> : null}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-stone-400">
            Pergunte sobre uma conduta, uma pegadinha ou o próximo passo de um
            caso. Respondo focado no que muda a decisão.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-amber-800 px-3 py-2 text-sm text-white"
                  : `max-w-[90%] rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-3 py-2 text-sm ${
                      m.error ? "text-red-600" : "text-stone-800"
                    }`
              }
            >
              {m.role === "assistant" && m.tier && (
                <span
                  className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${TIER_CLASS[m.tier]}`}
                >
                  {TIER_LABEL[m.tier]}
                </span>
              )}
              <div className="whitespace-pre-wrap break-words">
                {renderContent(m.content)}
                {m.streaming && m.content === "" && !m.draft && (
                  <span className="text-stone-400">pensando…</span>
                )}
              </div>
              {m.draft && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-xs">
                  <p className="mb-1 font-semibold text-amber-900">
                    Card proposto ·{" "}
                    {m.draft.kind === "basic" ? "básico" : "cloze"}
                  </p>
                  {m.draft.kind === "basic" ? (
                    <div className="space-y-1 text-stone-700">
                      <p>
                        <span className="font-medium">Frente:</span>{" "}
                        {m.draft.front}
                      </p>
                      <p>
                        <span className="font-medium">Verso:</span> {m.draft.back}
                      </p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-stone-700">
                      {m.draft.text}
                    </p>
                  )}
                  {m.draft.tags?.length ? (
                    <p className="mt-1 text-stone-500">
                      tags: {m.draft.tags.join(", ")}
                    </p>
                  ) : null}

                  {m.draftStatus === "created" ? (
                    <p className="mt-2 font-medium text-emerald-700">
                      ✓ {m.draftInfo}
                    </p>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={m.draftDeckId ?? decks?.[0]?.id ?? ""}
                        onChange={(e) =>
                          updateAt(i, (mm) => ({
                            ...mm,
                            draftDeckId: e.target.value,
                          }))
                        }
                        disabled={m.draftStatus === "creating" || !decks?.length}
                        className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800"
                      >
                        {!decks?.length && <option value="">sem baralhos</option>}
                        {decks?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={(e) => createCard(i, e.currentTarget)}
                        disabled={m.draftStatus === "creating" || !decks?.length}
                        data-ms-magnetic
                        data-ms-ripple="create"
                        className="shrink-0 rounded bg-amber-800 px-2 py-1 font-medium text-white transition hover:bg-amber-900 disabled:opacity-40"
                      >
                        {m.draftStatus === "creating" ? "Criando…" : "Criar card"}
                      </button>
                    </div>
                  )}
                  {m.draftStatus === "error" && m.draftInfo && (
                    <p className="mt-1 text-red-600">{m.draftInfo}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {notice && (
        <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {notice}
        </p>
      )}

      {canDeepen && (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={deepen}
            data-ms-magnetic
            data-ms-ripple="accent"
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
          >
            <SparkIcon /> Aprofundar
          </button>
        </div>
      )}

      <div className="border-t border-stone-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Escreva sua dúvida…"
            disabled={busy}
            className="max-h-28 flex-1 resize-none rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            data-ms-magnetic
            data-ms-ripple="ink"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-800 text-white transition hover:bg-amber-900 disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
        {/* Conteúdo clínico gerado por IA: sinaliza falibilidade sem alarmar. */}
        <p className="mt-2 text-center text-[11px] leading-snug text-stone-400">
          O Preceptor pode errar. Confirme condutas em diretrizes e fontes
          oficiais.
        </p>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.8L20 9.7l-4.9 3.6L17 19l-5-3.6L7 19l1.9-5.7L4 9.7l6.1-1.9z" />
    </svg>
  );
}
