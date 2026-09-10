"use client";

import { useEffect, useRef, useState } from "react";
import { Columns3, Check } from "lucide-react";

/**
 * ELEGIR QUÉ COLUMNAS SE VEN, Y QUE SE QUEDE.
 *
 * ── SE MONTA SOBRE LO QUE YA EXISTE ───────────────────────────────────────
 *
 * Usa exactamente el mecanismo de `anchos-de-columna`: una hoja de estilo
 * propia en `<head>` con reglas `table[data-tabla="x"] th:nth-child(N)`. No se
 * inyecta un solo nodo en el árbol que dibuja React, y esa regla no es
 * estética: la primera versión de los anchos metía elementos dentro de los
 * `<th>` y costó un error de hidratación —React encontraba nodos que su árbol
 * no tenía y regeneraba la rama entera—.
 *
 * Ocultar una columna es `display: none` sobre su `th` y sus `td`. La tabla que
 * React dibuja queda intacta; lo que cambia es la hoja que la pinta.
 *
 * ── LOS NOMBRES SALEN DE LA PROPIA TABLA ──────────────────────────────────
 *
 * Se leen del texto de cada `<th>` al montar, no de una lista escrita aquí. Una
 * segunda lista es una lista que se desincroniza: se añade una columna, nadie
 * actualiza el selector, y aparece «Columna 7» o —peor— se oculta la que no
 * era. Es el mismo criterio con el que `probe-enlaces` deriva las rutas del
 * árbol de `app` y `scripts/tenant.ts` deriva sus tablas de las migraciones.
 *
 * ── POR OMISIÓN SE VEN TODAS ──────────────────────────────────────────────
 *
 * Y es deliberado, aunque la tabla no quepa. Esconder columnas de entrada sería
 * decidir por alguien qué le importa, y hacerlo en silencio: quien no encuentre
 * un dato no va a suponer que el sistema se lo escondió. La tabla que no cabe
 * ya se desplaza —con su barra a la vista, que en `globals.css` está anotado
 * como decisión y no como descuido— y este selector es el control para quien
 * quiera menos.
 */

const CLAVE = (tabla: string) => `evo:columnas:${tabla}`;
const HOJA = (tabla: string) => `evo-columnas-${tabla}`;

/** Solo identificadores en minúscula: es un `data-tabla` que escribimos nosotros. */
const NOMBRE_VALIDO = /^[a-z][a-z0-9-]*$/;

/**
 * Las reglas de ocultado, como texto CSS.
 *
 * Exportada para poder comprobarla desde un probe sin montar un navegador: es
 * la parte de este archivo donde vive la decisión, igual que `reglasDeAncho`.
 *
 * `nth-child` es 1-basado, así que el índice 0 de la primera columna se escribe
 * como `nth-child(1)`. Equivocarse ahí oculta la columna de al lado, que es un
 * fallo silencioso y desconcertante.
 */
export function reglasDeColumnas(tabla: string, ocultas: number[]): string {
  if (!NOMBRE_VALIDO.test(tabla) || ocultas.length === 0) return "";
  return ocultas
    .filter((i) => Number.isInteger(i) && i >= 1)
    .map(
      (i) =>
        `table[data-tabla="${tabla}"] th:nth-child(${i + 1}),` +
        `table[data-tabla="${tabla}"] td:nth-child(${i + 1}){display:none}`,
    )
    .join("\n");
}

function leer(tabla: string): number[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE(tabla));
    if (!crudo) return [];
    const v = JSON.parse(crudo) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1);
  } catch {
    // Modo privado o almacenamiento bloqueado: se ven todas, que es lo de
    // antes. Se pierde el recuerdo, no la tabla.
    return [];
  }
}

function guardar(tabla: string, ocultas: number[]) {
  try {
    window.localStorage.setItem(CLAVE(tabla), JSON.stringify(ocultas));
  } catch {
    /* Ver `leer`. */
  }
}

export function ColumnasVisibles({ tabla }: { tabla: string }) {
  const [nombres, setNombres] = useState<string[]>([]);
  const [ocultas, setOcultas] = useState<number[]>([]);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  /*
    Lo guardado se lee al montar, porque el número del botón («8/12») lo
    necesita antes de que nadie abra nada.

    Es un `setState` dentro de un efecto y el linter lo señala. Es inevitable
    para un dato que solo existe en el navegador: en el servidor no hay
    `localStorage`, y leerlo durante el render daría un árbol distinto al que
    llegó del servidor — el error de hidratación. Es el mismo patrón que ya usa
    el interruptor de tema.
  */
  useEffect(() => {
    setOcultas(leer(tabla));
  }, [tabla]);

  /*
    LOS NOMBRES SE LEEN AL ABRIR, no al montar.

    Consultar el DOM en cada carga de la pantalla para rellenar un panel que
    casi nadie abre es trabajo pagado por todos para el beneficio de uno. Y
    hacerlo aquí, en un manejador de evento, evita el segundo `setState` dentro
    de un efecto.

    Se releen cada vez: si alguien ordenó o filtró, las cabeceras siguen siendo
    las mismas, pero si algún día una tabla cambia de columnas según el rol, lo
    leído en el momento de abrir es lo que hay.
  */
  const abrir = () => {
    if (!abierto) {
      const t = document.querySelector<HTMLTableElement>(`table[data-tabla="${tabla}"]`);
      setNombres(
        t
          ? Array.from(t.querySelectorAll("thead th")).map(
              (th, i) => (th.textContent ?? "").trim() || `Columna ${i + 1}`,
            )
          : [],
      );
    }
    setAbierto((v) => !v);
  };

  /* La hoja de estilo, creada una vez y reescrita en cada cambio. */
  useEffect(() => {
    if (!NOMBRE_VALIDO.test(tabla)) return;
    let hoja = document.getElementById(HOJA(tabla)) as HTMLStyleElement | null;
    if (!hoja) {
      hoja = document.createElement("style");
      hoja.id = HOJA(tabla);
      document.head.appendChild(hoja);
    }
    hoja.textContent = reglasDeColumnas(tabla, ocultas);
  }, [tabla, ocultas]);

  /* Cerrar al pulsar fuera: un panel que solo cierra con su botón se queda abierto. */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const alternar = (i: number) => {
    const siguiente = ocultas.includes(i) ? ocultas.filter((x) => x !== i) : [...ocultas, i];
    setOcultas(siguiente);
    guardar(tabla, siguiente);
  };

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={abrir}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary"
        aria-expanded={abierto}
      >
        <Columns3 className="size-3.5" />
        Columnas
        {/* Cuántas hay escondidas, a la vista. Sin esto, quien vuelva mañana no
            recuerda que ocultó tres y busca un dato que el sistema le quitó. */}
        {/* Cuántas se ocultaron. El total solo se sabe con el panel abierto
            —los nombres se leen entonces—, así que antes se enseña el número de
            ocultas a secas, que es el dato que importa: que hay algo escondido. */}
        {ocultas.length > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-[11px] text-primary">
            {nombres.length ? `${nombres.length - ocultas.length}/${nombres.length}` : `−${ocultas.length}`}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-xl">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Qué columnas se ven en esta tabla
          </p>
          <ul className="max-h-80 overflow-y-auto">
            {nombres.map((n, i) => {
              const visible = !ocultas.includes(i);
              /*
                La primera no se puede ocultar: es la identidad de la fila. Una
                tabla sin la columna que dice de quién es cada renglón no es una
                tabla más estrecha, es una tabla ilegible.
              */
              const fija = i === 0;
              return (
                <li key={n + i}>
                  <button
                    type="button"
                    disabled={fija}
                    onClick={() => alternar(i)}
                    className={[
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      fija ? "cursor-default opacity-60" : "hover:bg-secondary",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        visible ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      ].join(" ")}
                    >
                      {visible && <Check className="size-3" />}
                    </span>
                    <span className="truncate">{n}</span>
                    {fija && <span className="ml-auto text-[11px] text-muted-foreground">fija</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {ocultas.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setOcultas([]);
                guardar(tabla, []);
              }}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-primary hover:bg-secondary"
            >
              Ver todas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
