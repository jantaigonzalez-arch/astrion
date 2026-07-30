"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

/* ------------------------------------------------------------------
   Embudo: una barra por etapa, ancho proporcional al valor.
   Muestra también el valor ponderado por la probabilidad de la etapa.
------------------------------------------------------------------ */
export function FunnelChart({
  rows,
}: {
  rows: {
    stageId: string;
    name: string;
    probability: number;
    count: number;
    value: string;
    weighted: number;
  }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Sin etapas configuradas.
      </p>
    );
  }
  const max = Math.max(...rows.map((r) => Number(r.value)), 1);

  return (
    <div className="viz-root space-y-3">
      {rows.map((r, i) => {
        const w = Math.max(2, (Number(r.value) / max) * 100);
        const wWeighted = Math.max(0, (r.weighted / max) * 100);
        return (
          <div
            key={r.stageId}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-default"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">
                {r.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {r.count} negocio(s) · {r.probability}%
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {mxn(Number(r.value))}
              </span>
            </div>
            <div
              className="relative h-3 w-full overflow-hidden rounded-full"
              style={{ background: "var(--viz-track)" }}
            >
              {/* Valor total de la etapa */}
              <div
                className="absolute inset-y-0 left-0 transition-opacity"
                style={{
                  width: `${w}%`,
                  background: "var(--series-1)",
                  borderRadius: "2px 4px 4px 2px",
                  opacity: hover !== null && hover !== i ? 0.55 : 0.45,
                }}
              />
              {/* Porción ponderada: lo que realmente se espera cerrar */}
              <div
                className="absolute inset-y-0 left-0 transition-opacity"
                style={{
                  width: `${wWeighted}%`,
                  background: "var(--series-1)",
                  borderRadius: "2px 4px 4px 2px",
                  opacity: hover !== null && hover !== i ? 0.7 : 1,
                }}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Ponderado: {mxn(r.weighted)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   Barras mensuales de negocios cerrados: ganados (valor) y perdidos.
------------------------------------------------------------------ */
export function ClosedByMonth({
  data,
}: {
  data: {
    month: string;
    wonValue: string;
    wonCount: number;
    lostCount: number;
  }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Aún no hay negocios cerrados.
      </p>
    );
  }
  const max = Math.max(...data.map((d) => Number(d.wonValue)), 1);
  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-");
    return new Date(Number(y), Number(mm) - 1, 1)
      .toLocaleDateString("es-MX", { month: "short" })
      .replace(".", "");
  };

  return (
    <div className="viz-root relative">
      <div className="flex h-48 items-end gap-2">
        {data.map((d, i) => {
          const h = Math.max(2, (Number(d.wonValue) / max) * 100);
          return (
            <div
              key={d.month}
              className="group relative flex flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={cn(
                  "w-full max-w-12 rounded-t transition-opacity",
                  hover !== null && hover !== i && "opacity-50",
                )}
                style={{ height: `${h}%`, background: "var(--series-1)" }}
              />
              {hover === i && (
                <div className="absolute bottom-full z-20 mb-2 w-max rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <p className="font-semibold">{mxn(Number(d.wonValue))}</p>
                  <p className="text-muted-foreground">
                    {d.wonCount} ganado(s) · {d.lostCount} perdido(s)
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        {data.map((d) => (
          <div
            key={d.month}
            className="flex-1 text-center text-[11px] text-muted-foreground"
          >
            {monthLabel(d.month)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Barra de progreso de un objetivo comercial.
------------------------------------------------------------------ */
export function GoalProgress({
  pct,
  achievedLabel,
  targetLabel,
}: {
  pct: number;
  achievedLabel: string;
  targetLabel: string;
}) {
  const reached = pct >= 100;
  return (
    <div className="viz-root">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold tabular-nums">{achievedLabel}</span>
        <span className="text-xs text-muted-foreground">de {targetLabel}</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--viz-track)" }}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: reached ? "var(--color-success)" : "var(--series-1)",
            borderRadius: "2px 4px 4px 2px",
          }}
        />
      </div>
      <p
        className={cn(
          "mt-1 text-[11px] font-medium",
          reached ? "text-success" : "text-muted-foreground",
        )}
      >
        {pct}% {reached ? "· objetivo alcanzado" : "del objetivo"}
      </p>
    </div>
  );
}
