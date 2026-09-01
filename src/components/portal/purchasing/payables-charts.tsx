"use client";

import { useId, useState } from "react";
import {
  SERIE as SLOT,
  SERIE_ALERTA,
} from "@/components/portal/purchasing/chart-palette";
import { cn } from "@/lib/utils";

/**
 * Gráficos de cuentas por pagar.
 *
 * Dos colores categóricos y nada más: pago y anticipo.
 *
 * ── AQUÍ NACIÓ LA TERCERA COPIA ────────────────────────────────────────────
 *
 * De este archivo se extrajo `chart-palette.ts` —«viven en un módulo aparte
 * porque dos copias divergen en el primer retoque»— y luego este archivo se
 * quedó con la suya. Fue exactamente la divergencia que la extracción existía
 * para evitar: tres juegos de colores, los tres describiéndose como validados.
 *
 * Ahora los pasos son los slots de la aplicación y este módulo solo decide QUÉ
 * papel ocupa cada uno. El azul/teal de antes se fue con ellos.
 */

/** Qué slot le toca a cada papel. El orden importa: ver `chart-palette.ts`. */
const SERIE = {
  pago: SLOT.a,
  anticipo: SLOT.b,
} as const;

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

const moneyExact = (n: number, currency: string) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);

/* ------------------------- Calendario de pagos ------------------------- */

export function PaymentCalendarChart({
  weeks,
  currency,
}: {
  weeks: Array<{
    key: string;
    label: string;
    overdue: boolean;
    amount: number;
    count: number;
  }>;
  currency: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...weeks.map((w) => w.amount), 1);

  return (
    <div className="viz-root">
      <div className="flex items-end gap-2" style={{ height: 168 }}>
        {weeks.map((w) => {
          const h = Math.max(3, (w.amount / max) * 140);
          const activo = hover === w.key;
          return (
            <div
              key={w.key}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(w.key)}
              onMouseLeave={() => setHover(null)}
            >
              {activo && (
                <div className="absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium">{moneyExact(w.amount, currency)}</p>
                  <p className="text-muted-foreground">
                    {w.count} {w.count === 1 ? "vencimiento" : "vencimientos"}
                  </p>
                </div>
              )}
              {/* Etiqueta directa sobre la barra: evita tener que cruzar a un
                  eje para leer el importe. */}
              <span className="mb-1 text-[10px] tabular-nums text-muted-foreground">
                {w.amount > 0 ? money(w.amount, currency) : ""}
              </span>
              <div
                className={cn(
                  "w-full rounded-t transition-opacity",
                  hover && !activo && "opacity-50",
                )}
                style={{
                  height: h,
                  // Vencido es un ESTADO, no una serie: usa el color de estado
                  // y va acompañado de su etiqueta, nunca solo del color.
                  background: w.overdue ? SERIE_ALERTA : SERIE.pago,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-2">
        {weeks.map((w) => (
          <span
            key={w.key}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px]",
              w.overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {w.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------- Salida de caja por mes ------------------------- */

export function CashOutChart({
  data,
  currency,
}: {
  data: Array<{
    month: string;
    label: string;
    payments: number;
    advances: number;
    total: number;
  }>;
  currency: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.total), 1);
  const id = useId();
  const hayAnticipos = data.some((d) => d.advances > 0);

  return (
    <div className="viz-root">
      {/* Con dos series la leyenda es obligatoria: la identidad no puede
          depender solo del color. */}
      <div className="mb-3 flex flex-wrap gap-4 text-xs">
        <Leyenda color={SERIE.pago} texto="Pagos a factura" />
        {hayAnticipos && <Leyenda color={SERIE.anticipo} texto="Anticipos" />}
      </div>

      <div className="flex items-end gap-1.5" style={{ height: 160 }}>
        {data.map((d) => {
          const activo = hover === d.month;
          const hp = (d.payments / max) * 132;
          const ha = (d.advances / max) * 132;
          return (
            <div
              key={d.month}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(d.month)}
              onMouseLeave={() => setHover(null)}
            >
              {activo && d.total > 0 && (
                <div className="absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium">{moneyExact(d.total, currency)}</p>
                  <p className="text-muted-foreground">
                    pagos {money(d.payments, currency)}
                    {d.advances > 0 && ` · anticipos ${money(d.advances, currency)}`}
                  </p>
                </div>
              )}

              <div
                className={cn(
                  "flex w-full flex-col justify-end transition-opacity",
                  hover && !activo && "opacity-50",
                )}
                style={{ height: 132 }}
              >
                {d.advances > 0 && (
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: Math.max(3, ha),
                      background: SERIE.anticipo,
                      // 2px de superficie entre segmentos: sin el hueco, dos
                      // fills contiguos se leen como una sola barra.
                      marginBottom: d.payments > 0 ? 2 : 0,
                    }}
                    aria-hidden="true"
                  />
                )}
                {d.payments > 0 && (
                  <div
                    className={cn("w-full", d.advances > 0 ? "" : "rounded-t")}
                    style={{ height: Math.max(3, hp), background: SERIE.pago }}
                    aria-hidden="true"
                  />
                )}
                {d.total === 0 && (
                  <div className="w-full rounded-t bg-border" style={{ height: 2 }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        {data.map((d) => (
          <span
            key={d.month}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground"
          >
            {d.label}
          </span>
        ))}
      </div>

      {/* La vista de tabla es la salida obligatoria cuando el color no basta:
          lectores de pantalla, impresión y modo de contraste forzado. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Ver como tabla
        </summary>
        <table
          className="mt-2 w-full text-xs"
          aria-labelledby={id}
        >
          <caption id={id} className="sr-only">
            Salida de caja por mes, en {currency}
          </caption>
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Mes</th>
              <th className="py-1 text-right font-medium">Pagos</th>
              <th className="py-1 text-right font-medium">Anticipos</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-1">{d.month}</td>
                <td className="py-1 text-right tabular-nums">
                  {moneyExact(d.payments, currency)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {moneyExact(d.advances, currency)}
                </td>
                <td className="py-1 text-right font-medium tabular-nums">
                  {moneyExact(d.total, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2.5 rounded-sm"
        style={{ background: color }}
        aria-hidden="true"
      />
      {/* El texto va en tinta de texto, nunca en el color de la serie. */}
      <span className="text-muted-foreground">{texto}</span>
    </span>
  );
}

/* --------------------- Concentración: barra por proveedor --------------------- */

export function ShareBar({ pct }: { pct: number }) {
  return (
    // Lleva su propio `viz-root`: se incrusta suelta en una celda de tabla, así
    // que no puede contar con que haya una superficie de gráfica encima.
    <span
      className="viz-root inline-flex h-1.5 w-20 overflow-hidden rounded-full bg-border align-middle"
      aria-hidden="true"
    >
      <span
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, pct)}%`, background: SERIE.pago }}
      />
    </span>
  );
}
