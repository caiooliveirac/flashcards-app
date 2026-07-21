import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteContent } from "@/lib/content/schema";
import { renderBlocks, renderNoteContent } from "@/lib/render";

const mediaUrl = (assetId: string, thumb?: boolean): string =>
  `/api/media/${assetId}${thumb ? "?thumb=1" : ""}`;

const ASSET_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

const basicNote: NoteContent = {
  schemaVersion: 1,
  kind: "basic",
  front: [
    { type: "heading", level: 3, content: [{ type: "text", text: "Título" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "negrito", marks: ["bold"] },
        { type: "text", text: " itálico", marks: ["italic"] },
        { type: "text", text: " marcado", marks: ["highlight"] },
        { type: "text", text: " codigo", marks: ["code"] },
      ],
    },
  ],
  back: [
    {
      type: "list",
      ordered: false,
      items: [
        { blocks: [{ type: "paragraph", content: [{ type: "text", text: "item A" }] }] },
      ],
    },
    { type: "image", assetId: ASSET_ID, alt: "esquema" },
  ],
};

const clozeNote: NoteContent = {
  schemaVersion: 1,
  kind: "cloze",
  text: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "capital: " },
        {
          type: "cloze",
          groupKey: "g1",
          hint: "país da Ásia",
          content: [{ type: "text", text: "Tóquio", marks: ["bold"] }],
        },
        { type: "text", text: " e " },
        { type: "cloze", groupKey: "g2", content: [{ type: "text", text: "Brasília" }] },
      ],
    },
  ],
};

describe("renderNoteContent — basic", () => {
  const markup = renderToStaticMarkup(renderNoteContent(basicNote, { mediaUrl }));

  it("renderiza marks como strong/em/mark/code e heading no nível certo", () => {
    expect(markup).toContain("<strong>negrito</strong>");
    expect(markup).toContain("<em> itálico</em>");
    expect(markup).toContain("<mark> marcado</mark>");
    expect(markup).toContain("<code> codigo</code>");
    expect(markup).toContain("<h3>Título</h3>");
  });

  it("envolve frente e verso em note-front/note-back", () => {
    expect(markup).toContain('class="note-front"');
    expect(markup).toContain('class="note-back"');
  });

  it("omite note-back quando o verso é vazio", () => {
    const frontOnly = renderToStaticMarkup(
      renderNoteContent({ ...basicNote, back: [] }, { mediaUrl }),
    );
    expect(frontOnly).toContain('class="note-front"');
    expect(frontOnly).not.toContain("note-back");
  });

  it("imagem SEMPRE via mediaUrl (nunca URL do JSON) com alt", () => {
    expect(markup).toContain(`src="/api/media/${ASSET_ID}"`);
    expect(markup).toContain('alt="esquema"');
    expect(markup).toContain('class="note-image"');
  });

  it("lista vira ul/li", () => {
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<li><p>item A</p></li>");
  });
});

describe("renderNoteContent — cloze", () => {
  it("hiddenGroups 'all' oculta todos como [...]", () => {
    const markup = renderToStaticMarkup(
      renderNoteContent(clozeNote, { mediaUrl, cloze: { hiddenGroups: "all" } }),
    );
    expect(markup).toContain('class="note-text"');
    expect(markup).toContain('<span class="cloze-hidden" data-cloze-group="g1">[...]</span>');
    expect(markup).toContain('<span class="cloze-hidden" data-cloze-group="g2">[...]</span>');
    expect(markup).not.toContain("Tóquio");
    expect(markup).not.toContain("Brasília");
  });

  it("showHints usa o hint quando existe e [...] quando não", () => {
    const markup = renderToStaticMarkup(
      renderNoteContent(clozeNote, {
        mediaUrl,
        cloze: { hiddenGroups: "all", showHints: true },
      }),
    );
    expect(markup).toContain(">[país da Ásia]</span>");
    expect(markup).toContain('data-cloze-group="g2">[...]</span>');
  });

  it("Set oculta só os grupos listados; o resto fica revelado", () => {
    const markup = renderToStaticMarkup(
      renderNoteContent(clozeNote, {
        mediaUrl,
        cloze: { hiddenGroups: new Set(["g1"]) },
      }),
    );
    expect(markup).toContain('class="cloze-hidden" data-cloze-group="g1"');
    expect(markup).toContain('<span class="cloze-revealed" data-cloze-group="g2">Brasília</span>');
  });

  it("'none' e ausência de opts revelam tudo (marks preservados dentro do cloze)", () => {
    for (const opts of [
      { mediaUrl, cloze: { hiddenGroups: "none" as const } },
      { mediaUrl },
    ]) {
      const markup = renderToStaticMarkup(renderNoteContent(clozeNote, opts));
      expect(markup).toContain("<strong>Tóquio</strong>");
      expect(markup).toContain("Brasília");
      expect(markup).not.toContain("cloze-hidden");
    }
  });
});

describe("renderBlocks — blocos restantes e segurança", () => {
  it("codeBlock vira pre>code com language", () => {
    const markup = renderToStaticMarkup(
      renderBlocks([{ type: "codeBlock", language: "ts", text: "const a = 1;" }], {
        mediaUrl,
      }),
    );
    expect(markup).toContain('<pre class="note-codeblock">');
    expect(markup).toContain('<code class="language-ts">const a = 1;</code>');
  });

  it("math/formula viram code literal (KaTeX é débito)", () => {
    const markup = renderToStaticMarkup(
      renderBlocks(
        [
          { type: "formula", latex: "E=mc^2" },
          {
            type: "paragraph",
            content: [{ type: "math", latex: "\\pi r^2" }],
          },
        ],
        { mediaUrl },
      ),
    );
    expect(markup).toContain('<p class="note-formula"><code>E=mc^2</code></p>');
    expect(markup).toContain('<code class="note-math">\\pi r^2</code>');
  });

  it("callout vira div com classes de variante", () => {
    const markup = renderToStaticMarkup(
      renderBlocks(
        [
          {
            type: "callout",
            variant: "danger",
            content: [{ type: "paragraph", content: [{ type: "text", text: "perigo" }] }],
          },
        ],
        { mediaUrl },
      ),
    );
    expect(markup).toContain('class="note-callout note-callout-danger"');
    expect(markup).toContain("<p>perigo</p>");
  });

  it("escapa conteúdo hostil (sem dangerouslySetInnerHTML por construção)", () => {
    const markup = renderToStaticMarkup(
      renderBlocks(
        [
          {
            type: "paragraph",
            content: [{ type: "text", text: '<script>alert("xss")</script>' }],
          },
        ],
        { mediaUrl },
      ),
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("lista ordenada vira ol", () => {
    const markup = renderToStaticMarkup(
      renderBlocks(
        [
          {
            type: "list",
            ordered: true,
            items: [
              { blocks: [{ type: "paragraph", content: [{ type: "text", text: "um" }] }] },
            ],
          },
        ],
        { mediaUrl },
      ),
    );
    expect(markup).toContain("<ol>");
    expect(markup).toContain("<li><p>um</p></li>");
  });
});
