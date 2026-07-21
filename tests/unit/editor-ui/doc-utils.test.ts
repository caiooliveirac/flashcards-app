import { describe, expect, it } from "vitest";
import { collectAssetIdsFromDoc, docHasVisibleContent } from "@/features/editor/doc-utils";

const ASSET = "3f0a2b1c-9d8e-4f70-a1b2-c3d4e5f60718";

describe("docHasVisibleContent", () => {
  it("doc vazio (parágrafo único sem texto) não tem conteúdo", () => {
    expect(docHasVisibleContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(false);
  });

  it("texto só de whitespace não conta", () => {
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
      }),
    ).toBe(false);
  });

  it("texto real conta", () => {
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "olá" }] }],
      }),
    ).toBe(true);
  });

  it("texto aninhado em lista conta", () => {
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "item" }] },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("imagem com assetId conta; sem assetId não conta (upload incompleto)", () => {
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [{ type: "image", attrs: { assetId: ASSET, src: "blob:x" } }],
      }),
    ).toBe(true);
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [{ type: "image", attrs: { assetId: null, src: "blob:x" } }],
      }),
    ).toBe(false);
  });

  it("cloze com texto interno conta", () => {
    expect(
      docHasVisibleContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "cloze",
                attrs: { groupKey: "g1", hint: null },
                content: [{ type: "text", text: "oculto" }],
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("collectAssetIdsFromDoc", () => {
  it("coleta assetIds únicos em ordem de aparição, ignorando imagens sem assetId", () => {
    const other = "9b8c7d6e-5f40-4a31-b2c1-d0e9f8a7b6c5";
    expect(
      collectAssetIdsFromDoc({
        type: "doc",
        content: [
          { type: "image", attrs: { assetId: ASSET } },
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
          { type: "image", attrs: { assetId: other } },
          { type: "image", attrs: { assetId: ASSET } },
          { type: "image", attrs: { assetId: null } },
        ],
      }),
    ).toEqual([ASSET, other]);
  });

  it("doc sem imagens devolve lista vazia", () => {
    expect(collectAssetIdsFromDoc({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });
});
