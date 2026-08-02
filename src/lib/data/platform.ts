import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  memberships,
  platformEvents,
  tenants,
  tenantSchemas,
  users,
} from "@/lib/db/platform";

/**
 * Lecturas del PLANO DE CONTROL. Se consultan con `getDb()` y sin inquilino
 * activo: son justamente lo que hay que leer para saber qué inquilinos existen.
 */

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  plan: string;
  mlContribution: boolean;
  schemaName: string | null;
  migratedVersion: string | null;
  members: number;
  createdAt: Date;
  /** Nulo si el esquema aún no existe: se muestra como tal, no como cero. */
  stats: TenantStats | null;
};

export type TenantStats = {
  tickets: number;
  openTickets: number;
  organizations: number;
  contracts: number;
  equipment: number;
  events: number;
  lastActivity: Date | null;
};

/**
 * Conteos de un inquilino, leídos de SU esquema.
 *
 * Una consulta por inquilino en vez de un `UNION ALL` gigante: con el modelo
 * por esquemas no hay forma de agregarlos en una sola pasada, y ese es
 * precisamente el costo conocido de haber elegido aislamiento físico. Con
 * decenas de inquilinos esto se resuelve con una tabla de resumen que el
 * extractor nocturno mantiene, no consultando en vivo.
 */
async function statsFor(schemaName: string): Promise<TenantStats | null> {
  if (!/^tenant_[a-z0-9_]{1,50}$/.test(schemaName)) return null;
  const db = getDb();
  const s = sql.raw(`"${schemaName}"`);
  try {
    const rows = (await db.execute(sql`
      select
        (select count(*)::int from ${s}."tickets")                          as tickets,
        (select count(*)::int from ${s}."tickets"
          where status in ('open','in_progress','pending_review'))          as open_tickets,
        (select count(*)::int from ${s}."crm_organizations")                as organizations,
        (select count(*)::int from ${s}."contracts")                        as contracts,
        (select count(*)::int from ${s}."equipment")                        as equipment,
        (select count(*)::int from ${s}."domain_events")                    as events,
        (select max(created_at) from ${s}."tickets")                        as last_activity
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0];
    if (!r) return null;
    return {
      tickets: Number(r.tickets ?? 0),
      openTickets: Number(r.open_tickets ?? 0),
      organizations: Number(r.organizations ?? 0),
      contracts: Number(r.contracts ?? 0),
      equipment: Number(r.equipment ?? 0),
      events: Number(r.events ?? 0),
      lastActivity: r.last_activity ? new Date(String(r.last_activity)) : null,
    };
  } catch {
    // El esquema puede existir sin estar migrado, o estar a medio aprovisionar.
    // Devolver null hace que la UI diga "sin datos" en vez de mentir con ceros.
    return null;
  }
}

export async function getTenants(): Promise<TenantRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      plan: tenants.plan,
      mlContribution: tenants.mlContribution,
      createdAt: tenants.createdAt,
      schemaName: tenantSchemas.schemaName,
      migratedVersion: tenantSchemas.migratedVersion,
      members: sql<number>`(
        select count(*)::int from ${memberships}
         where ${memberships.tenantId} = ${tenants.id} and ${memberships.active}
      )`,
    })
    .from(tenants)
    .leftJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .orderBy(tenants.name);

  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      stats: r.schemaName ? await statsFor(r.schemaName) : null,
    })),
  );
}

/** Últimos movimientos de la plataforma: altas, accesos, consentimientos. */
export async function getPlatformEvents(limit = 40) {
  const db = getDb();
  return db
    .select({
      id: platformEvents.id,
      eventType: platformEvents.eventType,
      payload: platformEvents.payload,
      occurredAt: platformEvents.occurredAt,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(platformEvents)
    .leftJoin(tenants, eq(tenants.id, platformEvents.tenantId))
    .leftJoin(users, eq(users.id, platformEvents.actorId))
    .orderBy(desc(platformEvents.id))
    .limit(limit);
}
