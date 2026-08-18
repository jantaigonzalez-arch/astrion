"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Loader2, Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { analyzeRoute, type AssistantResult } from "@/lib/actions/assistant";
import {
  BLOCK_LABEL,
  BLOCK_ORDER,
  COMPACT_KINDS,
  type Block,
} from "@/lib/ml/blocks-types";
import { InsightItem } from "@/components/portal/insight-strip";
import {
  ForecastCard,
  ProjectionCard,
  TrendCard,
} from "@/components/portal/assistant-blocks";
import { usePathname } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * El asistente de análisis.
 *
 * Vive en la barra superior y está SIEMPRE, en el mismo sitio de toda la
 * aplicación. Eso es lo que lo vuelve una costumbre: la pregunta «¿habrá algo
 * que mirar aquí?» solo se la hace quien sabe dónde mirar, y solo lo sabe si el
 * sitio nunca cambia.
 *
 * La señal la lleva el punto, no la presencia. El botón tranquilo no significa
 * «no hay análisis», significa «no hay nada que atender» — y al abrirlo lo dice
 * con nombre y apellido, enseñando qué está vigilando. Un panel vacío enseñaría
 * a no volver a abrirlo.
 *
 * Nunca retrasa la página: el análisis viaja en su propia petición, disparada
 * después de que la pantalla ya se pintó.
 *
 * Dos tamaños, y no son el mismo panel estirado:
 *
 *   · compacto — globo colgado del botón. De paso: se consulta y se va solo al
 *     clicar fuera. Solo hallazgos, que es lo único legible en 26 rem.
 *   · ancho — hoja a la derecha, a toda la altura, con encabezado fijo y cuerpo
 *     que rueda. Se queda hasta que la cierran, y NO pierde los hallazgos: van
 *     primero, antes de las gráficas, con el conteo repetido en el encabezado.
 */
export function AnalysisAssistant() {
  const route = usePathname();
  const [open, setOpen] = useState(false);
  // Compacto por omisión: el asistente se consulta de pasada mucho más de lo
  // que se estudia. Quien quiera las gráficas las pide.
  const [ancho, setAncho] = useState(false);
  const [data, setData] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Al cambiar de ruta hay que descartar lo anterior: los hallazgos de la
  // pantalla que se dejó atrás no valen para la nueva, y el panel abierto
  // enseñaba algo que ya no es de aquí.
  //
  // Se ajusta DURANTE EL RENDER y no en un efecto. Hacerlo en un efecto pinta
  // primero un cuadro con los datos viejos bajo la ruta nueva y lo corrige
  // después — un parpadeo visible, además del render en cascada que la regla
  // `set-state-in-effect` señala. Es el mismo patrón que usa `payment-forms.tsx`.
  const [rutaVista, setRutaVista] = useState(route);
  if (route !== rutaVista) {
    setRutaVista(route);
    setData(null);
    setLoading(true);
    setOpen(false);
    setAncho(false);
  }

  // El efecto solo dispara la petición. El `setState` va dentro de la promesa,
  // que es una devolución de llamada y no el cuerpo del efecto.
  useEffect(() => {
    let vigente = true;
    analyzeRoute(route)
      .then((r) => {
        // Se descarta si para cuando llega ya se navegó: sin este corte, una
        // respuesta lenta pinta los hallazgos de la pantalla anterior encima
        // de la nueva.
        if (vigente) setData(r);
      })
      .catch(() => {
        if (vigente) setData(null);
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });
    return () => {
      vigente = false;
    };
  }, [route]);

  const cerrar = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const porTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", porTecla);
    return () => document.removeEventListener("keydown", porTecla);
  }, [open, cerrar]);

  // El clic fuera cierra el globo compacto, pero NO la hoja ancha.
  //
  // La hoja se abre justamente para comparar el análisis con la tabla que lo
  // originó: si el primer clic en esa tabla la cierra, no se puede comparar
  // nada. Ahí se cierra a propósito —la equis, reducir o Escape—, que es lo que
  // se espera de algo que uno agrandó. El globo compacto sí es de paso y se va
  // solo.
  useEffect(() => {
    if (!open || ancho) return;
    const porFuera = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) cerrar();
    };
    // `capture` para que el clic en el propio botón no reabra tras cerrar.
    document.addEventListener("mousedown", porFuera, true);
    return () => document.removeEventListener("mousedown", porFuera, true);
  }, [open, ancho, cerrar]);

  const blocks = data?.blocks ?? [];
  const findings = blocks.filter((b) => b.kind === "finding");
  // El punto y el conteo los mandan los HALLAZGOS, no el total de bloques. Una
  // gráfica de tendencia no es algo que atender, y contarla encendería el aviso
  // en pantallas donde no pasa nada.
  const worst = peorTono(findings.map((b) => b.insight));
  const alerting = worst === "risk" || worst === "watch";
  /*
    En compacto entran los tipos que tienen forma de una línea; el resto
    necesita ancho. Ver `COMPACT_KINDS`.

    Antes se filtraba el pronóstico entero por su gráfica, y el efecto era el
    contrario del buscado: en una pantalla cuyo único análisis fuera un
    pronóstico, el globo salía con el título puesto y NADA debajo. Un panel
    vacío enseña a no volver a abrirlo — la lección exacta que este componente
    existe para evitar. Lo que no cabe es la gráfica, no el bloque.
  */
  const visibles = ancho
    ? blocks
    : blocks.filter((b) => COMPACT_KINDS.includes(b.kind));

  /*
    Hay DOS razones distintas para ofrecer «agrandar», y confundirlas escondió
    el botón justo donde más falta hacía.

    · OCULTOS   — bloques que en compacto no salen (hoy, las tendencias).
    · ABREVIADOS — bloques que sí salen pero recortados: un pronóstico sin su
                   serie, una proyección sin sus barras.

    `hayMas` solo contaba los primeros, y funcionaba por casualidad: mientras el
    pronóstico estuviera excluido del compacto, siempre sobraba algo. Al darle
    forma compacta dejó de sobrar, y en el Embudo —cuyo único análisis es un
    pronóstico— el botón desapareció mientras la propia tarjeta decía «agranda
    para verlos». Prometía una puerta que ya no existía.
  */
  const ocultos = blocks.length - visibles.length;
  const abreviados = visibles.filter(esAbreviado).length;
  const hayMas = ocultos > 0 || abreviados > 0;

  // El encabezado se separa del cuerpo porque en la hoja ancha tiene que
  // quedarse quieto mientras el cuerpo rueda: con una columna larga de gráficas,
  // un encabezado que se va con el scroll deja al usuario sin saber de qué
  // pantalla es lo que está leyendo ni cómo cerrar.
  const encabezado = (
    <div
      className={cn(
        "flex items-start justify-between gap-3",
        ancho ? "shrink-0 border-b border-border px-5 py-4" : "mb-3",
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          Análisis
          {/* El conteo se repite aquí, y no por adorno: en la hoja ancha el
              botón de la barra queda tapado, así que este es el único sitio
              donde sigue viéndose cuántos hallazgos hay mientras se miran las
              gráficas. */}
          {findings.length > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 font-mono text-[11px] font-normal tabular-nums",
                worst === "risk"
                  ? "bg-destructive/10 text-destructive"
                  : worst === "watch"
                    ? "bg-warning/10 text-warning"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {findings.length}
            </span>
          )}
        </p>
        {data?.label && (
          <p className="truncate text-xs text-muted-foreground">{data.label}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {(hayMas || ancho) && (
          <button
            type="button"
            onClick={() => setAncho((v) => !v)}
            aria-label={ancho ? "Reducir" : "Agrandar"}
            title={ancho ? "Reducir" : "Agrandar"}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {ancho ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={cerrar}
          aria-label="Cerrar"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );

  const cuerpo = (
    <div className={cn(ancho && "min-h-0 flex-1 overflow-auto px-5 py-4")}>
      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Revisando…
        </p>
      )}

      {!loading && visibles.length > 0 && (
        <div className="space-y-5">
          {BLOCK_ORDER.map((kind) => {
            const grupo = visibles.filter((b) => b.kind === kind);
            if (!grupo.length) return null;
            return (
              <section key={kind}>
                {/* El encabezado solo aparece cuando hay más de un tipo:
                    rotular «Requiere atención» sobre la única lista que hay
                    no ordena nada, solo añade una línea. */}
                {ancho && (
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {BLOCK_LABEL[kind]}
                  </h2>
                )}
                <div className="grid gap-3">
                  {grupo.map((b) => (
                    <Bloque key={claveDe(b)} block={b} compact={!ancho} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Sin esto, en compacto no habría forma de saber que hay más: el
              botón de agrandar por sí solo no dice qué se está perdiendo. Y el
              texto distingue los dos casos, porque no son lo mismo: uno son
              análisis que no ves, el otro son gráficas de los que sí ves. */}
          {!ancho && hayMas && (
            <button
              type="button"
              onClick={() => setAncho(true)}
              className="w-full rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {ocultos > 0
                ? `Hay ${ocultos} análisis más con gráficas — agrandar`
                : "Ver las gráficas — agrandar"}
            </button>
          )}
        </div>
      )}

      {/* El vacío no es vacío: es la lista de lo que te cubre. Sin esto, el
          panel enseñaría a no volver a abrirse. */}
      {!loading && blocks.length === 0 && data?.watching.length ? (
        <div>
          <p className="text-sm">Nada que reportar aquí.</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Eye className="size-3.5" /> Vigilando
          </p>
          <ul className="mt-2 space-y-1.5">
            {data.watching.map((w) => (
              <li key={w} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-border" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && blocks.length === 0 && !data?.watching.length && (
        <p className="py-4 text-sm text-muted-foreground">
          En esta pantalla todavía no hay nada que analizar.
        </p>
      )}
    </div>
  );

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          alerting
            ? `Análisis: ${findings.length} ${findings.length === 1 ? "hallazgo" : "hallazgos"}`
            : "Análisis"
        }
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors",
          alerting
            ? worst === "risk"
              ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15"
            : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <span className="relative flex items-center">
          <Sparkles className="size-4" />
          {alerting && (
            <span
              className={cn(
                "absolute -right-1 -top-1 size-1.5 rounded-full ring-2 ring-card",
                worst === "risk" ? "bg-destructive" : "bg-warning",
              )}
            />
          )}
        </span>
        <span className="hidden sm:inline">Análisis</span>
        {findings.length > 0 && (
          <span
            className={cn(
              "rounded-full px-1.5 font-mono text-[11px] tabular-nums",
              alerting ? "bg-current/15" : "bg-border text-muted-foreground",
            )}
          >
            {findings.length}
          </span>
        )}
      </button>

      {open && !ancho && (
        <div
          role="dialog"
          aria-label="Análisis de esta pantalla"
          /*
            El globo NO va por portal —es `absolute` y cuelga del botón, que es
            justo lo que se quiere de un desplegable— pero paga la OTRA mitad
            del problema del `backdrop-blur` de la barra: además de romper el
            bloque contenedor de `fixed` (ver la nota de la hoja ancha, abajo),
            crea un contexto de apilamiento. Este `z-50` compite dentro del
            encabezado, no contra la página.

            Lo que lo saca por delante es el `relative z-30` del propio
            encabezado, en `topbar.tsx`. Sin él, el globo quedaba DEBAJO del
            contenido —se veía con las tarjetas del embudo dibujadas encima del
            texto— y aquí no había nada que lo delatara.
          */
          className="absolute right-0 z-50 mt-2 max-h-[min(32rem,80vh)] w-[min(26rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-border bg-card p-4 shadow-lg"
        >
          {encabezado}
          {cuerpo}
        </div>
      )}

      {/* La hoja ancha se pinta en `document.body` a través de un portal, y eso
          NO es opcional.
       *
       * Vive dentro de la barra superior, que lleva `backdrop-blur`. Un
       * `backdrop-filter` crea bloque contenedor para los descendientes
       * `position: fixed`, así que sin el portal `inset-y-0 right-0` no se
       * resuelve contra la ventana sino contra los 64 px de la barra: la hoja
       * salía como un recuadro colgando del encabezado, con el título y nada
       * más. Si alguien «simplifica» esto de vuelta a un `fixed` en el sitio,
       * el defecto regresa entero. */}
      {open && ancho && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-label="Análisis de esta pantalla"
              className="fixed inset-y-0 right-0 z-50 flex w-[min(42rem,100vw)] flex-col border-l border-border bg-card shadow-2xl duration-200 animate-in slide-in-from-right-8 fade-in"
            >
              {encabezado}
              {cuerpo}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Cada tipo tiene su forma. La clasificación no sirve si todo se ve igual. */
function Bloque({ block, compact }: { block: Block; compact: boolean }) {
  switch (block.kind) {
    case "finding":
      // El hallazgo ya es una línea: no tiene forma compacta que valga.
      return <InsightItem insight={block.insight} />;
    case "projection":
      return <ProjectionCard block={block} compact={compact} />;
    case "trend":
      // La tendencia no entra en compacto —su contenido es la forma de las
      // barras— así que aquí siempre llega en la hoja ancha.
      return <TrendCard block={block} />;
    case "forecast":
      return <ForecastCard block={block} compact={compact} />;
  }
}

function claveDe(b: Block): string {
  return b.kind === "finding" ? b.insight.id : b.id;
}

/**
 * ¿Este bloque enseña MENOS en compacto de lo que tiene?
 *
 * Es lo que distingue «lo estás viendo entero» de «lo estás viendo resumido», y
 * de ahí sale si tiene sentido ofrecer el botón de agrandar. Tiene que coincidir
 * con lo que las tarjetas recortan de verdad —ver `compact` en
 * `assistant-blocks.tsx`—: si se separan, el botón aparece donde no hay nada más
 * que ver, o falta donde sí lo hay.
 */
function esAbreviado(b: Block): boolean {
  // Un pronóstico esconde su serie; con un solo periodo no esconde nada.
  if (b.kind === "forecast") return (b.series?.length ?? 0) > 1;
  // Una proyección enseña el total en vez del reparto por semana… salvo que no
  // tenga total, y entonces ya venía dibujando las barras.
  if (b.kind === "projection") return b.total !== undefined && b.bars.length > 0;
  return false;
}

/** El más grave manda: decide el color del botón y si se enciende el punto. */
function peorTono(insights: Array<{ tone: string }>): string {
  for (const t of ["risk", "watch", "good", "neutral"]) {
    if (insights.some((i) => i.tone === t)) return t;
  }
  return "neutral";
}
