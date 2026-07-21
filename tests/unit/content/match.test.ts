import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveCards, nextGroupKey, type DerivedCard } from "@/lib/content/derive";
import {
  matchDerivedToExisting,
  type CardMatchPlan,
  type ExistingCardInfo,
} from "@/lib/content/match";
import type { ClozeNoteContent } from "@/lib/content/schema";
import {
  addGroupParagraph,
  applyPlan,
  clozeNoteArb,
  removeGroup,
  renameGroup,
} from "./generators";

function card(
  id: string,
  clozeGroupKey: string | null,
  contentFingerprint: string,
  variant: number,
  status: ExistingCardInfo["status"] = "active",
): ExistingCardInfo {
  return { id, clozeGroupKey, contentFingerprint, status, variant };
}

/** Cards "no banco" como se a nota tivesse sido salva agora (variants 1..n). */
function cardsFromDerived(derived: DerivedCard[]): ExistingCardInfo[] {
  return derived.map((d, i) =>
    card("card-" + String(i + 1), d.clozeGroupKey, d.fingerprint, i + 1),
  );
}

function groupKeysOf(content: ClozeNoteContent): string[] {
  const cards = deriveCards(content);
  return cards.map((c) => c.clozeGroupKey).filter((k): k is string => k !== null);
}

describe("matchDerivedToExisting — exemplos fixos", () => {
  it("nota basic: card único casa por key null => keep com fingerprint novo", () => {
    const plan = matchDerivedToExisting(
      [card("c1", null, "fp-old", 1)],
      [{ clozeGroupKey: null, fingerprint: "fp-new" }],
    );
    expect(plan).toEqual({
      keep: [{ cardId: "c1", fingerprint: "fp-new" }],
      transfer: [],
      reactivate: [],
      create: [],
      remove: [],
    });
  });

  it("apagar-e-recriar com key nova => transfer por fingerprint (aceite F2#2)", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1), card("c2", "g2", "fpB", 2)],
      [
        { clozeGroupKey: "g1", fingerprint: "fpA" },
        { clozeGroupKey: "g3", fingerprint: "fpB" },
      ],
    );
    expect(plan).toEqual({
      keep: [{ cardId: "c1", fingerprint: "fpA" }],
      transfer: [{ cardId: "c2", newGroupKey: "g3", fingerprint: "fpB" }],
      reactivate: [],
      create: [],
      remove: [],
    });
  });

  it("grupo que sumiu sem par => remove; grupo novo sem par => create com max+1", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1), card("c2", "g2", "fpB", 2)],
      [
        { clozeGroupKey: "g1", fingerprint: "fpA" },
        { clozeGroupKey: "g3", fingerprint: "fpC" },
      ],
    );
    expect(plan).toEqual({
      keep: [{ cardId: "c1", fingerprint: "fpA" }],
      transfer: [],
      reactivate: [],
      create: [{ clozeGroupKey: "g3", fingerprint: "fpC", variant: 3 }],
      remove: ["c2"],
    });
  });

  it("variant considera TODOS os cards, inclusive removed (nunca reutiliza)", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1), card("c2", "g2", "fpB", 5, "removed")],
      [
        { clozeGroupKey: "g1", fingerprint: "fpA" },
        { clozeGroupKey: "g9", fingerprint: "fpX" },
      ],
    );
    expect(plan.create).toEqual([
      { clozeGroupKey: "g9", fingerprint: "fpX", variant: 6 },
    ]);
    // removed sem par fica intocado: fora de qualquer lista.
    expect(plan.reactivate).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("reativa removed por key igual SOMENTE com fingerprint idêntico", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "removed")],
      [{ clozeGroupKey: "g1", fingerprint: "fpA" }],
    );
    expect(plan).toEqual({
      keep: [],
      transfer: [],
      reactivate: [{ cardId: "c1", newGroupKey: "g1", fingerprint: "fpA" }],
      create: [],
      remove: [],
    });
  });

  it("key igual com fingerprint DIVERGENTE não reativa: create + removed intocado (#3/#9)", () => {
    // Key g1 reciclada pelo editor para conteúdo diferente: reativar aqui
    // ressuscitaria o progresso FSRS do card antigo para conteúdo arbitrário.
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "removed")],
      [{ clozeGroupKey: "g1", fingerprint: "fpB" }],
    );
    expect(plan).toEqual({
      keep: [],
      transfer: [],
      reactivate: [],
      create: [{ clozeGroupKey: "g1", fingerprint: "fpB", variant: 2 }],
      remove: [],
    });
  });

  it("regressão #3: remover g2, depois key g2 reciclada p/ conteúdo NOVO => card novo, removed intocado", () => {
    // Estado após "remover grupo g2 e salvar": c2 ficou removed com a key g2.
    const existing = [
      card("c1", "g1", "fpA", 1),
      card("c2", "g2", "fpB", 2, "removed"),
    ];
    // Novo conteúdo recebe a key g2 (editor antigo gerava a menor key livre do doc).
    const plan = matchDerivedToExisting(existing, [
      { clozeGroupKey: "g1", fingerprint: "fpA" },
      { clozeGroupKey: "g2", fingerprint: "fpNOVO" },
    ]);
    expect(plan).toEqual({
      keep: [{ cardId: "c1", fingerprint: "fpA" }],
      transfer: [],
      reactivate: [], // c2 fica intocado: progresso do antigo NÃO herdado
      create: [{ clozeGroupKey: "g2", fingerprint: "fpNOVO", variant: 3 }],
      remove: [],
    });
  });

  it("entre removed de MESMO fingerprint, key igual tem preferência (estabilidade)", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "removed"), card("c2", "g2", "fpA", 2, "removed")],
      [{ clozeGroupKey: "g2", fingerprint: "fpA" }],
    );
    // c2 (key g2) ganha o par mesmo tendo variant maior que c1.
    expect(plan.reactivate).toEqual([
      { cardId: "c2", newGroupKey: "g2", fingerprint: "fpA" },
    ]);
    expect(plan.create).toEqual([]);
  });

  it("reativa removed por fingerprint igual com key nova", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "removed")],
      [{ clozeGroupKey: "g7", fingerprint: "fpA" }],
    );
    expect(plan.reactivate).toEqual([
      { cardId: "c1", newGroupKey: "g7", fingerprint: "fpA" },
    ]);
    expect(plan.create).toEqual([]);
  });

  it("reativa card basic removed (newGroupKey null) com fingerprint idêntico", () => {
    const plan = matchDerivedToExisting(
      [card("c1", null, "fpA", 1, "removed")],
      [{ clozeGroupKey: null, fingerprint: "fpA" }],
    );
    expect(plan.reactivate).toEqual([
      { cardId: "c1", newGroupKey: null, fingerprint: "fpA" },
    ]);
    // Fingerprint divergente => card novo; o removed fica intocado.
    const divergent = matchDerivedToExisting(
      [card("c1", null, "fpA", 1, "removed")],
      [{ clozeGroupKey: null, fingerprint: "fpB" }],
    );
    expect(divergent.reactivate).toEqual([]);
    expect(divergent.create).toEqual([
      { clozeGroupKey: null, fingerprint: "fpB", variant: 2 },
    ]);
  });

  it("transfer (não-removed) tem prioridade sobre reactivate no resgate por fingerprint", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1), card("c2", "g2", "fpA", 2, "removed")],
      [{ clozeGroupKey: "g3", fingerprint: "fpA" }],
    );
    expect(plan.transfer).toEqual([
      { cardId: "c1", newGroupKey: "g3", fingerprint: "fpA" },
    ]);
    expect(plan.reactivate).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("suspended participa do matching como não-removed (mantém progresso)", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "suspended")],
      [{ clozeGroupKey: "g1", fingerprint: "fpZ" }],
    );
    expect(plan.keep).toEqual([{ cardId: "c1", fingerprint: "fpZ" }]);
  });

  it("um removed só reativa 1 derived (pareamento 1:1, sempre por fingerprint)", () => {
    const plan = matchDerivedToExisting(
      [card("c1", "g1", "fpA", 1, "removed")],
      [
        { clozeGroupKey: "g1", fingerprint: "fpB" },
        { clozeGroupKey: "g2", fingerprint: "fpA" },
      ],
    );
    // c1 casa com o derived de fingerprint idêntico (g2/fpA), NÃO com o de
    // key igual e conteúdo diferente (g1/fpB) — este vira card novo.
    expect(plan.reactivate).toEqual([
      { cardId: "c1", newGroupKey: "g2", fingerprint: "fpA" },
    ]);
    expect(plan.create).toEqual([
      { clozeGroupKey: "g1", fingerprint: "fpB", variant: 2 },
    ]);
  });

  it("é determinístico sob permutação da lista de existentes", () => {
    const existing = [
      card("c1", "g1", "fpA", 1),
      card("c2", "g2", "fpB", 2, "removed"),
      card("c3", "g3", "fpA", 3),
    ];
    const derived: DerivedCard[] = [
      { clozeGroupKey: "g9", fingerprint: "fpA" },
      { clozeGroupKey: "g2", fingerprint: "fpB" },
    ];
    const a = matchDerivedToExisting(existing, derived);
    const b = matchDerivedToExisting([...existing].reverse(), derived);
    expect(b).toEqual(a);
  });
});

describe("matchDerivedToExisting — properties (§5)", () => {
  it("(c) apagar-e-recriar ocultação idêntica com key NOVA => transfer, nunca create+remove", () => {
    fc.assert(
      fc.property(clozeNoteArb, fc.nat(), (content, pick) => {
        const existing = cardsFromDerived(deriveCards(content));
        const keys = groupKeysOf(content);
        const oldKey = keys[pick % keys.length];
        if (oldKey === undefined) return;
        const newKey = nextGroupKey(keys);
        const edited = renameGroup(content, oldKey, newKey);
        const plan = matchDerivedToExisting(existing, deriveCards(edited));
        const oldCard = existing.find((c) => c.clozeGroupKey === oldKey);
        expect(plan.create).toEqual([]);
        expect(plan.remove).toEqual([]);
        expect(plan.reactivate).toEqual([]);
        expect(plan.transfer).toEqual([
          {
            cardId: oldCard?.id,
            newGroupKey: newKey,
            fingerprint: oldCard?.contentFingerprint,
          },
        ]);
        expect(plan.keep).toHaveLength(existing.length - 1);
      }),
    );
  });

  it("(d) recortar-e-colar: conteúdo idêntico com TODAS as keys novas => só transfers", () => {
    fc.assert(
      fc.property(clozeNoteArb, (content) => {
        const existing = cardsFromDerived(deriveCards(content));
        const keys = groupKeysOf(content);
        // Clone profundo + rename de todas as keys (UniqueID novo para tudo).
        let edited: ClozeNoteContent = JSON.parse(
          JSON.stringify(content),
        ) as ClozeNoteContent;
        keys.forEach((k, i) => {
          edited = renameGroup(edited, k, "g" + String(100 + i));
        });
        const plan = matchDerivedToExisting(existing, deriveCards(edited));
        expect(plan.keep).toEqual([]);
        expect(plan.create).toEqual([]);
        expect(plan.remove).toEqual([]);
        expect(plan.reactivate).toEqual([]);
        expect(plan.transfer.map((t) => t.cardId).sort()).toEqual(
          existing.map((c) => c.id).sort(),
        );
      }),
    );
  });

  it("(e) editar texto mantendo keys => todos keep com fingerprint novo", () => {
    fc.assert(
      fc.property(clozeNoteArb, fc.nat(), (content, pick) => {
        const existing = cardsFromDerived(deriveCards(content));
        const keys = groupKeysOf(content);
        const target = keys[pick % keys.length];
        if (target === undefined) return;
        // Muda a resposta do grupo alvo (append em todo texto interno dele).
        const edited: ClozeNoteContent = JSON.parse(
          JSON.stringify(content),
          (key, value: unknown) => value,
        ) as ClozeNoteContent;
        const mutate = (blocks: ClozeNoteContent["text"]) => {
          for (const b of blocks) {
            if (b.type === "paragraph" || b.type === "heading") {
              for (const inl of b.content) {
                if (inl.type === "cloze" && inl.groupKey === target) {
                  for (const t of inl.content) t.text = t.text + "X";
                }
              }
            } else if (b.type === "list") {
              for (const item of b.items) mutate(item.blocks);
            } else if (b.type === "callout") {
              mutate(b.content);
            }
          }
        };
        mutate(edited.text);
        const derived = deriveCards(edited);
        const plan = matchDerivedToExisting(existing, derived);
        expect(plan.transfer).toEqual([]);
        expect(plan.create).toEqual([]);
        expect(plan.remove).toEqual([]);
        expect(plan.keep).toHaveLength(existing.length);
        // O card do grupo alvo ganhou fingerprint NOVO (progresso preservado).
        const targetCard = existing.find((c) => c.clozeGroupKey === target);
        const targetDerived = derived.find((d) => d.clozeGroupKey === target);
        const kept = plan.keep.find((k) => k.cardId === targetCard?.id);
        expect(kept?.fingerprint).toBe(targetDerived?.fingerprint);
        expect(kept?.fingerprint).not.toBe(targetCard?.contentFingerprint);
      }),
    );
  });

  it("(f) variant é monotônico e nunca reutilizado através de edições sucessivas", () => {
    fc.assert(
      fc.property(
        clozeNoteArb,
        fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), fc.nat()), {
          minLength: 1,
          maxLength: 4,
        }),
        (initial, ops) => {
          let content = initial;
          let cards: ExistingCardInfo[] = [];
          let idSeq = 0;
          const makeId = () => {
            idSeq += 1;
            return "id-" + String(idSeq);
          };
          const everVariants = new Set<number>();
          const step = () => {
            const derived = deriveCards(content);
            const maxBefore = cards.reduce((m, c) => Math.max(m, c.variant), 0);
            const plan = matchDerivedToExisting(cards, derived);
            let expected = maxBefore;
            for (const cr of plan.create) {
              expected += 1;
              expect(cr.variant).toBe(expected);
              expect(everVariants.has(cr.variant)).toBe(false);
              everVariants.add(cr.variant);
            }
            cards = applyPlan(cards, plan, makeId);
            expect(new Set(cards.map((c) => c.variant)).size).toBe(cards.length);
          };
          step(); // criação inicial
          for (const [op, pick] of ops) {
            const keys = groupKeysOf(content);
            if (op === 0 || keys.length < 2) {
              content = addGroupParagraph(
                content,
                nextGroupKey(keys),
                "resposta" + String(pick),
              );
            } else if (op === 1) {
              const key = keys[pick % keys.length];
              if (key !== undefined) content = removeGroup(content, key);
            } else {
              const key = keys[pick % keys.length];
              if (key !== undefined)
                content = renameGroup(content, key, nextGroupKey(keys));
            }
            step();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("(h) o plano é uma partição de existentes e derivados", () => {
    const keyPool = fc.constantFrom<string | null>("g1", "g2", "g3", null);
    const fpPool = fc.constantFrom("f1", "f2", "f3", "f4");
    const statusPool = fc.constantFrom<ExistingCardInfo["status"]>(
      "active",
      "suspended",
      "removed",
    );
    const existingArb = fc
      .array(fc.tuple(keyPool, fpPool, statusPool), { maxLength: 8 })
      .map((rows) =>
        rows.map(([k, f, s], i) => card("c" + String(i + 1), k, f, i + 1, s)),
      );
    const derivedArb = fc.array(
      fc
        .tuple(keyPool, fpPool)
        .map(([clozeGroupKey, fingerprint]) => ({ clozeGroupKey, fingerprint })),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(existingArb, derivedArb, (existing, derived) => {
        const plan: CardMatchPlan = matchDerivedToExisting(existing, derived);
        const touchedIds = [
          ...plan.keep.map((k) => k.cardId),
          ...plan.transfer.map((t) => t.cardId),
          ...plan.reactivate.map((r) => r.cardId),
          ...plan.remove,
        ];
        // Nenhum card em duas listas.
        expect(new Set(touchedIds).size).toBe(touchedIds.length);
        const byId = new Map(existing.map((c) => [c.id, c]));
        // keep/transfer/remove só com não-removed; reactivate só com removed.
        for (const id of [
          ...plan.keep.map((k) => k.cardId),
          ...plan.transfer.map((t) => t.cardId),
          ...plan.remove,
        ]) {
          expect(byId.get(id)?.status).not.toBe("removed");
        }
        for (const r of plan.reactivate) {
          expect(byId.get(r.cardId)?.status).toBe("removed");
        }
        // Todo não-removed aparece em exatamente uma lista (nunca fica intocado).
        const alive = existing.filter((c) => c.status !== "removed");
        expect(touchedIds.filter((id) => byId.get(id)?.status !== "removed")).toHaveLength(
          alive.length,
        );
        // Cada derived consumido por exatamente uma decisão.
        expect(
          plan.keep.length +
            plan.transfer.length +
            plan.reactivate.length +
            plan.create.length,
        ).toBe(derived.length);
        // Variants criados: estritamente crescentes e acima de todos os existentes.
        const maxExisting = existing.reduce((m, c) => Math.max(m, c.variant), 0);
        let prev = maxExisting;
        for (const cr of plan.create) {
          expect(cr.variant).toBe(prev + 1);
          prev = cr.variant;
        }
        // Determinismo sob permutação dos existentes.
        expect(matchDerivedToExisting([...existing].reverse(), derived)).toEqual(plan);
      }),
    );
  });
});
