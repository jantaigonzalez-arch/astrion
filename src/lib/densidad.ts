/**
 * CUÁNTO RESPIRA UNA TABLA. Una sola preferencia, para todas.
 *
 * ── EL PROBLEMA QUE RESUELVE ──────────────────────────────────────────────
 *
 * Había treinta y tres tablas repartidas por los módulos y cinco rellenos
 * distintos entre ellas —`py-3`, `py-2`, `py-1`, `px-3 py-2`…— escritos a mano
 * pantalla por pantalla. No eran tres densidades pensadas: eran cinco
 * accidentes, y el resultado es que la misma persona pasa de Tickets a Compras
 * y las filas cambian de alto sin que nada lo explique.
 *
 * Ahora hay tres, se eligen, y valen para TODAS a la vez. Que sea una sola
 * preferencia global es lo que la vuelve costumbre: quien la pone en compacta
 * la pone una vez y el sistema entero se comporta igual.
 *
 * ── LAS TRES, Y POR QUÉ ESAS ──────────────────────────────────────────────
 *
 * Es el patrón asentado en aplicaciones de datos: compacta para quien opera
 * todo el día y quiere ver el máximo de renglones sin desplazarse, normal como
 * punto medio, amplia para pantallas táctiles y para quien lee poco a poco. La
 * diferencia real se mide en cuántas veces hay que desplazarse para recorrer
 * trescientos registros, y es del doble entre los extremos.
 *
 * ── VIAJA EN COOKIE Y NO EN `localStorage` ────────────────────────────────
 *
 * Porque las tablas se dibujan en el SERVIDOR. Con `localStorage` habría que
 * leerla en el navegador después de montar, y cada carga pintaría la densidad
 * por omisión para corregirla un instante después: el salto se ve. Es la misma
 * decisión, y por el mismo motivo, que ya tomó el ancho de la barra lateral.
 */

export const DENSIDADES = ["compacta", "normal", "amplia"] as const;
export type Densidad = (typeof DENSIDADES)[number];

/** Debe coincidir con lo que escribe el control. Ver `DensidadToggle`. */
export const DENSIDAD_COOKIE = "evo_densidad";

export const DENSIDAD_LABEL: Record<Densidad, string> = {
  compacta: "Compacta",
  normal: "Normal",
  amplia: "Amplia",
};

/** Qué gana cada una, en una línea, para el menú que las ofrece. */
export const DENSIDAD_AYUDA: Record<Densidad, string> = {
  compacta: "Más renglones a la vista, menos desplazamiento.",
  normal: "El equilibrio entre leer y abarcar.",
  amplia: "Filas altas, cómodas para leer y para tocar.",
};

/**
 * La densidad guardada, saneada.
 *
 * Cae a `normal` ante cualquier cosa que no reconozca: la cookie la escribe el
 * navegador y puede traer un valor de una versión anterior o escrito a mano.
 * Un valor raro no puede dejar la tabla sin relleno.
 */
export function densidadGuardada(v: string | undefined | null): Densidad {
  return (DENSIDADES as readonly string[]).includes(v ?? "")
    ? (v as Densidad)
    : "normal";
}
