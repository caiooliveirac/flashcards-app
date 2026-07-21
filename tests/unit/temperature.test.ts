import { describe, expect, it } from "vitest";
import {
  deckTemperatureScore,
  temperatureTier,
  type TemperatureInput,
} from "@/features/decks/temperature";

const base: TemperatureInput = {
  activeCount: 0,
  dueCount: 0,
  dueNext72h: 0,
  retrievabilityDeficitSum: 0,
  desiredRetention: 0.9,
  daysSinceLastReview: null,
  daysUntilExam: null,
};

describe("temperatura de revisão (§8)", () => {
  it("faixas: Frio<20 ≤ Morno<40 ≤ Quente<60 ≤ Muito quente<80 ≤ Crítico", () => {
    expect(temperatureTier(0)).toBe("frio");
    expect(temperatureTier(19)).toBe("frio");
    expect(temperatureTier(20)).toBe("morno");
    expect(temperatureTier(39)).toBe("morno");
    expect(temperatureTier(40)).toBe("quente");
    expect(temperatureTier(60)).toBe("muito-quente");
    expect(temperatureTier(80)).toBe("critico");
    expect(temperatureTier(100)).toBe("critico");
  });

  it("deck sem cards em revisão e sem prova = 0 (frio)", () => {
    expect(deckTemperatureScore(base)).toBe(0);
  });

  it("tudo vencido com déficit máximo satura os dois maiores pesos (0.45+0.20=65)", () => {
    const score = deckTemperatureScore({
      ...base,
      activeCount: 10,
      dueCount: 10,
      retrievabilityDeficitSum: 10 * 0.9, // déficit médio = desired retention
      desiredRetention: 0.9,
    });
    expect(score).toBe(65); // 100*(0.45*1 + 0.20*1)
    expect(temperatureTier(score)).toBe("muito-quente");
  });

  it("metade vencida, sem déficit de retrievability: só o peso de proporção", () => {
    const score = deckTemperatureScore({
      ...base,
      activeCount: 10,
      dueCount: 5,
      retrievabilityDeficitSum: 0, // cards vencidos mas ainda com R alta
    });
    expect(score).toBe(10); // 100*(0.20*0.5)
    expect(temperatureTier(score)).toBe("frio");
  });

  it("prova amanhã, sem cards ativos: só o peso de urgência (~10)", () => {
    const score = deckTemperatureScore({ ...base, daysUntilExam: 1 });
    expect(score).toBeGreaterThanOrEqual(9);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("sem revisar há 14+ dias satura o componente de staleness", () => {
    const score = deckTemperatureScore({
      ...base,
      activeCount: 4,
      daysSinceLastReview: 20, // > STALE_DAYS_FULL
    });
    expect(score).toBe(10); // 100*(0.10*1)
  });
});
