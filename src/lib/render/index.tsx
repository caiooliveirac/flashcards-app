import { Fragment, type ReactNode } from "react";
import katex from "katex";
import type {
  Block,
  ClozeInline,
  Inline,
  NoteContent,
  TextInline,
} from "@/lib/content/schema";

/**
 * Renderizador React do NoteContentV1 para estudo/preview (arquitetura D13):
 * walker próprio da árvore validada — sem dangerouslySetInnerHTML, sem DOM,
 * server-safe (sem hooks, sem 'use client'; usável direto em RSC).
 *
 * - Imagem: src SEMPRE via opts.mediaUrl(assetId) — nunca URL vinda do JSON.
 * - math/formula: latex literal em <code> (KaTeX é débito registrado da F2).
 * - Cloze oculto: <span class="cloze-hidden">[...]</span> (ou [hint] com
 *   showHints); revelado: <span class="cloze-revealed">texto</span>.
 *
 * Classes CSS emitidas (estilização é do agente de UI): cloze-hidden,
 * cloze-revealed, note-front, note-back, note-text, note-image,
 * note-codeblock, note-math, note-formula, note-callout,
 * note-callout-{info|warning|success|danger}.
 */

export interface ClozeRenderOptions {
  /** 'all' oculta todos os grupos; Set oculta só os listados; 'none' revela tudo. */
  hiddenGroups: "all" | "none" | Set<string>;
  showHints?: boolean;
}

export interface RenderNoteContentOptions {
  /** Resolve a URL autenticada/assinada da mídia — nunca vem do JSON. */
  mediaUrl: (assetId: string, thumb?: boolean) => string;
  /** Ausente = todos os clozes revelados. */
  cloze?: ClozeRenderOptions;
}

function isHidden(groupKey: string, cloze?: ClozeRenderOptions): boolean {
  if (!cloze || cloze.hiddenGroups === "none") return false;
  if (cloze.hiddenGroups === "all") return true;
  return cloze.hiddenGroups.has(groupKey);
}

function renderTextInline(t: TextInline, key: number): ReactNode {
  let el: ReactNode = t.text;
  const marks = t.marks ?? [];
  // Aninhamento determinístico: strong > em > mark > code (de fora para dentro).
  if (marks.includes("code")) el = <code>{el}</code>;
  if (marks.includes("highlight")) el = <mark>{el}</mark>;
  if (marks.includes("italic")) el = <em>{el}</em>;
  if (marks.includes("bold")) el = <strong>{el}</strong>;
  return <Fragment key={key}>{el}</Fragment>;
}

function renderCloze(
  c: ClozeInline,
  key: number,
  opts: RenderNoteContentOptions,
): ReactNode {
  if (isHidden(c.groupKey, opts.cloze)) {
    const label = opts.cloze?.showHints && c.hint ? `[${c.hint}]` : "[...]";
    return (
      <span key={key} className="cloze-hidden" data-cloze-group={c.groupKey}>
        {label}
      </span>
    );
  }
  return (
    <span key={key} className="cloze-revealed" data-cloze-group={c.groupKey}>
      {c.content.map((t, i) => renderTextInline(t, i))}
    </span>
  );
}

function renderInlines(
  inlines: ReadonlyArray<Inline>,
  opts: RenderNoteContentOptions,
): ReactNode[] {
  return inlines.map((inline, i) => {
    if (inline.type === "text") return renderTextInline(inline, i);
    if (inline.type === "cloze") return renderCloze(inline, i, opts);
    return (
      <span
        key={i}
        className="note-math"
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(inline.latex, { throwOnError: false }),
        }}
      />
    );
  });
}

function renderBlock(
  block: Block<Inline>,
  key: number,
  opts: RenderNoteContentOptions,
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p key={key}>{renderInlines(block.content, opts)}</p>;
    case "heading": {
      const Heading = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
      return <Heading key={key}>{renderInlines(block.content, opts)}</Heading>;
    }
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>{item.blocks.map((b, j) => renderBlock(b, j, opts))}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "codeBlock":
      return (
        <pre key={key} className="note-codeblock">
          <code className={block.language ? `language-${block.language}` : undefined}>
            {block.text}
          </code>
        </pre>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- mídia privada servida por rota autenticada/presigned; next/image não se aplica
        <img
          key={key}
          className="note-image"
          src={opts.mediaUrl(block.assetId)}
          alt={block.alt ?? ""}
        />
      );
    case "formula":
      return (
        <p
          key={key}
          className="note-formula"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(block.latex, {
              throwOnError: false,
              displayMode: true,
            }),
          }}
        />
      );
    case "callout":
      return (
        <div key={key} className={`note-callout note-callout-${block.variant}`}>
          {block.content.map((b, i) => renderBlock(b, i, opts))}
        </div>
      );
  }
}

/** Renderiza uma lista de blocks (um campo da nota). */
export function renderBlocks(
  blocks: ReadonlyArray<Block<Inline>>,
  opts: RenderNoteContentOptions,
): ReactNode {
  return <>{blocks.map((b, i) => renderBlock(b, i, opts))}</>;
}

/**
 * Renderiza a nota inteira: basic → .note-front + .note-back (verso omitido
 * se vazio); cloze → .note-text. Para renderizar um campo isolado (ex.: só a
 * frente antes do flip), use renderBlocks(content.front, opts).
 */
export function renderNoteContent(
  content: NoteContent,
  opts: RenderNoteContentOptions,
): ReactNode {
  if (content.kind === "basic") {
    return (
      <>
        <div className="note-front">{renderBlocks(content.front, opts)}</div>
        {content.back.length > 0 ? (
          <div className="note-back">{renderBlocks(content.back, opts)}</div>
        ) : null}
      </>
    );
  }
  return <div className="note-text">{renderBlocks(content.text, opts)}</div>;
}
