/**
 * Motion System — comportamentos por data-attribute (handoff §2).
 *
 * Porte do `motion-system.js` do handoff para TS, com três mudanças deliberadas:
 *
 * 1. **Nada escreve `transform` inline.** Cada comportamento escreve custom
 *    properties (`--ms-x`, `--ms-rx`, …) e o CSS compõe usando as propriedades
 *    individuais `translate` / `rotate` / `scale`. Assim press (transição CSS),
 *    magnetismo (rAF) e tilt (rAF) coexistem no mesmo elemento sem um
 *    sobrescrever o outro — o que aconteceria com `style.transform`.
 * 2. **Retorno do magnetismo por transição CSS**, não WAAPI: `translate` é
 *    animável isoladamente, então a mola é declarativa e some sozinha.
 * 3. **Cleanup real**: um único `AbortController` derruba todos os listeners, e
 *    os rAF/observers ficam num registro de disposers (React StrictMode monta e
 *    desmonta duas vezes em dev).
 *
 * `prefers-reduced-motion: reduce` → nada é ligado (early return).
 */

import { motionTokens, type RippleKind } from "./tokens";

const SELECTOR =
  "[data-ms-tilt],[data-ms-magnetic],[data-ms-ripple],[data-ms-spotlight],[data-ms-field]";

/** Lerps do handoff: o conteúdo persegue o cursor, a sombra fica para trás. */
const LERP_CONTENT = 0.14;
const LERP_SHADOW = 0.05;
const LERP_MAGNETIC = 0.2;
/** Abaixo disto o rAF encerra — nada roda parado (handoff §5). */
const SETTLE = 0.002;

type Disposer = () => void;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * O campo de pontos é o único comportamento com custo de canvas por frame;
 * em máquinas fracas ele sai de cena e o layout permanece íntegro (handoff §5).
 */
function isLowPower(): boolean {
  return (navigator.hardwareConcurrency ?? 8) <= 4;
}

/* ------------------------------------------------------------------ *
 * Tilt com inércia — conteúdo segue rápido, sombra e brilho atrasam.
 * ------------------------------------------------------------------ */
function bindTilt(el: HTMLElement, signal: AbortSignal): Disposer {
  const max = Number.parseFloat(el.dataset.msTilt ?? "") || motionTokens.depth.tiltMaxDeg;
  const lag = motionTokens.depth.shadowLagPx;
  let raf: number | null = null;
  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let active = false;

  const loop = () => {
    cx += (tx - cx) * LERP_CONTENT;
    cy += (ty - cy) * LERP_CONTENT;
    sx += (tx - sx) * LERP_SHADOW;
    sy += (ty - sy) * LERP_SHADOW;

    el.style.setProperty("--ms-rx", `${-cy * max}deg`);
    el.style.setProperty("--ms-ry", `${cx * max}deg`);
    // Sombra dura deslocada: sem blur, só offset (Modernist).
    el.style.setProperty("--ms-shx", `${-sx * lag}px`);
    el.style.setProperty("--ms-shy", `${Math.abs(sy) * lag + 6}px`);
    // Posição do brilho especular / spotlight, em %.
    el.style.setProperty("--ms-mx", `${((tx + 1) / 2) * 100}%`);
    el.style.setProperty("--ms-my", `${((ty + 1) / 2) * 100}%`);

    if (!active && Math.abs(cx) < SETTLE && Math.abs(cy) < SETTLE) {
      el.style.removeProperty("--ms-rx");
      el.style.removeProperty("--ms-ry");
      raf = null;
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    active = true;
    el.dataset.msLift = "";
    // O brilho especular acende junto com o tilt: é a mesma luz.
    el.style.setProperty("--ms-spot", "1");
    if (raf === null) raf = requestAnimationFrame(loop);
  };

  el.addEventListener(
    "pointerenter",
    (e) => {
      // Toque não tem hover: inclinar sob o dedo só atrapalha o alvo do toque.
      if (e.pointerType === "touch") return;
      start();
    },
    { signal },
  );
  el.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (raf === null) start();
    },
    { signal },
  );
  const leave = () => {
    active = false;
    tx = 0;
    ty = 0;
    delete el.dataset.msLift;
    el.style.setProperty("--ms-spot", "0");
    if (raf === null) raf = requestAnimationFrame(loop);
  };
  el.addEventListener("pointerleave", leave, { signal });
  el.addEventListener("pointercancel", leave, { signal });

  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
  };
}

/* ------------------------------------------------------------------ *
 * Magnetismo — o alvo é puxado alguns px na direção do cursor.
 * ------------------------------------------------------------------ */
function bindMagnetic(el: HTMLElement, signal: AbortSignal): Disposer {
  const pull = Number.parseFloat(el.dataset.msMagnetic ?? "") || motionTokens.depth.liftPx;
  let raf: number | null = null;
  let releaseTimer: number | null = null;
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;

  const loop = () => {
    x += (tx - x) * LERP_MAGNETIC;
    y += (ty - y) * LERP_MAGNETIC;
    el.style.setProperty("--ms-x", `${x}px`);
    el.style.setProperty("--ms-y", `${y}px`);
    if (Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = null;
    }
  };

  el.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      // Enquanto atrai, o rAF manda: a transição de retorno tem de sair.
      delete el.dataset.msRelease;
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * pull;
      ty = ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * pull;
      if (raf === null) raf = requestAnimationFrame(loop);
    },
    { signal },
  );

  const release = () => {
    tx = 0;
    ty = 0;
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    x = 0;
    y = 0;
    // A mola de volta é declarativa: o atributo liga `transition: translate`.
    el.dataset.msRelease = "";
    el.style.setProperty("--ms-x", "0px");
    el.style.setProperty("--ms-y", "0px");
    releaseTimer = window.setTimeout(() => {
      delete el.dataset.msRelease;
      releaseTimer = null;
    }, motionTokens.spring.soft.duration);
  };
  el.addEventListener("pointerleave", release, { signal });
  el.addEventListener("pointercancel", release, { signal });

  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    if (releaseTimer !== null) clearTimeout(releaseTimer);
  };
}

/* ------------------------------------------------------------------ *
 * Ripple semântico — onda QUADRADA (raio zero); o desenho é o significado.
 * ------------------------------------------------------------------ */
const RIPPLE_STYLE: Record<RippleKind, string> = {
  // tinta = navegar/revisar/abrir
  ink: "border:2px solid color-mix(in srgb, var(--foreground) 55%, transparent);background:transparent",
  // contorno accent = errar, leech, alerta de qualidade
  accent: "border:2px solid var(--primary);background:transparent",
  // tracejado = excluir, suspender, descartar
  danger: "border:2px dashed var(--destructive);background:transparent",
  // preenchimento accent = criar, salvar, aceitar
  create: "border:none;background:color-mix(in srgb, var(--primary) 22%, transparent)",
};

function bindRipple(el: HTMLElement, signal: AbortSignal): Disposer {
  const kind = (el.dataset.msRipple || "ink") as RippleKind;
  const style = RIPPLE_STYLE[kind] ?? RIPPLE_STYLE.ink;

  el.addEventListener(
    "pointerdown",
    (e) => {
      if (el instanceof HTMLButtonElement && el.disabled) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      // Camada de recorte própria: não mexemos no `overflow` do host, que
      // clipparia menus e badges posicionados por cima dele.
      const layer = document.createElement("span");
      layer.setAttribute("aria-hidden", "true");
      layer.className = "ms-ripple-layer";

      const wave = document.createElement("span");
      wave.setAttribute(
        "style",
        `position:absolute;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;` +
          `width:16px;height:16px;margin:-8px;pointer-events:none;${style}`,
      );
      layer.appendChild(wave);
      el.appendChild(layer);

      const scale = Math.max(r.width, r.height) / 8;
      const anim = wave.animate(
        [
          { transform: "scale(0.4) rotate(0deg)", opacity: 0.95 },
          {
            transform: `scale(${scale}) rotate(${kind === "danger" ? 8 : 0}deg)`,
            opacity: 0,
          },
        ],
        { duration: motionTokens.choreography.rippleMs, easing: "cubic-bezier(0,0,0.2,1)" },
      );
      // Rede de segurança: numa aba oculta a WAAPI congela e `onfinish` nunca
      // dispara. Sem o timeout as camadas se acumulariam no DOM para sempre.
      const timer = window.setTimeout(
        () => layer.remove(),
        motionTokens.choreography.rippleMs + 200,
      );
      const clean = () => {
        clearTimeout(timer);
        layer.remove();
      };
      anim.onfinish = clean;
      anim.oncancel = clean;
    },
    { signal },
  );

  return () => {
    el.querySelectorAll(".ms-ripple-layer").forEach((n) => n.remove());
  };
}

/* ------------------------------------------------------------------ *
 * Spotlight — o container publica a posição do cursor em --ms-mx/--ms-my.
 * ------------------------------------------------------------------ */
function bindSpotlight(el: HTMLElement, signal: AbortSignal): Disposer {
  el.addEventListener(
    "pointermove",
    (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--ms-mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty("--ms-my", `${((e.clientY - r.top) / r.height) * 100}%`);
      el.style.setProperty("--ms-spot", "1");
    },
    { signal },
  );
  el.addEventListener("pointerleave", () => el.style.setProperty("--ms-spot", "0"), { signal });
  return () => {};
}

/* ------------------------------------------------------------------ *
 * Campo ambiente — grade de pontos em canvas; o modo é a state machine do ✳.
 * ------------------------------------------------------------------ */
function bindField(el: HTMLElement, signal: AbortSignal): Disposer {
  if (isLowPower()) return () => {};

  const cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.className = "ms-field-canvas";
  el.prepend(cv);
  const ctx = cv.getContext("2d");
  if (!ctx) {
    cv.remove();
    return () => {};
  }

  const GAP = 26;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let pts: { x: number; y: number }[] = [];
  let w = 0;
  let h = 0;
  let t = 0;
  let raf: number | null = null;

  const resize = () => {
    const r = el.getBoundingClientRect();
    w = cv.width = Math.max(1, Math.round(r.width * dpr));
    h = cv.height = Math.max(1, Math.round(r.height * dpr));
    pts = [];
    const g = GAP * dpr;
    for (let y = g / 2; y < h; y += g) for (let x = g / 2; x < w; x += g) pts.push({ x, y });
  };

  const frame = () => {
    t += 0.016;
    const mode = el.dataset.msField || "repouso";
    const ink = el.dataset.msFieldInk || "32,30,29";
    const base = Number.parseFloat(el.dataset.msFieldIntensity ?? "") || motionTokens.intensity.ambient;
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      let a = base * 0.6;
      let dx = 0;
      let s = 1.4 * dpr;
      if (mode === "observando") {
        a = base * 0.5 + base * 0.5 * Math.sin(t * 1.2 + p.x * 0.01);
      } else if (mode === "raciocinando") {
        dx = Math.sin(t * 2 + p.y * 0.02) * 2.4 * dpr;
        a = base;
      } else if (mode === "insight") {
        const pulse = Math.max(0, Math.sin(t * 3));
        a = base * 0.6 + pulse * motionTokens.intensity.focus * 0.55;
        s = (1.4 + pulse * 1.2) * dpr;
      }
      ctx.fillStyle = `rgba(${ink},${a})`;
      ctx.fillRect(p.x + dx - s / 2, p.y - s / 2, s, s);
    }
    raf = requestAnimationFrame(frame);
  };

  const play = () => {
    if (raf === null && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  };

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  let visible = false;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible) play();
    else pause();
  });
  io.observe(el);

  // Aba em segundo plano não gasta frame nenhum (handoff §5).
  const onVisibility = () => {
    if (document.hidden) pause();
    else if (visible) play();
  };
  document.addEventListener("visibilitychange", onVisibility, { signal });

  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    cv.remove();
  };
}

/* ------------------------------------------------------------------ *
 * Scanner: um MutationObserver único, WeakSet anti-rebind.
 * ------------------------------------------------------------------ */
const BINDERS: [keyof DOMStringMap, (el: HTMLElement, s: AbortSignal) => Disposer][] = [
  ["msTilt", bindTilt],
  ["msMagnetic", bindMagnetic],
  ["msRipple", bindRipple],
  ["msSpotlight", bindSpotlight],
  ["msField", bindField],
];

/**
 * Liga o Motion System no documento. Idempotente por elemento; devolve o
 * cleanup que derruba listeners, rAFs e observers.
 */
export function startMotionSystem(): Disposer {
  if (typeof window === "undefined") return () => {};
  if (prefersReducedMotion()) return () => {};

  const bound = new WeakSet<HTMLElement>();
  const disposers: Disposer[] = [];
  const controller = new AbortController();
  const { signal } = controller;

  const scan = () => {
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (bound.has(el)) return;
      bound.add(el);
      for (const [key, bind] of BINDERS) {
        if (el.dataset[key] !== undefined) disposers.push(bind(el, signal));
      }
    });
  };

  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { subtree: true, childList: true });
  scan();

  document.documentElement.dataset.msReady = "";

  return () => {
    controller.abort();
    mo.disconnect();
    for (const d of disposers) d();
    delete document.documentElement.dataset.msReady;
  };
}
