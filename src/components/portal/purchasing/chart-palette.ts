/**
 * Los pasos de color para marcas de datos.
 *
 * NO son los tokens de la aplicación. `--signal` da 1.89:1 sobre blanco y su
 * luminosidad queda fuera de banda: sirve para un acento o un borde, no para un
 * relleno que hay que leer. Los de abajo salieron de derivar pasos del mismo
 * tono y pasarlos por el comprobador de paleta —banda de luminosidad, piso de
 * croma, separación bajo daltonismo, piso de visión normal y contraste contra
 * la superficie— en los DOS modos:
 *
 *   claro   serie A #0462d3   serie B #0095a5   ΔE normal 17.4
 *   oscuro  serie A #1b6ad4   serie B #00ab9c   ΔE normal 22.4
 *
 * El paso oscuro no es el claro aclarado: es un escalón elegido contra su
 * propia superficie. Si se tocan estos valores hay que volver a pasarlos por el
 * comprobador, no ajustarlos a ojo.
 *
 * Viven en un módulo aparte porque los usan la pantalla de análisis y el panel
 * del asistente, y dos copias divergen en el primer retoque.
 */
export const SERIE = {
  /** Serie principal. Pagos, importes, la magnitud que se lee primero. */
  a: "text-[#0462d3] dark:text-[#1b6ad4]",
  /** Serie secundaria. Anticipos, el segundo componente de una barra apilada. */
  b: "text-[#0095a5] dark:text-[#00ab9c]",
} as const;

/**
 * Un tramo en ESTADO —vencido, en falta— no es una serie más: lleva el color de
 * estado y siempre va acompañado de su etiqueta escrita, nunca del color solo.
 */
export const SERIE_ALERTA = "text-destructive";
