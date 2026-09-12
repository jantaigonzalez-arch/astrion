import "server-only";
import type { DbOrTx } from "@/lib/db";
import { eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";
import { membershipRole, type MembershipRole } from "@/lib/db/platform";
import { getTipoDeCambio } from "@/lib/data/tipo-de-cambio";
import { hoyEnMexico } from "@/lib/tipo-de-cambio";

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
  /** Si el tipo de cambio sale de Banxico. Ver `tipoDeCambioDeLaEmpresa`. */
  tipoCambioAutomatico: boolean;
  /**
   * QUÉ ROLES pueden pedir un viaje a quien todavía no es cliente.
   *
   * Vacío = nadie, que es también lo que vale cuando no hay fila de ajustes:
   * una empresa recién dada de alta no ha decidido nada, y el valor por omisión
   * de una política de gasto tiene que ser el que no gasta.
   */
  viaticosProspectosRoles: MembershipRole[];
  /**
   * LA POLÍTICA DE DESTINOS DE VIÁTICOS (0037).
   *
   * Qué roles piden viajes a CONTRATOS y quién VISITA a clientes sin contrato
   * vigente; cuántos destinos de cada tipo caben en una solicitud y si se
   * mezclan contratos con lo comercial. Los valores de fábrica son los de antes
   * de que esto fuera configurable: contratos para todos los roles internos,
   * visitas para nadie, uno de cada tipo y sin mezclar. Ver `vetoDestinos` en
   * `domain/viaticos.ts`.
   */
  viaticosContratosRoles: MembershipRole[];
  viaticosVisitasRoles: MembershipRole[];
  /** Cuántos de cada tipo caben en un viático. Ver la 0037. */
  viaticosMaxPorTipo: { contrato: number; visita: number; prospecto: number };
  viaticosMezclarDestinos: boolean;
};

/** Los roles que viajan: todos menos el cliente, que no entra al portal interno. */
export const ROLES_INTERNOS: MembershipRole[] = ["owner", "admin", "agent", "sales", "general"];

const DEFAULTS: AppSettings = {
  laborCostPerHour: 0,
  laborRatePerHour: 0,
  usdRate: null,
  // Automático también sin fila de ajustes: es lo que se decidió para todas.
  tipoCambioAutomatico: true,
  viaticosProspectosRoles: [],
  // Sin fila de ajustes, lo de antes de la 0037: cualquiera pide contratos.
  viaticosContratosRoles: ROLES_INTERNOS,
  viaticosVisitasRoles: [],
  viaticosMaxPorTipo: { contrato: 1, visita: 1, prospecto: 1 },
  viaticosMezclarDestinos: false,
};

/** El CHECK de la base ya lo acota a 1..20; se acota otra vez por si la fila se escribió a mano. */
const tope = (n: unknown) => Math.min(20, Math.max(1, Number(n) || 1));

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
    tipoCambioAutomatico: row.tipoCambioAutomatico,
    /*
      Se SANEA lo que viene, no se confía en el tipo.

      `jsonb` puede traer un rol que esta versión ya no conoce, una cadena
      escrita a mano o directamente basura — es la misma lección que dejó
      `ajustesGuardados` con los permisos por persona, y la misma que dejó una
      fila de `viz` con un nombre viejo tumbando un tablero entero.
    */
    viaticosProspectosRoles: rolesGuardados(row.viaticosProspectosRoles),
    viaticosContratosRoles: rolesGuardados(row.viaticosContratosRoles),
    viaticosVisitasRoles: rolesGuardados(row.viaticosVisitasRoles),
    viaticosMaxPorTipo: {
      contrato: tope(row.viaticosMaxContratos),
      visita: tope(row.viaticosMaxVisitas),
      prospecto: tope(row.viaticosMaxProspectos),
    },
    viaticosMezclarDestinos: row.viaticosMezclarDestinos,
  };
}

export type TipoDeCambioEfectivo = {
  valor: number;
  fuente: "banxico" | "manual";
  /** Con Banxico: el FIX que se usó y cuándo lo publicó el Diario Oficial. */
  fix?: string;
  publicado?: string;
} | null;

/**
 * EL TIPO DE CAMBIO QUE ESTA EMPRESA USA HOY. El único sitio que lo decide.
 *
 *  · automático (lo normal) → el de Banxico para operaciones del día: el FIX
 *    publicado en el Diario Oficial el día anterior (art. 20 del CFF).
 *  · manual → el que la empresa escribió en Configuración → Moneda.
 *  · automático SIN dato de Banxico —el cargador lleva días sin correr, o es
 *    una instalación nueva— → el manual, si hay. Mejor el tipo que la empresa
 *    fijó que ninguno; y si tampoco hay manual, `null`: no se inventa una
 *    paridad y el negocio queda «sin convertir», como siempre.
 */
export async function tipoDeCambioDeLaEmpresa(
  conexion?: DbOrTx,
  dia = hoyEnMexico(),
): Promise<TipoDeCambioEfectivo> {
  const s = await getSettings(conexion);
  if (s.tipoCambioAutomatico) {
    const { paraHoy } = await getTipoDeCambio(`USD|${dia}`);
    if (paraHoy) {
      return { valor: paraHoy.valor, fuente: "banxico", fix: paraHoy.fecha, publicado: paraHoy.publicado };
    }
  }
  return s.usdRate ? { valor: s.usdRate, fuente: "manual" } : null;
}
