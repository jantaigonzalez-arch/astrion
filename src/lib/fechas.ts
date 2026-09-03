/**
 * El día del calendario de la operación.
 *
 * ── POR QUÉ NO VALE `toISOString().slice(0, 10)` ──────────────────────────
 *
 * Porque `toISOString` siempre habla en UTC, y el contenedor corre en
 * `America/Mexico_City` justamente para que no lo haga —ver la nota del
 * `Dockerfile`—. A partir de las 18:00 hora de México ya es el día siguiente en
 * UTC, así que todo lo que se fechara con ese recorte salía adelantado un día
 * durante la última cuarta parte de la jornada.
 *
 * No era cosmético en ninguno de los sitios donde estaba: la fecha por omisión
 * de una factura de proveedor es la de emisión del documento fiscal y la de
 * salida del dinero, y de ella cuelgan el vencimiento —`sumarDias` sobre los
 * días de crédito— y la antigüedad de la deuda. En el CSV del CRM era la
 * columna «Creado» de cada negocio.
 *
 * ── POR QUÉ `en-CA` ───────────────────────────────────────────────────────
 *
 * No es un idioma elegido al azar: es el único de los comunes cuyo formato
 * corto ya es `YYYY-MM-DD`, así que no hay que recomponer la fecha por partes
 * ni rellenar ceros a mano. `Intl` resuelve la zona del proceso, que es la que
 * fija `TZ`.
 *
 * ── ESTO NO REEMPLAZA A LA ARITMÉTICA CIVIL ───────────────────────────────
 *
 * `sumarDias` y `sumarMeses` (`domain/payables.ts`) siguen operando en UTC a
 * propósito, y está bien: reciben y devuelven `YYYY-MM-DD`, o sea que nunca
 * tocan una hora. Lo que se arregla aquí es el paso de un INSTANTE a un día,
 * que es donde la zona horaria importa.
 */

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día en que estamos, `YYYY-MM-DD`, en la zona del servidor. */
export function hoyCivil(): string {
  return FORMATO.format(new Date());
}

/** El día al que pertenece un instante, `YYYY-MM-DD`, en la zona del servidor. */
export function diaCivil(fecha: Date): string {
  return FORMATO.format(fecha);
}
