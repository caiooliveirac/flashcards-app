import { describe, expect, it } from "vitest";
import { convertSuggestion } from "@/lib/ai/to-note-content";
import { collectClozeInlines, type ClozeNoteContent } from "@/lib/content";
import type { SuggestedCard } from "@/lib/ai/suggestion-schema";

function card(partial: Partial<SuggestedCard>): SuggestedCard {
  return { kind: "basic", front: "", back: "", text: "", tags: [], ...partial };
}

describe("convertSuggestion — basic", () => {
  it("converte pergunta/resposta em NoteContentV1 basic", () => {
    const out = convertSuggestion(
      card({ kind: "basic", front: "Capital da França?", back: "Paris", tags: ["geo", "geo"] }),
    );
    expect(out).not.toBeNull();
    expect(out!.noteType).toBe("basic");
    expect(out!.content.kind).toBe("basic");
    expect(out!.preview).toEqual({ front: "Capital da França?", back: "Paris" });
    // tags normalizadas e deduplicadas
    expect(out!.tags).toEqual(["geo"]);
  });

  it("descarta card basic sem front", () => {
    expect(convertSuggestion(card({ kind: "basic", front: "   ", back: "algo" }))).toBeNull();
  });
});

describe("convertSuggestion — cloze", () => {
  it("converte {{ocultação}} em inline cloze com groupKey", () => {
    const out = convertSuggestion(
      card({ kind: "cloze", text: "A capital da França é {{Paris}}." }),
    );
    expect(out).not.toBeNull();
    expect(out!.noteType).toBe("cloze");
    const content = out!.content as ClozeNoteContent;
    const clozes = collectClozeInlines(content.text);
    expect(clozes).toHaveLength(1);
    expect(clozes[0]!.groupKey).toBe("g1");
    expect(out!.preview.front).toBe("A capital da França é […].");
    expect(out!.preview.back).toBe("Paris");
  });

  it("suporta dica com {{trecho::dica}}", () => {
    const out = convertSuggestion(card({ kind: "cloze", text: "O {{coração::órgão}} bombeia sangue." }));
    const content = out!.content as ClozeNoteContent;
    const clozes = collectClozeInlines(content.text);
    expect(clozes[0]!.hint).toBe("órgão");
  });

  it("numera múltiplas ocultações g1..gn e junta respostas no preview", () => {
    const out = convertSuggestion(
      card({ kind: "cloze", text: "Em {{1492}} Colombo chegou à {{América}}." }),
    );
    const content = out!.content as ClozeNoteContent;
    const clozes = collectClozeInlines(content.text);
    expect(clozes.map((c) => c.groupKey)).toEqual(["g1", "g2"]);
    expect(out!.preview.back).toBe("1492 · América");
  });

  it("descarta cloze sem nenhuma ocultação", () => {
    expect(convertSuggestion(card({ kind: "cloze", text: "Frase sem chaves." }))).toBeNull();
  });
});
