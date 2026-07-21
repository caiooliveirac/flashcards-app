import { describe, expect, it } from "vitest";
import { getSchema, type CommandProps, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Cloze } from "@/lib/editor/cloze-node";
import { editorExtensions } from "@/lib/editor/extensions";

/**
 * Os comandos são funções puras sobre EditorState (sem DOM) — dá para
 * testá-los invocando a implementação registrada em addCommands com um
 * contexto mínimo. A integração completa (editor montado) é coberta pelo
 * E2E do agente de UI.
 */

const schema = getSchema(editorExtensions({ mode: "cloze" }));

interface ClozeCommands {
  setCloze: (opts: { groupKey: string; hint?: string }) => (props: CommandProps) => boolean;
  unsetCloze: () => (props: CommandProps) => boolean;
}

function clozeCommands(): ClozeCommands {
  const addCommands = Cloze.config.addCommands;
  if (!addCommands) throw new Error("Cloze sem addCommands");
  const ctx = { name: Cloze.name, options: Cloze.options, storage: Cloze.storage };
  return addCommands.call(
    ctx as unknown as ThisParameterType<typeof addCommands>,
  ) as unknown as ClozeCommands;
}

function docFrom(json: JSONContent): PMNode {
  return schema.nodeFromJSON(json);
}

/** attrs do PM têm prototype null (computeAttrs) — normaliza para comparação estrita. */
function docJson(state: EditorState): unknown {
  return JSON.parse(JSON.stringify(state.doc.toJSON()));
}

function run(
  state: EditorState,
  command: (props: CommandProps) => boolean,
): { ok: boolean; state: EditorState } {
  let next = state;
  const props = {
    state,
    tr: state.tr,
    dispatch: (tr: Transaction) => {
      next = state.apply(tr);
    },
  } as unknown as CommandProps;
  const ok = command(props);
  return { ok, state: next };
}

const HELLO_DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
  ],
};

// paragraph abre em 0; "hello " ocupa 1..7; cloze em 7 (nodeSize 7); "world" em 8..13
const HELLO_WITH_CLOZE: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "hello " },
        {
          type: "cloze",
          attrs: { groupKey: "g1", hint: null },
          content: [{ type: "text", text: "world" }],
        },
      ],
    },
  ],
};

describe("setCloze", () => {
  it("envolve a seleção num node cloze com groupKey/hint", () => {
    const doc = docFrom(HELLO_DOC);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 7, 12),
    });
    const { ok, state: after } = run(state, clozeCommands().setCloze({ groupKey: "g1" }));
    expect(ok).toBe(true);
    expect(docJson(after)).toStrictEqual(HELLO_WITH_CLOZE);
  });

  it("preserva marks do texto selecionado e aceita hint", () => {
    const doc = docFrom({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab", marks: [{ type: "bold" }] },
            { type: "text", text: "cd" },
          ],
        },
      ],
    });
    // seleciona "b" + "c" (2..4)
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2, 4),
    });
    const { ok, state: after } = run(
      state,
      clozeCommands().setCloze({ groupKey: "g2", hint: "dica" }),
    );
    expect(ok).toBe(true);
    expect(docJson(after)).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            {
              type: "cloze",
              attrs: { groupKey: "g2", hint: "dica" },
              content: [
                { type: "text", text: "b", marks: [{ type: "bold" }] },
                { type: "text", text: "c" },
              ],
            },
            { type: "text", text: "d" },
          ],
        },
      ],
    });
  });

  it("recusa seleção vazia, groupKey inválido e seleção cruzando blocos", () => {
    const doc = docFrom(HELLO_DOC);
    const collapsed = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    expect(run(collapsed, clozeCommands().setCloze({ groupKey: "g1" })).ok).toBe(false);

    const selected = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, 5),
    });
    expect(run(selected, clozeCommands().setCloze({ groupKey: "c1" })).ok).toBe(false);
    expect(run(selected, clozeCommands().setCloze({ groupKey: "" })).ok).toBe(false);

    const twoParagraphs = docFrom({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "um" }] },
        { type: "paragraph", content: [{ type: "text", text: "dois" }] },
      ],
    });
    const crossing = EditorState.create({
      doc: twoParagraphs,
      selection: TextSelection.create(twoParagraphs, 2, 7),
    });
    expect(run(crossing, clozeCommands().setCloze({ groupKey: "g1" })).ok).toBe(false);
  });

  it("recusa seleção que já contém um cloze (nested rejeitado no V1)", () => {
    const doc = docFrom(HELLO_WITH_CLOZE);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
    expect(run(state, clozeCommands().setCloze({ groupKey: "g2" })).ok).toBe(false);
  });
});

describe("unsetCloze", () => {
  it("desembrulha com o cursor dentro do cloze (texto volta a mesclar)", () => {
    const doc = docFrom(HELLO_WITH_CLOZE);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 9) });
    const { ok, state: after } = run(state, clozeCommands().unsetCloze());
    expect(ok).toBe(true);
    expect(docJson(after)).toStrictEqual(HELLO_DOC);
  });

  it("desembrulha com NodeSelection sobre o cloze", () => {
    const doc = docFrom(HELLO_WITH_CLOZE);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 7) });
    const { ok, state: after } = run(state, clozeCommands().unsetCloze());
    expect(ok).toBe(true);
    expect(docJson(after)).toStrictEqual(HELLO_DOC);
  });

  it("retorna false fora de um cloze", () => {
    const doc = docFrom(HELLO_DOC);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    expect(run(state, clozeCommands().unsetCloze()).ok).toBe(false);
  });
});
