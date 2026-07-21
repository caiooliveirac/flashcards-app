import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { CLOZE_GROUP_KEY_RE } from "@/lib/content/schema";

/**
 * Node inline de ocultação (cloze) — arquitetura D14.
 * Estrutural (não marcação textual {{c1::}}): atributos groupKey/hint persistem
 * no JSON do ProseMirror e mapeiam 1:1 para ClozeInline do NoteContentV1.
 * Conteúdo restrito a texto (nested cloze rejeitado por construção no V1).
 *
 * Rendering no editor: renderHTML puro (sem node view React) — span com classe
 * `cloze-chip` + data-cloze-group/data-cloze-hint; estilização via CSS do agente
 * de UI.
 */

export interface SetClozeOptions {
  groupKey: string;
  hint?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cloze: {
      /** Envolve a seleção atual (texto dentro de um único bloco) num node cloze. */
      setCloze: (options: SetClozeOptions) => ReturnType;
      /** Desembrulha o cloze sob a seleção de volta para texto puro. */
      unsetCloze: () => ReturnType;
    };
  }
}

export const Cloze = Node.create({
  name: "cloze",

  inline: true,

  group: "inline",

  content: "text*",

  addAttributes() {
    return {
      groupKey: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-cloze-group"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.groupKey === "string" && attributes.groupKey.length > 0
            ? { "data-cloze-group": attributes.groupKey }
            : {},
      },
      hint: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-cloze-hint"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.hint === "string" && attributes.hint.length > 0
            ? { "data-cloze-hint": attributes.hint }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-cloze-group]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "cloze-chip" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCloze:
        ({ groupKey, hint }) =>
        ({ state, tr, dispatch }) => {
          if (!CLOZE_GROUP_KEY_RE.test(groupKey)) return false;
          const { from, to, $from, $to } = state.selection;
          // Seleção não vazia e dentro de um único bloco de texto.
          if (from === to || !$from.sameParent($to)) return false;

          const slice = state.doc.slice(from, to);
          let invalid = false;
          const texts: Array<{ text: string; marks: PMNode["marks"] }> = [];
          slice.content.descendants((node) => {
            if (node.type.name === this.name) {
              // Nested cloze é rejeitado por construção no V1.
              invalid = true;
              return false;
            }
            if (node.isText && typeof node.text === "string" && node.text.length > 0) {
              texts.push({ text: node.text, marks: node.marks });
            }
            return true;
          });
          if (invalid || texts.length === 0) return false;

          const clozeType = state.schema.nodes[this.name];
          if (!clozeType) return false;
          const content = texts.map((t) => state.schema.text(t.text, t.marks));
          const node = clozeType.create({ groupKey, hint: hint ?? null }, content);
          if (dispatch) {
            tr.replaceSelectionWith(node, false);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },

      unsetCloze:
        () =>
        ({ state, tr, dispatch }) => {
          const { selection } = state;
          let clozeNode: PMNode | null = null;
          let clozePos = -1;

          if (
            selection instanceof NodeSelection &&
            selection.node.type.name === this.name
          ) {
            clozeNode = selection.node;
            clozePos = selection.from;
          } else {
            const { $from } = selection;
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              const candidate = $from.node(depth);
              if (candidate.type.name === this.name) {
                clozeNode = candidate;
                clozePos = $from.before(depth);
                break;
              }
            }
          }

          if (!clozeNode || clozePos < 0) return false;
          if (dispatch) {
            tr.replaceWith(clozePos, clozePos + clozeNode.nodeSize, clozeNode.content);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});

/**
 * groupKeys de cloze presentes no doc PM, únicos, em ordem de aparição.
 * Puro sobre JSON — usado pela UI para decidir "novo grupo" vs "mesmo grupo".
 */
export function collectGroupKeysFromDoc(pmDoc: JSONContent): string[] {
  const keys: string[] = [];
  const walk = (node: JSONContent): void => {
    if (node.type === "cloze") {
      const groupKey: unknown = node.attrs?.groupKey;
      if (typeof groupKey === "string" && groupKey.length > 0 && !keys.includes(groupKey)) {
        keys.push(groupKey);
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(pmDoc);
  return keys;
}
