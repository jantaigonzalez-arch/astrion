"use client";

import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

// "Señal cruda": un cromatograma sin procesar — línea base a la deriva, picos
// sin resolver y ruido de alta frecuencia. Es la metáfora nativa de Evoelution
// del dato .dat antes de que Evo_AI lo ingiera, corrija y ordene.
// Todo se genera de forma determinista (PRNG sembrado + funciones puras) para
// que el HTML de servidor y cliente coincidan (sin desajuste de hidratación).

const W = 300;
const H = 140;
const BASE = 104; // y de la línea base (hacia abajo = mayor y)

// Picos gaussianos deliberadamente solapados → "sin resolver".
const HUMPS = [
  { c: 58, a: 30, w: 15 },
  { c: 92, a: 24, w: 11 },
  { c: 150, a: 40, w: 17 },
  { c: 173, a: 33, w: 13 },
  { c: 244, a: 20, w: 22 },
];

function signalY(x: number, noise: number): number {
  const drift = 7 * Math.sin(x * 0.03 + 0.6) + 5 * Math.sin(x * 0.011 + 2);
  let humps = 0;
  for (const h of HUMPS) {
    humps += h.a * Math.exp(-((x - h.c) ** 2) / (2 * h.w * h.w));
  }
  return BASE - drift - humps + noise;
}

function buildSignal() {
  let s = 987654321 >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const pts: { x: number; y: number }[] = [];
  for (let x = 0; x <= W; x += 1.5) {
    const noise = (rnd() - 0.5) * 4.5;
    pts.push({ x, y: signalY(x, noise) });
  }
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  return { d, pts };
}

const { d: SIGNAL_D } = buildSignal();

// Marcadores de problema: x sobre la señal + posición del chip.
const MARKERS = [
  { ann: 0, x: 40, left: "6%" }, // ruido
  { ann: 1, x: 150, left: "44%" }, // picos sin resolver
  { ann: 2, x: 270, left: "72%" }, // deriva
];

export function RawSignal({ annotations }: { annotations: string[] }) {
  return (
    <div className="relative">
      <div className="rounded-2xl bg-gradient-to-br from-signal/50 via-primary/25 to-transparent p-px shadow-2xl shadow-primary/20">
      <div className="glass relative overflow-hidden rounded-2xl p-4">
        {/* Haz de barrido "de futuro" */}
        <div className="pointer-events-none absolute inset-y-0 -left-1/3 z-20 w-1/3 bg-gradient-to-r from-transparent via-signal/12 to-transparent animate-scan [animation-delay:-3s]" />
        {/* Barra de ventana */}
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-destructive/70" />
            <span className="size-2.5 rounded-full bg-warning/70" />
            <span className="size-2.5 rounded-full bg-success/70" />
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            raw_signal.dat · sin procesar
          </span>
        </div>

        <div className="relative mt-3 overflow-hidden rounded-xl border border-border/60 bg-background/60 p-3">
          {/* Chips de anotación */}
          {MARKERS.map((m) => (
            <div
              key={m.ann}
              className="absolute top-1.5 z-10"
              style={{ left: m.left }}
            >
              <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                <AlertTriangle className="size-2.5" />
                {annotations[m.ann]}
              </span>
            </div>
          ))}

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-8 h-44 w-full"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* Malla de fondo */}
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={`h${f}`}
                x1="0"
                y1={H * f}
                x2={W}
                y2={H * f}
                stroke="var(--border)"
                strokeWidth="0.5"
                strokeOpacity="0.5"
              />
            ))}

            {/* Guías verticales punteadas hacia cada marcador */}
            {MARKERS.map((m) => (
              <line
                key={`g${m.x}`}
                x1={m.x}
                y1="0"
                x2={m.x}
                y2={H}
                stroke="var(--destructive)"
                strokeWidth="0.6"
                strokeOpacity="0.35"
                strokeDasharray="2 3"
              />
            ))}

            {/* Señal cruda ruidosa */}
            <motion.path
              d={SIGNAL_D}
              stroke="var(--muted-foreground)"
              strokeWidth="1.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 0.85 }}
              viewport={{ once: true }}
              transition={{ duration: 1.8, ease: "easeInOut" }}
            />

            {/* Punto marcador donde la guía cruza la señal */}
            {MARKERS.map((m) => (
              <circle
                key={`m${m.x}`}
                cx={m.x}
                cy={signalY(m.x, 0)}
                r="2.4"
                fill="var(--destructive)"
              />
            ))}
          </svg>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>0.0 min</span>
            <span className="text-destructive">● no integrado</span>
            <span>8.0 min</span>
          </div>
        </div>
      </div>
      </div>

      {/* Resplandor sutil detrás */}
      <div className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-primary/5 blur-2xl" />
    </div>
  );
}
