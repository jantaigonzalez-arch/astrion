import { cn } from "@/lib/utils";

/**
 * Historia y pronóstico en el mismo eje, con la banda dibujada.
 *
 * Tres decisiones de presentación que no son estéticas:
 *
 * 1. LA BANDA SE DIBUJA, no se pone al lado en texto. Un pronóstico sin
 *    incertidumbre visible se lee como una promesa, y la banda de esta capa se
 *    ENSANCHA con la distancia porque la proyección es recursiva —cada periodo
 *    usa como dato lo que el anterior estimó—. Ver esa cuña abrirse es lo que
 *    enseña, sin explicarlo, que el sexto mes vale menos que el primero.
 *
 * 2. LA FRONTERA ES VISIBLE. Una línea vertical separa lo ocurrido de lo
 *    estimado. Sin ella, una serie continua invita a leer los últimos puntos
 *    como datos, que es el malentendido más caro que puede producir esta
 *    pantalla.
 *
 * 3. SVG SIN LIBRERÍA. Son doce a cuarenta puntos y dos polígonos; una
 *    biblioteca de gráficas costaría más kilobytes que todo el resto de la
 *    pantalla y traería su propio modelo de temas que habría que reconciliar
 *    con el de aquí.
 */

export type ForecastRow = {
  period: string;
  value: number;
  lower: number | null;
  upper: number | null;
  actual: number | null;
};

export type HistoryRow = { period: string; value: number };

const W = 720;
const H = 220;
const PAD = { top: 14, right: 12, bottom: 26, left: 56 };

export function ForecastChart({
  history,
  forecast,
  unit,
  className,
}: {
  history: HistoryRow[];
  forecast: ForecastRow[];
  unit: string;
  className?: string;
}) {
  if (forecast.length === 0 && history.length === 0) return null;

  const puntos = [
    ...history.map((h) => ({ at: h.period, v: h.value, lo: h.value, hi: h.value, futuro: false })),
    ...forecast.map((f) => ({
      at: f.period,
      v: f.value,
      lo: f.lower ?? f.value,
      hi: f.upper ?? f.value,
      futuro: true,
    })),
  ];

  // La escala cubre la BANDA, no solo la línea. Escalar por el valor central
  // recortaría la parte de arriba de la cuña justo donde importa.
  const min = Math.min(...puntos.map((p) => p.lo), 0);
  const max = Math.max(...puntos.map((p) => p.hi));
  const rango = max - min || 1;

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, puntos.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    H - PAD.bottom - ((v - min) / rango) * (H - PAD.top - PAD.bottom);

  const futuros = puntos.filter((p) => p.futuro);
  const iFrontera = puntos.findIndex((p) => p.futuro);

  const linea = (ps: typeof puntos, desde: number) =>
    ps.map((p, k) => `${k === 0 ? "M" : "L"}${x(desde + k).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  const banda =
    futuros.length > 0
      ? [
          ...futuros.map((p, k) => `${k === 0 ? "M" : "L"}${x(iFrontera + k).toFixed(1)},${y(p.hi).toFixed(1)}`),
          ...futuros
            .slice()
            .reverse()
            .map((p, k) => `L${x(iFrontera + futuros.length - 1 - k).toFixed(1)},${y(p.lo).toFixed(1)}`),
          "Z",
        ].join(" ")
      : "";

  const fmt = (v: number) =>
    Math.abs(v) >= 1000
      ? `${Math.round(v / 1000)}k`
      : v.toLocaleString("es-MX", { maximumFractionDigits: 1 });

  const mes = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <figure className={cn("w-full", className)}>
      {/* `overflow-x-auto` en el envoltorio y viewBox fijo: en un móvil el
          gráfico se desplaza en su propia caja en vez de encoger los puntos
          hasta hacerlos indistinguibles. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Historia y pronóstico en ${unit}. ${futuros.length} periodos estimados.`}
          className="h-auto w-full min-w-[560px]"
        >
          {/* Rejilla y eje: cuatro marcas, las suficientes para leer magnitud
              sin convertir el fondo en un cuaderno. */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = min + rango * f;
            return (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-border"
                  strokeWidth="0.5"
                />
                <text
                  x={PAD.left - 6}
                  y={y(v) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[9px]"
                >
                  {fmt(v)}
                </text>
              </g>
            );
          })}

          {banda && <path d={banda} className="fill-primary/15" />}

          {/* Lo ocurrido: línea continua. */}
          {iFrontera !== 0 && (
            <path
              d={linea(puntos.slice(0, iFrontera === -1 ? puntos.length : iFrontera + 1), 0)}
              fill="none"
              className="stroke-foreground"
              strokeWidth="1.6"
            />
          )}

          {/* Lo estimado: discontinua. La diferencia de trazo hace el trabajo
              incluso en una captura en blanco y negro, donde el color no. */}
          {futuros.length > 0 && (
            <path
              d={linea(futuros, iFrontera)}
              fill="none"
              className="stroke-primary"
              strokeWidth="1.8"
              strokeDasharray="4 3"
            />
          )}

          {/* La frontera entre saber y estimar. */}
          {iFrontera > 0 && (
            <line
              x1={x(iFrontera)}
              x2={x(iFrontera)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-primary/50"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          )}

          {futuros.map((p, k) => (
            <circle
              key={p.at}
              cx={x(iFrontera + k)}
              cy={y(p.v)}
              r="2.5"
              className="fill-primary"
            />
          ))}

          {/* Etiquetas de fecha: la primera, la frontera y la última. Poner
              todas las convierte en una mancha. */}
          {[0, iFrontera, puntos.length - 1]
            .filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
            .map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[9px]"
              >
                {mes(puntos[i].at)}
              </text>
            ))}
        </svg>
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-foreground" /> ocurrido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-primary" /> estimado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-primary/15" /> margen
        </span>
        <span>
          La banda se abre con la distancia: cada periodo usa como dato lo que
          estimó el anterior.
        </span>
      </figcaption>
    </figure>
  );
}
