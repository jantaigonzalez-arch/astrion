"use client";

import { useMemo, useState } from "react";
import type { Bar } from "@/lib/ml/blocks-types";
import type { Forma } from "@/lib/ml/formas";
import { SERIE, SERIES, SERIE_ALERTA } from "@/components/portal/purchasing/chart-palette";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Las formas en que se puede dibujar un bloque de barras.
 *
 * ── UN ARCHIVO PARA TODAS, Y NO UNA POR TARJETA ────────────────────────────
 *
 * Antes el dibujo vivía dentro de la tarjeta que lo usaba, y por eso durante
 * mucho tiempo solo hubo uno: añadir una forma exigía tocar la tarjeta. Aquí
 * cada forma es una función con la MISMA entrada —`Bar[]`, la moneda y los
 * nombres de las series— así que elegir entre ellas es un `switch` y no una
 * refactorización.
 *
 * ── LO QUE COMPARTEN TODAS ─────────────────────────────────────────────────
 *
 * · Salen dentro de un `.viz-root`, que es quien pone en pie los `--series-N`.
 *   Lo pone la tarjeta; estas funciones dan por hecho que está.
 * · La identidad NUNCA depende solo del color: con dos o más series hay
 *   leyenda con texto, y donde el color no alcanza el contraste hay etiqueta
 *   escrita. Es la condición que la paleta impone —ver `globals.css`— y no una
 *   preferencia.
 * · Los estados (`alert`) llevan el color de estado y su etiqueta, y no cuentan
 *   como una serie más.
 *
 * QUÉ forma le toca a cada bloque no se decide aquí: eso es `@/lib/ml/formas`.
 */

export const money = (n: number, currency?: string, exacto = false) =>
  new Intl.NumberFormat("es-MX", {
    style: currency ? "currency" : "decimal",
    currency: currency ?? undefined,
    currencyDisplay: "code",
    maximumFractionDigits: exacto ? 2 : 0,
  }).format(n);

const pct = (n: number) => `${Math.round(n * 100)} %`;

export type ChartProps = {
  bars: Bar[];
  currency?: string;
  /** Nombres de las dos magnitudes, cuando hay dos. */
  legend?: [string, string];
};

/* ------------------------------------------------------------------ *
 * Reparto                                                             *
 * ------------------------------------------------------------------ */

/**
 * El dibujo, con lo que se puede HACER sobre él.
 *
 * ── LA INTERACCIÓN VIVE AQUÍ Y NO EN CADA FORMA ───────────────────────────
 *
 * Apagar una serie y recortar el periodo son decisiones sobre LOS DATOS, no
 * sobre el dibujo: valen igual para columnas, para línea y para la tabla. Si
 * cada forma llevara su propio estado, trece formas serían trece
 * implementaciones que se desincronizan, y cambiar de forma perdería lo que la
 * persona acababa de ajustar. Aquí se transforman los datos una vez y abajo se
 * dibuja lo que quede.
 *
 * ── LO QUE NO HACE ────────────────────────────────────────────────────────
 *
 * Filtrar el resto del tablero. Clicar una barra lleva a SU lista, y ahí se
 * acaba: el filtro cruzado exige que cada análisis acepte un contexto de
 * filtro, y hoy los once constructores resuelven sin parámetros. Prometerlo a
 * medias —filtrar tres bloques de ocho y dejar los otros cinco mintiendo— es
 * peor que no tenerlo.
 */
export function Chart({
  forma,
  axis,
  ...p
}: ChartProps & { forma: Forma; axis?: "time" }) {
  /*
    Qué series están apagadas, por índice: 0 la principal, 1 la apilada.

    Apagar una serie NO la quita del cálculo del máximo de otras formas ni
    reordena nada: solo la pone en cero, que es lo que hace que el resto del
    dibujo se reescale y se pueda leer la que quedó. Es justo lo que alguien
    busca al apagarla.
  */
  const [apagadas, setApagadas] = useState<number[]>([]);
  /** Cuántos periodos se enseñan. `null` es todos. Solo en series de tiempo. */
  const [ultimos, setUltimos] = useState<number | null>(null);

  const hayDos = p.bars.some((b) => (b.stacked ?? 0) > 0);

  const bars = useMemo(() => {
    let xs = p.bars;
    // El recorte se hace por la COLA: en una serie de tiempo lo reciente es lo
    // que se quiere mirar de cerca, nunca los primeros meses.
    if (axis === "time" && ultimos && ultimos < xs.length) xs = xs.slice(-ultimos);
    if (apagadas.length === 0) return xs;
    return xs.map((b) => ({
      ...b,
      value: apagadas.includes(0) ? 0 : b.value,
      stacked: apagadas.includes(1) ? 0 : b.stacked,
    }));
  }, [p.bars, apagadas, ultimos, axis]);

  /*
    Los cortes que se ofrecen: solo los que el dato ADMITE.

    Ofrecer «últimos 24» sobre doce meses sería un botón que no cambia nada, y
    un control que no hace nada es peor que su ausencia — enseña a desconfiar
    del resto. Se filtra contra el largo real de la serie.
  */
  const cortes = [6, 12, 24].filter((k) => k < p.bars.length);

  const dibujo = <Pintar forma={forma} {...p} bars={bars} />;

  if (cortes.length === 0 && !(hayDos && p.legend)) return dibujo;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {hayDos && p.legend ? (
          <LeyendaViva
            claves={[
              { color: SERIE.a, texto: p.legend[0] },
              { color: SERIE.b, texto: p.legend[1] },
            ]}
            apagadas={apagadas}
            onAlternar={(i) =>
              setApagadas((xs) => {
                const next = xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i];
                // Nunca las dos: un dibujo sin ninguna serie es una caja vacía
                // que parece un fallo de carga. La última encendida no se apaga.
                return next.length >= 2 ? xs : next;
              })
            }
          />
        ) : (
          <span />
        )}

        {cortes.length > 0 && (
          <div className="flex items-center gap-0.5 text-[11px]">
            {[...cortes, null].map((k) => (
              <button
                key={k ?? "todo"}
                type="button"
                onClick={() => setUltimos(k)}
                aria-pressed={ultimos === k}
                className={cn(
                  "rounded px-1.5 py-0.5 transition-colors",
                  ultimos === k
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {k ? `${k}` : "Todo"}
              </button>
            ))}
          </div>
        )}
      </div>
      {dibujo}
    </div>
  );
}

/** La leyenda que además APAGA. Ver `Chart`. */
function LeyendaViva({
  claves,
  apagadas,
  onAlternar,
}: {
  claves: Array<{ color: string; texto: string }>;
  apagadas: number[];
  onAlternar: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {claves.map((c, i) => {
        const off = apagadas.includes(i);
        return (
          <button
            key={c.texto}
            type="button"
            onClick={() => onAlternar(i)}
            aria-pressed={!off}
            title={off ? `Mostrar ${c.texto}` : `Ocultar ${c.texto}`}
            className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-secondary"
          >
            <span
              className={cn("size-2.5 shrink-0 rounded-sm border", off && "bg-transparent!")}
              style={{ background: c.color, borderColor: c.color }}
              aria-hidden="true"
            />
            {/* Tachado además de apagado: el color solo no puede cargar el
                estado, por lo mismo que no puede cargar la identidad. */}
            <span className={cn("text-muted-foreground", off && "line-through opacity-60")}>
              {c.texto}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** El reparto puro a la forma que toque. Sin estado. */
function Pintar({ forma, ...p }: ChartProps & { forma: Forma }) {
  switch (forma) {
    case "ranking":
      return <Ranking {...p} />;
    case "linea":
      return <Linea {...p} />;
    case "area":
      return <Linea {...p} area />;
    case "regresion":
      return <Linea {...p} tendencia />;
    case "apiladas":
      return <Columnas {...p} modo="apiladas" />;
    case "agrupadas":
      return <Columnas {...p} modo="agrupadas" />;
    case "cien":
      return <Columnas {...p} modo="cien" />;
    case "pastel":
      return <Porciones {...p} />;
    case "dona":
      return <Porciones {...p} hueco />;
    case "treemap":
      return <Treemap {...p} />;
    case "dispersion":
      return <Dispersion {...p} />;
    case "tabla":
      return <Tabla {...p} />;
    default:
      return <Columnas {...p} modo="simple" />;
  }
}

/* ------------------------------------------------------------------ *
 * Leyenda — obligatoria con dos o más series                          *
 * ------------------------------------------------------------------ */

export function Leyenda({ claves }: { claves: Array<{ color: string; texto: string }> }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {claves.map((c) => (
        <span key={c.texto} className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ background: c.color }}
            aria-hidden="true"
          />
          {/* El texto en tinta de texto, nunca en el color de la serie. */}
          <span className="text-muted-foreground">{c.texto}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 1 · Columnas — simple, apiladas, agrupadas, 100 %                    *
 * ------------------------------------------------------------------ */

/**
 * La columna vertical, en sus cuatro variantes.
 *
 * `apiladas` suma las dos magnitudes en una torre; `agrupadas` las pone lado a
 * lado, que es lo que sirve cuando lo que importa es cuál es mayor y no cuánto
 * suman; `cien` normaliza cada periodo a su propio total, que responde «cómo se
 * reparte» y renuncia a «cuánto». Son tres preguntas distintas sobre los mismos
 * dos números, y por eso son tres formas y no una con opciones.
 */
function Columnas({
  bars,
  currency,
  legend,
  modo,
}: ChartProps & { modo: "simple" | "apiladas" | "agrupadas" | "cien" }) {
  const [hover, setHover] = useState<string | null>(null);

  const max =
    modo === "cien"
      ? 1
      : modo === "agrupadas"
        ? Math.max(...bars.map((b) => Math.max(b.value, b.stacked ?? 0)), 1)
        : Math.max(...bars.map((b) => b.value + (b.stacked ?? 0)), 1);

  return (
    <div>
      {legend && modo !== "simple" && (
        <Leyenda
          claves={[
            { color: SERIE.a, texto: legend[0] },
            { color: SERIE.b, texto: legend[1] },
          ]}
        />
      )}

      {/* `--viz-h` la pone la tarjeta a partir del alto que eligió quien
          compuso; el 132 es el respaldo para cuando se dibuja fuera de un
          tablero —el globo del asistente, una pantalla de trabajo—. Las
          columnas dejan 24 px al pie para sus etiquetas. */}
      <div
        className="flex items-end gap-1.5"
        style={{ height: "var(--viz-h, 132px)" }}
      >
        {bars.map((b) => {
          const activo = hover === b.key;
          const s = b.stacked ?? 0;
          const total = b.value + s;
          const atenua = hover !== null && !activo ? "opacity-50" : "";

          return (
            <Marca
              key={b.key}
              href={b.href}
              titulo={`Ver ${b.label}`}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
            >
              {activo && total > 0 && (
                <div className="absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md">
                  <p className="font-medium">{money(total, currency, true)}</p>
                  {s > 0 && (
                    <p className="text-muted-foreground">
                      {money(b.value, currency)} + {money(s, currency)}
                      {modo === "cien" && ` · ${pct(b.value / total)}`}
                    </p>
                  )}
                </div>
              )}

              {modo === "agrupadas" ? (
                // Dos columnas pegadas con 2 px de aire: el hueco es lo que
                // impide que se lean como una sola barra de dos colores.
                <div
                  className={cn("flex w-full items-end gap-0.5", atenua)}
                  style={{ height: "calc(var(--viz-h, 132px) - 24px)" }}
                >
                  <div
                    className="flex-1 rounded-t"
                    style={{ height: `${(b.value / max) * 100}%`, background: SERIE.a }}
                  />
                  <div
                    className="flex-1 rounded-t"
                    style={{ height: `${(s / max) * 100}%`, background: SERIE.b }}
                  />
                </div>
              ) : (
                <div
                  className={cn("flex w-full flex-col justify-end", atenua)}
                  style={{ height: "calc(var(--viz-h, 132px) - 24px)" }}
                >
                  {s > 0 && (
                    <div
                      className="w-full rounded-t"
                      style={{
                        height:
                          modo === "cien"
                            ? `${(s / total) * 100}%`
                            : `${Math.max(2, (s / max) * 100)}%`,
                        background: SERIE.b,
                        marginBottom: b.value > 0 ? 2 : 0,
                      }}
                    />
                  )}
                  {total > 0 ? (
                    <div
                      className={cn("w-full", s > 0 ? "" : "rounded-t")}
                      style={{
                        height:
                          modo === "cien"
                            ? `${(b.value / total) * 100}%`
                            : `${Math.max(2, (b.value / max) * 100)}%`,
                        background: b.alert ? SERIE_ALERTA : SERIE.a,
                      }}
                    />
                  ) : (
                    // Un periodo sin nada deja una marca de 2 px: sin ella, el
                    // hueco parece un fallo de dibujo en vez de un cero.
                    <div className="w-full rounded-t bg-border" style={{ height: 2 }} />
                  )}
                </div>
              )}
            </Marca>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1.5">
        {bars.map((b) => (
          <span
            key={b.key}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px]",
              b.alert ? "font-medium text-destructive" : "text-muted-foreground",
            )}
            title={b.label}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 2 · Ranking horizontal                                              *
 * ------------------------------------------------------------------ */

/**
 * Entidades con nombre, ordenadas por magnitud.
 *
 * El nombre ocupa una línea entera y el valor va escrito a su derecha, así que
 * no hay que cruzar a ningún eje ni descifrar una etiqueta de 10 px girada. Es
 * la forma correcta para la mayoría del catálogo, y la que estuvo ausente.
 */
function Ranking({ bars, currency }: ChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);

  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <Marca
          key={b.key}
          href={b.href}
          titulo={`Ver ${b.label}`}
          onMouseEnter={() => setHover(b.key)}
          onMouseLeave={() => setHover(null)}
          // La fila ENTERA es el objetivo, no la barra: en un ranking la barra
          // corta —justo la que alguien quiere investigar— sería un blanco de
          // ocho píxeles.
          className="block w-full text-left"
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            {/* `truncate` en vez de recortar el texto: quien decide si cabe es
                el ancho real, y el nombre completo sigue en el `title`. */}
            <span className="min-w-0 truncate" title={b.label}>
              {b.label}
            </span>
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                b.alert && "text-destructive",
              )}
            >
              {money(b.value, currency)}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--viz-track)" }}
          >
            <div
              className="h-full rounded-full transition-opacity"
              style={{
                width: `${Math.max(2, (Math.abs(b.value) / max) * 100)}%`,
                background: b.alert ? SERIE_ALERTA : SERIE.a,
                opacity: hover && hover !== b.key ? 0.55 : 1,
              }}
            />
          </div>
        </Marca>
      ))}
    </div>
  );
}

/**
 * Lo que envuelve una marca clicable — o no la envuelve, si no lleva a ningún
 * sitio.
 *
 * Un `<div>` cuando no hay destino y un `<a>` cuando lo hay, en vez de un `<a>`
 * siempre con `href` vacío: el cursor de mano, el foco de teclado y el anuncio
 * del lector de pantalla salen de la etiqueta, y prometer los tres para después
 * no hacer nada es la forma más rápida de enseñar que aquí no se clica.
 */
function Marca({
  href,
  titulo,
  children,
  className,
  ...rest
}: {
  href?: string;
  titulo?: string;
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  if (!href) {
    return (
      <div {...rest} className={cn(className, "cursor-default")}>
        {children}
      </div>
    );
  }
  return (
    <Link
      {...rest}
      href={href}
      title={titulo}
      className={cn(className, "cursor-pointer rounded transition-colors hover:bg-secondary/50")}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * 3 · Línea, área y línea con tendencia                                *
 * ------------------------------------------------------------------ */

/**
 * Una serie de tiempo. Con relleno (`area`) o con recta de ajuste (`tendencia`).
 *
 * ── LA RECTA NO SE PROLONGA, Y ESO NO ES UN DESCUIDO ───────────────────────
 *
 * La tendencia se dibuja SOLO sobre el tramo observado. Extenderla un periodo
 * más la convertiría en un pronóstico, y en este sistema un pronóstico es una
 * cosa con nombre y con obligaciones: banda de incertidumbre y número de casos
 * que lo sostienen, exigidos por el tipo `ForecastBlock`. Una recta de mínimos
 * cuadrados no trae ninguna de las dos. Describe lo que pasó; no dice lo que
 * va a pasar, y la diferencia se protege no dibujándola más allá del dato.
 *
 * ── LA ESCALA ARRANCA EN CERO ──────────────────────────────────────────────
 *
 * Son importes. Empezar el eje en el valor mínimo multiplica visualmente
 * cualquier variación pequeña hasta contar una historia que el dato no cuenta.
 */
function Linea({
  bars,
  currency,
  area,
  tendencia,
}: ChartProps & { area?: boolean; tendencia?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const v = bars.map((b) => b.value);
  const max = Math.max(...v, 0);
  const tope = max <= 0 ? 1 : max;
  // El `viewBox` se queda en 132 y el alto real lo pone el CSS: `preserveAspect
  // Ratio="none"` estira el dibujo hasta donde diga `--viz-h`, así que la
  // geometría se calcula una vez y sirve para los tres pasos de alto.
  const H = 132;
  const x = (i: number) => (i / Math.max(bars.length - 1, 1)) * 100;
  const y = (n: number) => H - (n / tope) * (H - 10) - 5;
  const puntos = v.map((n, i) => `${x(i)},${y(n)}`);

  // Mínimos cuadrados sobre (índice, valor). El índice sirve de abscisa porque
  // los periodos son consecutivos y equiespaciados: es lo que `axis: "time"`
  // garantiza y por lo que esta forma solo se ofrece ahí.
  let recta: { a: number; b: number } | null = null;
  if (tendencia && v.length >= 2) {
    const n = v.length;
    const sx = (n - 1) * n / 2;
    const sy = v.reduce((s, k) => s + k, 0);
    const sxy = v.reduce((s, k, i) => s + i * k, 0);
    const sxx = v.reduce((s, _, i) => s + i * i, 0);
    const den = n * sxx - sx * sx;
    if (den !== 0) {
      const b = (n * sxy - sx * sy) / den;
      recta = { a: (sy - b * sx) / n, b };
    }
  }

  const iMax = v.indexOf(max);
  const destacados = [...new Set([iMax, v.length - 1])];

  return (
    <div>
      <div className="relative">
        <svg
          className="w-full"
          style={{ height: "var(--viz-h, 132px)" }}
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Serie de ${bars.length} periodos. Máximo ${money(max, currency)}.`}
        >
          {area && (
            <polygon
              points={`0,${H} ${puntos.join(" ")} 100,${H}`}
              fill={SERIE.a}
              opacity="0.16"
            />
          )}

          {recta && (
            <line
              x1={x(0)}
              y1={y(recta.a)}
              x2={x(v.length - 1)}
              y2={y(recta.a + recta.b * (v.length - 1))}
              stroke={SERIE.b}
              strokeWidth="2"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <polyline
            points={puntos.join(" ")}
            fill="none"
            stroke={SERIE.a}
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {destacados.map((i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v[i])}
              r="4"
              fill={SERIE.a}
              stroke="var(--color-card)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Franjas de contacto por periodo: el objetivo es la columna entera y
            no el punto, que a 4 px no se acierta con el ratón. */}
        <div className="absolute inset-0 flex">
          {bars.map((b, i) => (
            <div
              key={b.key}
              className="min-w-0 flex-1"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>

        {hover !== null && (
          <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md">
            <span className="font-medium">{money(bars[hover].value, currency, true)}</span>
            <span className="ml-1.5 text-muted-foreground">{bars[hover].label}</span>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex gap-1.5">
        {bars.map((b, i) => (
          <span
            key={b.key}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[10px]",
              // Solo extremos y lo señalado: doce nombres de mes a 10 px se
              // pisan entre sí y dejan de leerse todos.
              i === 0 || i === bars.length - 1 || i === hover
                ? "text-muted-foreground"
                : "text-transparent",
            )}
          >
            {b.label}
          </span>
        ))}
      </div>

      {recta && (
        // La pendiente escrita: es LO que la recta afirma, y leerla de la
        // inclinación es adivinar. Por periodo, que es la unidad del eje.
        <p className="mt-2 text-[11px] text-muted-foreground">
          Tendencia del tramo observado:{" "}
          <span className="font-medium text-foreground">
            {recta.b >= 0 ? "+" : "−"}
            {money(Math.abs(recta.b), currency)} por periodo
          </span>
          . Describe lo ocurrido; no lo prolonga.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 4 · Pastel y dona                                                    *
 * ------------------------------------------------------------------ */

/**
 * El reparto de un total entre pocas partes.
 *
 * Solo se ofrece cuando las barras SUMAN el total —ver `esRepartoCompleto`— y
 * son seis o menos. Las dos condiciones son lo que separa un pastel honesto de
 * uno que afirma que seis clientes son toda la cartera.
 *
 * Cada porción lleva su nombre y su porcentaje en la leyenda, al lado de su
 * color. Un pastel cuya única pista de identidad es el color obliga a ir y
 * volver entre dibujo y leyenda por cada porción, y con seis tonos y visión
 * cromática reducida directamente no se puede.
 */
function Porciones({ bars, currency, hueco }: ChartProps & { hueco?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = bars.reduce((s, b) => s + b.value, 0) || 1;
  const R = 50;

  /*
    Los cortes ACUMULADOS, calculados antes de recorrer.

    Mutar un acumulador dentro del `map` daba el mismo dibujo pero es un patrón
    que el compilador de React rechaza —y con razón: la posición de cada arco
    dependería del orden en que se evalúe el recorrido—. Se calculan los cortes
    primero y cada arco lee los suyos.
  */
  const cortes = bars.reduce<number[]>(
    (acc, b) => [...acc, acc[acc.length - 1] + b.value],
    [0],
  );

  const arcos = bars.map((b, i) => ({
    b,
    desde: cortes[i] / total,
    hasta: cortes[i + 1] / total,
    color: b.alert ? SERIE_ALERTA : SERIES[i % SERIES.length],
    fraccion: b.value / total,
  }));

  const punto = (f: number, r: number) => {
    // Arranca arriba y gira en el sentido del reloj, que es como se lee.
    const ang = f * 2 * Math.PI - Math.PI / 2;
    return [R + r * Math.cos(ang), R + r * Math.sin(ang)];
  };

  return (
    <div className="flex flex-wrap items-center gap-5">
      {/* El círculo crece con el alto elegido, con tope: un pastel más ancho
          que su leyenda deja de poder compararse con ella de un vistazo. */}
      <svg
        viewBox="0 0 100 100"
        className="shrink-0"
        style={{ width: "min(var(--viz-h, 144px), 18rem)", height: "min(var(--viz-h, 144px), 18rem)" }}
        role="img"
        aria-label="Reparto del total"
      >
        {arcos.map((a) => {
          if (a.fraccion <= 0) return null;
          const [x1, y1] = punto(a.desde, R);
          const [x2, y2] = punto(a.hasta, R);
          const grande = a.fraccion > 0.5 ? 1 : 0;
          // Una sola porción que ocupa todo no puede dibujarse como arco —el
          // punto inicial y el final coinciden y el trazo desaparece—, así que
          // se dibuja como círculo entero.
          const d =
            a.fraccion >= 0.999
              ? `M ${R} ${R - R} A ${R} ${R} 0 1 1 ${R - 0.01} ${R - R} Z`
              : `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${grande} 1 ${x2} ${y2} Z`;
          return (
            <path
              key={a.b.key}
              d={d}
              fill={a.color}
              // 2 px de superficie entre porciones: sin el hueco, dos tonos
              // contiguos se leen como una sola porción grande.
              stroke="var(--color-card)"
              strokeWidth="2"
              opacity={hover && hover !== a.b.key ? 0.55 : 1}
              onMouseEnter={() => setHover(a.b.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        {hueco && <circle cx={R} cy={R} r={R * 0.58} fill="var(--color-card)" />}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {arcos.map((a) => (
          <li
            key={a.b.key}
            className="flex items-baseline gap-2"
            onMouseEnter={() => setHover(a.b.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="mt-1 size-2.5 shrink-0 rounded-sm"
              style={{ background: a.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate" title={a.b.label}>
              {a.b.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {pct(a.fraccion)}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {money(a.b.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5 · Mapa de árbol                                                    *
 * ------------------------------------------------------------------ */

/**
 * El mismo reparto que el pastel, pero admitiendo más partes.
 *
 * El área es más fácil de comparar que el ángulo cuando hay muchas piezas, y
 * además el rectángulo tiene sitio para escribir el nombre dentro — que es lo
 * que un pastel de diez porciones no puede hacer.
 *
 * El reparto es «squarify»: en cada paso se decide si añadir la siguiente pieza
 * a la fila actual mejora o empeora la proporción del peor rectángulo. Es lo
 * que evita las tiras largas y finas del reparto ingenuo, donde comparar áreas
 * se vuelve imposible.
 */
function Treemap({ bars, currency }: ChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  const datos = bars.filter((b) => b.value > 0).sort((a, b) => b.value - a.value);
  const total = datos.reduce((s, b) => s + b.value, 0) || 1;

  const W = 100;
  const H = 62;
  type Caja = { b: Bar; x: number; y: number; w: number; h: number };
  const cajas: Caja[] = [];

  let x = 0;
  let y = 0;
  let libreW = W;
  let libreH = H;
  let i = 0;
  const areaDe = (b: Bar) => (b.value / total) * W * H;

  while (i < datos.length) {
    const vertical = libreW >= libreH;
    const lado = vertical ? libreH : libreW;
    const fila: Bar[] = [];
    let mejor = Infinity;

    // Se añaden piezas a la fila mientras la peor proporción MEJORE.
    while (i + fila.length < datos.length) {
      const cand = [...fila, datos[i + fila.length]];
      const suma = cand.reduce((s, b) => s + areaDe(b), 0);
      const grueso = suma / lado;
      const peor = Math.max(
        ...cand.map((b) => {
          const largo = areaDe(b) / grueso;
          return Math.max(grueso / largo, largo / grueso);
        }),
      );
      if (fila.length > 0 && peor > mejor) break;
      mejor = peor;
      fila.push(datos[i + fila.length]);
    }

    const suma = fila.reduce((s, b) => s + areaDe(b), 0);
    const grueso = suma / lado;
    let corrido = 0;
    for (const b of fila) {
      const largo = areaDe(b) / grueso;
      cajas.push(
        vertical
          ? { b, x, y: y + corrido, w: grueso, h: largo }
          : { b, x: x + corrido, y, w: largo, h: grueso },
      );
      corrido += largo;
    }

    if (vertical) {
      x += grueso;
      libreW -= grueso;
    } else {
      y += grueso;
      libreH -= grueso;
    }
    i += fila.length;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "var(--viz-h, 168px)" }} role="img"
        aria-label={`Reparto de ${money(total, currency)} entre ${datos.length} partes`}>
        {cajas.map((c, k) => {
          const color = c.b.alert ? SERIE_ALERTA : SERIES[k % SERIES.length];
          // El nombre solo cabe a partir de cierto tamaño; por debajo, la pieza
          // se identifica al apuntarla. Escribir encima de todas produce texto
          // recortado que no dice nada.
          const cabe = c.w > 16 && c.h > 9;
          return (
            <g
              key={c.b.key}
              onMouseEnter={() => setHover(c.b.key)}
              onMouseLeave={() => setHover(null)}
              opacity={hover && hover !== c.b.key ? 0.55 : 1}
            >
              <rect
                x={c.x}
                y={c.y}
                width={Math.max(0, c.w - 0.6)}
                height={Math.max(0, c.h - 0.6)}
                fill={color}
                rx="1"
              />
              {cabe && (
                <text
                  x={c.x + 2}
                  y={c.y + 5}
                  className="fill-white"
                  style={{ fontSize: 3.4, fontWeight: 500 }}
                >
                  {c.b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {hover
          ? (() => {
              const c = cajas.find((k) => k.b.key === hover);
              return c
                ? `${c.b.label} · ${money(c.b.value, currency)} · ${pct(c.b.value / total)}`
                : "";
            })()
          : `${datos.length} partes de ${money(total, currency)}. El área es la magnitud.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 6 · Dispersión                                                       *
 * ------------------------------------------------------------------ */

/**
 * Las dos magnitudes de cada categoría, cruzadas.
 *
 * Es la única forma que necesita DOS números por punto, y por eso solo se
 * ofrece donde el bloque los trae. Sirve para lo que ninguna barra enseña: si
 * las dos magnitudes van juntas o no —meses de mucho ingreso que también son de
 * mucho costo— y quién se sale de esa relación.
 *
 * Lleva la diagonal de referencia porque en estos bloques las dos magnitudes
 * suelen ser comparables (ingreso contra costo, pagos contra anticipos): estar
 * por encima o por debajo de la diagonal es la lectura inmediata, y sin la
 * línea hay que calcularla a ojo punto por punto.
 */
function Dispersion({ bars, currency, legend }: ChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  const maxX = Math.max(...bars.map((b) => b.value), 1);
  const maxY = Math.max(...bars.map((b) => b.stacked ?? 0), 1);
  const tope = Math.max(maxX, maxY);
  const S = 100;
  const px = (n: number) => (n / tope) * (S - 10) + 5;
  const py = (n: number) => S - ((n / tope) * (S - 10) + 5);
  const activo = bars.find((b) => b.key === hover);

  return (
    <div>
      {legend && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Horizontal: {legend[0]} · Vertical: {legend[1]}
        </p>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${S} ${S}`} className="w-full" style={{ height: "var(--viz-h, 168px)" }} role="img"
          aria-label={`Dispersión de ${bars.length} puntos`}>
          <line x1="5" y1={S - 5} x2={S - 5} y2="5" stroke="var(--viz-grid)" strokeWidth="1"
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1="5" y1="5" x2="5" y2={S - 5} stroke="var(--viz-grid)" strokeWidth="1"
            vectorEffect="non-scaling-stroke" />
          <line x1="5" y1={S - 5} x2={S - 5} y2={S - 5} stroke="var(--viz-grid)" strokeWidth="1"
            vectorEffect="non-scaling-stroke" />
          {bars.map((b) => (
            <circle
              key={b.key}
              cx={px(b.value)}
              cy={py(b.stacked ?? 0)}
              r={hover === b.key ? 3.5 : 2.6}
              fill={b.alert ? SERIE_ALERTA : SERIE.a}
              stroke="var(--color-card)"
              strokeWidth="1"
              opacity={hover && hover !== b.key ? 0.5 : 1}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {activo
          ? `${activo.label} · ${money(activo.value, currency)} / ${money(activo.stacked ?? 0, currency)}`
          : "La diagonal marca donde las dos magnitudes son iguales."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 7 · Tabla                                                            *
 * ------------------------------------------------------------------ */

/**
 * El dato exacto, sin dibujo.
 *
 * No es el premio de consolación: es la forma que SIEMPRE es apta y la que
 * permite leer cifras exactas y copiarlas. También es lo que la paleta exige
 * como alternativa cuando el color no alcanza el contraste mínimo.
 */
function Tabla({ bars, currency, legend }: ChartProps) {
  const dos = bars.some((b) => (b.stacked ?? 0) > 0);
  return (
    // El desbordamiento va DENTRO de la tabla y nunca en la página: un tablero
    // que se desplaza a lo ancho entero por una celda larga es peor que una
    // tabla con su propia barra.
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-1.5 text-left font-medium">Concepto</th>
            <th className="py-1.5 text-right font-medium">{legend?.[0] ?? "Valor"}</th>
            {dos && <th className="py-1.5 text-right font-medium">{legend?.[1] ?? "Segunda"}</th>}
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key} className="border-b border-border/50 last:border-0">
              <td className="py-1.5 pr-3">
                {b.href ? (
                  <Link href={b.href} className="hover:text-primary hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  b.label
                )}
                {b.alert && (
                  <span className="ml-1.5 text-[10px] font-medium text-destructive">
                    vencido
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {money(b.value, currency, true)}
              </td>
              {dos && (
                <td className="py-1.5 text-right tabular-nums">
                  {money(b.stacked ?? 0, currency, true)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
