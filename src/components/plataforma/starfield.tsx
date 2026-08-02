"use client";

import { useEffect, useRef } from "react";

/**
 * Cielo animado del encabezado.
 *
 * Tres capas de profundidad: las lejanas apenas se mueven, las cercanas derivan
 * más rápido. Es el paralaje de un cielo en rotación, y da la sensación de estar
 * mirando hacia afuera en vez de a un fondo pintado. Cada tanto cruza un meteoro
 * con estela H-alfa — el acento de la página apareciendo en el cielo, no un
 * color decorativo.
 *
 * Se detiene con la pestaña oculta (no tiene sentido gastar cuadros que nadie
 * ve) y se dibuja quieto si el sistema pide movimiento reducido.
 */
type Star = {
  x: number; y: number; r: number; a: number;
  v: number; red: boolean; sp: number; ph: number;
};
type Meteor = { x: number; y: number; len: number; sp: number; life: number; max: number };

const LAYERS = [
  { n: 0.45, r: [0.25, 0.65], a: [0.14, 0.34], v: 0.0035 },
  { n: 0.35, r: [0.5, 1.0], a: [0.24, 0.52], v: 0.008 },
  { n: 0.2, r: [0.8, 1.5], a: [0.4, 0.78], v: 0.015 },
] as const;

export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];
    let w = 0, h = 0, raf = 0, last = 0, nextMeteor = 2600, resizeTimer = 0;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c!.offsetWidth;
      h = c!.offsetHeight;
      c!.width = w * dpr;
      c!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const total = Math.min(260, Math.round((w * h) / 4200));
      stars = [];
      for (const L of LAYERS) {
        for (let i = 0; i < Math.round(total * L.n); i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: rnd(L.r[0], L.r[1]),
            a: rnd(L.a[0], L.a[1]),
            v: L.v,
            red: Math.random() < 0.09,
            sp: rnd(0.0004, 0.0016),
            ph: Math.random() * Math.PI * 2,
          });
        }
      }
      meteors = [];
    }

    function paintStar(s: Star, alpha: number) {
      ctx!.beginPath();
      ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx!.fillStyle = s.red
        ? `rgba(232,128,112,${alpha.toFixed(3)})`
        : `rgba(214,226,245,${alpha.toFixed(3)})`;
      ctx!.fill();
    }

    function frame(t: number) {
      const dt = last ? Math.min(t - last, 48) : 16;
      last = t;
      ctx!.clearRect(0, 0, w, h);

      for (const s of stars) {
        s.x -= s.v * dt; // el cielo gira
        if (s.x < -2) { s.x = w + 2; s.y = Math.random() * h; }
        paintStar(s, s.a * (0.6 + 0.4 * Math.sin(t * s.sp + s.ph)));
      }

      nextMeteor -= dt;
      if (nextMeteor <= 0) {
        meteors.push({
          x: rnd(w * 0.15, w * 1.05),
          y: rnd(-20, h * 0.45),
          len: rnd(70, 190),
          sp: rnd(0.34, 0.62),
          life: 0,
          max: rnd(680, 1100),
        });
        nextMeteor = rnd(4200, 11000);
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        m.x -= m.sp * dt;
        m.y += m.sp * dt * 0.42;
        const k = m.life / m.max;
        if (k >= 1) { meteors.splice(i, 1); continue; }
        const fade = Math.sin(Math.PI * k);
        const g = ctx!.createLinearGradient(m.x, m.y, m.x + m.len, m.y - m.len * 0.42);
        g.addColorStop(0, `rgba(240,116,95,${(0.85 * fade).toFixed(3)})`);
        g.addColorStop(0.4, `rgba(225,89,75,${(0.28 * fade).toFixed(3)})`);
        g.addColorStop(1, "rgba(225,89,75,0)");
        ctx!.strokeStyle = g;
        ctx!.lineWidth = 1.25;
        ctx!.beginPath();
        ctx!.moveTo(m.x, m.y);
        ctx!.lineTo(m.x + m.len, m.y - m.len * 0.42);
        ctx!.stroke();
      }

      raf = requestAnimationFrame(frame);
    }

    function still() {
      ctx!.clearRect(0, 0, w, h);
      for (const s of stars) paintStar(s, s.a);
    }

    function start() {
      build();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (reduced) still();
      else raf = requestAnimationFrame(frame);
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(start, 180);
    }
    function onVisibility() {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduced && !raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }

    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
