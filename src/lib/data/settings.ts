import "server-only";
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
};

const DEFAULTS: AppSettings = {
  laborCostPerHour: 0,
  laborRatePerHour: 0,
  usdRate: null,
};

export async function getSettings(): Promise<AppSettings> {
  const db = await tenantDb();
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
  };
}
