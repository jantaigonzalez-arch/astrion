"use client";

import { useState } from "react";
import { GripVertical, Plus, Search, Undo2, X } from "lucide-react";
import type { Bar, Block } from "@/lib/ml/blocks-types";
import { recomendada } from "@/lib/ml/formas";
import { SERIE, SERIE_ALERTA } from "@/components/portal/purchasing/chart-palette";
import { cn } from "@/lib/utils";

export type HerramientaItem = {
  id: string;
  label: string;
  kind: string;
  watching: string[];
  /** Cuántos bloques produce hoy. Cero = configurado pero sin nada que decir. */
  piezas: number;
  /**
   * Lo que este análisis enseña HOY, ya resuelto en el servidor.
   *
   * Es el MISMO array que el compositor pinta al soltar el bloque: llega hasta
   * aquí desde `componer/page.tsx`, que resuelve todo el catálogo de una vez.
   * Antes se recibía y se tiraba —solo sobrevivía su `.length`, como `piezas`—
   * y la tarjeta se quedaba en tres líneas de texto. Dibujarlo no cuesta una
   * consulta más: el dato ya estaba en el cliente.
   */
  preview: Block[];
};

const KIND_LABEL: Record<string, string> = {
  finding: "Requiere atención",
  projection: "Lo que viene",
  trend: "Cómo viene",
  forecast: "Lo que estima un modelo",
};

/**
 * Lo que se puede poner en el tablero: la última sección del panel.
 *
 * ── ACOPLADA AL COSTADO, NO ENCIMA ─────────────────────────────────────────
 *
 * El panel de Análisis de la barra superior es una superposición que tapa el
 * contenido, y para leer está bien. Esto no puede serlo: de aquí se ARRASTRA
 * hacia el tablero, así que la caja y el destino tienen que verse a la vez. Una
 * superposición obligaría a cerrarla para soltar, que es justo el gesto que se
 * quiere evitar.
 *
 * Vive dentro del panel del compositor, debajo del nombre y de los módulos, y
 * es la única parte que se desplaza: lo de arriba se decide una vez y esto se
 * recorre. Quien la envuelve es también quien recibe lo que se suelta para
 * quitarlo, porque el destino de ese gesto es el panel entero y no esta lista.
 *
 * ── ESTABA ABAJO Y ESO ERA EL PROBLEMA ─────────────────────────────────────
 *
 * La lista de disponibles vivía al final de la página, después de todos los
 * bloques. Con un tablero de ocho, agregar el noveno exigía recorrer el tablero
 * entero hasta el fondo, y volver a subir para ver dónde cayó. Al costado se
 * ven las dos cosas sin desplazarse.
 *
 * ── DOS SECCIONES, PORQUE SON DOS COSAS ────────────────────────────────────
 *
 * «Disponibles» es lo que existe y nunca estuvo aquí. «Quitados» es lo que
 * alguien apagó, y sigue existiendo a propósito: apagar no es borrar, y esa
 * distinción se perdería si un bloque apagado desapareciera sin dejar rastro.
 */
export function DashboardToolbox({
  disponibles,
  quitados,
  quitando,
  onAgregar,
  onArrastrar,
}: {
  disponibles: HerramientaItem[];
  quitados: HerramientaItem[];
  /** Se está arrastrando algo DESDE el tablero: soltarlo aquí lo quita. */
  quitando: boolean;
  /** Al pulsar «+»: entra al final del tablero, encendido. */
  onAgregar: (id: string, desde: "disponible" | "quitado") => void;
  onArrastrar: (id: string, desde: "disponible" | "quitado" | null) => void;
}) {
  const [q, setQ] = useState("");

  /*
    Busca en el nombre Y en lo que vigila.

    Solo por nombre no serviría para lo que la gente pregunta: quien escribe
    «anticipos» no busca un análisis llamado así —se llama «Avisos de cuentas
    por pagar»— sino el que los vigila. Esa frase está en `watching`, que es
    justo lo que hace la búsqueda útil en vez de decorativa.

    Sin acentos a los dos lados: nadie escribe «rentabilidad» con tilde en un
    campo de búsqueda, y hacer que «utilidad» no encuentre «Utilidad por mes»
    sería una trampa.
  */
  const term = normalizar(q);
  const filtrar = (xs: HerramientaItem[]) =>
    term
      ? xs.filter((a) =>
          normalizar([a.label, ...a.watching].join(" ")).includes(term),
        )
      : xs;

  // Sin memoizar a mano: son listas de veintitantos y el compilador de React ya
  // se encarga. Envolverlo en `useMemo` además le impedía optimizar el
  // componente entero, porque no puede preservar la memoización de una función
  // que devuelve otra función.
  const dispFiltrados = filtrar(disponibles);
  const quitFiltrados = filtrar(quitados);
  const buscando = q.trim().length > 0;
  const nada = buscando && dispFiltrados.length === 0 && quitFiltrados.length === 0;

  return (
    // `min-h-0` con `flex-1`: sin él, un elemento flexible no se deja encoger
    // por debajo de su contenido y la lista desborda el panel en vez de
    // desplazarse dentro.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* El buscador se queda fijo mientras la lista se desplaza: buscar y
          seguir viendo el campo es lo que permite corregir el término sin
          volver arriba. */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar análisis…"
            aria-label="Buscar entre los análisis disponibles"
            className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {buscando && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Limpiar la búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        <p className="px-1 pt-2 text-[11px] leading-snug text-muted-foreground">
          {quitando
            ? "Suelta aquí para quitarlo del tablero."
            : "Arrastra al tablero, o pulsa + para ponerlo al final."}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {nada ? (
          <p className="px-1 text-xs text-muted-foreground">
            Nada coincide con «{q.trim()}». Se busca en el nombre y en lo que
            vigila cada análisis.
          </p>
        ) : (
          <>
            <Seccion
              titulo="Disponibles"
              vacio={
                buscando ? "" : "Ya está todo en el tablero."
              }
              items={dispFiltrados}
              desde="disponible"
              onAgregar={onAgregar}
              onArrastrar={onArrastrar}
            />
            {quitFiltrados.length > 0 && (
              <Seccion
                titulo="Quitados de este tablero"
                ayuda="Siguen existiendo: apagar no es borrar."
                vacio=""
                items={quitFiltrados}
                desde="quitado"
                onAgregar={onAgregar}
                onArrastrar={onArrastrar}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * La forma que va a tener el bloque, en 28 px de alto.
 *
 * ── PARA QUÉ ───────────────────────────────────────────────────────────────
 *
 * La tarjeta decía el TIPO —«Cómo viene»— y no la FORMA. Dos análisis del mismo
 * tipo pueden ser doce barras mensuales o tres categorías, y eso decide si el
 * bloque va a media fila o a fila entera; era justo lo que había que
 * imaginarse antes de arrastrar. Con la miniatura, la decisión de ancho se toma
 * mirando.
 *
 * ── ES UN ADORNO HONESTO, Y POR ESO VA `aria-hidden` ───────────────────────
 *
 * A este tamaño no caben ejes, etiquetas ni valores, y una marca de color sin
 * etiqueta no puede cargar identidad —es la regla que obliga a que las barras
 * de verdad lleven su cifra escrita—. Aquí no la carga: lo que significa cada
 * cosa sigue estando en el texto de al lado (el tipo, qué vigila, cuántas
 * piezas), y esto solo enseña el CONTORNO. Por eso no se anuncia a quien usa
 * lector de pantalla: no añade información, la repetiría peor.
 *
 * No se dibuja para un hallazgo. Un hallazgo es texto —un aviso con su motivo—
 * y no tiene contorno que enseñar; inventarle uno sería dibujar una gráfica que
 * el bloque nunca va a tener.
 */
function Miniatura({ preview }: { preview: Block[] }) {
  const b = preview[0];
  if (!b || b.kind === "finding") return null;

  if (b.kind === "forecast") {
    const serie = [
      ...(b.history ?? []).map((p) => p.value),
      ...(b.series ?? []).map((p) => p.value),
    ];
    // Un pronóstico de un solo caso —«esta visita llevará 5 h»— no tiene serie
    // que dibujar, y dos puntos no hacen una línea legible.
    if (serie.length < 3) return null;
    const corte = (b.history ?? []).length;
    return <Linea valores={serie} corte={corte} />;
  }

  // La MISMA regla que usa la tarjeta de verdad, no una parecida: la miniatura
  // existe para que soltar el bloque no sorprenda, y dos reglas que se parecen
  // acaban divergiendo justo en el caso raro.
  switch (recomendada(b)) {
    case "ranking":
      return <Tiritas bars={b.bars} />;
    case "linea":
      return <Linea valores={b.bars.map((x) => x.value)} corte={b.bars.length} />;
    default:
      return <Barritas bars={b.bars} />;
  }
}

/** El contorno de un ranking: unas cuantas barras horizontales. */
function Tiritas({ bars }: { bars: Bar[] }) {
  const primeras = bars.slice(0, 4);
  if (primeras.length === 0) return null;
  const max = Math.max(...primeras.map((x) => Math.abs(x.value)), 1);

  return (
    <div className="viz-root mt-2 space-y-1" aria-hidden="true">
      {primeras.map((x) => (
        <div key={x.key} className="h-1 w-full overflow-hidden rounded-full"
          style={{ background: "var(--viz-track)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(4, (Math.abs(x.value) / max) * 100)}%`,
              background: x.alert ? SERIE_ALERTA : SERIE.a,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** El contorno de unas barras. Apiladas si el bloque lo está. */
function Barritas({ bars }: { bars: Bar[] }) {
  // Las últimas, no las primeras: en una serie temporal lo reciente es lo que
  // dice qué forma tiene ahora, y a este ancho no caben doce sin volverse una
  // trama gris.
  const ultimas = bars.slice(-12);
  if (ultimas.length === 0) return null;
  const max = Math.max(...ultimas.map((x) => x.value + (x.stacked ?? 0)), 1);

  return (
    <div className="viz-root mt-2 flex h-7 items-end gap-px" aria-hidden="true">
      {ultimas.map((x) => {
        const hv = (x.value / max) * 100;
        const hs = ((x.stacked ?? 0) / max) * 100;
        return (
          <div key={x.key} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {hs > 0 && (
              <div
                style={{
                  height: `${Math.max(2, hs)}%`,
                  background: SERIE.b,
                  // El mismo hueco de 2 px que llevan las barras de verdad. Sin
                  // él los dos tramos se leen como uno solo, que es la lectura
                  // que la miniatura tiene que evitar.
                  marginBottom: x.value > 0 ? 2 : 0,
                }}
              />
            )}
            <div
              className="rounded-t-[1px]"
              style={{
                height: `${Math.max(2, hv)}%`,
                background: x.alert ? SERIE_ALERTA : SERIE.a,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * El contorno de una serie, con la frontera entre lo ocurrido y lo estimado.
 *
 * La parte estimada va punteada y no de otro color: la distinción es «esto ya
 * pasó / esto es una estimación», y confiarla a un segundo tono la volvería una
 * serie más. Es la misma frontera que el bloque grande dibuja con su banda.
 */
function Linea({ valores, corte }: { valores: number[]; corte: number }) {
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min || 1;
  const W = 100;
  const H = 28;
  const punto = (v: number, i: number) =>
    `${(i / (valores.length - 1)) * W},${H - ((v - min) / rango) * (H - 4) - 2}`;

  const pasado = valores.slice(0, Math.max(corte, 0)).map(punto);
  // El primer punto estimado se repite en las dos líneas: sin ese solape queda
  // un hueco justo en la frontera, que es donde peor se ve.
  const futuro = valores.slice(Math.max(corte - 1, 0)).map((v, i) => punto(v, i + Math.max(corte - 1, 0)));

  return (
    <svg
      className="viz-root mt-2 h-7 w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {pasado.length > 1 && (
        <polyline
          points={pasado.join(" ")}
          fill="none"
          stroke={SERIE.a}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {futuro.length > 1 && (
        <polyline
          points={futuro.join(" ")}
          fill="none"
          stroke={SERIE.a}
          strokeWidth="2"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/** Minúsculas y sin acentos, a los dos lados de la comparación. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function Seccion({
  titulo,
  ayuda,
  vacio,
  items,
  desde,
  onAgregar,
  onArrastrar,
}: {
  titulo: string;
  ayuda?: string;
  vacio: string;
  items: HerramientaItem[];
  desde: "disponible" | "quitado";
  onAgregar: (id: string, desde: "disponible" | "quitado") => void;
  onArrastrar: (id: string, desde: "disponible" | "quitado" | null) => void;
}) {
  if (items.length === 0 && !vacio) return null;

  return (
    <div>
      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      {ayuda && <p className="px-1 pt-0.5 text-[11px] text-muted-foreground">{ayuda}</p>}

      {items.length === 0 ? (
        // Sin texto que poner, la sección entera desaparece: un encabezado
        // «Disponibles» sobre nada es peor que no estar, y al buscar pasa
        // seguido —lo que coincide suele estar en una sola de las dos.
        vacio ? <p className="px-1 pt-2 text-xs text-muted-foreground">{vacio}</p> : null
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              draggable
              onDragStart={(e) => {
                onArrastrar(a.id, desde);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.id);
              }}
              onDragEnd={() => onArrastrar(a.id, null)}
              className={cn(
                "group flex cursor-grab items-start gap-2 rounded-lg border border-border",
                "bg-background p-2.5 transition-colors hover:border-primary/50 active:cursor-grabbing",
              )}
            >
              <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-snug">{a.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {KIND_LABEL[a.kind] ?? a.kind}
                  {/* Cuántos bloques trae HOY. Un análisis configurado que hoy
                      no encuentra nada se puede colocar igual —mañana dirá
                      algo— pero quien compone tiene que saber que ahora mismo
                      no va a ver nada aparecer. */}
                  {a.piezas === 0 && " · hoy sin datos"}
                </p>
                {/* Qué vigila, no solo su nombre: poner «Avisos de compras» sin
                    saber que ahí van las refacciones en falta es poner algo a
                    ciegas. Una sola línea, que la caja es angosta. */}
                {a.watching[0] && (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                    · {a.watching[0]}
                  </p>
                )}
                {/* Debajo del texto y no al lado: a lo ancho competiría con el
                    nombre, que es lo primero que se lee. */}
                <Miniatura preview={a.preview} />
              </div>
              <button
                type="button"
                onClick={() => onAgregar(a.id, desde)}
                title={desde === "quitado" ? "Volver a poner" : "Agregar al final"}
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              >
                {desde === "quitado" ? (
                  <Undo2 className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
