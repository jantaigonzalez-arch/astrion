"use client";

import { FlaskConical } from "lucide-react";
import type {
  ForecastBlock,
  ProjectionBlock,
  TrendBlock,
} from "@/lib/ml/blocks-types";
import { formaEfectiva, type Forma } from "@/lib/ml/formas";
import { Chart, money } from "@/components/portal/block-charts";
import { ForecastChart } from "@/components/portal/forecast-chart";
import { SERIE } from "@/components/portal/purchasing/chart-palette";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Los tres tipos que no son un hallazgo, dibujados.
 *
 * Cada uno se ve distinto a propósito: la clasificación no sirve de nada si los
 * cuatro tipos acaban pareciendo la misma tarjeta. El pronóstico es lo único
 * que lleva banda, y la lleva SIEMPRE — el tipo no deja construirlo sin ella.
 *
 * QUÉ forma toma una proyección o una tendencia ya no se decide aquí: lo
 * decide `formaEfectiva` a partir de los datos y de lo que alguien haya
 * elegido, y lo dibuja `@/components/portal/block-charts`. Antes esta decisión
 * estaba implícita —se llamaba a `Barras` y punto—, y por eso durante mucho
 * tiempo todo fue una columna vertical.
 */

/* ------------------------- 2 · Proyección ------------------------- */

export function ProjectionCard({
  block,
  compact = false,
  viz = null,
}: {
  block: ProjectionBlock;
  compact?: boolean;
  /** La forma elegida para ESTA colocación. `null` = la recomendada. */
  viz?: Forma | null;
}) {
  return (
    <Marco
      title={block.title}
      note={block.note}
      href={block.href}
      compact={compact}
      right={
        block.total !== undefined
          ? `total ${money(block.total, block.currency)}`
          : undefined
      }
    >
      {/* En compacto, el TOTAL sustituye a las barras: un calendario de pagos
          se resume en cuánto vence, y el reparto por semana es el detalle. Sin
          barras y sin total no queda nada, así que ahí sí se dibujan. */}
      {compact && block.total !== undefined ? (
        <p className="text-2xl font-semibold tabular-nums">
          {money(block.total, block.currency)}
        </p>
      ) : (
        <Chart
          forma={formaEfectiva(block, viz)}
          axis={block.axis}
          bars={block.bars}
          currency={block.currency}
        />
      )}
    </Marco>
  );
}

/* ------------------------- 3 · Tendencia ------------------------- */

export function TrendCard({
  block,
  viz = null,
}: {
  block: TrendBlock;
  /** La forma elegida para ESTA colocación. `null` = la recomendada. */
  viz?: Forma | null;
}) {
  return (
    <Marco title={block.title} note={block.note} href={block.href}>
      {/* La leyenda ya no se pinta aquí: cada forma sabe si le hace falta y
          dónde va —al lado de las porciones en un pastel, encima en unas
          columnas— y una leyenda fija arriba sobraba en la mitad de ellas. */}
      <Chart
        forma={formaEfectiva(block, viz)}
        axis={block.axis}
        bars={block.bars}
        currency={block.currency}
        legend={block.legend}
      />
    </Marco>
  );
}

/* ------------------------- 4 · Pronóstico ------------------------- */

export function ForecastCard({
  block,
  compact = false,
}: {
  block: ForecastBlock;
  compact?: boolean;
}) {
  const { lower, upper } = block.band;
  // En compacto no se dibuja la serie: es lo único que de verdad no cabe en
  // 26 rem. La cifra y su banda sí, y son lo que alguien mira.
  const serie = compact ? [] : (block.series ?? []);
  const rango = upper - lower;
  // Dónde cae el valor dentro de su propia banda. Si está descentrado, la
  // estimación es asimétrica y conviene que se vea.
  const pos = rango > 0 ? ((block.value - lower) / rango) * 100 : 50;

  return (
    <Marco
      title={block.title}
      note={block.note}
      href={block.href}
      right={compact ? `v${block.model.version}` : `${block.model.template} v${block.model.version}`}
      icon={<FlaskConical className="size-3.5" />}
      compact={compact}
    >
      <div className="flex items-baseline gap-2">
        <span className={cn("font-semibold tabular-nums", compact ? "text-2xl" : "text-3xl")}>
          {block.value.toLocaleString("es-MX")}
        </span>
        <span className="text-sm text-muted-foreground">{block.unit}</span>
      </div>

      {/* La banda: lo único que distingue un pronóstico de un dato. */}
      <div className="mt-3">
        <div className="relative h-1.5 rounded-full bg-border">
          <div
            className="absolute h-full rounded-full opacity-40"
            style={{ left: 0, right: 0, background: SERIE.a }}
          />
          <div
            className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full ring-2 ring-card"
            style={{
              left: `calc(${Math.min(100, Math.max(0, pos))}% - 5px)`,
              background: SERIE.a,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{lower.toLocaleString("es-MX")} {block.unit}</span>
          <span>{upper.toLocaleString("es-MX")} {block.unit}</span>
        </div>
      </div>

      {/* La SERIE, cuando lo que se pronostica son varios periodos.
          Va debajo de la banda del primero y no en su lugar: la cifra grande es
          lo que alguien lee de reojo, y la gráfica lo que mira cuando decide. */}
      {serie.length > 1 && (
        <div className="mt-4">
          <ForecastChart
            history={(block.history ?? []).map((h) => ({
              period: h.at,
              value: h.value,
            }))}
            forecast={serie.map((p) => ({
              period: p.at,
              value: p.value,
              lower: p.lower,
              upper: p.upper,
              actual: null,
            }))}
            unit={block.unit}
          />
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Sostenido por {block.support}{" "}
        {block.support === 1 ? "periodo histórico" : "periodos históricos"}
        {serie.length > 1 ? ` · ${serie.length} periodos estimados` : ""}
        {compact && (block.series?.length ?? 0) > 1
          ? ` · ${block.series!.length} periodos, agranda para verlos`
          : ""}
        .
      </p>
    </Marco>
  );
}

/* ------------------------- El marco común ------------------------- */

function Marco({
  title,
  note,
  right,
  href,
  icon,
  compact = false,
  children,
}: {
  title: string;
  note: string;
  right?: string;
  href?: string;
  icon?: React.ReactNode;
  /** En el globo del asistente. Recorta el motivo y aprieta el espaciado. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    // `viz-root` es lo que pone en pie los `--series-N`. Va en la tarjeta y no
    // más arriba a propósito: una tarjeta es una superficie de gráfica, y así
    // un bloque suelto —el globo del asistente, la vista previa del
    // compositor— trae sus colores puestos sin depender de dónde lo cuelguen.
    <section
      className={cn(
        "viz-root rounded-lg border border-border bg-secondary/25",
        compact ? "p-3" : "p-4",
      )}
    >
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
          se lee. Es el mismo papel que `because` en un hallazgo. Se recorta en
          compacto, no se quita: tres líneas caben y el texto entero empujaría
          la cifra fuera del globo. */}
      <p
        className={cn(
          "mb-3 text-xs leading-relaxed text-muted-foreground",
          compact && "line-clamp-3",
        )}
      >
        {note}
      </p>
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
