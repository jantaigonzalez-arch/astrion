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

/**
 * LA FIRMA DE LAS COLUMNAS, Y POR QUÉ HACE FALTA.
 *
 * ── EL FALLO QUE ESTO ARREGLA, Y QUE COSTÓ TRES RONDAS ENCONTRAR ──────────
 *
 * Los anchos se guardan POR POSICIÓN (`nth-child(3)`), que es lo único que un
 * selector de CSS entiende. Mientras la tabla no cambie, correcto.
 *
 * Pero la tabla cambia. A Clientes se le añadieron dos columnas fiscales en
 * mitad de la fila, y a partir de ese momento cada ancho guardado se aplicó a
 * una columna DISTINTA de aquella en la que se midió: el ancho del teléfono
 * pasó a gobernar el estado fiscal, y la última columna se quedó sin ninguno.
 *
 * Y con `table-layout: fixed`, una columna sin ancho declarado se lleva lo que
 * sobra a partes iguales con las demás e ignora su contenido. El resultado en
 * pantalla era «General» convertido en «Ge…» y «Sin asignar» en «Sin as» — una
 * tabla ilegible que nadie relacionaba con haber arrastrado un borde meses
 * antes, porque el recuerdo estaba en `localStorage` y no había forma de verlo.
 *
 * NADA AVISABA. El estado guardado seguía siendo válido para el navegador y
 * absurdo para la tabla.
 *
 * ── LA FIRMA ──────────────────────────────────────────────────────────────
 *
 * Se guarda junto a los anchos el texto de los encabezados. Si al leer no
 * coincide —cambió una columna, se añadió, se quitó, se reordenaron— los anchos
 * se DESCARTAN y la tabla vuelve a repartirse sola. Se pierde una preferencia;
 * se gana que la tabla nunca quede rota por un recuerdo caduco.
 *
 * Es la misma idea que el `hash_datos` del expediente fiscal: un dato derivado
 * que deja de cuadrar cuando cambia aquello de lo que salió, y que por eso puede
 * invalidarse solo en vez de esperar a que alguien se dé cuenta.
 */
export function firmaDeColumnas(encabezados: readonly string[]): string {
  return `${encabezados.length}:${encabezados.map((t) => t.trim()).join("|")}`;
}

type Guardado = { v: 2; firma: string; anchos: Anchos };

function leer(tabla: string, firma: string): Anchos {
  try {
    const crudo = window.localStorage.getItem(CLAVE(tabla));
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};

    const g = v as Partial<Guardado>;
    /*
      El formato viejo —un objeto de anchos a secas, sin versión ni firma— se
      descarta y se borra. No se puede saber a qué columnas correspondía, y
      aplicarlo es exactamente el fallo que esto viene a cerrar. Quien tuviera
      anchos guardados los pierde UNA vez.
    */
    if (g.v !== 2 || typeof g.firma !== "string" || !g.anchos) {
      window.localStorage.removeItem(CLAVE(tabla));
      return {};
    }
    if (g.firma !== firma) {
      window.localStorage.removeItem(CLAVE(tabla));
      return {};
    }

    const out: Anchos = {};
    for (const [k, ancho] of Object.entries(g.anchos as Record<string, unknown>)) {
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

function guardar(tabla: string, anchos: Anchos, firma: string) {
  try {
    const g: Guardado = { v: 2, firma, anchos };
    window.localStorage.setItem(CLAVE(tabla), JSON.stringify(g));
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

    /** El texto de los encabezados de una tabla, para firmar sus anchos. */
    const rotulos = (t: HTMLTableElement) =>
      Array.from(t.querySelectorAll<HTMLElement>("thead th")).map(
        (h) => (h.textContent ?? "").trim(),
      );

    for (const t of tablas()) {
      const nombre = t.dataset.tabla;
      if (nombre) estado.set(nombre, leer(nombre, firmaDeColumnas(rotulos(t))));
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
        guardar(nombre, anchos, firmaDeColumnas(rotulos(tabla)));
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
