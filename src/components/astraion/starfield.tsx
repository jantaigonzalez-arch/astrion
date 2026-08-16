"use client";

import { useEffect, useRef } from "react";

/**
 * Cielo animado del encabezado.
 *
 * Tres capas de profundidad: las lejanas apenas se mueven, las cercanas derivan
 * más rápido. Es el paralaje de un cielo en rotación, y da la sensación de estar
 * mirando hacia afuera en vez de a un fondo pintado. Cruza algún meteoro de
 * estela blanca, de tarde en tarde.
 *
 * La frecuencia está deliberadamente baja. Caían cada 0.65-2.4 s y en ráfagas
 * de hasta tres, y eso convertía el encabezado de un producto de gestión en un
 * salvapantallas. Uno cada 5-13 s se nota cuando ocurre y no reclama atención
 * el resto del tiempo, que es lo que tiene que hacer un fondo.
 *
 * El lienzo cubre todo el encabezado, pero una máscara en `.stars` desvanece la
 * franja de abajo: ahí está la fogata y su resplandor borraría las estrellas.
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
    let w = 0, h = 0, raf = 0, last = 0, nextMeteor = 700, resizeTimer = 0;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    // Un meteoro nuevo. `delay` lo retrasa dentro de una misma ráfaga para que
    // los de un grupo no salgan calcados uno encima de otro.
    function spawnMeteor(delay = 0) {
      if (meteors.length >= 3) return;
      meteors.push({
        x: rnd(w * 0.1, w * 1.1),
        y: rnd(-40, h * 0.62),
        len: rnd(70, 180),
        sp: rnd(0.16, 0.34),
        life: -delay,
        max: rnd(1400, 2200),
      });
    }

    function build() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c!.offsetWidth;
      h = c!.offsetHeight;
      c!.width = w * dpr;
      c!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const total = Math.min(210, Math.round((w * h) / 5200));
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
      nextMeteor = 2600;
    }

    function paintStar(s: Star, alpha: number) {
      ctx!.beginPath();
      ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      // Blanco casi puro: sobre el azul de Prusia una estrella gris se pierde,
      // y son lo único que se ve en la franja alta del cielo.
      ctx!.fillStyle = s.red
        ? `rgba(255,214,170,${alpha.toFixed(3)})`
        : `rgba(240,245,252,${alpha.toFixed(3)})`;
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
        // Casi siempre uno solo; muy de vez en cuando un segundo detrás.
        const burst = Math.random() < 0.12 ? 2 : 1;
        for (let b = 0; b < burst; b++) spawnMeteor(b * rnd(240, 620));
        nextMeteor = rnd(5000, 13000);
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life += dt;
        if (m.life < 0) continue; // todavía no entra: espera su turno en la ráfaga
        m.x -= m.sp * dt;
        m.y += m.sp * dt * 0.42;
        const k = m.life / m.max;
        if (k >= 1) { meteors.splice(i, 1); continue; }
        const fade = Math.sin(Math.PI * k);
        const g = ctx!.createLinearGradient(m.x, m.y, m.x + m.len, m.y - m.len * 0.42);
        g.addColorStop(0, `rgba(255,250,240,${(0.85 * fade).toFixed(3)})`);
        g.addColorStop(0.4, `rgba(172,190,216,${(0.28 * fade).toFixed(3)})`);
        g.addColorStop(1, "rgba(172,190,216,0)");
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
