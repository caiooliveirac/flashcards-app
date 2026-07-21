import { describe, expect, it } from "vitest";
import { nextGroupKeyWithHistory } from "@/features/editor/group-keys";

/**
 * Achado #9a: a próxima key de ocultação considera a UNIÃO das keys do doc
 * atual com as keys históricas dos cards da nota (INCLUINDO 'removed').
 * Gerar key só a partir do doc reciclava a key de um card removed — no
 * matching do §5 o conteúdo novo colidiria com o card antigo.
 */
describe("nextGroupKeyWithHistory (#9a)", () => {
  it("key de card removed CONSTA no histórico e nunca é reciclada", () => {
    // g2 é de um card 'removed': saiu do doc, mas segue no histórico => g3.
    expect(nextGroupKeyWithHistory(["g1", "g2"], ["g1"])).toBe("g3");
  });

  it("união histórico ∪ doc: menor gN livre nos DOIS conjuntos", () => {
    // g2 não consta nem no histórico nem no doc => é LIVRE e correto.
    expect(nextGroupKeyWithHistory(["g1", "g3"], ["g1"])).toBe("g2");
    // Key só no doc (ocultação recém-criada, ainda não salva) também conta.
    expect(nextGroupKeyWithHistory(["g1"], ["g1", "g2"])).toBe("g3");
    // Key só no histórico conta mesmo ausente do doc.
    expect(nextGroupKeyWithHistory(["g2"], [])).toBe("g1");
  });

  it("criação (nota nova): histórico vazio => comportamento atual por doc", () => {
    expect(nextGroupKeyWithHistory([], [])).toBe("g1");
    expect(nextGroupKeyWithHistory([], ["g1"])).toBe("g2");
    expect(nextGroupKeyWithHistory([], ["g1", "g3"])).toBe("g2");
  });
});
