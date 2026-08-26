"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Direccion } from "@/lib/listado";

/**
 * Ordenar una lista que YA está entera en el navegador.
 *
 * El hermano de cliente de `ThOrden`, y existe porque hay dos clases de listado
 * en el portal y ordenarlas igual sería un error en una de las dos:
 *
 *   · La cola de servicio se pagina en la base. Ahí el orden TIENE que decidirse
 *     en SQL: ordenar las 25 filas que llegaron ordena la página, no la lista,
 *     y el ticket más urgente se queda escondido en la página nueve.
 *
 *   · Clientes, organizaciones y refacciones se traen completos y se filtran en
 *     memoria —con su buscador, ya escrito—. Ahí no hay página que mentir: lo
 *     que se ordena es todo lo que hay, y hacerlo en el navegador es instantáneo
 *     y no vuelve al servidor por cada clic.
 *
 * Cuando alguno de esos listados crezca hasta necesitar paginación, la señal de
 * que hay que moverlo a SQL es justamente que deje de poder usar esto.
 *
 * ── LA COMPARACIÓN NO ES `a > b` ───────────────────────────────────────────
 *
 * Los nombres se comparan con `localeCompare` en español: sin eso «Ávila» cae
 * después de «Zúñiga» porque su código de carácter es mayor, y en un padrón de
 * laboratorios mexicanos eso se nota a la primera pantalla.
 */

export type Comparable = string | number | Date | null | undefined;

/**
 * El estado del orden y la lista ya ordenada.
 *
 * `valores` dice cómo sacar el valor de cada columna. Se pasa como objeto y no
 * como función suelta para que el nombre de la columna y su valor vivan juntos:
 * es lo que impide que el encabezado diga «Equipos» y ordene por tickets.
 */
export function useOrdenLocal<T, K extends string>(
  filas: T[],
  valores: Record<K, (fila: T) => Comparable>,
  inicial: { campo: K; dir: Direccion },
) {
  const [orden, setOrden] = useState(inicial);

  const ordenadas = useMemo(() => {
    const saca = valores[orden.campo];
    if (!saca) return filas;
    const signo = orden.dir === "asc" ? 1 : -1;

    return [...filas].sort((a, b) => {
      const va = saca(a);
      const vb = saca(b);

      // Lo vacío al final SIEMPRE, se ordene hacia donde se ordene. Un cliente
      // sin último servicio no es «el más antiguo»: es uno del que no se sabe,
      // y mezclarlo con fechas reales inventa un dato.
      const na = va === null || va === undefined || va === "";
      const nb = vb === null || vb === undefined || vb === "";
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;

      if (typeof va === "number" && typeof vb === "number") return (va - vb) * signo;
      if (va instanceof Date && vb instanceof Date) {
        return (va.getTime() - vb.getTime()) * signo;
      }
      return String(va).localeCompare(String(vb), "es", { sensitivity: "base" }) * signo;
    });
  }, [filas, orden, valores]);

  /** Pulsar la columna activa invierte; pulsar otra arranca por su dirección. */
  const pulsar = (campo: K, inicialDir: Direccion = "asc") =>
    setOrden((o) =>
      o.campo === campo
        ? { campo, dir: o.dir === "asc" ? "desc" : "asc" }
        : { campo, dir: inicialDir },
    );

  return { orden, pulsar, ordenadas };
}

/**
 * «Ordenar por» en fichas, para listas de tarjetas que viven en el navegador.
 *
 * El cuarto y último control de la familia. Los cuatro existen porque hay dos
 * ejes independientes —dónde se decide el orden (base o navegador) y cómo se
 * dibuja la lista (tabla o tarjetas)— y las cuatro combinaciones se dan de
 * verdad en el portal. Lo que comparten es el dibujo y la convención de la
 * flecha, para que se aprendan una sola vez.
 */
export function OrdenChipsLocal<K extends string>({
  campos,
  orden,
  onPulsar,
  titulo = "Ordenar por",
}: {
  campos: Array<{ campo: K; label: string; inicial?: Direccion }>;
  orden: { campo: K; dir: Direccion };
  onPulsar: (campo: K, inicial?: Direccion) => void;
  titulo?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs uppercase tracking-wide text-muted-foreground">
        {titulo}
      </span>
      {campos.map(({ campo, label, inicial = "asc" }) => {
        const activo = orden.campo === campo;
        const Icono = !activo ? ChevronsUpDown : orden.dir === "asc" ? ArrowUp : ArrowDown;
        return (
          <button
            key={campo}
            type="button"
            onClick={() => onPulsar(campo, inicial)}
            aria-pressed={activo}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              activo
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {label}
            <Icono
              className={cn("size-3 shrink-0", activo ? "opacity-100" : "opacity-40")}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Un `<th>` que ordena en el navegador.
 *
 * Mismo dibujo y misma convención que `ThOrden`: la flecha señala cómo está
 * ordenado ahora, no lo que pasaría al pulsar. Que las dos familias de listado
 * se vean y se comporten igual es lo que hace que nadie tenga que aprender dos
 * tablas distintas.
 */
export function ThLocal<K extends string>({
  campo,
  children,
  orden,
  onPulsar,
  inicial = "asc",
  className,
}: {
  campo: K;
  children: React.ReactNode;
  orden: { campo: K; dir: Direccion };
  onPulsar: (campo: K, inicial?: Direccion) => void;
  inicial?: Direccion;
  className?: string;
}) {
  const activo = orden.campo === campo;
  const Icono = !activo ? ChevronsUpDown : orden.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={cn("px-4 py-3 font-medium", className)}
      aria-sort={activo ? (orden.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onPulsar(campo, inicial)}
        className={cn(
          "group inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wide transition-colors hover:text-foreground",
          activo && "text-foreground",
        )}
        title={activo ? "Cambiar el sentido del orden" : "Ordenar por esta columna"}
      >
        {children}
        <Icono
          className={cn(
            "size-3 shrink-0 transition-opacity",
            activo ? "opacity-100" : "opacity-30 group-hover:opacity-70",
          )}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}
