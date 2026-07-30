"use client";

import { motion } from "motion/react";
import { Chromatogram } from "@/components/marketing/chromatogram";

// "Señal procesada": el resultado de Evo_AI — línea base corregida, picos
// resueltos e integrados, con métricas y score de anomalía saludable.
// Es el "después" que contrasta con <RawSignal /> (el "antes" del hero).
export function ProcessedSignal() {
  return (
    <div className="relative">
      <div className="rounded-2xl bg-gradient-to-br from-signal/50 via-primary/25 to-transparent p-px shadow-2xl shadow-primary/20">
        <div className="glass relative overflow-hidden rounded-2xl">
          {/* Haz de barrido "de futuro" */}
          <div className="pointer-events-none absolute inset-y-0 -left-1/3 z-20 w-1/3 bg-gradient-to-r from-transparent via-signal/12 to-transparent animate-scan [animation-delay:-2s]" />

          {/* Barra de ventana */}
          <div className="flex items-center justify-between border-b border-border/60 bg-secondary/40 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-destructive/70" />
              <span className="size-2.5 rounded-full bg-warning/70" />
              <span className="size-2.5 rounded-full bg-success/70" />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              evo_ai · procesado
            </span>
          </div>

          {/* Pestañas */}
          <div className="flex gap-1 border-b border-border/60 px-3 pt-3">
            {["Análisis", "Trending", "Insights"].map((tab, i) => (
              <span
                key={tab}
                className={
                  i === 0
                    ? "rounded-t-md border border-b-0 border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium"
                    : "px-3 py-1.5 text-xs text-muted-foreground"
                }
              >
                {tab}
              </span>
            ))}
          </div>

          <div className="space-y-4 p-4">
            {/* Cromatograma resuelto */}
            <div className="rounded-xl border border-border/60 bg-background/60 p-4">
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span>chromatogram.dat</span>
                <span className="text-success">● integrado</span>
              </div>
              <Chromatogram className="h-36 w-full" />
            </div>

            {/* Tabla de picos + medidor de anomalía */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11px]">
                <div className="grid grid-cols-4 gap-2 pb-1.5 text-muted-foreground">
                  <span>RT</span>
                  <span>Área</span>
                  <span>FWHM</span>
                  <span>SNR</span>
                </div>
                {[
                  ["2.41", "48,209", "0.08", "312:1"],
                  ["3.87", "31,004", "0.11", "204:1"],
                  ["5.12", "12,847", "0.09", "96:1"],
                ].map((row) => (
                  <div
                    key={row[0]}
                    className="grid grid-cols-4 gap-2 border-t border-border/40 py-1.5"
                  >
                    {row.map((c, i) => (
                      <span key={i} className={i === 0 ? "text-signal" : ""}>
                        {c}
                      </span>
                    ))}
                  </div>
                ))}
              </div>

              <AnomalyGauge />
            </div>
          </div>
        </div>
      </div>

      {/* Resplandor sutil detrás */}
      <div className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-primary/5 blur-2xl" />
    </div>
  );
}

function AnomalyGauge() {
  const score = 12; // % anomalía — corrida saludable
  const r = 30;
  const circ = 2 * Math.PI * r;

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-background/60 p-3 text-center">
      <div className="relative size-[76px]">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth="7"
          />
          <motion.circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke="var(--success)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            whileInView={{ strokeDashoffset: circ * (1 - score / 100) }}
            viewport={{ once: true }}
            transition={{ duration: 1.4, delay: 0.4, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold">{score}%</span>
        </div>
      </div>
      <span className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        anomaly score
      </span>
    </div>
  );
}
