import { describe, expect, it } from "vitest";
import { FIELD_MODES, motionTokens, RIPPLE_KINDS, SPRING, tiltForTemperature } from "@/lib/motion";

/**
 * O Motion System é quase todo CSS/DOM, mas duas coisas são lógica pura e
 * quebram silenciosamente se alguém mexer: a curva da mola (que o CSS espelha
 * à mão em motion.css) e o mapa temperatura → tilt.
 */
describe("motion tokens", () => {
  it("a curva SPRING tem overshoot — é mola, não ease-out", () => {
    const peaks = SPRING.match(/(\d+\.\d+)\s+\d+(\.\d+)?%/g) ?? [];
    const values = peaks.map((p) => Number.parseFloat(p));
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it("SPRING é uma easing linear() válida e fechada em 1", () => {
    expect(SPRING.startsWith("linear(0,")).toBe(true);
    expect(SPRING.trimEnd().endsWith("1)")).toBe(true);
  });

  it("press comprime sem sumir e volta pela mola soft", () => {
    expect(motionTokens.press.scale).toBeGreaterThan(0.9);
    expect(motionTokens.press.scale).toBeLessThan(1);
    // A compressão é bem mais curta que o retorno: bate e volta devagar.
    expect(motionTokens.press.duration).toBeLessThan(motionTokens.spring.soft.duration / 4);
  });

  it("snappy é mais rápido que soft", () => {
    expect(motionTokens.spring.snappy.duration).toBeLessThan(motionTokens.spring.soft.duration);
  });

  it("tilt cresce monotonicamente com a temperatura do baralho", () => {
    const tiers = ["frio", "morno", "quente", "muito-quente", "critico"];
    const tilts = tiers.map(tiltForTemperature);
    for (let i = 1; i < tilts.length; i++) {
      expect(tilts[i]!).toBeGreaterThan(tilts[i - 1]!);
    }
    // Faixa 4–8° da disseminação (handoff §7).
    expect(Math.min(...tilts)).toBe(4);
    expect(Math.max(...tilts)).toBe(8);
  });

  it("tier desconhecido cai no tilt de repouso, não em NaN", () => {
    expect(tiltForTemperature("inexistente")).toBe(4);
  });

  it("os vocabulários de ripple e campo batem com os do handoff", () => {
    expect([...RIPPLE_KINDS]).toEqual(["ink", "accent", "danger", "create"]);
    expect([...FIELD_MODES]).toEqual(["repouso", "observando", "raciocinando", "insight"]);
  });
});
