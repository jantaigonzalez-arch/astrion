"use client";

import { useEffect, useRef } from "react";

/**
 * El pronóstico, dibujado.
 *
 * Es la prueba de la capa 3: consumo mensual real de una refacción —el dato que
 * el ERP ya escribe cada vez que un técnico descuenta una pieza— y el modelo
 * extendiéndolo con su banda de incertidumbre hasta un punto de reorden.
 *
 * Tres cosas en un objeto: el dato del ERP, el modelo, y la decisión.
 *
 * Se dibuja con ejes rotulados a propósito. Un gráfico sin escala ni unidades
 * es una ilustración; con ellas es una lectura, que es lo que la página afirma
 * que el sistema entrega.
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

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function DecisionForecast({
  className,
  locale,
  labels,
}: {
  className?: string;
  locale: string;
  labels: { today: string; unit: string };
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

    // La izquierda tiene que alojar las etiquetas del eje: sin ese espacio el
    // gráfico se lee como un adorno pegado al borde.
    const PAD = { l: 40, r: 16, t: 24, b: 34 };
    const total = HISTORY.length + FORECAST.length;
    const lastIdx = HISTORY.length - 1;
    const maxY = 18;
    const TICKS = [0, 6, 12, 18];

    // Meses reales en el idioma de la página: el eje deja de ser abstracto.
    const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      month: "short",
    });
    const monthAt = (i: number) =>
      fmt.format(new Date(2024, i % 12, 1)).replace(".", "").toUpperCase();

    const xAt = (i: number) => PAD.l + (i / (total - 1)) * (W - PAD.l - PAD.r);
    const yAt = (v: number) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = c!.offsetWidth;
      H = c!.offsetHeight;
      c!.width = W * dpr;
      c!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Retícula, escala y meses. Se dibujan siempre: son el marco, no la señal. */
    function drawAxes() {
      ctx!.font = `9.5px ${MONO}`;
      ctx!.textBaseline = "middle";

      for (const v of TICKS) {
        const y = yAt(v);
        ctx!.strokeStyle =
          v === 0 ? "rgba(128,142,168,0.32)" : "rgba(128,142,168,0.15)";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(PAD.l, y);
        ctx!.lineTo(W - PAD.r, y);
        ctx!.stroke();

        ctx!.textAlign = "right";
        ctx!.fillStyle = "rgba(140,154,180,0.85)";
        ctx!.fillText(String(v), PAD.l - 9, y);
      }

      // Unidad: una escala sin unidad no dice nada.
      ctx!.textAlign = "right";
      ctx!.fillStyle = "rgba(140,154,180,0.62)";
      ctx!.fillText(labels.unit, PAD.l - 9, PAD.t - 12);

      ctx!.textAlign = "center";
      ctx!.textBaseline = "alphabetic";
      ctx!.fillStyle = "rgba(140,154,180,0.76)";
      for (let i = 0; i < total; i += 3) {
        ctx!.fillText(monthAt(i), xAt(i), H - PAD.b + 16);
      }
    }

    /** p: 0→1 dibuja el histórico; 1→2 abre la banda y el pronóstico. */
    function draw(p: number) {
      ctx!.clearRect(0, 0, W, H);
      drawAxes();

      const hp = Math.min(1, p);
      const fp = Math.max(0, Math.min(1, p - 1));

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
          for (let i = lower.length - 1; i >= 0; i--) {
            ctx!.lineTo(lower[i][0], lower[i][1]);
          }
          ctx!.closePath();
          const g = ctx!.createLinearGradient(xAt(lastIdx), 0, W - PAD.r, 0);
          g.addColorStop(0, "rgba(235,167,90,0.32)");
          g.addColorStop(1, "rgba(235,167,90,0.08)");
          ctx!.fillStyle = g;
          ctx!.fill();
        }
      }

      /* ---- Línea del pronóstico (punteada: es una estimación) ---- */
      if (fp > 0) {
        ctx!.save();
        ctx!.setLineDash([4, 4]);
        ctx!.strokeStyle = "rgba(249,196,131,0.95)";
        ctx!.lineWidth = 1.7;
        ctx!.lineJoin = "round";
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
      const shown = Math.max(2, Math.round(hp * HISTORY.length));

      // Relleno tenue bajo la serie: le da peso frente a la banda del modelo.
      const area = ctx!.createLinearGradient(0, PAD.t, 0, H - PAD.b);
      area.addColorStop(0, "rgba(130,169,210,0.22)");
      area.addColorStop(1, "rgba(130,169,210,0)");
      ctx!.beginPath();
      ctx!.moveTo(xAt(0), H - PAD.b);
      for (let i = 0; i < shown; i++) ctx!.lineTo(xAt(i), yAt(HISTORY[i]));
      ctx!.lineTo(xAt(shown - 1), H - PAD.b);
      ctx!.closePath();
      ctx!.fillStyle = area;
      ctx!.fill();

      ctx!.strokeStyle = "rgba(169,196,222,0.95)";
      ctx!.lineWidth = 1.7;
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      for (let i = 0; i < shown; i++) {
        const x = xAt(i), y = yAt(HISTORY[i]);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();

      // Cada punto es una medición, no un trazo: se marcan.
      ctx!.fillStyle = "rgba(169,196,222,0.66)";
      for (let i = 0; i < shown; i++) {
        ctx!.beginPath();
        ctx!.arc(xAt(i), yAt(HISTORY[i]), 1.9, 0, Math.PI * 2);
        ctx!.fill();
      }

      /* ---- Corte del presente ---- */
      if (hp >= 1) {
        const x = xAt(lastIdx);
        ctx!.save();
        ctx!.setLineDash([3, 4]);
        ctx!.strokeStyle = "rgba(152,166,192,0.58)";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(x, PAD.t - 10);
        ctx!.lineTo(x, H - PAD.b);
        ctx!.stroke();
        ctx!.restore();

        ctx!.font = `9.5px ${MONO}`;
        ctx!.textAlign = "center";
        ctx!.textBaseline = "alphabetic";
        ctx!.fillStyle = "rgba(178,190,212,0.9)";
        ctx!.fillText(labels.today, x, PAD.t - 15);

        ctx!.beginPath();
        ctx!.arc(x, yAt(HISTORY[lastIdx]), 3.4, 0, Math.PI * 2);
        ctx!.fillStyle = "#f9c483";
        ctx!.fill();
      }
    }

    function frame(t: number) {
      if (!t0) t0 = t;
      // 1.1 s el histórico, 1.1 s la banda. Se detiene: no es un bucle.
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
  }, [locale, labels.today, labels.unit]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
