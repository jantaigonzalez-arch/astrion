import { cookies } from "next/headers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  memberships,
  platformEvents,
  tenants,
  tenantSchemas,
  type MembershipRole,
} from "@/lib/db/platform";
import { auth } from "@/lib/auth";

/**
 * Contexto de inquilino: qué empresa está viendo el usuario en esta petición,
 * y cómo se consultan sus datos.
 *
 * Regla que sostiene el aislamiento: `getDb()` habla con el PLANO DE CONTROL
 * (public) y no ve una sola tabla de negocio. Para leer o escribir negocio hay
 * que pasar por `tenantDb()`, que devuelve un cliente atado al esquema del
 * inquilino activo. Si no hay inquilino activo, no hay cliente — y la consulta
 * falla en vez de devolver datos de otra empresa.
 */

export const ACTIVE_TENANT_COOKIE = "evo_tenant";

/* ============================================================
   Clientes por esquema
   ============================================================ */

type TenantClient = ReturnType<typeof drizzle<typeof schema>>;
const clients = new Map<string, TenantClient>();

/**
 * Un pool pequeño por esquema, con el `search_path` fijado al conectar.
 *
 * Se eligió esto sobre `SET LOCAL search_path` dentro de una transacción por una
 * razón práctica: permite que las ~110 consultas ya escritas sigan con la misma
 * forma (`const db = await tenantDb()`) en vez de reescribirlas todas como
 * callbacks. El aislamiento es igual de estricto — el esquema viaja en la
 * conexión, no en un ajuste que se pueda olvidar.
 *
 * El costo es el número de conexiones: cada inquilino activo mantiene su pool.
 * Por eso `max` es deliberadamente bajo y `idle_timeout` corto: un inquilino que
 * lleva 20 s sin actividad devuelve sus conexiones al sistema. Con decenas de
 * inquilinos concurrentes esto deja de alcanzar, y ese es el punto donde se pasa
 * a un pooler externo o al modelo por transacción. Está medido, no es sorpresa.
 */
function clientFor(schemaName: string): TenantClient {
  const cached = clients.get(schemaName);
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");

  // Validación estricta: el search_path no se parametriza, se interpola.
  if (!/^tenant_[a-z0-9_]{1,50}$/.test(schemaName)) {
    throw new Error(`Nombre de esquema inválido: ${JSON.stringify(schemaName)}`);
  }

  const sql = postgres(url, {
    prepare: process.env.DB_PREPARE === "true",
    max: Number(process.env.DB_TENANT_POOL_MAX ?? 3),
    idle_timeout: Number(process.env.DB_TENANT_IDLE ?? 20),
    connection: { search_path: `${schemaName}, public` },
  });

  const client = drizzle(sql, { schema });
  clients.set(schemaName, client);
  return client;
}

/* ============================================================
   Resolución del inquilino activo
   ============================================================ */

export type TenantContext = {
  tenantId: string;
  slug: string;
  name: string;
  schemaName: string;
  /** Rol del usuario EN ESTA empresa. */
  role: MembershipRole;
  /** true si entró por consola de plataforma y no por membresía propia. */
  impersonated: boolean;
};

/** Membresías activas del usuario, para el selector de empresa. */
export async function listMemberships(userId: string) {
  const db = getDb();
  return db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      role: memberships.role,
      schemaName: tenantSchemas.schemaName,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)));
}

/**
 * Resuelve el inquilino activo, o null si no hay ninguno.
 *
 * Orden: la cookie manda si el usuario tiene derecho a ese inquilino; si no,
 * cae a su única membresía. Un superadministrador puede tener cookie de una
 * empresa donde NO es miembro — eso es entrar por consola, y queda marcado
 * como `impersonated` para que la UI lo muestre y nadie confunda "administrar
 * mi empresa" con "estar dentro de la de un cliente".
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const jar = await cookies();
  const wanted = jar.get(ACTIVE_TENANT_COOKIE)?.value ?? null;

  const mine = await listMemberships(session.user.id);

  if (wanted) {
    const own = mine.find((m) => m.slug === wanted);
    if (own?.schemaName) {
      return {
        tenantId: own.tenantId,
        slug: own.slug,
        name: own.name,
        schemaName: own.schemaName,
        role: own.role,
        impersonated: false,
      };
    }
    // Sin membresía: solo pasa si es personal de la plataforma.
    if (session.user.platformRole) {
      const db = getDb();
      const [t] = await db
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          schemaName: tenantSchemas.schemaName,
        })
        .from(tenants)
        .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
        .where(eq(tenants.slug, wanted))
        .limit(1);
      if (t?.schemaName) {
        return {
          tenantId: t.tenantId,
          slug: t.slug,
          name: t.name,
          schemaName: t.schemaName,
          role: "admin",
          impersonated: true,
        };
      }
    }
  }

  const only = mine.find((m) => m.schemaName);
  if (!only?.schemaName) return null;
  return {
    tenantId: only.tenantId,
    slug: only.slug,
    name: only.name,
    schemaName: only.schemaName,
    role: only.role,
    impersonated: false,
  };
}

/** Igual que el anterior pero falla si no hay inquilino: para código que lo exige. */
export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) {
    throw new Error(
      "No hay empresa activa. Toda consulta de negocio necesita una: elegí una empresa o entrá desde la consola de plataforma.",
    );
  }
  return ctx;
}

/**
 * Cliente de base de datos del inquilino activo.
 *
 * Reemplaza a `getDb()` en TODA lectura y escritura de negocio.
 */
export async function tenantDb() {
  const ctx = await requireTenant();
  return clientFor(ctx.schemaName);
}

/** Para tareas fuera de una petición (cron, importadores): esquema explícito. */
export function tenantDbFor(schemaName: string) {
  return clientFor(schemaName);
}

/* ============================================================
   Bitácora de acceso de plataforma
   ============================================================ */

/**
 * Registra que alguien de la plataforma entró a la empresa de un cliente.
 *
 * No es opcional ni cosmético: un laboratorio farmacéutico va a preguntar quién
 * de tu equipo vio sus datos y cuándo, y la respuesta no puede ser "no lo
 * sabemos". Se escribe en `platform_events`, que sobrevive incluso si el
 * inquilino se da de baja y su esquema se elimina.
 */
export async function logTenantAccess(args: {
  tenantId: string;
  actorId: string;
  slug: string;
  reason?: string | null;
}) {
  const db = getDb();
  await db.insert(platformEvents).values({
    tenantId: args.tenantId,
    eventType: "tenant.accessed_by_platform",
    actorId: args.actorId,
    payload: { slug: args.slug, motivo: args.reason ?? null },
  });
}
