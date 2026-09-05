"use client";

import { useEffect } from "react";

/**
 * Cambiar el ancho de las columnas arrastrando, y que se quede.
 *
 * ── NO TOCA UN SOLO NODO DEL ÁRBOL DE REACT ───────────────────────────────
 *
 * Y es la lección que costó un error de hidratación. La primera versión metía
 * un `<span>` con el tirador dentro de cada `<th>` y le ponía `position` en el
 * atributo `style`. Esos encabezados los gobierna React: al reconciliar
 * encontraba nodos y atributos que su árbol no tenía, daba la rama por
 * corrompida y la volvía a generar entera —con el aviso en consola de que el
 * HTML del servidor no coincide con el del cliente—.
 *
 * Ahora no se inyecta nada ni se escribe un `style` en ningún elemento suyo:
 *
 *   el tirador  es un pseudo-elemento de CSS. No vive en el DOM, así que React
 *               no puede chocar con él. Recibe eventos de puntero y muestra su
 *               cursor igual que un elemento de verdad.
 *
 *   los anchos  viajan en UNA hoja de estilo propia, metida en `<head>`, con
 *               reglas del tipo `table[data-tabla="x"] th:nth-child(3)`. La
 *               tabla queda intacta: lo que cambia es la hoja que la pinta.
 *
 *   el arrastre se escucha en la tabla, no en cada encabezado, y se decide por
 *               la posición del puntero contra el borde derecho de la celda.
 *
 * La regla general: para dar comportamiento a DOM que dibuja React, se escucha
 * y se pinta desde fuera; lo que no se puede es escribir dentro.
 *
 * ── SE GUARDA POR TABLA Y POR PERSONA ─────────────────────────────────────
 *
 * En `localStorage` y no en cookie, al revés que la densidad, y la diferencia
 * está en quién lo necesita: la densidad la lee el SERVIDOR para pintar ya con
 * el relleno correcto; el ancho lo aplica el navegador sobre una tabla ya
 * dibujada. Mandarlo en cada petición sería pagar peso en todas las cargas
 * para algo que solo se usa aquí.
 *
 * La clave lleva el nombre de la tabla: el ancho que le sirve a alguien en
 * Proveedores no dice nada del que quiere en Cuentas por pagar.
 */

const CLAVE = (tabla: string) => `evo:anchos:${tabla}`;
/** Debajo de esto la columna deja de poder agarrarse: su tirador vive en el borde. */
const MINIMO = 64;
/** Ancho de la zona sensible. El mismo número que el `::after` de `globals.css`. */
const AGARRE = 9;

type Anchos = Record<number, number>;

function leer(tabla: string): Anchos {
  try {
    const crudo = window.localStorage.getItem(CLAVE(tabla));
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Anchos = {};
    for (const [k, ancho] of Object.entries(v as Record<string, unknown>)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && typeof ancho === "number" && ancho >= MINIMO) {
        out[i] = Math.round(ancho);
      }
    }
    return out;
  } catch {
    // Modo privado, almacenamiento bloqueado: la tabla se dibuja con sus anchos
    // naturales, que es exactamente lo de antes. Se pierde el recuerdo, no la
    // tabla.
    return {};
  }
}

function guardar(tabla: string, anchos: Anchos) {
  try {
    window.localStorage.setItem(CLAVE(tabla), JSON.stringify(anchos));
  } catch {
    /* Ver `leer`: no poder recordar no puede romper el arrastre. */
  }
}

/**
 * Las reglas de ancho de una tabla, como texto CSS.
 *
 * `table-layout: fixed` solo cuando hay algo guardado: sin anchos, el reparto
 * automático del navegador es mejor que cualquiera que se pueda calcular aquí.
 * Y con el automático un `width` es apenas una sugerencia — se arrastra la
 * columna y no pasa nada.
 *
 * ── ESTRECHAR TIENE QUE RECORTAR, NO DESBORDAR ────────────────────────────
 *
 * Casi todas las celdas de estos listados llevan `whitespace-nowrap` —un folio
 * o una fecha partidos en dos renglones se leen peor— y una celda que no parte
 * el texto y no lo recorta lo DERRAMA: al estrechar la columna, el nombre largo
 * de un laboratorio se pintaba encima del correo de al lado y las dos columnas
 * quedaban ilegibles a la vez.
 *
 * `overflow: hidden` lo corta y `text-overflow: ellipsis` avisa con los tres
 * puntos de que hay más. Los puntos importan: sin ellos, un nombre recortado
 * parece un nombre corto, y nadie ensancharía la columna para ver el resto.
 *
 * Va en ESTA hoja y no en la general porque solo tiene sentido con el reparto
 * fijo. Sin anchos puestos, la columna crece con su contenido y no hay nada que
 * recortar: aplicarlo siempre sería recortar por si acaso.
 *
 * Exportada para poder comprobar el CSS que produce desde un probe, sin montar
 * un navegador: es la única parte de este archivo que se puede ejercitar sin
 * DOM, y es donde vive la decisión.
 */
export function reglasDeAncho(tabla: string, anchos: Anchos): string {
  const entradas = Object.entries(anchos);
  if (entradas.length === 0) return "";
  /*
    El nombre se VALIDA en vez de escaparse.

    Sale de un `data-tabla` que escribimos nosotros, así que es un puñado de
    identificadores en minúscula. Comprobarlo es más seguro que escaparlo —lo
    que no encaja no produce selector, en lugar de producir uno raro— y además
    no depende de `CSS.escape`, que solo existe en el navegador y dejaba esta
    función imposible de ejercitar desde un probe.
  */
  if (!/^[a-z][a-z0-9_-]*$/.test(tabla)) return "";
  const sel = `table.tabla-erp[data-tabla="${tabla}"]`;
  return [
    `${sel}{table-layout:fixed}`,
    `${sel} th,${sel} td{overflow:hidden;text-overflow:ellipsis}`,
    ...entradas.map(
      ([i, w]) => `${sel} thead th:nth-child(${Number(i) + 1}){width:${w}px}`,
    ),
  ].join("\n");
}

export function AnchosDeColumna() {
  useEffect(() => {
    const hoja = document.createElement("style");
    hoja.dataset.anchosDeColumna = "1";
    document.head.appendChild(hoja);

    // Lo que hay guardado, por tabla, para poder reescribir la hoja entera cada
    // vez que algo cambia. Son unas pocas reglas: rehacerla es más simple y más
    // seguro que ir parcheándola.
    const estado = new Map<string, Anchos>();

    const tablas = () =>
      Array.from(
        document.querySelectorAll<HTMLTableElement>("table.tabla-erp[data-tabla]"),
      );

    function repintar() {
      hoja.textContent = [...estado]
        .map(([t, a]) => reglasDeAncho(t, a))
        .filter(Boolean)
        .join("\n");
    }

    for (const t of tablas()) {
      const nombre = t.dataset.tabla;
      if (nombre) estado.set(nombre, leer(nombre));
    }
    repintar();

    function alPulsar(e: PointerEvent) {
      const th = (e.target as HTMLElement | null)?.closest?.("th");
      if (!th) return;
      const tabla = th.closest<HTMLTableElement>("table.tabla-erp[data-tabla]");
      const nombre = tabla?.dataset.tabla;
      if (!tabla || !nombre) return;

      const encabezados = Array.from(tabla.querySelectorAll<HTMLElement>("thead th"));
      const i = encabezados.indexOf(th as HTMLElement);
      // La última no se redimensiona: no hay nada a su derecha que ceder sitio.
      if (i < 0 || i === encabezados.length - 1) return;

      const caja = th.getBoundingClientRect();
      // Por la posición del puntero contra el borde y no por `offsetX`: el
      // objetivo del evento puede ser el enlace que ordena, y entonces sus
      // coordenadas serían relativas a otra cosa.
      if (e.clientX < caja.right - AGARRE) return;

      e.preventDefault();
      e.stopPropagation();

      const desde = e.clientX;
      const inicial = caja.width;
      const anchos = { ...(estado.get(nombre) ?? {}) };
      /*
        Se fijan TODOS los anchos actuales al empezar, no solo el que se
        arrastra. Con `table-layout: fixed` y una sola columna declarada, el
        navegador reparte el resto a partes iguales: la tabla entera saltaba al
        primer movimiento del ratón. Congelando lo que ya se veía, lo único que
        se mueve es la columna que se está agarrando.
      */
      encabezados.forEach((h, k) => {
        if (anchos[k] === undefined) {
          anchos[k] = Math.round(h.getBoundingClientRect().width);
        }
      });

      document.body.classList.add("redimensionando");

      const mover = (ev: PointerEvent) => {
        anchos[i] = Math.max(MINIMO, Math.round(inicial + ev.clientX - desde));
        estado.set(nombre, anchos);
        repintar();
      };
      const soltar = () => {
        document.body.classList.remove("redimensionando");
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
        window.removeEventListener("pointercancel", soltar);
        guardar(nombre, anchos);
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
      // Un gesto que el navegador cancela —el dedo sale de la pantalla, entra
      // una llamada— no puede dejar la tabla pegada al puntero para siempre.
      window.addEventListener("pointercancel", soltar);
    }

    // Delegado en el documento y no en cada tabla: las tablas se van y vuelven
    // con cada navegación, y un oyente por tabla habría que volver a poner en
    // cada una. El documento está siempre.
    document.addEventListener("pointerdown", alPulsar, true);
    return () => {
      document.removeEventListener("pointerdown", alPulsar, true);
      hoja.remove();
    };
  }, []);

  return null;
}
