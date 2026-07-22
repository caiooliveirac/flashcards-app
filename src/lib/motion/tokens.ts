/**
 * Motion System — tokens da "Camada de Vida" (handoff §1).
 *
 * Uma única fonte de verdade compartilhada entre o CSS (`motion.css` espelha os
 * valores em custom properties) e o runtime (`behaviors.ts`). Mexer aqui muda a
 * física da app inteira.
 *
 * As intensidades já embutem a subida de um degrau pedida na disseminação (§7):
 * `intensity.focus` 0.22 → 0.30, tilt herói 6° → 8°, trail 3px → 4px.
 */

/**
 * Curva `linear()` amostrada de uma mola (stiffness 120, damping 14, mass 1).
 * O overshoot (picos > 1 entre 20% e 40%) é o que dá corpo ao retorno do press:
 * o elemento passa do ponto e volta, em vez de frear num ease-out morto.
 */
export const SPRING =
  "linear(0, 0.062 2.5%, 0.235 5.4%, 0.665 11.4%, 0.885 15%, 1.065 20.3%, 1.117 24.6%, 1.118 28.5%, 1.038 38.8%, 0.99 48.4%, 0.997 66.3%, 1)";

export const motionTokens = {
  spring: {
    /** Retorno de press, painéis, morphs. */
    soft: { stiffness: 120, damping: 14, mass: 1, duration: 550, easing: SPRING },
    /** Chips, badges, ripple de estado. */
    snappy: { stiffness: 260, damping: 22, mass: 0.8, duration: 380, easing: SPRING },
  },
  /** Compressão do clique; o retorno é sempre pela mola `soft`. */
  press: { scale: 0.96, duration: 70 },
  /** Profundidade física: sombra dura (offset, sem blur — Modernist). */
  depth: { tiltMaxDeg: 7, heroTiltMaxDeg: 8, shadowLagPx: 16, liftPx: 5, thicknessPx: 7 },
  /** Opacidades do campo de pontos / spotlight. */
  intensity: { ambient: 0.1, hero: 0.06, focus: 0.3 },
  /** Coreografias compostas. */
  choreography: { rippleMs: 650, flipMs: 800, trailMs: 900, trailWidthPx: 4, staggerMs: 80 },
} as const;

/** Modos do campo ambiente = estados da máquina do ✳ (handoff §3 · 4f). */
export const FIELD_MODES = ["repouso", "observando", "raciocinando", "insight"] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

/**
 * Semântica do ripple (handoff §7). A forma da onda carrega significado:
 * a app nunca usa accent como decoração, então o desenho é que diferencia.
 */
export const RIPPLE_KINDS = ["ink", "accent", "danger", "create"] as const;
export type RippleKind = (typeof RIPPLE_KINDS)[number];

/**
 * Tilt proporcional à temperatura do baralho: o calor é físico, o deck quente
 * inclina mais (handoff §7 — "Home: TODAS as células, tilt 4–8°").
 */
export function tiltForTemperature(tier: string): number {
  switch (tier) {
    case "critico":
      return 8;
    case "muito-quente":
      return 7;
    case "quente":
      return 6;
    case "morno":
      return 5;
    default:
      return 4;
  }
}
