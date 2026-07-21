import type { Extensions } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { Cloze } from "@/lib/editor/cloze-node";

/**
 * Schema ProseMirror restrito ao NoteContentV1 (arquitetura §4, D1).
 * Tudo que o formato não representa fica DESABILITADO no editor — o parser
 * nunca deveria encontrar link/strike/underline/blockquote/hr/hardBreak.
 *
 * Este módulo NÃO importa @tiptap/react: o componente do editor (outro agente)
 * importa esta lista e a passa ao useEditor.
 */

export interface EditorExtensionsOptions {
  /** basic = front/back sem cloze; cloze = campo text com node cloze. */
  mode: "basic" | "cloze";
  placeholder?: string;
}

/**
 * Imagem do formato: persiste APENAS assetId (data-asset-id) e alt.
 * src nunca vai para o NoteContentV1 — o editor client resolve a URL em
 * runtime (rota autenticada/presigned) e o serializer ignora o atributo.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      assetId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.assetId === "string" && attributes.assetId.length > 0
            ? { "data-asset-id": attributes.assetId }
            : {},
      },
    };
  },
});

export function editorExtensions(opts: EditorExtensionsOptions): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      // Fora do NoteContentV1 — desabilitados por construção.
      link: false,
      underline: false,
      strike: false,
      blockquote: false,
      horizontalRule: false,
      hardBreak: false,
      heading: { levels: [1, 2, 3] },
    }),
    Highlight,
    NoteImage,
    Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
  ];
  if (opts.mode === "cloze") {
    extensions.push(Cloze);
  }
  return extensions;
}
