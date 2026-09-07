"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, X } from "lucide-react";

/**
 * CONFIGURAR LA DESCARGA ANTES DE BAJARLA.
 *
 * ── POR QUÉ UNA VENTANA Y NO MÁS BOTONES ───────────────────────────────────
 *
 * Elegir columnas es una decisión con veinte opciones. En un menú desplegable no
 * cabe, y en la propia pantalla estorbaría a quien solo quiere trabajar. Una
 * ventana modal es el sitio donde una decisión con varias partes se toma entera
 * y de una vez, sin perder de vista lo que se estaba haciendo.
 *
 * ── `<dialog>` NATIVO ──────────────────────────────────────────────────────
 *
 * `showModal()` trae gratis lo que un modal casero casi nunca reconstruye
 * entero: el foco atrapado dentro —tabular no se escapa a la página de atrás—,
 * el cierre con Esc, el fondo inerte para el lector de pantalla, y la capa
 * superior del navegador, que es la única forma de no pelearse para siempre con
 * los `z-index` de la barra lateral. Es la regla 3 del agente de diseño: se sale
 * de lo nativo cuando hay un problema medido, y aquí no lo hay.
 *
 * ── LA DESCARGA ES UN ENLACE, NO UN `fetch` ────────────────────────────────
 *
 * Se navega a la URL armada y el navegador hace lo suyo. Con `fetch` habría que
 * recibir el archivo en memoria, construir un blob y simular un clic — más
 * código para acabar en el mismo sitio, y perdiendo la barra de progreso nativa
 * y la reanudación. Además, así el 413 del tope se ve como lo que es.
 */

export type ColumnaOpcion = { llave: string; titulo: string };

export function DescargarDialogo({
  dataset,
  columnas,
  query = {},
  etiquetas = {},
}: {
  dataset: string;
  /** Las columnas del dataset, ya con su llave. Ver `llaveDeColumna`. */
  columnas: ColumnaOpcion[];
  /** Los filtros de la pantalla, tal como los arma `queryLimpia`. */
  query?: Record<string, string | undefined>;
  /** Cómo se lee cada filtro: `{ estado: "Estado", open: "Abierto" }`. */
  etiquetas?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [formato, setFormato] = useState<"xlsx" | "csv">("xlsx");
  const [soloFiltrado, setSoloFiltrado] = useState(true);
  const [elegidas, setElegidas] = useState<string[]>(() =>
    columnas.map((c) => c.llave),
  );

  // `showModal()` no se puede llamar en el render: es un efecto sobre el DOM.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  const filtros = Object.entries(query).filter(([, v]) => v);
  const hayFiltros = filtros.length > 0;
  const nombre = (k: string) => etiquetas[k] ?? k;
  const valor = (v: string) => etiquetas[v] ?? v;

  const params = new URLSearchParams();
  params.set("formato", formato);
  // Solo se manda `cols` cuando la persona quitó alguna: sin el parámetro van
  // todas, y así el enlace queda corto y legible en el caso normal.
  if (elegidas.length < columnas.length) params.set("cols", elegidas.join(","));
  if (!soloFiltrado) params.set("todo", "1");
  else for (const [k, v] of filtros) params.set(k, v!);
  const url = `/api/export/${dataset}?${params}`;

  const todas = () => setElegidas(columnas.map((c) => c.llave));
  const ninguna = () => setElegidas([]);
  const alternar = (llave: string) =>
    setElegidas((prev) =>
      prev.includes(llave) ? prev.filter((x) => x !== llave) : [...prev, llave],
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Download className="size-4" />
        Descargar
      </button>

      <dialog
        ref={ref}
        // `close` también lo dispara Esc y el clic en el fondo: sincronizar el
        // estado aquí evita que el botón deje de abrir a la segunda.
        onClose={() => setAbierto(false)}
        onClick={(e) => {
          // Clic en el fondo —el propio `<dialog>`, no su contenido— cierra.
          if (e.target === ref.current) setAbierto(false);
        }}
        className="w-[min(32rem,92vw)] rounded-xl border border-border bg-popover p-0 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-semibold">Descargar</h2>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* ── Formato ── */}
          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Formato
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["xlsx", FileSpreadsheet, "Excel", "Fechas e importes con su tipo"],
                  ["csv", FileText, "CSV", "Para otro sistema o un script"],
                ] as const
              ).map(([f, Icono, titulo, pie]) => (
                <label
                  key={f}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${
                    formato === f
                      ? "border-primary bg-primary/[0.04]"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="formato"
                    checked={formato === f}
                    onChange={() => setFormato(f)}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icono className="size-3.5" />
                      {titulo}
                    </span>
                    <span className="block text-xs text-muted-foreground">{pie}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* ── Qué filas ── */}
          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Qué filas
            </legend>
            {hayFiltros ? (
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm hover:bg-muted">
                  <input
                    type="radio"
                    name="filas"
                    checked={soloFiltrado}
                    onChange={() => setSoloFiltrado(true)}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    <span className="font-medium">Lo que estoy viendo</span>
                    {/*
                      Los filtros se enseñan, no se resumen en «con filtros».
                      Quien va a mandar este archivo a otra persona necesita
                      saber qué recorte lleva dentro; «3 filtros» no lo dice.
                    */}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {filtros.map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {nombre(k)}: <span className="text-foreground">{valor(v!)}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm hover:bg-muted">
                  <input
                    type="radio"
                    name="filas"
                    checked={!soloFiltrado}
                    onChange={() => setSoloFiltrado(false)}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    <span className="font-medium">Todo el módulo</span>
                    <span className="block text-xs text-muted-foreground">
                      Sin los filtros que tienes puestos.
                    </span>
                  </span>
                </label>
              </div>
            ) : (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                No tienes filtros puestos: se descarga todo el módulo. Filtra en
                la pantalla y vuelve aquí para acotar.
              </p>
            )}
          </fieldset>

          {/* ── Columnas ── */}
          <fieldset>
            <div className="mb-2 flex items-center justify-between">
              <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Columnas · {elegidas.length} de {columnas.length}
              </legend>
              <span className="flex gap-2 text-xs">
                <button type="button" onClick={todas} className="text-primary hover:underline">
                  Todas
                </button>
                <button type="button" onClick={ninguna} className="text-primary hover:underline">
                  Ninguna
                </button>
              </span>
            </div>
            <div className="grid gap-0.5 rounded-lg border border-border p-2 sm:grid-cols-2">
              {columnas.map((c) => (
                <label
                  key={c.llave}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={elegidas.includes(c.llave)}
                    onChange={() => alternar(c.llave)}
                    className="size-4 rounded border-input"
                  />
                  {c.titulo}
                </label>
              ))}
            </div>
            {/*
              El orden de las columnas en el archivo lo decide el dataset, no el
              orden en que se marcaron. Se dice para que nadie intente ordenarlas
              marcándolas en otra secuencia.
            */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Salen en este mismo orden.
            </p>
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          {elegidas.length === 0 ? (
            // Sin columnas no hay archivo. El enlace se apaga aquí y el
            // servidor lo rechaza igual: la pantalla explica, el borde protege.
            <span className="text-sm text-muted-foreground">
              Elige al menos una columna
            </span>
          ) : (
            <a
              href={url}
              download
              onClick={() => setAbierto(false)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Download className="size-4" />
              Descargar {formato === "xlsx" ? "Excel" : "CSV"}
            </a>
          )}
        </div>
      </dialog>
    </>
  );
}
