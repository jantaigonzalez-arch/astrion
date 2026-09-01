"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Info, Sparkles } from "lucide-react";
import type { Bar } from "@/lib/ml/blocks-types";
import {
  FORMAS,
  FORMA_LABEL,
  aptitud,
  recomendada,
  type Datos,
  type Forma,
} from "@/lib/ml/formas";
import { cn } from "@/lib/utils";

/**
 * Elegir con qué forma se dibuja un bloque.
 *
 * ── LAS QUE NO SIRVEN SE VEN, Y DICEN POR QUÉ ──────────────────────────────
 *
 * Es la decisión de diseño que sostiene todo lo demás. Un menú que solo lista
 * lo posible deja a quien busca «pastel» sin respuesta: concluye que la función
 * falta, o peor, que el producto es pobre. Enseñarlo apagado sin explicación es
 * igual de malo — un candado gris no se puede discutir.
 *
 * Así que salen las trece, y las que no aplican traen el motivo medido sobre
 * ESTE bloque:
 *
 *   Pastel · no apta
 *   «Estas barras son las mayores, no todas. Un pastel afirmaría que suman
 *    el total, y no es cierto.»
 *
 * Eso es una frase que enseña algo del dato, no una negativa. Y es accionable:
 * si el análisis declarara su total, el pastel se habilitaría solo.
 *
 * ── LA RECOMENDADA VA MARCADA, NO IMPUESTA ─────────────────────────────────
 *
 * Arriba del todo hay una opción «Automática» que es la que traen todos los
 * bloques al nacer, y que sigue a los datos cuando cambian. Las demás son una
 * elección explícita. La diferencia importa: un bloque que hoy son seis
 * categorías y mañana catorce necesita poder cambiar de forma solo, y eso solo
 * pasa mientras nadie haya fijado una.
 *
 * ── POR QUÉ NO ES UN `<select>` ────────────────────────────────────────────
 *
 * Porque un `<option>` no puede llevar un motivo de dos líneas, ni una insignia
 * de «recomendada», ni quedar visible y desactivada con explicación. Todo lo
 * que hace bueno a este menú es justo lo que un desplegable nativo no admite.
 */
export function FormaPicker({
  bars,
  axis,
  total,
  valor,
  onElegir,
}: {
  bars: Bar[];
  axis?: "time";
  total?: number;
  /** La forma fijada, o `null` para automática. */
  valor: Forma | null;
  onElegir: (f: Forma | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const datos: Datos = { bars, axis, total };
  const sugerida = recomendada(datos);

  /*
    Cerrar al pulsar fuera y con Escape.

    Sin esto el menú se queda abierto tapando el bloque de al lado, que es
    justo el que hay que mirar para decidir. Se registra solo mientras está
    abierto: un oyente global permanente por cada bloque de un tablero de
    quince son quince oyentes para nada.
  */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const aptas = FORMAS.filter((f) => aptitud(datos, f).apta).length;
  const actual = valor ? FORMA_LABEL[valor] : `Automática · ${FORMA_LABEL[sugerida]}`;

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        title="Cambiar el tipo de gráfica"
        className={cn(
          "flex h-7 max-w-52 items-center gap-1.5 rounded-md border border-border bg-background",
          "px-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        )}
      >
        <span className="truncate">{actual}</span>
        <ChevronDown className="size-3 shrink-0" />
      </button>

      {abierto && (
        <div
          role="listbox"
          className={cn(
            "absolute right-0 z-30 mt-1 w-80 overflow-hidden rounded-lg border border-border",
            "bg-popover shadow-xl",
          )}
        >
          <div className="max-h-[26rem] overflow-y-auto p-1">
            <Opcion
              titulo="Automática"
              detalle={`Ahora mismo: ${FORMA_LABEL[sugerida]}. Cambia sola si cambian los datos.`}
              elegida={valor === null}
              recomendada
              onClick={() => {
                onElegir(null);
                setAbierto(false);
              }}
            />

            <div className="my-1 border-t border-border" />

            {FORMAS.map((f) => {
              const ap = aptitud(datos, f);
              return (
                <Opcion
                  key={f}
                  titulo={FORMA_LABEL[f]}
                  detalle={ap.apta ? undefined : ap.motivo}
                  noApta={!ap.apta}
                  elegida={valor === f}
                  onClick={() => {
                    if (!ap.apta) return;
                    onElegir(f);
                    setAbierto(false);
                  }}
                />
              );
            })}
          </div>

          {/* El recuento explica de un vistazo por qué hay tantas apagadas, y
              evita la lectura de «está roto». */}
          <p className="border-t border-border bg-secondary/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {aptas} de {FORMAS.length} sirven para estos datos. Las demás dicen qué
            les falta.
          </p>
        </div>
      )}
    </div>
  );
}

function Opcion({
  titulo,
  detalle,
  elegida,
  noApta,
  recomendada: esRecomendada,
  onClick,
}: {
  titulo: string;
  detalle?: string;
  elegida: boolean;
  noApta?: boolean;
  recomendada?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={elegida}
      // `disabled` no: una opción deshabilitada queda fuera del tabulador y su
      // motivo se vuelve inalcanzable con teclado, que es justo a quien más le
      // sirve leerlo. Se deja enfocable y el `onClick` no hace nada.
      aria-disabled={noApta}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        noApta ? "cursor-default" : "hover:bg-secondary",
        elegida && "bg-secondary",
      )}
    >
      <span className="mt-0.5 w-3.5 shrink-0">
        {elegida && <Check className="size-3.5 text-primary" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-xs font-medium",
              noApta ? "text-muted-foreground/70" : "text-foreground",
            )}
          >
            {titulo}
          </span>
          {esRecomendada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
              <Sparkles className="size-2.5" /> recomendada
            </span>
          )}
          {noApta && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              no apta
            </span>
          )}
        </span>

        {detalle && (
          <span className="mt-0.5 flex gap-1 text-[11px] leading-snug text-muted-foreground">
            {noApta && <Info className="mt-px size-3 shrink-0" />}
            <span>{detalle}</span>
          </span>
        )}
      </span>
    </button>
  );
}
