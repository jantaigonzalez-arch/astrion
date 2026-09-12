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
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/platform";
import { alcanza, type Nivel } from "@/lib/permisos";

soloEnPruebas(
  "_stub-tenancy",
  "Devuelve rol `owner` y un `puedeEn()` que concede todo: dentro de la\n"
    + "  aplicación, cualquiera sería dueño de cualquier empresa, y sin un solo\n"
    + "  error en el registro.",
);

const ESQUEMA = process.env.PROBE_SCHEMA ?? "tenant_evoelution";

type Cliente = ReturnType<typeof drizzle<typeof schema>>;
/** Un pool por esquema: el de la sesión y, si alguien lo pide, otro explícito. */
const clientes = new Map<string, Cliente>();

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

/** Un solo pool por esquema para todo el probe: medir no debe pagar conexiones nuevas. */
function clienteDelEsquema(esquema = ESQUEMA): Cliente {
  let cliente = clientes.get(esquema);
  if (!cliente) {
    const sql = postgres(process.env.DATABASE_URL!, {
      prepare: process.env.DB_PREPARE === "true",
      max: 4,
      connection: { search_path: `${esquema}, public` },
      debug: (_conn: unknown, q: string, p: unknown[]) => {
        consultas.n += 1;
        consultas.sql.push({ q, p });
      },
    });
    cliente = drizzle(sql, { schema });
    clientes.set(esquema, cliente);
  }
  return cliente;
}

export const ACTIVE_TENANT_COOKIE = "evo_tenant";

export type TenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  schemaName: string;
  /** Como en el real: el de la empresa, o «ORG» si no tiene. */
  folioPrefix: string;
  role: MembershipRole;
};

const SIN_EMPRESA = "00000000-0000-0000-0000-000000000000";

const CTX: TenantContext = {
  tenantId: SIN_EMPRESA,
  slug: ESQUEMA.replace(/^tenant_/, ""),
  name: "probe",
  schemaName: ESQUEMA,
  folioPrefix: "ORG",
  role: "owner",
};

/*
  EL `tenantId` DE VERDAD, NO UNO DE CEROS.

  Mientras solo se medían consultas daba igual: las tablas de negocio viven en
  el esquema y no llevan el id de la empresa. Pero las acciones de marca, de
  correo y de usuarios escriben en tablas de PLATAFORMA —`tenants`,
  `memberships`— filtrando por `ctx.tenantId`, y con ceros un `update` no toca
  ninguna fila y responde ok: la prueba daría verde sin haber escrito nada.

  Se resuelve una vez, al primer uso, por el slug. Si la base no trae esa
  empresa se quedan los ceros, que es lo que había.
*/
let resuelto = false;
async function contexto(): Promise<TenantContext> {
  if (!resuelto) {
    resuelto = true;
    const [fila] = await getDb()
      .select({
        id: schema.tenants.id,
        name: schema.tenants.name,
        folioPrefix: schema.tenants.folioPrefix,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, CTX.slug))
      .limit(1)
      .catch(() => []);
    if (fila) {
      Object.assign(CTX, {
        tenantId: fila.id,
        name: fila.name,
        // Sin él, los folios de las pruebas salían «undefined-000123».
        folioPrefix: fila.folioPrefix ?? CTX.folioPrefix,
      });
    }
  }
  /*
    El rol se lee en CADA llamada, como la sesión en `_stub-auth`: un probe
    necesita ser agente y luego administrador en el mismo proceso.
  */
  CTX.role = (process.env.PROBE_ROL as MembershipRole) || "owner";
  return CTX;
}

export async function getTenantContext(): Promise<TenantContext | null> {
  return contexto();
}
export async function requireTenant(): Promise<TenantContext> {
  return contexto();
}
/**
 * `owner` por omisión, que es lo que había. `PROBE_ROL=agent` lo cambia.
 *
 * Existe por las pocas acciones que no preguntan por permiso sino por ROL
 * —`isSupport(await currentRole())`, el asistente, el buscador de
 * refacciones—: con el rol fijo en dueño, la mitad de esas guardias que dice
 * que no era imposible de ejercitar.
 */
export async function currentRole(): Promise<MembershipRole | null> {
  return (await contexto()).role;
}
export async function tenantDb() {
  return clienteDelEsquema();
}
/*
  El esquema que se PIDE, no el de la sesión. Devolvía siempre el de la sesión,
  y eso escondía justo lo que interesa de quien llama a `tenantDbFor`: que
  escriba en una empresa que no es la de la sesión —los contactos del sitio
  público van a la de `LEADS_TENANT` aunque quien los mande esté en otra—.
*/
export function tenantDbFor(schemaName: string) {
  return clienteDelEsquema(schemaName);
}
/* eslint-disable @typescript-eslint/no-unused-vars --
   Los parámetros se conservan porque la firma tiene que coincidir con la real:
   quien llama sigue pasándolos, y quitarlos escondería que aquí se ignoran. */
export async function listMemberships(_userId: string) {
  return getDb() && [];
}
export async function logTenantAccess(_args: unknown) {
  /* el probe no audita: no está entrando nadie */
}

/**
 * El permiso. Concedido por omisión, denegable a propósito.
 *
 * Lo llaman TODAS las acciones de servidor antes de tocar nada, así que sin
 * esto ninguna se puede ejercitar desde un probe.
 *
 * ── POR QUÉ SE PUEDE APAGAR ────────────────────────────────────────────────
 *
 * Porque un probe que solo puede correr con permiso comprueba media guardia. La
 * mitad que importa —que la acción NO escriba cuando el permiso falta— exige
 * poder decir que no, y una acción a la que nunca se le dice que no es una
 * acción cuyo `if` del principio nadie ha ejecutado nunca.
 *
 *     PROBE_PUEDE=false   deniega TODO
 *     PROBE_PUEDE=ventas:editar,compras:administrar
 *                         concede HASTA ese nivel en esos módulos, y nada en
 *                         los demás
 *
 * El valor por omisión no cambia: sin la variable, concede, que es lo que
 * esperan los probes que ya existían.
 *
 * La tercera forma llegó con las pruebas de todas las acciones. Con un sí o un
 * no a secas se comprueba que HAY guardia, pero no que pida el nivel correcto:
 * un borrado que exigiera «editar» en vez de «administrar» pasaba las dos
 * pruebas. Con niveles, se le da a la acción exactamente un escalón menos del
 * que debería pedir y se mira que diga que no.
 *
 * Sigue sin ser un modelo de permisos, y no debe serlo: quién puede entrar de
 * verdad se prueba contra la aplicación con una sesión real, que es como se
 * encontró el hueco de la pantalla de Usuarios. Esto solo da las dos respuestas
 * que una acción necesita oír para que sus dos caminos se ejerciten.
 */
export async function puedeEn(modulo: string, nivel: string): Promise<boolean> {
  const p = process.env.PROBE_PUEDE;
  if (p === undefined || p === "" || p === "true") return true;
  if (p === "false") return false;
  const concedido = p
    .split(",")
    .map((s) => s.trim().split(":"))
    .find(([m]) => m === modulo)?.[1] as Nivel | undefined;
  return concedido ? alcanza(concedido, nivel as Nivel) : false;
}

/** La misma disyunción que el módulo real, sobre el `puedeEn` de aquí. */
export async function puedeEnAlguno(modulos: readonly string[], nivel: string): Promise<boolean> {
  for (const m of modulos) if (await puedeEn(m, nivel)) return true;
  return false;
}

/** El techo de conexiones, tal cual lo calcula el módulo real. */
export const connectionCeiling = () => ({
  porInquilino: 2,
  poolsEnCache: 30,
  techoInquilinos: 60,
  techoControl: 10,
  techoTotal: 70,
});
