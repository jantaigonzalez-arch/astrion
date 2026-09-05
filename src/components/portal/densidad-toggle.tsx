"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Rows3 } from "lucide-react";
import {
  DENSIDADES,
  DENSIDAD_AYUDA,
  DENSIDAD_COOKIE,
  DENSIDAD_LABEL,
  type Densidad,
} from "@/lib/densidad";
import { cn } from "@/lib/utils";

/**
 * Elegir cuánto respiran las tablas.
 *
 * ── EN LA BARRA SUPERIOR Y NO EN CADA TABLA ───────────────────────────────
 *
 * Porque la preferencia es de la persona, no de la pantalla: quien opera todo
 * el día en compacta la quiere compacta en Tickets, en Compras y en Cuentas por
 * pagar. Un control por tabla obligaría a repetir la misma decisión en cada
 * módulo y garantizaría que acabaran distintas — que es exactamente el estado
 * del que se viene.
 *
 * Sitio fijo, junto al tema y al asistente, por la misma razón que ellos: lo
 * que está siempre en el mismo lugar se vuelve costumbre.
 *
 * ── SE APLICA AL INSTANTE, SIN RECARGAR ───────────────────────────────────
 *
 * El atributo se escribe en la raíz del documento y el CSS reacciona solo. La
 * cookie es para la PRÓXIMA carga: el servidor la lee y pinta ya con la
 * densidad correcta, así que no hay parpaseo. Es la misma pareja de gestos que
 * usa el ancho de la barra lateral.
 */
export function DensidadToggle({ inicial }: { inicial: Densidad }) {
  const [valor, setValor] = useState<Densidad>(inicial);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  /*
    La elección se SINCRONIZA con dos sistemas externos, y por eso va en un
    efecto: el atributo de la raíz —que es de lo que cuelga el CSS de las
    tablas— y la cookie que leerá el servidor en la próxima carga.

    Escribir el DOM dentro del manejador del clic sería más directo y es
    justamente lo que la regla de inmutabilidad de React desaconseja: fuera del
    ciclo de render, nada garantiza el orden respecto al repintado. Aquí el
    efecto es la herramienta correcta y no un rodeo — «actualizar un sistema
    externo con el último estado de React» es su definición.

    Corre también al montar, con el valor que vino del servidor. No estorba y
    tiene un efecto útil: renueva el año de vigencia de la cookie cada vez que
    se usa el sistema, así que la preferencia no caduca por dejar de entrar
    unos meses.
  */
  useEffect(() => {
    document.documentElement.dataset.densidad = valor;
    document.cookie = `${DENSIDAD_COOKIE}=${valor}; path=/; max-age=31536000; samesite=lax`;
  }, [valor]);

  function elegir(d: Densidad) {
    setValor(d);
    setAbierto(false);
  }

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={`Densidad de las tablas: ${DENSIDAD_LABEL[valor]}`}
        aria-expanded={abierto}
        className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Rows3 className="size-[18px]" />
      </button>

      {abierto && (
        <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl">
          <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
            Densidad de las tablas
          </p>
          {DENSIDADES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => elegir(d)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary",
                d === valor && "bg-secondary/60",
              )}
            >
              <Check
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  d === valor ? "text-primary" : "text-transparent",
                )}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{DENSIDAD_LABEL[d]}</span>
                <span className="block text-xs text-muted-foreground">
                  {DENSIDAD_AYUDA[d]}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
