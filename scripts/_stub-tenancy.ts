/**
 * Sustituto de `@/lib/tenancy/context` para medir la capa de datos.
 *
 * ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────
 *
 * Casi toda la capa de datos pide su conexión con `tenantDb()`, que la resuelve
 * desde las cookies de la petición. Fuera de una petición eso revienta, así que
 * medir cuánto cuesta `getClients()` o la cola de tickets exigía —hasta aquí—
 * abrir el navegador y mirar. Aquí se fija la empresa por variable de entorno y
 * la capa entera queda medible.
 *
 * ── QUÉ NO SE ESTÁ MIDIENDO ────────────────────────────────────────────────
 *
 * La sesión. `currentRole` devuelve administrador porque lo que se mide son
 * consultas, no permisos: un rol menor solo esconde pantallas, y esconder
 * trabajo daría números más bonitos que la realidad.
 */
import { soloEnPruebas } from "./_stub-guardia";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/platform";

soloEnPruebas(
  "_stub-tenancy",
  "Devuelve rol `owner` y un `puedeEn()` que concede todo: dentro de la\n"
    + "  aplicación, cualquiera sería dueño de cualquier empresa, y sin un solo\n"
    + "  error en el registro.",
);

const ESQUEMA = process.env.PROBE_SCHEMA ?? "tenant_evoelution";

let cliente: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Consultas enviadas desde que se puso el contador a cero.
 *
 * Se cuenta en el CLIENTE de Postgres y no envolviendo el constructor de
 * consultas: así entra todo —lo que escribe Drizzle, el `sql` crudo y lo que
 * dispare una relación— y no solo lo que alguien se acordó de instrumentar. Es
 * la diferencia entre medir viajes a la base y medir llamadas a una API.
 */
export const consultas = {
  n: 0,
  /** El SQL enviado, en orden, para poder ver QUÉ se repite y no solo cuánto. */
  sql: [] as Array<{ q: string; p: unknown[] }>,
  cero() {
    this.n = 0;
    this.sql.length = 0;
  },
};

/** Un solo pool para todo el probe: medir no debe pagar conexiones nuevas. */
function clienteDelEsquema() {
  if (!cliente) {
    const sql = postgres(process.env.DATABASE_URL!, {
      prepare: process.env.DB_PREPARE === "true",
      max: 4,
      connection: { search_path: `${ESQUEMA}, public` },
      debug: (_conn: unknown, q: string, p: unknown[]) => {
        consultas.n += 1;
        consultas.sql.push({ q, p });
      },
    });
    cliente = drizzle(sql, { schema });
  }
  return cliente;
}

export const ACTIVE_TENANT_COOKIE = "evo_tenant";

export type TenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  schemaName: string;
  role: MembershipRole;
};

const CTX: TenantContext = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  slug: ESQUEMA.replace(/^tenant_/, ""),
  name: "probe",
  schemaName: ESQUEMA,
  role: "owner",
};

export async function getTenantContext(): Promise<TenantContext | null> {
  return CTX;
}
export async function requireTenant(): Promise<TenantContext> {
  return CTX;
}
export async function currentRole(): Promise<MembershipRole | null> {
  return CTX.role;
}
export async function tenantDb() {
  return clienteDelEsquema();
}
/* eslint-disable @typescript-eslint/no-unused-vars --
   Los parámetros se conservan porque la firma tiene que coincidir con la real:
   quien llama sigue pasándolos, y quitarlos escondería que aquí se ignoran. */
export function tenantDbFor(_schemaName: string) {
  return clienteDelEsquema();
}
export async function listMemberships(_userId: string) {
  return getDb() && [];
}
export async function logTenantAccess(_args: unknown) {
  /* el probe no audita: no está entrando nadie */
}

/**
 * El permiso, siempre concedido.
 *
 * Lo llaman TODAS las acciones de servidor antes de tocar nada, así que sin
 * esto ninguna se puede ejercitar desde un probe — que es la razón de que las
 * veintitantas acciones del repositorio no tengan una sola prueba.
 *
 * Devolver `true` a secas es correcto AQUÍ y sería un desastre en producción:
 * lo que un probe de acción comprueba es qué ESCRIBE, no a quién deja entrar.
 * Quién puede entrar se prueba contra la aplicación de verdad, con una sesión
 * de verdad, que es como se encontró el hueco de la pantalla de Usuarios.
 */
export async function puedeEn(_modulo: string, _nivel: string): Promise<boolean> {
  return true;
}

/** El techo de conexiones, tal cual lo calcula el módulo real. */
export const connectionCeiling = () => ({
  porInquilino: 2,
  poolsEnCache: 30,
  techoInquilinos: 60,
  techoControl: 10,
  techoTotal: 70,
});
