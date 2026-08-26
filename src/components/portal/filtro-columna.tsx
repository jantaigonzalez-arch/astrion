"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListFilter, Search } from "lucide-react";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { filtroHref, type OpcionFiltro } from "@/lib/listado";

/**
 * El filtro de una columna, desplegable desde su encabezado.
 *
 * ── QUÉ SUSTITUYE Y POR QUÉ ────────────────────────────────────────────────
 *
 * Los filtros vivían en una barra sobre la tabla, una ficha por valor posible.
 * Con cuatro dimensiones eso eran veintidós fichas en dos filas —más alto que
 * cinco filas de datos— y encima repetían lo que las columnas ya decían:
 * «Categoría» aparecía como grupo de fichas arriba y como columna abajo.
 *
 * Aquí el filtro está DONDE ESTÁ EL DATO. La columna que se quiere acotar es la
 * que se pulsa, no hay que buscar su grupo en una barra, y la tabla recupera el
 * espacio vertical. Es lo que hace cualquier hoja de cálculo, y por eso no hay
 * que explicarlo.
 *
 * ── SIGUE SIENDO UN ENLACE ─────────────────────────────────────────────────
 *
 * Lo único que este componente añade al cliente es ABRIR y CERRAR. Cada opción
 * es un `<Link>` a la misma URL que generaba la ficha, así que la vista se
 * sigue pudiendo compartir, marcar y recargar, y el botón de atrás deshace el
 * filtro. El estado del filtro no vive aquí: vive en la dirección.
 *
 * ── POR QUÉ EL PANEL VA EN UN PORTAL ───────────────────────────────────────
 *
 * La tabla vive dentro de un `overflow-x-auto` para poder desplazarse en
 * pantallas estrechas, y ese contenedor RECORTA lo que se salga. Un panel
 * absoluto dentro del encabezado se vería cortado por el borde de la tabla
 * —o peor, forzaría una barra de desplazamiento horizontal al abrirse—. Se
 * dibuja en el `body` con posición fija, calculada desde el botón.
 */
export function FiltroColumna({
  titulo,
  clave,
  opciones,
  activo,
  basePath,
  query,
}: {
  /** Lo que se está filtrando, para el encabezado del panel. */
  titulo: string;
  clave: string;
  opciones: OpcionFiltro[];
  activo: string | undefined;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Las opciones vacías no se ofrecen, salvo la que está puesta. Misma regla
  // que tenían las fichas: un valor con cero es un camino a una lista vacía.
  const visibles = opciones.filter(
    (o) => o.n === undefined || o.n > 0 || (o.valor ?? undefined) === activo,
  );

  const term = busqueda.trim().toLowerCase();
  const filtradas = term
    ? visibles.filter((o) => o.label.toLowerCase().includes(term))
    : visibles;

  /*
    La posición se calcula ANTES de pintar, no después.

    Con `useEffect` el panel aparecía un fotograma en la esquina superior
    izquierda y saltaba a su sitio. `useLayoutEffect` corre antes de que el
    navegador dibuje, así que nace colocado.
  */
  useLayoutEffect(() => {
    if (!abierto || !boton.current) return;
    const r = boton.current.getBoundingClientRect();
    // Se alinea por la DERECHA del botón y se corrige si eso lo sacaría de la
    // ventana: las últimas columnas de una tabla ancha están pegadas al borde.
    const ancho = 240;
    const left = Math.min(Math.max(8, r.right - ancho), window.innerWidth - ancho - 8);
    setPos({ top: r.bottom + 4, left });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;

    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !boton.current?.contains(t)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    // Al desplazar, el panel se quedaría flotando lejos de su columna: como su
    // posición es fija y se calculó una vez, seguir al botón exigiría
    // recalcular en cada fotograma. Cerrar es más honesto y más barato.
    const mover = () => setAbierto(false);

    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", mover);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", mover);
    };
  }, [abierto]);

  const puesto = activo !== undefined;

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => {
          setBusqueda("");
          setAbierto((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={puesto ? `Filtro de ${titulo} activo` : `Filtrar por ${titulo}`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors",
          puesto
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground/40 hover:bg-secondary hover:text-foreground",
          abierto && "bg-secondary text-foreground",
        )}
      >
        <ListFilter className="size-3" aria-hidden="true" />
      </button>

      {abierto &&
        pos &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: 240 }}
            className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          >
            <p className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {titulo}
            </p>

            {/* El buscador aparece cuando la lista deja de leerse de un vistazo.
                Con seis técnicos sobra; con veinticuatro laboratorios, no. */}
            {visibles.length > 8 && (
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto py-1">
              {filtradas.map((o) => {
                const marcado = (o.valor ?? undefined) === activo;
                return (
                  <Link
                    key={o.valor ?? "todos"}
                    href={filtroHref(basePath, clave, o.valor, query)}
                    role="menuitem"
                    onClick={() => setAbierto(false)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-secondary",
                      marcado && "font-medium text-foreground",
                    )}
                  >
                    <Check
                      className={cn(
                        "size-3 shrink-0",
                        marcado ? "opacity-100 text-primary" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.n !== undefined && (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {o.n}
                      </span>
                    )}
                  </Link>
                );
              })}
              {filtradas.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Nada coincide con «{busqueda}».
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
