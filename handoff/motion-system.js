/* Motion System — Preceptor / MEMORÁVEL.
 * Tokens + comportamentos por atributo. Sem dependências; WAAPI + rAF.
 * Uso: data-ms-tilt="6" | data-ms-magnetic | data-ms-ripple="ink|accent|danger|create"
 *      data-ms-spotlight | data-ms-field="repouso|observando|raciocinando|insight"
 * Respeita prefers-reduced-motion (não liga nada).
 */
(function () {
  const SPRING = 'linear(0, 0.062 2.5%, 0.235 5.4%, 0.665 11.4%, 0.885 15%, 1.065 20.3%, 1.117 24.6%, 1.118 28.5%, 1.038 38.8%, 0.99 48.4%, 0.997 66.3%, 1)';
  const tokens = {
    spring: {
      soft:   { stiffness: 120, damping: 14, mass: 1,   duration: 550, easing: SPRING },
      snappy: { stiffness: 260, damping: 22, mass: 0.8, duration: 380, easing: SPRING },
    },
    press: { scale: 0.95, duration: 70 },
    depth: { tiltMaxDeg: 7, shadowLagPx: 16, liftPx: 5 },
    intensity: { ambient: 0.10, focus: 0.22 },
  };
  window.MotionSystem = { tokens, spring: SPRING };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const bound = new WeakSet();

  /* Tilt com inércia: conteúdo segue rápido, sombra (--shx/--shy) e brilho (--mx/--my) atrasam */
  function bindTilt(el) {
    const max = parseFloat(el.getAttribute('data-ms-tilt')) || tokens.depth.tiltMaxDeg;
    let raf = null, tx = 0, ty = 0, cx = 0, cy = 0, sx = 0, sy = 0, active = false;
    el.style.willChange = 'transform';
    function loop() {
      cx += (tx - cx) * 0.14; cy += (ty - cy) * 0.14;
      sx += (tx - sx) * 0.05; sy += (ty - sy) * 0.05;
      el.style.transform = 'perspective(900px) rotateX(' + (-cy * max) + 'deg) rotateY(' + (cx * max) + 'deg)';
      el.style.setProperty('--shx', (-sx * tokens.depth.shadowLagPx) + 'px');
      el.style.setProperty('--shy', (Math.abs(sy) * tokens.depth.shadowLagPx + 6) + 'px');
      el.style.setProperty('--mx', (((tx + 1) / 2) * 100) + '%');
      el.style.setProperty('--my', (((ty + 1) / 2) * 100) + '%');
      const settled = !active && Math.abs(cx) < 0.002 && Math.abs(cy) < 0.002;
      if (settled) { el.style.transform = ''; raf = null; return; }
      raf = requestAnimationFrame(loop);
    }
    el.addEventListener('pointerenter', function () { active = true; if (!raf) raf = requestAnimationFrame(loop); });
    el.addEventListener('pointermove', function (e) {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    el.addEventListener('pointerleave', function () { active = false; tx = 0; ty = 0; });
  }

  /* Magnetismo: o elemento é puxado alguns px na direção do cursor; solta com mola */
  function bindMagnetic(el) {
    const pull = parseFloat(el.getAttribute('data-ms-magnetic')) || tokens.depth.liftPx;
    let raf = null, tx = 0, ty = 0, x = 0, y = 0;
    function loop() {
      x += (tx - x) * 0.2; y += (ty - y) * 0.2;
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      if (Math.abs(tx - x) > 0.05 || Math.abs(ty - y) > 0.05) raf = requestAnimationFrame(loop); else raf = null;
    }
    el.addEventListener('pointermove', function (e) {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * pull;
      ty = ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * pull;
      if (!raf) raf = requestAnimationFrame(loop);
    });
    el.addEventListener('pointerleave', function () {
      tx = 0; ty = 0;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      el.animate(
        [{ transform: 'translate(' + x + 'px,' + y + 'px)' }, { transform: 'translate(0,0)' }],
        { duration: tokens.spring.soft.duration, easing: SPRING }
      );
      x = 0; y = 0; el.style.transform = '';
    });
  }

  /* Ripple semântico: onda quadrada (Modernist) cujo desenho muda com a ação */
  const RIPPLE_KINDS = {
    ink:    'border:2px solid rgba(32,30,29,0.55);background:transparent',
    accent: 'border:2px solid #ec3013;background:transparent',
    danger: 'border:2px dashed #ae1800;background:transparent',
    create: 'border:none;background:rgba(236,48,19,0.22)',
  };
  function bindRipple(el) {
    const kind = el.getAttribute('data-ms-ripple') || 'ink';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.overflow = 'hidden';
    el.addEventListener('pointerdown', function (e) {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const w = document.createElement('span');
      w.setAttribute('aria-hidden', 'true');
      w.setAttribute('style', 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:16px;height:16px;margin:-8px;pointer-events:none;' + (RIPPLE_KINDS[kind] || RIPPLE_KINDS.ink));
      el.appendChild(w);
      const anim = w.animate(
        [{ transform: 'scale(0.4) rotate(0deg)', opacity: 0.95 }, { transform: 'scale(' + (Math.max(r.width, r.height) / 8) + ') rotate(' + (kind === 'danger' ? 8 : 0) + 'deg)', opacity: 0 }],
        { duration: 650, easing: 'cubic-bezier(0,0,0.2,1)' }
      );
      anim.onfinish = function () { w.remove(); };
    });
  }

  /* Spotlight: o container ganha --mx/--my do cursor; um overlay usa radial-gradient */
  function bindSpotlight(el) {
    el.addEventListener('pointermove', function (e) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100) + '%');
      el.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100) + '%');
      el.style.setProperty('--spot', '1');
    });
    el.addEventListener('pointerleave', function () { el.style.setProperty('--spot', '0'); });
  }

  /* Campo de pontos ambiente: canvas leve, modo via atributo (state machine da IA) */
  function bindField(el) {
    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.prepend(cv);
    const ctx = cv.getContext('2d');
    const GAP = 26; let pts = [], W = 0, H = 0, t = 0, raf = null;
    function resize() {
      const r = el.getBoundingClientRect();
      W = cv.width = Math.max(1, r.width * devicePixelRatio);
      H = cv.height = Math.max(1, r.height * devicePixelRatio);
      pts = [];
      const g = GAP * devicePixelRatio;
      for (let y = g / 2; y < H; y += g) for (let x = g / 2; x < W; x += g) pts.push({ x, y });
    }
    function frame() {
      t += 0.016;
      const mode = el.getAttribute('data-ms-field') || 'repouso';
      const ink = (el.getAttribute('data-ms-field-ink') || '32,30,29');
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        let a = 0.06, dx = 0, dy = 0, s = 1.4;
        if (mode === 'observando') { a = 0.05 + 0.05 * Math.sin(t * 1.2 + p.x * 0.01); }
        else if (mode === 'raciocinando') { dx = Math.sin(t * 2 + p.y * 0.02) * 2.4; a = 0.1; }
        else if (mode === 'insight') { const pu = Math.max(0, Math.sin(t * 3)); a = 0.06 + pu * 0.16; s = 1.4 + pu * 1.2; }
        ctx.fillStyle = 'rgba(' + ink + ',' + a + ')';
        ctx.fillRect(p.x + dx - s / 2, p.y + dy - s / 2, s * devicePixelRatio, s * devicePixelRatio);
      }
      raf = requestAnimationFrame(frame);
    }
    resize();
    new ResizeObserver(resize).observe(el);
    const io = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { if (!raf) raf = requestAnimationFrame(frame); }
      else if (raf) { cancelAnimationFrame(raf); raf = null; }
    });
    io.observe(el);
  }

  function scan(root) {
    const q = '[data-ms-tilt],[data-ms-magnetic],[data-ms-ripple],[data-ms-spotlight],[data-ms-field]';
    (root.querySelectorAll ? root.querySelectorAll(q) : []).forEach(function (el) {
      if (bound.has(el)) return; bound.add(el);
      if (el.hasAttribute('data-ms-tilt')) bindTilt(el);
      if (el.hasAttribute('data-ms-magnetic')) bindMagnetic(el);
      if (el.hasAttribute('data-ms-ripple')) bindRipple(el);
      if (el.hasAttribute('data-ms-spotlight')) bindSpotlight(el);
      if (el.hasAttribute('data-ms-field')) bindField(el);
    });
  }
  new MutationObserver(function () { scan(document); }).observe(document.documentElement, { subtree: true, childList: true });
  if (document.readyState !== 'loading') scan(document);
  else document.addEventListener('DOMContentLoaded', function () { scan(document); });
})();
