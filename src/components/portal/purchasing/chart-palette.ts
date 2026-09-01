/**
 * Los colores de las marcas de datos, por su PAPEL.
 *
 * ── ESTO YA NO ES UNA PALETA ───────────────────────────────────────────────
 *
 * Lo fue, y ahí estaba el problema: declaraba sus propios pasos —azul #0462d3 y
 * teal #0095a5— mientras `globals.css` declaraba otros —azul #2a78d6 y naranja
 * #eb6834— y las dos se describían como «la validada». Las usaban superficies
 * distintas de la MISMA pantalla: los bloques de un tablero pintaban la segunda
 * serie en teal, y la gráfica de rentabilidad de abajo la pintaba en naranja.
 * Dos archivos con la verdad es ninguno.
 *
 * Ahora los valores viven en un solo sitio, `--series-N` en `globals.css`, y
 * esto solo les pone nombre según para qué se usan. Sobrevivió aquella paleta
 * porque sus pasos ya eran los slots 1 y 2 de la referencia; ésta no lo era.
 *
 * ── SON VALORES DE COLOR, NO CLASES ────────────────────────────────────────
 *
 * Antes eran clases de Tailwind (`text-[#0462d3]`) que se pintaban con el truco
 * de `background: currentColor`. Ese rodeo existía solo para poder escribir el
 * modo oscuro con `dark:`; con un token que ya sabe cambiar de modo, sobra.
 *
 * Van en `style`, no en `className`, y hay un motivo para no volver atrás: una
 * clase arbitraria de Tailwind con `var()` dentro se compila mal según cómo se
 * escriba, y esto es justo la clase de detalle que se rompe en silencio.
 *
 * OJO: `var(--series-N)` solo resuelve dentro de un `.viz-root`. Quien dibuje
 * con estos valores tiene que estar debajo de uno.
 */

/** Slots categóricos, en el orden en que se asignan. Nunca en ciclo. */
export const SERIE = {
  /** Serie principal. Pagos, importes, la magnitud que se lee primero. */
  a: "var(--series-1)",
  /** Serie secundaria. Anticipos, el segundo componente de una barra apilada. */
  b: "var(--series-2)",
  c: "var(--series-3)",
  d: "var(--series-4)",
  e: "var(--series-5)",
  f: "var(--series-6)",
} as const;

/** Los seis, en orden, para asignar por índice. */
export const SERIES = [SERIE.a, SERIE.b, SERIE.c, SERIE.d, SERIE.e, SERIE.f] as const;

/**
 * Un tramo en ESTADO —vencido, en falta— no es una serie más: lleva el color de
 * estado y siempre va acompañado de su etiqueta escrita, nunca del color solo.
 * Por eso está fuera de `SERIES`: que no lo alcance nunca una asignación por
 * índice, o un «serie 7» acabaría pintado de rojo de alerta.
 */
export const SERIE_ALERTA = "var(--color-destructive)";
