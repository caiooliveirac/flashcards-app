import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { editorExtensions } from "@/lib/editor/extensions";

describe("editorExtensions — schema PM restrito ao NoteContentV1", () => {
  const clozeSchema = getSchema(editorExtensions({ mode: "cloze" }));
  const basicSchema = getSchema(editorExtensions({ mode: "basic" }));

  it("contém exatamente os nós do formato", () => {
    for (const name of [
      "doc",
      "text",
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "image",
      "cloze",
    ]) {
      expect(clozeSchema.nodes[name], `node ${name}`).toBeDefined();
    }
    for (const name of ["blockquote", "horizontalRule", "hardBreak"]) {
      expect(clozeSchema.nodes[name], `node ${name} deveria estar fora`).toBeUndefined();
    }
  });

  it("contém exatamente os marks do formato", () => {
    for (const name of ["bold", "italic", "code", "highlight"]) {
      expect(clozeSchema.marks[name], `mark ${name}`).toBeDefined();
    }
    for (const name of ["link", "underline", "strike"]) {
      expect(clozeSchema.marks[name], `mark ${name} deveria estar fora`).toBeUndefined();
    }
  });

  it("modo basic não tem o node cloze; ambos têm Placeholder", () => {
    expect(basicSchema.nodes.cloze).toBeUndefined();
    expect(
      editorExtensions({ mode: "basic" }).some((e) => e.name === "placeholder"),
    ).toBe(true);
    expect(
      editorExtensions({ mode: "cloze", placeholder: "Digite..." }).some(
        (e) => e.name === "placeholder",
      ),
    ).toBe(true);
  });

  it("image persiste assetId/alt; cloze é inline com groupKey/hint e content text*", () => {
    const image = clozeSchema.nodes.image;
    expect(image?.spec.attrs).toMatchObject({ assetId: {}, alt: {} });

    const cloze = clozeSchema.nodes.cloze;
    expect(cloze?.spec.inline).toBe(true);
    expect(cloze?.spec.group).toBe("inline");
    expect(cloze?.spec.content).toBe("text*");
    expect(cloze?.spec.attrs).toMatchObject({ groupKey: {}, hint: {} });
  });

  it("heading restrito aos níveis 1-3", () => {
    const heading = clozeSchema.nodes.heading;
    expect(heading).toBeDefined();
    // levels são opção da extensão; o reflexo no schema são as parse rules h1-h3 sem h4+
    const rules = (heading?.spec.parseDOM ?? []).map((r) => r.tag);
    expect(rules).toContain("h1");
    expect(rules).toContain("h3");
    expect(rules).not.toContain("h4");
  });
});
