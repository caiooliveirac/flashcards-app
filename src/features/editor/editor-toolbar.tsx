"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useId } from "react";

/**
 * Toolbar única do editor (opera no editor com foco). Mobile (pesquisa R10,
 * issue tiptap#6571): botões com preventDefault em onMouseDown para o iOS não
 * perder a seleção/teclado; o container é sticky bottom com safe-area no
 * componente pai. Sem BubbleMenu em touch.
 *
 * Redesign: botões ≥44×44px, borda 1px, raio zero; estado ativo em tinta
 * invertida; ação contextual do cloze ("Ocultar trecho") é o botão primário.
 */

export interface EditorToolbarProps {
  editor: Editor | null;
  /** Modo cloze: mostra os botões de ocultação. */
  cloze?: {
    onHideNew: () => void;
    onHideSame: () => void;
    sameEnabled: boolean;
  };
  onFiles: (files: File[]) => void;
}

interface ToolbarButtonProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  /** "primary" = ação contextual em destaque (accent). */
  variant?: "default" | "primary";
}

function ToolbarButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
  title,
  variant = "default",
}: ToolbarButtonProps) {
  const surface =
    variant === "primary"
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover hover:border-primary-hover"
      : pressed
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-background hover:bg-surface";
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      // preventDefault: iOS Safari perde a seleção do editor no mousedown (R10).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      data-ms-ripple={variant === "primary" ? "create" : "ink"}
      className={`min-h-11 min-w-11 border px-2.5 text-sm transition-colors duration-150 ease-out disabled:opacity-40 ${surface}`}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({ editor, cloze, onFiles }: EditorToolbarProps) {
  const fileInputId = useId();
  const state = useEditorState({
    editor,
    selector: (snapshot) => {
      const e = snapshot.editor;
      if (!e) return null;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        code: e.isActive("code"),
        highlight: e.isActive("highlight"),
        heading2: e.isActive("heading", { level: 2 }),
        bulletList: e.isActive("bulletList"),
        codeBlock: e.isActive("codeBlock"),
      };
    },
  });

  const run = (fn: (e: Editor) => void) => {
    if (editor) fn(editor);
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatação do editor"
      className="flex flex-wrap items-center gap-1.5"
    >
      <ToolbarButton
        label="Negrito"
        title="Negrito (Cmd/Ctrl+B)"
        pressed={state?.bold ?? false}
        onClick={() => run((e) => e.chain().focus().toggleBold().run())}
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        label="Itálico"
        title="Itálico (Cmd/Ctrl+I)"
        pressed={state?.italic ?? false}
        onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Código inline"
        pressed={state?.code ?? false}
        onClick={() => run((e) => e.chain().focus().toggleCode().run())}
      >
        <span className="font-mono">{"<>"}</span>
      </ToolbarButton>
      <ToolbarButton
        label="Marca-texto"
        pressed={state?.highlight ?? false}
        onClick={() => run((e) => e.chain().focus().toggleHighlight().run())}
      >
        <span className="bg-urgent-strong px-0.5 text-foreground">M</span>
      </ToolbarButton>
      <ToolbarButton
        label="Título"
        pressed={state?.heading2 ?? false}
        onClick={() => run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Lista"
        pressed={state?.bulletList ?? false}
        onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
      >
        • —
      </ToolbarButton>
      <ToolbarButton
        label="Bloco de código"
        pressed={state?.codeBlock ?? false}
        onClick={() => run((e) => e.chain().focus().toggleCodeBlock().run())}
      >
        <span className="font-mono">{"{ }"}</span>
      </ToolbarButton>

      {/* Caminho MOBILE do aceite F2#4: input de arquivo real, acionado pelo label. */}
      <label
        htmlFor={fileInputId}
        onMouseDown={(e) => e.preventDefault()}
        className="inline-flex min-h-11 cursor-pointer items-center border border-border bg-background px-2.5 text-sm transition-colors duration-150 ease-out hover:bg-surface"
      >
        Imagem
        <input
          id={fileInputId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) onFiles(files);
          }}
        />
      </label>

      {cloze ? (
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ToolbarButton
            label="Ocultar trecho selecionado (novo grupo)"
            title="Ocultar trecho (Cmd/Ctrl+Shift+C)"
            variant="primary"
            onClick={cloze.onHideNew}
          >
            Ocultar trecho
          </ToolbarButton>
          <ToolbarButton
            label="Ocultar no mesmo grupo da última ocultação"
            disabled={!cloze.sameEnabled}
            onClick={cloze.onHideSame}
          >
            Ocultar junto com o anterior
          </ToolbarButton>
        </span>
      ) : null}
    </div>
  );
}
