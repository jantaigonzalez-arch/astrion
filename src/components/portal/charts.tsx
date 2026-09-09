"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

const mxnFull = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);

/* ------------------------------------------------------------------
   Tendencia mensual — una sola serie (sin leyenda: el título la nombra).
   Barras finas ancladas a la línea base, extremo de dato redondeado 4px.
------------------------------------------------------------------ */
export function MonthlyTrend({
  data,
}: {
  data: { label: string; revenue: number; cost: number; profit: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => Math.abs(d.profit)), 1);

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Sin datos en el periodo.
      </p>
    );
  }

  return (
    <div className="viz-root relative">
      <div className="flex h-52 items-end gap-2">
        {data.map((d, i) => {
          const h = Math.max(2, (Math.abs(d.profit) / max) * 100);
          const negative = d.profit < 0;
          return (
            <div
              key={d.label}
              // h-full es obligatorio, no decorativo: la barra se dimensiona con
              // `height: N%`, y un porcentaje necesita que el contenedor tenga
              // altura DEFINIDA. El padre usa `items-end`, que deja a esta
              // columna con altura automática (= la de su contenido), así que
              // sin h-full el porcentaje no tiene contra qué calcularse y la
              // barra colapsa a 0: la gráfica se ve vacía aunque los datos
              // estén bien.
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Área de hover mayor que la marca */}
              <div className="absolute inset-0 z-10" aria-hidden />
              <div
                className={cn(
                  "w-full max-w-14 rounded-t transition-opacity",
                  hover !== null && hover !== i && "opacity-50",
                )}
                style={{
                  height: `${h}%`,
                  background: negative
                    ? "var(--color-destructive)"
                    : "var(--series-1)",
                  borderRadius: "4px 4px 2px 2px",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Línea base y etiquetas */}
      <div className="mt-1 border-t" style={{ borderColor: "var(--viz-grid)" }} />
      <div className="mt-1.5 flex gap-2">
        {data.map((d) => (
          <div
            key={d.label}
            className="flex-1 text-center text-[11px] text-muted-foreground"
          >
            {d.label}
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hover !== null && (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
          <div className="font-semibold">{data[hover].label}</div>
          <div className="mt-1 space-y-0.5 text-muted-foreground">
            <div>Ingreso: {mxnFull(data[hover].revenue)}</div>
            <div>Costo: {mxnFull(data[hover].cost)}</div>
            <div className="font-medium text-foreground">
              Utilidad: {mxnFull(data[hover].profit)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Ranking horizontal — una sola serie, con etiqueta directa del valor.
------------------------------------------------------------------ */
export function RankBars({
  rows,
  emptyText = "Sin datos.",
}: {
  rows: { label: string; sub?: string; value: number }[];
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
    );
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <div className="viz-root space-y-3">
      {rows.map((r, i) => {
        const w = Math.max(2, (Math.abs(r.value) / max) * 100);
        const negative = r.value < 0;
        return (
          <div
            key={r.label + i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-default"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r.label}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums font-semibold",
                  negative ? "text-destructive" : "",
                )}
              >
                {mxn(r.value)}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--viz-track)" }}
            >
              <div
                className="h-full transition-opacity"
                style={{
                  width: `${w}%`,
                  background: negative
                    ? "var(--color-destructive)"
                    : "var(--series-1)",
                  borderRadius: "2px 4px 4px 2px",
                  opacity: hover !== null && hover !== i ? 0.55 : 1,
                }}
              />
            </div>
            {r.sub && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{r.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   Composición de la utilidad: refacciones vs mano de obra.
   Dos series → leyenda presente + etiquetas directas (identidad nunca
   depende solo del color). Separación de 2px entre segmentos.
------------------------------------------------------------------ */
export function ProfitSplit({
  partsProfit,
  laborProfit,
}: {
  partsProfit: number;
  laborProfit: number;
}) {
  const total = Math.max(partsProfit + laborProfit, 1);
  const pParts = (Math.max(0, partsProfit) / total) * 100;
  const pLabor = (Math.max(0, laborProfit) / total) * 100;

  return (
    <div className="viz-root">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        <div
          style={{ width: `${pParts}%`, background: "var(--series-1)" }}
          className="rounded-l-full"
        />
        <div
          style={{ width: `${pLabor}%`, background: "var(--series-2)" }}
          className="rounded-r-full"
        />
      </div>

      {/* Leyenda con etiqueta directa del valor */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 size-2.5 shrink-0 rounded-full"
            style={{ background: "var(--series-1)" }}
            aria-hidden
          />
          <div>
            <div className="text-muted-foreground">Refacciones</div>
            <div className="font-semibold tabular-nums">{mxn(partsProfit)}</div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span
            className="mt-1 size-2.5 shrink-0 rounded-full"
            style={{ background: "var(--series-2)" }}
            aria-hidden
          />
          <div>
            <div className="text-muted-foreground">Mano de obra</div>
            <div className="font-semibold tabular-nums">{mxn(laborProfit)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   BARRAS DE OCUPACIÓN: cuánto se usa de lo que hay.

   ── UN SOLO EJE, Y POR ESO ESTE COMPONENTE EXISTE ────────────────
   `RankBars` compara importes entre sí y escala contra el mayor de la
   lista. Aquí cada renglón tiene SU PROPIO techo —conexiones contra 300,
   empresas contra 20— y lo que se compara es el porcentaje, no el valor
   absoluto. Meter las dos cosas en el mismo componente habría obligado a
   un segundo eje escondido, que es el error de gráfico más común que hay.

   ── EL COLOR DE ESTADO ES ESTADO, NO SERIE ───────────────────────
   Una sola serie no lleva leyenda: el título la nombra. El ámbar y el
   rojo aparecen SOLO cuando la barra cruza un umbral, y siempre con el
   porcentaje escrito al lado — la identidad nunca depende solo del color.
------------------------------------------------------------------ */
export function OccupancyBars({
  rows,
  emptyText = "Sin datos.",
}: {
  rows: { label: string; used: number; ceiling: number; unit?: string; note?: string }[];
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="viz-root space-y-4">
      {rows.map((r, i) => {
        const pct = r.ceiling > 0 ? (r.used / r.ceiling) * 100 : 0;
        // Se dibuja topado al 100 % pero se DICE el número real: una barra que
        // se sale del carril no informa, y un 140 % escondido es peor.
        const ancho = Math.min(100, Math.max(pct > 0 ? 2 : 0, pct));
        const estado =
          pct >= 90 ? "critico" : pct >= 70 ? "aviso" : "holgado";
        const color =
          estado === "critico"
            ? "var(--color-destructive)"
            : estado === "aviso"
              ? "var(--color-warning)"
              : "var(--series-1)";

        return (
          <div
            key={r.label + i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="cursor-default"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r.label}</span>
              {/* El texto va en tinta, nunca en el color de la serie. */}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {r.used.toLocaleString("es-MX")}
                </span>{" "}
                de {r.ceiling.toLocaleString("es-MX")}
                {r.unit ? ` ${r.unit}` : ""}
                <span className="ml-2 font-semibold text-foreground">
                  {Math.round(pct)}%
                </span>
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ background: "var(--viz-track)" }}
            >
              <div
                className="h-full transition-opacity"
                style={{
                  width: `${ancho}%`,
                  background: color,
                  borderRadius: "2px 4px 4px 2px",
                  opacity: hover !== null && hover !== i ? 0.55 : 1,
                }}
              />
            </div>
            {r.note && (
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {r.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   BARRAS DE CONTEO: la misma unidad en todos los renglones.

   Existe porque `RankBars` formatea como dinero. Aquí lo que se compara
   son registros contra registros —tickets, equipos, contratos— y por eso
   sí escala contra el mayor de la lista: no hay techos distintos.
------------------------------------------------------------------ */
export function CountBars({
  rows,
  emptyText = "Sin datos.",
}: {
  rows: { label: string; value: number; sub?: string }[];
  emptyText?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="viz-root space-y-3">
      {rows.map((r, i) => (
        <div
          key={r.label + i}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          className="cursor-default"
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {r.value.toLocaleString("es-MX")}
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--viz-track)" }}
          >
            <div
              className="h-full transition-opacity"
              style={{
                width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`,
                background: "var(--series-1)",
                borderRadius: "2px 4px 4px 2px",
                opacity: hover !== null && hover !== i ? 0.55 : 1,
              }}
            />
          </div>
          {r.sub && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{r.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
