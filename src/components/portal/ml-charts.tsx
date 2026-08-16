import { Target, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toleranceLabel, withinToleranceOf, type ToleranceKind } from "@/lib/ml/core";

/**
 * Las dos preguntas que un administrador se hace de verdad, dibujadas.
 *
 * La pantalla sabía responder «el error es 3,12 h y mejora 9,1%». Eso es
 * cierto y es inútil para quien tiene que decidir si confía: no dice qué va a
 * estimar el sistema ni cuánto se equivoca en los casos que a él le importan.
 * Estas dos gráficas contestan lo que sí se pregunta:
 *
 *   1. ¿QUÉ ME VA A DECIR?  →  las estimaciones por grupo, con su rango.
 *   2. ¿LE PUEDO CREER?     →  cada caso evaluado contra lo que pasó de verdad.
 *
 * Las dos salen de datos que ya existían: la primera del modelo guardado, la
 * segunda de la evaluación —que hasta ahora calculaba cada predicción y la
 * tiraba—. No hay ningún número nuevo aquí; hay los mismos números en una
 * forma que se puede mirar.
 */

export type ForecastRow = {
  /** Los valores del grupo, ya legibles: «mantenimiento · Waters». */
  label: string;
  /** Con qué agrupó: «Categoría + Marca del equipo». */
  by: string;
  median: number;
  p25: number;
  p75: number;
  /** Casos históricos que sostienen esta estimación. */
  n: number;
  /** El respaldo global: lo que se estima cuando ningún grupo aplica. */
  global?: boolean;
};

export type MlChartsProps = {
  unit: string;
  tolerance: number;
  /** Ver `ToleranceKind`. Cambia la forma de la banda, no solo el texto. */
  toleranceKind?: ToleranceKind;
  forecast: ForecastRow[];
  /** Pares [real, estimado] de la evaluación. Ver `Backtest.points`. */
  points: Array<[number, number]>;
  nTest: number;
};

export function MlCharts({
  unit,
  tolerance,
  toleranceKind,
  forecast,
  points,
  nTest,
}: MlChartsProps) {
  if (forecast.length === 0 && points.length === 0) return null;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <ForecastChart rows={forecast} unit={unit} />
      <AccuracyChart
        points={points}
        tolerance={tolerance}
        toleranceKind={toleranceKind}
        unit={unit}
        nTest={nTest}
      />
    </div>
  );
}

/* ------------------------- Qué va a estimar ------------------------- */

/**
 * Las estimaciones del modelo, una por grupo.
 *
 * Es el modelo entrenado mostrado tal cual es: una tabla de medianas. La barra
 * NO es una barra de magnitud sino el rango intercuartil —la mitad central de
 * los casos históricos— con la mediana marcada. Esa distinción importa: un
 * rango ancho significa que ese grupo es irregular y el número de en medio
 * vale poco, y eso se ve de un vistazo sin tener que leer ninguna cifra.
 *
 * Se ordena por casos y no por valor: los grupos con más historia detrás son
 * los que de verdad se van a usar, y son los que merecen estar arriba.
 */
function ForecastChart({ rows, unit }: { rows: ForecastRow[]; unit: string }) {
  if (rows.length === 0) return null;

  // Escala común a todas las filas: comparar rangos entre grupos es la mitad
  // de la utilidad, y con una escala por fila esa comparación sería mentira.
  const max = Math.max(...rows.map((r) => r.p75), ...rows.map((r) => r.median));
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);

  return (
    <section className="rounded-lg border border-border p-4">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <TrendingUp className="size-4 shrink-0 text-primary" />
        Lo que va a estimar
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        La línea es el rango habitual; el punto, lo que va a decir. Cuanto más
        larga la línea, más irregular es ese grupo y menos vale su estimación.
      </p>

      <div className="mt-4 grid gap-3">
        {rows.map((r) => (
          <div key={`${r.by}-${r.label}`}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span
                className={cn(
                  "truncate",
                  r.global ? "italic text-muted-foreground" : "text-foreground",
                )}
                title={`${r.by}: ${r.label}`}
              >
                {r.label}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                <span className="font-semibold">{r.median.toFixed(1)}</span>{" "}
                <span className="text-muted-foreground">{unit}</span>
              </span>
            </div>

            <div className="mt-1 flex items-center gap-2">
              {/* Pista de ancho completo: la posición dentro de ella es lo que
                  hace comparables dos grupos distintos. */}
              <div className="relative h-2 flex-1 rounded-full bg-secondary">
                <div
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    r.global ? "bg-muted-foreground/30" : "bg-primary/25",
                  )}
                  style={{
                    left: `${pct(r.p25)}%`,
                    width: `${Math.max(pct(r.p75 - r.p25), 1.5)}%`,
                  }}
                />
                <div
                  className={cn(
                    "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                    r.global ? "bg-muted-foreground" : "bg-primary",
                  )}
                  style={{ left: `${pct(r.median)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {r.n} casos
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------- Qué tan bien acertó ------------------------- */

/**
 * Cada caso de la evaluación: lo que el modelo dijo contra lo que pasó.
 *
 * Es la gráfica que convence o desmiente. La diagonal es el acierto perfecto y
 * la banda es la tolerancia que el negocio declaró útil: un punto dentro de la
 * banda es una estimación con la que se puede trabajar. Contar los puntos
 * verdes da el mismo porcentaje que la cifra de arriba, pero además muestra
 * DÓNDE están los fallos, que es lo que la cifra no puede decir.
 *
 * Enseña sin adornos la limitación real de una mediana: los puntos se aplanan
 * hacia el centro, así que los servicios muy largos se subestiman y los muy
 * cortos se sobrestiman. Preferible verlo aquí que descubrirlo cotizando.
 */
function AccuracyChart({
  points,
  tolerance,
  toleranceKind,
  unit,
  nTest,
}: {
  points: Array<[number, number]>;
  tolerance: number;
  toleranceKind?: ToleranceKind;
  unit: string;
  nTest: number;
}) {
  if (points.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border p-4">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <Target className="size-4 shrink-0 text-muted-foreground" />
          Qué tan bien acertó
        </h4>
        <p className="mt-2 text-xs text-muted-foreground">
          Este modelo se entrenó antes de que se guardaran los casos de la
          evaluación. Vuelve a entrenar y la gráfica aparece: sus números no
          cambian, solo se conserva el detalle para poder dibujarlo.
        </p>
      </section>
    );
  }

  const max = Math.max(...points.flat(), tolerance) * 1.05 || 1;
  const PAD = 5;
  const span = 100 - 2 * PAD;
  const sx = (v: number) => PAD + (v / max) * span;
  const sy = (v: number) => 100 - PAD - (v / max) * span;

  /*
    La banda de tolerancia.

    Con margen ABSOLUTO son dos rectas paralelas a la diagonal y la banda es una
    franja de ancho constante. Con margen RELATIVO el ancho crece con el valor
    real, así que la banda es una CUÑA que se abre desde el origen — y dibujarla
    como franja mentiría: enseñaría verdes fuera de la banda y rojos dentro.

    En ambos casos se recorta al cuadro: con una tolerancia mayor que el rango
    de los datos, el polígono degeneraría con vértices fuera del área.
  */
  const rel = toleranceKind === "relative";
  const band = rel
    ? [
        [0, 0],
        [max, Math.min(max, max * (1 + tolerance / 100))],
        [max, max * (1 - tolerance / 100)],
      ]
        .map(([x, y]) => `${sx(x)},${sy(y)}`)
        .join(" ")
    : (() => {
        const t = Math.min(tolerance, max);
        return [
          [0, 0],
          [0, t],
          [max - t, max],
          [max, max],
          [max, max - t],
          [t, 0],
        ]
          .map(([x, y]) => `${sx(x)},${sy(y)}`)
          .join(" ");
      })();

  // La MISMA regla que contó los aciertos en el backtest. Si la pantalla
  // usara la suya, la gráfica y la cifra de arriba dirían cosas distintas
  // sobre los mismos datos y nadie sabría cuál creer.
  const dentro = ([a, p]: [number, number]) =>
    withinToleranceOf(Math.abs(p - a), a, tolerance, toleranceKind ?? "absolute");
  const hits = points.filter(dentro).length;

  return (
    <section className="rounded-lg border border-border p-4">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <Target className="size-4 shrink-0 text-primary" />
        Qué tan bien acertó
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Cada punto es un caso real que el modelo <em>no</em> vio al entrenar.
        Dentro de la franja, la estimación sirve.
      </p>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
          <span>Estimado ({unit})</span>
          <span className="font-mono tabular-nums">
            {max.toFixed(0)} {unit}
          </span>
        </div>

        <svg
          viewBox="0 0 100 100"
          className="aspect-square w-full overflow-visible"
          role="img"
          aria-label={`Estimado contra real: ${hits} de ${points.length} casos dentro de ${toleranceLabel(tolerance, toleranceKind, unit)}`}
        >
          {/* La franja útil primero, para que los puntos queden encima. */}
          <polygon points={band} className="fill-success/12" />
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(max)}
            y2={sy(max)}
            className="stroke-success/50"
            strokeWidth={1}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(max)}
            y2={sy(0)}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(0)}
            y2={sy(max)}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {points.map(([real, est], i) => {
            const ok = dentro([real, est]);
            return (
              <circle
                key={i}
                cx={sx(real)}
                cy={sy(est)}
                r={1.4}
                className={ok ? "fill-success/70" : "fill-warning"}
              />
            );
          })}
        </svg>

        <div className="mt-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">0</span>
          <span>Real ({unit})</span>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium text-success">{hits}</span> de{" "}
        <span className="font-medium text-foreground">{points.length}</span>{" "}
        dentro de {toleranceLabel(tolerance, toleranceKind, unit)}
        {points.length < nTest && (
          <> · muestra de los {nTest} casos evaluados</>
        )}
        .
      </p>
    </section>
  );
}
