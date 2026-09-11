/**
 * QUÉ TIPO DE CAMBIO VALE EN UNA FECHA.
 *
 * Puro —sin base, sin red— para poder probarlo con fechas inventadas. La tabla
 * `tipo_de_cambio` guarda el FIX por fecha de DETERMINACIÓN (ver la migración
 * 0033 de `drizzle/`); aquí se contesta lo que la gente de verdad pregunta.
 *
 * ── LAS TRES FECHAS DE UN FIX ──────────────────────────────────────────────
 *
 *   determinación   Banxico lo fija un día hábil bancario, al mediodía.
 *   publicación     El Diario Oficial lo publica el día hábil SIGUIENTE.
 *   aplicación      Para una obligación en moneda extranjera vale el publicado
 *                   el día ANTERIOR a aquel en que se causa (art. 20 del CFF);
 *                   si ese día no hubo publicación, el último publicado.
 *
 * Así, un negocio pactado el lunes 14 usa el publicado el domingo 13 —que no
 * hubo—, o sea el del viernes 11, que es el FIX determinado el jueves 10.
 *
 * La publicación de un FIX es el siguiente día de la serie: Banxico determina
 * uno cada día hábil bancario y el DOF lo publica al siguiente. Del ÚLTIMO FIX
 * todavía no hay «siguiente», y se supone el próximo día de lunes a viernes. Si
 * cae en festivo se adelanta un día, y se corrige solo en cuanto llega el FIX
 * siguiente.
 */

export const MONEDAS = ["USD", "EUR"] as const;
export type Moneda = (typeof MONEDAS)[number];

/**
 * Las series del SIE de Banxico.
 *
 * USD es SF43718, el FIX por fecha de determinación. NO SF60653, aunque su
 * título diga lo mismo: esa va por fecha de liquidación, trae un valor para cada
 * día del calendario y el último siempre es futuro.
 */
export const SERIES: Record<Moneda, string> = {
  USD: "SF43718",
  EUR: "SF46410",
};

export type Cotizacion = { fecha: string; valor: number };
export type Vigente = Cotizacion & {
  /** Cuándo lo publicó (o publicará) el Diario Oficial. */
  publicado: string;
};

/** `10/09/2026` (formato del SIE) → `2026-09-10`. Lo que no tenga esa forma, null. */
export function fechaDelSie(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [, d, mes, y] = m;
  const t = new Date(Date.UTC(Number(y), Number(mes) - 1, Number(d)));
  if (t.getUTCDate() !== Number(d) || t.getUTCMonth() !== Number(mes) - 1) return null;
  return t.toISOString().slice(0, 10);
}

/** `2026-09-10` ± días, en fechas de calendario (sin horas ni zonas). */
export function sumarDias(fecha: string, dias: number): string {
  const t = new Date(`${fecha}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** El siguiente día de lunes a viernes. No conoce los festivos: ver la cabecera. */
export function siguienteDiaHabil(fecha: string): string {
  let d = sumarDias(fecha, 1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = sumarDias(d, 1);
  return d;
}

/**
 * El último FIX que el Diario Oficial ya había publicado en `dia`, con su fecha
 * de publicación. `filas` en orden de fecha ascendente.
 */
export function publicadoAl(filas: readonly Cotizacion[], dia: string): Vigente | null {
  let mejor: Vigente | null = null;
  for (let i = 0; i < filas.length; i++) {
    const publicado = filas[i + 1]?.fecha ?? siguienteDiaHabil(filas[i].fecha);
    if (publicado <= dia) mejor = { ...filas[i], publicado };
    else break;
  }
  return mejor;
}

/**
 * El que vale para una operación hecha en `dia`: el publicado el día anterior
 * (art. 20 del CFF). Es el que la aplicación estampa en un negocio en dólares.
 */
export function paraOperacionesDel(filas: readonly Cotizacion[], dia: string): Vigente | null {
  return publicadoAl(filas, sumarDias(dia, -1));
}

/** Hoy en la Ciudad de México, que es el día que la empresa dirá que pactó. */
export function hoyEnMexico(ahora = new Date()): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}
