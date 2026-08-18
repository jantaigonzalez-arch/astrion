"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Historia y pronóstico en el mismo eje, con banda y lectura al pasar el cursor.
 *
 * ── POR QUÉ SIN BIBLIOTECA DE GRÁFICAS ─────────────────────────────────────
 *
 * Por la misma regla que gobierna la capa de inteligencia: no se usa el método
 * caro cuando el barato contesta bien.
 *
 * Son cuarenta puntos, dos polígonos y una línea guía. Recharts pesa unos
 * 110 kB comprimidos y ECharts el triple — más que todo el JavaScript que hoy
 * manda el portal— y ninguna de las dos aporta nada que falte aquí. Peor: cada
 * una trae su propio modelo de temas, y estas formas ya usan los tokens de la
 * aplicación (`stroke-border`, `fill-primary`), así que el modo oscuro funciona
 * sin escribir una línea. Reconciliar dos sistemas de color es trabajo real y
 * permanente a cambio de nada.
 *
 * Cuándo SÍ convendría, para que la decisión se pueda revisar con criterio y no
 * por gusto: acercar y desplazar el eje, seleccionar rangos con el ratón, ejes
 * dobles, o meterle de golpe media docena de tipos de gráfica nuevos. Nada de
 * eso está pedido, y el día que lo esté, lo que se sustituye es este archivo.
 *
 * ── LA INTERACCIÓN ─────────────────────────────────────────────────────────
 *
 * Con PUNTEROS y no con `mouse`: los mismos manejadores cubren ratón, lápiz y
 * dedo. Con eventos de ratón, en una tableta la gráfica sería un dibujo mudo.
 *
 * Y con TECLADO, que no es un adorno de accesibilidad: es la única forma de
 * leer un valor exacto sin apuntar con precisión de píxel. Las flechas recorren
 * los periodos, Inicio y Fin van a los extremos, Escape suelta.
 *
 * El punto activo se busca por CERCANÍA en el eje horizontal, no por acertarle
 * al círculo. Obligar a apuntar a un punto de 2,5 px de radio convierte la
 * lectura en un juego de puntería — y es lo que hace que las gráficas hechas a
 * mano se sientan peores que las de biblioteca, mucho más que el dibujo.
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

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type Punto = {
  at: string;
  v: number;
  lo: number;
  hi: number;
  actual: number | null;
  futuro: boolean;
};

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [activo, setActivo] = useState<number | null>(null);

  const puntos: Punto[] = useMemo(
    () => [
      ...history.map((h) => ({
        at: h.period,
        v: h.value,
        lo: h.value,
        hi: h.value,
        actual: null,
        futuro: false,
      })),
      ...forecast.map((f) => ({
        at: f.period,
        v: f.value,
        lo: f.lower ?? f.value,
        hi: f.upper ?? f.value,
        actual: f.actual,
        futuro: true,
      })),
    ],
    [history, forecast],
  );

  const geo = useMemo(() => {
    if (puntos.length === 0) return null;
    // La escala cubre la BANDA y los valores reales, no solo la línea:
    // escalar por el centro recortaría la cuña justo donde importa.
    const todos = puntos.flatMap((p) => [p.lo, p.hi, p.actual].filter((n): n is number => n !== null));
    const min = Math.min(...todos, 0);
    const max = Math.max(...todos);
    const rango = max - min || 1;
    const x = (i: number) =>
      PAD.left + (i / Math.max(1, puntos.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => H - PAD.bottom - ((v - min) / rango) * (H - PAD.top - PAD.bottom);
    return { min, max, rango, x, y };
  }, [puntos]);

  // Se busca el índice más cercano en X. Ver la nota de la cabecera.
  const desdePuntero = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || !geo || puntos.length === 0) return null;
      const caja = svg.getBoundingClientRect();
      // De píxeles de pantalla a coordenadas del viewBox. El SVG escala
      // uniformemente, así que basta la proporción del ancho.
      const vx = ((clientX - caja.left) / caja.width) * W;
      const util = W - PAD.left - PAD.right;
      const frac = (vx - PAD.left) / util;
      const i = Math.round(frac * (puntos.length - 1));
      return Math.max(0, Math.min(puntos.length - 1, i));
    },
    [geo, puntos.length],
  );

  const mover = useCallback(
    (e: React.PointerEvent) => setActivo(desdePuntero(e.clientX)),
    [desdePuntero],
  );

  const teclas = useCallback(
    (e: React.KeyboardEvent) => {
      if (puntos.length === 0) return;
      const paso = (d: number) =>
        setActivo((a) => Math.max(0, Math.min(puntos.length - 1, (a ?? 0) + d)));

      if (e.key === "ArrowRight") { e.preventDefault(); paso(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); paso(-1); }
      else if (e.key === "Home") { e.preventDefault(); setActivo(0); }
      else if (e.key === "End") { e.preventDefault(); setActivo(puntos.length - 1); }
      else if (e.key === "Escape") setActivo(null);
    },
    [puntos.length],
  );

  if (!geo || puntos.length === 0) return null;

  const { x, y, min, rango } = geo;
  const futuros = puntos.filter((p) => p.futuro);
  const iFrontera = puntos.findIndex((p) => p.futuro);
  const p = activo === null ? null : puntos[activo];

  const linea = (ps: Punto[], desde: number) =>
    ps.map((q, k) => `${k === 0 ? "M" : "L"}${x(desde + k).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ");

  const banda =
    futuros.length > 0
      ? [
          ...futuros.map((q, k) => `${k === 0 ? "M" : "L"}${x(iFrontera + k).toFixed(1)},${y(q.hi).toFixed(1)}`),
          ...futuros
            .slice()
            .reverse()
            .map((q, k) => `L${x(iFrontera + futuros.length - 1 - k).toFixed(1)},${y(q.lo).toFixed(1)}`),
          "Z",
        ].join(" ")
      : "";

  const fmtEje = (v: number) =>
    Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : redondo(v);
  const mes = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <figure className={cn("w-full", className)}>
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={
            p
              ? `${mes(p.at)}: ${redondo(p.v)} ${unit}`
              : `Historia y pronóstico en ${unit}. ${futuros.length} periodos estimados. Usa las flechas para recorrerlos.`
          }
          onPointerMove={mover}
          onPointerDown={mover}
          onPointerLeave={() => setActivo(null)}
          onKeyDown={teclas}
          onBlur={() => setActivo(null)}
          className="h-auto w-full min-w-[560px] touch-pan-y rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
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
                  {fmtEje(v)}
                </text>
              </g>
            );
          })}

          {banda && <path d={banda} className="fill-primary/15" />}

          {iFrontera !== 0 && (
            <path
              d={linea(puntos.slice(0, iFrontera === -1 ? puntos.length : iFrontera + 1), 0)}
              fill="none"
              className="stroke-foreground"
              strokeWidth="1.6"
            />
          )}

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

          {futuros.map((q, k) => (
            <circle key={q.at} cx={x(iFrontera + k)} cy={y(q.v)} r="2.5" className="fill-primary" />
          ))}

          {/* Lo que de verdad pasó, sobre el periodo que lo prometió. Es lo que
              convierte la gráfica en un historial y no en una promesa: sin esto,
              un pronóstico cumplido y uno fallado se ven igual. */}
          {puntos.map((q, i) =>
            q.actual === null ? null : (
              <circle
                key={`r-${q.at}`}
                cx={x(i)}
                cy={y(q.actual)}
                r="3"
                className="fill-card stroke-foreground"
                strokeWidth="1.5"
              />
            ),
          )}

          {/* La guía y el punto resaltado. Van al final para quedar por encima. */}
          {p && (
            <>
              <line
                x1={x(activo!)}
                x2={x(activo!)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                className="stroke-foreground/30"
                strokeWidth="1"
              />
              {/* `stroke-card` y no un color literal: el anillo separa el punto
                  del fondo y ese fondo cambia con el tema. Con blanco fijo, en
                  modo oscuro el punto sale con un halo claro alrededor. */}
              <circle
                cx={x(activo!)}
                cy={y(p.v)}
                r="4.5"
                className={cn("stroke-card", p.futuro ? "fill-primary" : "fill-foreground")}
                strokeWidth="2"
              />
            </>
          )}

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

        {/* El globo va en HTML y no en SVG: el texto se ajusta solo, hereda la
            tipografía y los colores del tema, y no hay que calcular a mano dónde
            cortar las líneas. Se coloca en porcentaje del ancho porque el SVG
            escala uniformemente con su `viewBox`. */}
        {p && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 z-10 min-w-[9rem] -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(x(activo!) / W) * 100}%`,
              // Cerca del borde el globo se pega en vez de salirse.
              transform:
                activo! < puntos.length * 0.15
                  ? "translateX(-10%)"
                  : activo! > puntos.length * 0.85
                    ? "translateX(-90%)"
                    : "translateX(-50%)",
            }}
          >
            <p className="font-medium">{mes(p.at)}</p>
            <p className="mt-0.5 font-mono tabular-nums">
              {redondo(p.v)} <span className="text-muted-foreground">{unit}</span>
            </p>
            {p.futuro && p.hi > p.lo && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                entre {redondo(p.lo)} y {redondo(p.hi)}
              </p>
            )}
            {p.actual !== null && (
              <p className="mt-1 border-t border-border pt-1 text-[11px]">
                llegó{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {redondo(p.actual)}
                </span>{" "}
                <span className={cn(desvio(p) >= 0 ? "text-warning" : "text-success")}>
                  ({desvio(p) >= 0 ? "+" : ""}
                  {desvio(p).toFixed(0)} %)
                </span>
              </p>
            )}
            {!p.futuro && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">ocurrido</p>
            )}
          </div>
        )}
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
          estimó el anterior. Pasa el cursor —o usa las flechas— para ver cada
          periodo.
        </span>
      </figcaption>
    </figure>
  );
}

/** Cuánto se desvió la estimación de lo que pasó, en porcentaje del real. */
function desvio(p: Punto): number {
  if (p.actual === null || p.actual === 0) return 0;
  return ((p.v - p.actual) / Math.abs(p.actual)) * 100;
}

function redondo(v: number): string {
  return v.toLocaleString("es-MX", {
    maximumFractionDigits: Math.abs(v) < 100 ? 1 : 0,
  });
}
