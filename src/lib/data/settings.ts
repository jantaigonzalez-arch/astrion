import "server-only";
import type { DbOrTx } from "@/lib/db";
import { eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";
import { membershipRole, type MembershipRole } from "@/lib/db/platform";

/** Descarta lo que no sea un rol conocido. Ver la nota de `getSettings`. */
function rolesGuardados(v: unknown): MembershipRole[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is MembershipRole =>
      typeof x === "string" && membershipRole.enumValues.includes(x as MembershipRole),
  );
}

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
   * QUÉ ROLES pueden pedir un viaje a quien todavía no es cliente.
   *
   * Vacío = nadie, que es también lo que vale cuando no hay fila de ajustes:
   * una empresa recién dada de alta no ha decidido nada, y el valor por omisión
   * de una política de gasto tiene que ser el que no gasta.
   */
  viaticosProspectosRoles: MembershipRole[];
};

const DEFAULTS: AppSettings = {
  laborCostPerHour: 0,
  laborRatePerHour: 0,
  usdRate: null,
  viaticosProspectosRoles: [],
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
    /*
      Se SANEA lo que viene, no se confía en el tipo.

      `jsonb` puede traer un rol que esta versión ya no conoce, una cadena
      escrita a mano o directamente basura — es la misma lección que dejó
      `ajustesGuardados` con los permisos por persona, y la misma que dejó una
      fila de `viz` con un nombre viejo tumbando un tablero entero.
    */
    viaticosProspectosRoles: rolesGuardados(row.viaticosProspectosRoles),
  };
}
