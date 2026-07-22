"use client";

import { useEffect, useRef } from "react";
import { onMotion } from "./events";
import { motionTokens } from "./tokens";

/** Curva de Bézier suave entre dois pontos, arqueando para cima. */
function pathBetween(from: DOMRect, to: DOMRect): { d: string; length: number } {
  const x1 = from.left + from.width / 2;
  const y1 = from.top + from.height / 2;
  const x2 = to.left + to.width / 2;
  const y2 = to.top + to.height / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  // O arco cresce com a distância, mas satura: trajetos longos não viram laço.
  const lift = Math.min(160, dist * 0.35);
  const d = `M ${x1} ${y1} C ${x1 + dx * 0.3} ${y1 - lift}, ${x1 + dx * 0.7} ${y2 - lift}, ${x2} ${y2}`;
  return { d, length: dist + lift };
}

/**
 * Energy trails (handoff §3 · 4g, §7).
 *
 * Uma camada única, fixa e `pointer-events:none`, que desenha o caminho
 * origem → destino quando um card é aceito ou uma nota é salva. É puramente
 * decorativa: se o elemento de origem ou destino não existir na tela, nada é
 * desenhado e o fluxo segue igual.
 */
export function TrailLayer() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const draw = ({
      sourceEl,
      deckEl,
      delay = 0,
    }: {
      sourceEl?: Element | null;
      deckEl?: Element | null;
      delay?: number;
    }) => {
      if (!sourceEl || !deckEl) return;
      const from = sourceEl.getBoundingClientRect();
      const to = deckEl.getBoundingClientRect();
      if (from.width === 0 || to.width === 0) return;

      const { d, length } = pathBetween(from, to);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--primary)");
      path.setAttribute("stroke-width", String(motionTokens.choreography.trailWidthPx));
      path.setAttribute("stroke-linecap", "square");
      path.setAttribute("stroke-dasharray", `${length * 0.28} ${length}`);
      path.setAttribute("stroke-dashoffset", String(length * 0.28));
      svg.appendChild(path);

      const anim = path.animate(
        [{ strokeDashoffset: length * 0.28 }, { strokeDashoffset: -length }],
        {
          duration: motionTokens.choreography.trailMs,
          delay,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          fill: "both",
        },
      );
      const clean = () => path.remove();
      anim.onfinish = clean;
      anim.oncancel = clean;
    };

    const offAccepted = onMotion("card:accepted", draw);
    const offSaved = onMotion("card:saved", draw);
    const offBatch = onMotion("cards:batchApproved", ({ count }) => {
      // Stagger de 80ms, um trail por card aprovado (handoff §6).
      const cards = document.querySelectorAll("[data-ms-trail-source]");
      const deck = document.querySelector("[data-ms-trail-target]");
      for (let i = 0; i < Math.min(count, cards.length); i++) {
        draw({
          sourceEl: cards[i],
          deckEl: deck,
          delay: i * motionTokens.choreography.staggerMs,
        });
      }
    });

    return () => {
      offAccepted();
      offSaved();
      offBatch();
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
