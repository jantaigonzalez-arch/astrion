"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import type {
  Bar,
  ForecastBlock,
  ProjectionBlock,
  TrendBlock,
} from "@/lib/ml/blocks-types";
import { SERIE, SERIE_ALERTA } from "@/components/portal/purchasing/chart-palette";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Los tres tipos que no son un hallazgo, dibujados.
 *
 * Cada uno se ve distinto a propósito: la clasificación no sirve de nada si los
 * cuatro tipos acaban pareciendo la misma tarjeta. La proyección y la tendencia
 * son barras planas; el pronóstico es lo único que lleva banda, y la lleva
 * SIEMPRE — el tipo no deja construirlo sin ella.
 */

const money = (n: number, currency?: string, exacto = false) =>
  new Intl.NumberFormat("es-MX", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    currencyDisplay: "code",
    maximumFractionDigits: exacto ? 2 : 0,
  }).format(n);

/* ------------------------- 2 · Proyección ------------------------- */

export function ProjectionCard({ block }: { block: ProjectionBlock }) {
  return (
    <Marco
      title={block.title}
      note={block.note}
      href={block.href}
      right={
        block.total !== undefined
          ? `total ${money(block.total, block.currency)}`
          : undefined
      }
    >
      <Barras bars={block.bars} currency={block.currency} />
    </Marco>
  );
}

/* ------------------------- 3 · Tendencia ------------------------- */

export function TrendCard({ block }: { block: TrendBlock }) {
  const hayApilado = block.bars.some((b) => (b.stacked ?? 0) > 0);

  return (
    <Marco title={block.title} note={block.note} href={block.href}>
      {block.legend && hayApilado && (
        // Con dos series la leyenda es obligatoria: la identidad no puede
        // depender solo del color.
        <div className="mb-3 flex flex-wrap gap-4 text-xs">
          <Clave clase={SERIE.a} texto={block.legend[0]} />
          <Clave clase={SERIE.b} texto={block.legend[1]} />
        </div>
      )}
      <Barras bars={block.bars} currency={block.currency} apilado />
    </Marco>
  );
}

/* ------------------------- 4 · Pronóstico ------------------------- */

export function ForecastCard({ block }: { block: ForecastBlock }) {
  const { lower, upper } = block.band;
  const rango = upper - lower;
  // Dónde cae el valor dentro de su propia banda. Si está descentrado, la
  // estimación es asimétrica y conviene que se vea.
  const pos = rango > 0 ? ((block.value - lower) / rango) * 100 : 50;

  return (
    <Marco
      title={block.title}
      note={block.note}
      href={block.href}
      right={`${block.model.template} v${block.model.version}`}
      icon={<FlaskConical className="size-3.5" />}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{block.value}</span>
        <span className="text-sm text-muted-foreground">{block.unit}</span>
      </div>

      {/* La banda: lo único que distingue un pronóstico de un dato. */}
      <div className="mt-3">
        <div className="relative h-1.5 rounded-full bg-border">
          <div
            className={cn("absolute h-full rounded-full opacity-40", SERIE.a)}
            style={{ left: 0, right: 0, background: "currentColor" }}
          />
          <div
            className={cn("absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full ring-2 ring-card", SERIE.a)}
            style={{ left: `calc(${Math.min(100, Math.max(0, pos))}% - 5px)`, background: "currentColor" }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{lower} {block.unit}</span>
          <span>{upper} {block.unit}</span>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Sostenido por {block.support}{" "}
        {block.support === 1 ? "caso histórico" : "casos históricos"}.
      </p>
    </Marco>
  );
}

/* ------------------------- Piezas ------------------------- */

function Marco({
  title,
  note,
  right,
  href,
  icon,
  children,
}: {
  title: string;
  note: string;
  right?: string;
  href?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-secondary/25 p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </h3>
        {right && (
          <span className="font-mono text-xs text-muted-foreground">{right}</span>
        )}
      </div>
      {/* El «porqué» va antes del dibujo: una gráfica sin su motivo se mira, no
          se lee. Es el mismo papel que `because` en un hallazgo. */}
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{note}</p>
      {children}
      {href && (
        <Link
          href={href}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          Ver a detalle
        </Link>
      )}
    </section>
  );
}

function Barras({
  bars,
  currency,
  apilado,
}: {
  bars: Bar[];
  currency?: string;
  apilado?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => b.value + (b.stacked ?? 0)), 1);

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: 132 }}>
        {bars.map((b) => {
          const activo = hover === b.key;
          const total = b.value + (b.stacked ?? 0);
          const hv = (b.value / max) * 108;
          const hs = ((b.stacked ?? 0) / max) * 108;
          return (
            <div
              key={b.key}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
            >
              {activo && total > 0 && (
                <div className="absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md">
                  <p className="font-medium">{money(total, currency, true)}</p>
                  {(b.stacked ?? 0) > 0 && (
                    <p className="text-muted-foreground">
                      {money(b.value, currency)} + {money(b.stacked!, currency)}
                    </p>
                  )}
                </div>
              )}

              <div
                className={cn(
                  "flex w-full flex-col justify-end transition-opacity",
                  hover && !activo && "opacity-50",
                )}
                style={{ height: 108 }}
              >
                {apilado && (b.stacked ?? 0) > 0 && (
                  <div
                    className={cn("w-full rounded-t", SERIE.b)}
                    style={{
                      height: Math.max(3, hs),
                      background: "currentColor",
                      // 2 px de superficie: sin el hueco, dos rellenos contiguos
                      // se leen como una sola barra.
                      marginBottom: b.value > 0 ? 2 : 0,
                    }}
                    aria-hidden="true"
                  />
                )}
                {total > 0 ? (
                  <div
                    className={cn(
                      "w-full",
                      apilado && (b.stacked ?? 0) > 0 ? "" : "rounded-t",
                      b.alert ? SERIE_ALERTA : SERIE.a,
                    )}
                    style={{ height: Math.max(3, hv), background: "currentColor" }}
                    aria-hidden="true"
                  />
                ) : (
                  <div className="w-full rounded-t bg-border" style={{ height: 2 }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1.5">
        {bars.map((b) => (
          <span
            key={b.key}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px]",
              // El estado va escrito además de coloreado.
              b.alert ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Clave({ clase, texto }: { clase: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn("size-2.5 rounded-sm", clase)}
        style={{ background: "currentColor" }}
        aria-hidden="true"
      />
      {/* El texto en tinta de texto, nunca en el color de la serie. */}
      <span className="text-muted-foreground">{texto}</span>
    </span>
  );
}
