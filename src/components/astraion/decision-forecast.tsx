"use client";

import { useEffect, useRef } from "react";

/**
 * El argumento del encabezado, dibujado.
 *
 * La página sostiene que una empresa grande responde «¿cuántas compro?» con un
 * pronóstico y una chica con una corazonada. Esto ES ese pronóstico: consumo
 * mensual real de una refacción —el dato que el ERP ya escribe cada vez que un
 * técnico descuenta una pieza— y el modelo extendiéndolo con su banda de
 * incertidumbre hasta un punto de reorden.
 *
 * Tres cosas en un objeto: el dato del ERP, el modelo, y la decisión. Por eso
 * está aquí y no un gráfico decorativo.
 *
 * La serie es fija y no aleatoria: un gráfico que cambia en cada carga se ve
 * como lo que sería, un adorno.
 */

/** 14 meses de consumo. Estacional, con el pico de mantenimiento de marzo. */
const HISTORY = [4, 3, 9, 6, 5, 7, 12, 8, 6, 5, 11, 9, 7, 10];
/** Media del pronóstico y ancho de banda: crece con el horizonte, como debe. */
const FORECAST = [
  { mean: 8.4, band: 1.6 },
  { mean: 9.1, band: 2.4 },
  { mean: 10.2, band: 3.4 },
  { mean: 9.6, band: 4.3 },
];

export function DecisionForecast({
  className,
  labels,
}: {
  className?: string;
  labels: {
    history: string;
    model: string;
    today: string;
  };
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, t0 = 0, resizeTimer = 0;
    let W = 0, H = 0;

    const PAD = { l: 8, r: 10, t: 16, b: 26 };
    const total = HISTORY.length + FORECAST.length;
    const maxY = 17;

    const xAt = (i: number) =>
      PAD.l + (i / (total - 1)) * (W - PAD.l - PAD.r);
    const yAt = (v: number) =>
      H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = c!.offsetWidth;
      H = c!.offsetHeight;
      c!.width = W * dpr;
      c!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** p: 0→1 dibuja el histórico; 1→2 abre la banda y el pronóstico. */
    function draw(p: number) {
      ctx!.clearRect(0, 0, W, H);

      // Retícula tenue: referencia sin competir con la señal.
      ctx!.strokeStyle = "rgba(120,134,160,0.10)";
      ctx!.lineWidth = 1;
      for (let g = 0; g <= 3; g++) {
        const y = PAD.t + (g / 3) * (H - PAD.t - PAD.b);
        ctx!.beginPath();
        ctx!.moveTo(PAD.l, y);
        ctx!.lineTo(W - PAD.r, y);
        ctx!.stroke();
      }

      const hp = Math.min(1, p);
      const fp = Math.max(0, Math.min(1, p - 1));
      const lastIdx = HISTORY.length - 1;

      /* ---- Banda de incertidumbre ---- */
      if (fp > 0) {
        const upper: [number, number][] = [[xAt(lastIdx), yAt(HISTORY[lastIdx])]];
        const lower: [number, number][] = [[xAt(lastIdx), yAt(HISTORY[lastIdx])]];
        FORECAST.forEach((f, k) => {
          const x = xAt(lastIdx + 1 + k);
          const grow = Math.min(1, fp * 1.35 - k * 0.12);
          if (grow <= 0) return;
          upper.push([x, yAt(f.mean + f.band * grow)]);
          lower.push([x, yAt(f.mean - f.band * grow)]);
        });
        if (upper.length > 1) {
          ctx!.beginPath();
          upper.forEach(([x, y], i) => (i ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y)));
          for (let i = lower.length - 1; i >= 0; i--) ctx!.lineTo(lower[i][0], lower[i][1]);
          ctx!.closePath();
          const g = ctx!.createLinearGradient(xAt(lastIdx), 0, W - PAD.r, 0);
          g.addColorStop(0, "rgba(225,89,75,0.24)");
          g.addColorStop(1, "rgba(225,89,75,0.05)");
          ctx!.fillStyle = g;
          ctx!.fill();
        }
      }

      /* ---- Línea del pronóstico (punteada: es una estimación) ---- */
      if (fp > 0) {
        ctx!.save();
        ctx!.setLineDash([4, 4]);
        ctx!.strokeStyle = "rgba(240,116,95,0.9)";
        ctx!.lineWidth = 1.6;
        ctx!.beginPath();
        ctx!.moveTo(xAt(lastIdx), yAt(HISTORY[lastIdx]));
        FORECAST.forEach((f, k) => {
          const reach = Math.min(1, fp * 1.3 - k * 0.2);
          if (reach <= 0) return;
          ctx!.lineTo(xAt(lastIdx + 1 + k), yAt(f.mean));
        });
        ctx!.stroke();
        ctx!.restore();
      }

      /* ---- Histórico: sólido, es lo que de verdad pasó ---- */
      const shown = Math.max(1, Math.round(hp * HISTORY.length));
      ctx!.strokeStyle = "rgba(216,226,242,0.92)";
      ctx!.lineWidth = 1.7;
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      for (let i = 0; i < shown; i++) {
        const x = xAt(i), y = yAt(HISTORY[i]);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();

      // Punto vivo en el extremo del histórico
      if (hp >= 1) {
        ctx!.beginPath();
        ctx!.arc(xAt(lastIdx), yAt(HISTORY[lastIdx]), 3.2, 0, Math.PI * 2);
        ctx!.fillStyle = "#f0745f";
        ctx!.fill();
      }

      /* ---- Corte del presente ---- */
      if (hp >= 1) {
        const x = xAt(lastIdx);
        ctx!.save();
        ctx!.setLineDash([3, 4]);
        ctx!.strokeStyle = "rgba(160,172,196,0.45)";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(x, PAD.t - 6);
        ctx!.lineTo(x, H - PAD.b + 4);
        ctx!.stroke();
        ctx!.restore();

        ctx!.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx!.fillStyle = "rgba(160,172,196,0.75)";
        ctx!.textAlign = "center";
        ctx!.fillText(labels.today, x, H - PAD.b + 17);

        ctx!.textAlign = "left";
        ctx!.fillStyle = "rgba(200,212,232,0.6)";
        ctx!.fillText(labels.history, PAD.l, H - PAD.b + 17);

        if (fp > 0.35) {
          ctx!.textAlign = "right";
          ctx!.fillStyle = "rgba(240,116,95,0.85)";
          ctx!.fillText(labels.model, W - PAD.r, H - PAD.b + 17);
        }
      }
    }

    function frame(t: number) {
      if (!t0) t0 = t;
      // 1.1 s el histórico, 1.5 s la banda. Se detiene: no es un bucle.
      const p = Math.min(2, (t - t0) / 1100);
      draw(p);
      if (p < 2) raf = requestAnimationFrame(frame);
    }

    function start() {
      resize();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      t0 = 0;
      if (reduced) draw(2);
      else raf = requestAnimationFrame(frame);
    }

    // Arranca al entrar en pantalla: la animación cuenta algo y debe verse.
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            io = null;
            start();
          }
        },
        { threshold: 0.4 },
      );
      io.observe(c);
      resize();
      draw(0);
    } else {
      start();
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        draw(2); // tras redimensionar se muestra completo, no se repite
      }, 160);
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      io?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [labels.history, labels.model, labels.today]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
