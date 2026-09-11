import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tipoDeCambio } from "@/lib/db/platform";
import { referenciaCacheCon } from "@/lib/referencia-compartida";
import {
  paraOperacionesDel,
  publicadoAl,
  sumarDias,
  type Cotizacion,
  type Moneda,
  type Vigente,
} from "@/lib/tipo-de-cambio";

/**
 * EL TIPO DE CAMBIO DE BANXICO, LEÍDO UNA VEZ PARA TODAS LAS EMPRESAS.
 *
 * Dato de REFERENCIA: el mismo para todo el país, en `public`, sin inquilino.
 * Por eso va con `referenciaCache` —una entrada para toda la plataforma— y por
 * eso este archivo no puede tocar nada de una empresa: `probe-referencia` lo
 * vigila. Lo que cada empresa decide (automático o manual) vive en
 * `tipoDeCambioDeLaEmpresa`, en `data/settings.ts`.
 */

export type EstadoTipoDeCambio = {
  moneda: Moneda;
  /** El que vale para una operación de hoy: publicado ayer (art. 20 del CFF). */
  paraHoy: Vigente | null;
  /** El que el Diario Oficial publica hoy. */
  publicadoHoy: Vigente | null;
  /** El FIX más reciente, aunque todavía no se haya publicado. */
  masReciente: Cotizacion | null;
  /** Cuándo entró el último dato: si es viejo, el cargador no está corriendo. */
  cargadoEn: string | null;
  /** Los últimos FIX, del más reciente al más viejo. */
  historial: Cotizacion[];
};

/**
 * Cuarenta días hacia atrás bastan para cualquier «qué valía hoy»: el FIX es
 * diario y el hueco más largo de Banxico es una Semana Santa. Si el cargador
 * lleva más que eso sin correr, no hay dato — y es mejor decirlo que estampar
 * una paridad de hace dos meses.
 */
const VENTANA = 40;

async function leer(clave: string): Promise<EstadoTipoDeCambio> {
  const [moneda, dia] = clave.split("|") as [Moneda, string];
  const db = getDb();
  const [filas, [carga]] = await Promise.all([
    db
      .select({ fecha: tipoDeCambio.fecha, valor: tipoDeCambio.valor })
      .from(tipoDeCambio)
      .where(
        and(
          eq(tipoDeCambio.moneda, moneda),
          gte(tipoDeCambio.fecha, sumarDias(dia, -VENTANA)),
          lte(tipoDeCambio.fecha, dia),
        ),
      )
      .orderBy(asc(tipoDeCambio.fecha)),
    db
      .select({ en: sql<string | null>`max(${tipoDeCambio.cargadoEn})::text` })
      .from(tipoDeCambio)
      .where(eq(tipoDeCambio.moneda, moneda)),
  ]);
  const cot: Cotizacion[] = filas.map((f) => ({ fecha: f.fecha, valor: Number(f.valor) }));
  return {
    moneda,
    paraHoy: paraOperacionesDel(cot, dia),
    publicadoHoy: publicadoAl(cot, dia),
    masReciente: cot.at(-1) ?? null,
    cargadoEn: carga?.en ?? null,
    historial: cot.slice(-10).reverse(),
  };
}

/**
 * El estado del tipo de cambio de una moneda en un día: `getTipoDeCambio("USD|2026-09-10")`.
 *
 * Clave con el día dentro: mañana es otra entrada, y la de hoy caduca a la hora
 * (el cargador corre cada seis, el FIX sale una vez al día).
 */
export const getTipoDeCambio = referenciaCacheCon("tipo-de-cambio", leer);
