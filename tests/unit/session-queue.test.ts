import { describe, expect, it } from "vitest";
import {
  advanceQueue,
  dropNote,
  initialQueue,
  LEARN_AHEAD_MS,
  remainingCount,
  shouldRequeue,
  undoQueue,
  type QueueState,
} from "@/features/review/session-queue";
import type { SessionCard } from "@/features/review/session-types";

function card(cardId: string, noteId = cardId): SessionCard {
  return {
    cardId,
    noteId,
    noteType: "basic",
    clozeGroupKey: null,
    content: { schemaVersion: 1, kind: "basic", front: [], back: [] } as unknown as SessionCard["content"],
    isNew: true,
    previewMs: [60_000, 360_000, 600_000, 691_200_000],
    lapses: 0,
    isLeech: false,
    aiText: "",
  };
}

const NOW = 1_000_000;

describe("shouldRequeue", () => {
  it("card em learning vencendo dentro da janela reentra", () => {
    expect(shouldRequeue("learning", new Date(NOW + 600_000), NOW)).toBe(true);
  });

  it("card graduado para review não reentra", () => {
    expect(shouldRequeue("review", new Date(NOW + 172_800_000), NOW)).toBe(false);
  });

  it("learning além da janela de learn-ahead não reentra", () => {
    expect(shouldRequeue("learning", new Date(NOW + LEARN_AHEAD_MS + 1), NOW)).toBe(false);
  });
});

describe("advanceQueue — fila principal", () => {
  it("consome a fila principal em ordem", () => {
    let q = initialQueue([card("a"), card("b"), card("c")]);
    expect(q.current?.cardId).toBe("a");
    q = advanceQueue(q, { now: NOW });
    expect(q.current?.cardId).toBe("b");
    q = advanceQueue(q, { now: NOW });
    expect(q.current?.cardId).toBe("c");
    q = advanceQueue(q, { now: NOW });
    expect(q.current).toBeNull();
  });
});

describe("advanceQueue — learn-ahead respeita o relógio", () => {
  it("NÃO reapresenta um card que ainda não venceu", () => {
    // Regressão do 'travou no mesmo card': "Difícil" agenda ~6min e o card
    // voltava no mesmo segundo, dando a sensação de loop.
    const q = advanceQueue(initialQueue([card("a")]), {
      requeue: { card: card("a"), readyAt: NOW + 360_000 },
      now: NOW,
    });
    expect(q.current).toBeNull();
    expect(q.learn).toHaveLength(1);
  });

  it("reapresenta assim que o horário chega", () => {
    const pendente: QueueState = {
      main: [],
      learn: [{ card: card("a"), readyAt: NOW + 360_000 }],
      current: null,
      presentation: 1,
    };
    const q = advanceQueue(pendente, { now: NOW + 360_001 });
    expect(q.current?.cardId).toBe("a");
    expect(q.learn).toHaveLength(0);
  });

  it("entre vários prontos, escolhe o que venceu primeiro", () => {
    const pronto: QueueState = {
      main: [],
      learn: [
        { card: card("tarde"), readyAt: NOW - 1_000 },
        { card: card("cedo"), readyAt: NOW - 9_000 },
      ],
      current: null,
      presentation: 0,
    };
    expect(advanceQueue(pronto, { now: NOW }).current?.cardId).toBe("cedo");
  });

  it("a fila principal tem prioridade sobre learning já vencido", () => {
    const misto: QueueState = {
      main: [card("novo")],
      learn: [{ card: card("velho"), readyAt: NOW - 60_000 }],
      current: null,
      presentation: 0,
    };
    expect(advanceQueue(misto, { now: NOW }).current?.cardId).toBe("novo");
  });
});

describe("advanceQueue — irmãos de cloze saem da sessão", () => {
  it("enterra os irmãos da nota avaliada, preservando o próprio card", () => {
    // O servidor enterra os irmãos a cada avaliação, mas a fila do cliente é um
    // snapshot: sem isto, g2 e g3 da MESMA nota continuavam aparecendo.
    const q: QueueState = {
      main: [card("g2", "nota"), card("outro", "outra-nota"), card("g3", "nota")],
      learn: [{ card: card("g4", "nota"), readyAt: NOW - 1 }],
      current: card("g1", "nota"),
      presentation: 0,
    };
    const next = advanceQueue(q, {
      burySiblingsOfNote: "nota",
      exclude: "g1",
      requeue: { card: card("g1", "nota"), readyAt: NOW - 1 },
      now: NOW,
    });
    expect(next.current?.cardId).toBe("outro");
    expect(next.main).toHaveLength(0);
    // Só o próprio card avaliado sobrevive na fila de learning.
    expect(next.learn.map((l) => l.card.cardId)).toEqual(["g1"]);
  });

  it("não mexe em cards de outras notas", () => {
    const q: QueueState = {
      main: [card("x", "outra")],
      learn: [],
      current: card("g1", "nota"),
      presentation: 0,
    };
    expect(advanceQueue(q, { burySiblingsOfNote: "nota", now: NOW }).current?.cardId).toBe("x");
  });
});

describe("presentation muda sempre", () => {
  it("incrementa mesmo reapresentando o MESMO objeto de card", () => {
    // É isto que força uma idempotencyKey nova: sem mudar, o servidor
    // descartava a avaliação seguinte como duplicata e o card nunca progredia.
    const mesmo = card("a");
    const q: QueueState = {
      main: [],
      learn: [{ card: mesmo, readyAt: NOW - 1 }],
      current: mesmo,
      presentation: 7,
    };
    const next = advanceQueue(q, { now: NOW });
    expect(next.current).toBe(mesmo);
    expect(next.presentation).toBe(8);
  });

  it("incrementa também no undo", () => {
    const q = initialQueue([card("a"), card("b")]);
    expect(undoQueue(q, card("z")).presentation).toBe(1);
  });
});

describe("undo e enterro de nota", () => {
  it("undo devolve o card atual ao topo da fila", () => {
    const q = initialQueue([card("a"), card("b")]);
    const next = undoQueue(q, card("anterior"));
    expect(next.current?.cardId).toBe("anterior");
    expect(next.main[0]?.cardId).toBe("a");
  });

  it("dropNote remove a nota das duas filas", () => {
    const q: QueueState = {
      main: [card("g2", "n"), card("x", "outra")],
      learn: [{ card: card("g3", "n"), readyAt: NOW }],
      current: card("g1", "n"),
      presentation: 0,
    };
    const next = dropNote(q, "n");
    expect(next.main.map((c) => c.cardId)).toEqual(["x"]);
    expect(next.learn).toHaveLength(0);
  });
});

describe("remainingCount", () => {
  it("conta o card na tela junto das duas filas", () => {
    const q: QueueState = {
      main: [card("a")],
      learn: [{ card: card("b"), readyAt: NOW }],
      current: card("c"),
      presentation: 0,
    };
    expect(remainingCount(q)).toBe(3);
    expect(remainingCount({ ...q, current: null })).toBe(2);
  });
});
