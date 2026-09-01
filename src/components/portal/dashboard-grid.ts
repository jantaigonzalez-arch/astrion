import type { Caja } from "@/lib/ml/placements";

/**
 * La geometría del lienzo. Un solo sitio, y por un motivo concreto.
 *
 * La vista publicada y el compositor tienen que dibujar EXACTAMENTE el mismo
 * lienzo: componer viendo un layout y publicar otro sería peor que no poder
 * componerlo. Ya pasó en este repo con las tres paletas de color que se
 * declaraban «la validada» y con `width`, duplicado entre catálogo y base.
 *
 * ── EL LIENZO ES LIBRE, PERO SE APOYA EN UNA RETÍCULA ─────────────────────
 *
 * Cada bloque va donde lo pusieron: se pueden solapar, se pueden dejar huecos,
 * nadie reacomoda nada. Lo único que la retícula impone es que las coordenadas
 * sean enteras —24 columnas de ancho, filas de 32 px— y eso no es una
 * concesión: sin ella, alinear dos bloques exige pelearse con el ratón por un
 * píxel, y ningún tablero queda recto.
 *
 * El ancho va en PORCENTAJE y el alto en PÍXELES, a propósito. El tablero
 * acompaña el ancho de la ventana sin recalcular nada, y el alto no se encoge
 * con ella — si se encogiera, la letra de dentro tendría que encogerse también
 * y a media pantalla dejaría de leerse. Es el defecto de un lienzo de píxeles
 * puros, y es el que este modelo evita.
 */

/** Columnas del lienzo. */
export const COLS = 24;
/** Alto de una fila, en píxeles. */
export const FILA = 32;
/** Aire entre bloques. Se descuenta por dentro, no de la coordenada. */
export const AIRE = 8;

/**
 * El alto total que hay que reservar, en píxeles.
 *
 * Se calcula del bloque que llegue más abajo y no de la suma: en un lienzo los
 * bloques pueden solaparse, así que sumar altos daría un tablero con un vacío
 * enorme al final.
 */
export const altoLienzo = (cajas: Caja[]): number =>
  (cajas.reduce((max, c) => Math.max(max, c.y + c.h), 0) || 8) * FILA;

/**
 * Las variables que sitúan un bloque. Las lee el CSS de `.lienzo`.
 *
 * Van como variables y no como `left`/`top` calculados aquí porque la posición
 * SOLO aplica de tableta para arriba: en un teléfono el lienzo se apila y esas
 * propiedades tienen que desaparecer. Una media query no puede apagar un estilo
 * en línea, pero sí puede dejar de usar una variable. Ver `globals.css`.
 */
export const estiloCaja = (c: Caja) =>
  ({
    ["--bx" as string]: String(c.x),
    ["--by" as string]: String(c.y),
    ["--bw" as string]: String(c.w),
    ["--bh" as string]: String(c.h),
  }) as React.CSSProperties;

/** El estilo del contenedor: reserva el alto que ocupan sus bloques. */
export const estiloLienzo = (cajas: Caja[]) =>
  ({ ["--lienzo-h" as string]: `${altoLienzo(cajas)}px` }) as React.CSSProperties;

/**
 * Píxeles → unidades de la retícula. Lo usa el compositor al arrastrar.
 *
 * El ancho de columna se MIDE del contenedor y no se supone: depende de la
 * ventana y de si el panel lateral está plegado, y suponerlo daría un salto
 * justo cuando alguien pliega el panel para acomodar a gusto.
 */
export function aReticula(
  rect: DOMRect,
  px: number,
  py: number,
): { cx: number; cy: number } {
  return {
    cx: Math.round((px / rect.width) * COLS),
    cy: Math.round(py / FILA),
  };
}
