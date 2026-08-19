/**
 * La etiqueta de un mes en las gráficas: «mar 25».
 *
 * En un módulo propio porque la escriben tres capas de análisis distintas
 * —rentabilidad, ventas y clientes— y la lista de nombres cortos es justo la
 * clase de constante que se copia bien la primera vez y mal la tercera. Que
 * todas las gráficas del sistema rotulen los meses igual no es cosmético: es lo
 * que permite comparar dos tarjetas de un tablero sin releer los ejes.
 */
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** De una fecha. */
export const etiquetaMes = (d: Date) =>
  `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

/**
 * De un `YYYY-MM` de Postgres.
 *
 * Se parte la cadena en vez de construir un `Date`: `new Date("2026-03")` se
 * interpreta en UTC y, al leerlo con `getMonth()` en un huso al oeste, devuelve
 * febrero. Un mes de menos en toda la serie, y solo se nota si alguien compara
 * la gráfica con el listado.
 */
export function etiquetaMesISO(ym: string): string {
  const [anio, mes] = ym.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} ${anio.slice(2)}`;
}
