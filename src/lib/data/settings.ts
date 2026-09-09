import "server-only";
import type { DbOrTx } from "@/lib/db";
import { eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";

export type AppSettings = {
  laborCostPerHour: number;
  laborRatePerHour: number;
  /**
   * Tipo de cambio USD→MXN vigente, o `null` si la empresa no fijó ninguno.
   *
   * `null` no es cero y la diferencia importa: cero convertiría toda la cartera
   * en dólares a nada, mientras que `null` significa "no convierto", y las
   * pantallas lo informan aparte en vez de sumar un número inventado.
   */
  usdRate: number | null;
  /**
   * ¿La empresa paga viajes a quien todavía no es cliente?
   *
   * Apagado de fábrica, y también apagado cuando no hay fila de ajustes: una
   * empresa recién dada de alta no ha decidido nada todavía, y el valor por
   * omisión de una política de gasto tiene que ser el que no gasta.
   */
  viaticosProspectos: boolean;
  /** ¿Pasarse del presupuesto de un rubro impide guardar el gasto? */
  viaticosBloqueaExceso: boolean;
};

const DEFAULTS: AppSettings = {
  laborCostPerHour: 0,
  laborRatePerHour: 0,
  usdRate: null,
  viaticosProspectos: false,
  viaticosBloqueaExceso: false,
};

export async function getSettings(conexion?: DbOrTx): Promise<AppSettings> {
  // La conexión explícita permite leer los ajustes dentro de una transacción o
  // desde un script, donde `tenantDb()` —que resuelve el inquilino por la
  // cookie— no puede usarse. Misma convención que `countForIn`.
  const db = conexion ?? (await tenantDb());
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, "global"))
    .limit(1);
  if (!row) return DEFAULTS;
  const rate = Number(row.usdRate ?? 0);
  return {
    laborCostPerHour: Number(row.laborCostPerHour ?? 0),
    laborRatePerHour: Number(row.laborRatePerHour ?? 0),
    usdRate: rate > 0 ? rate : null,
    viaticosProspectos: row.viaticosProspectos,
    viaticosBloqueaExceso: row.viaticosBloqueaExceso,
  };
}
