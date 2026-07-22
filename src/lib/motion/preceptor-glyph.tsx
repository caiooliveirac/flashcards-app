"use client";

import { useEffect, useState } from "react";
import { onMotion } from "./events";
import type { FieldMode } from "./tokens";

export type GlyphState = FieldMode | "executa";

/**
 * IA com corpo — o glifo ✳ (handoff §3 · 4f).
 *
 * Máquina de estados `repouso → observando → raciocinando → insight → executa`.
 * O desenho é sempre o mesmo (seis barras de raio zero); o que muda é o RITMO,
 * então a IA parece a mesma criatura em humores diferentes, não seis ícones.
 *
 * Pode ser controlado por prop (`state`) ou escutar o barramento (`listen`).
 */
export function PreceptorGlyph({
  state,
  listen = false,
  className = "",
}: {
  state?: GlyphState;
  /** Segue os eventos `ai:state` / `review:rated` do barramento. */
  listen?: boolean;
  className?: string;
}) {
  const [busState, setBusState] = useState<GlyphState>("repouso");

  useEffect(() => {
    if (!listen) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const offAi = onMotion("ai:state", ({ mode }) => {
      clearTimeout(settle);
      setBusState(mode);
    });
    // "Errei" acorda o Preceptor: ele repara no erro e volta ao repouso.
    const offRated = onMotion("review:rated", ({ rating }) => {
      if (rating !== 1) return;
      setBusState("insight");
      clearTimeout(settle);
      settle = setTimeout(() => setBusState("repouso"), 2400);
    });
    return () => {
      clearTimeout(settle);
      offAi();
      offRated();
    };
  }, [listen]);

  const current = state ?? busState;

  return (
    <span aria-hidden="true" data-ms-glyph={current} className={`ms-glyph ${className}`}>
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ "--ms-i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}
