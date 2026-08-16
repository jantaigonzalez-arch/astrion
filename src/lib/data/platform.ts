import "server-only";
import { unstable_cache } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  memberships,
  platformEvents,
  tenants,
  tenantSchemas,
  tenantSignups,
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

/** Etiqueta de caché de la marca de una empresa. Ver `getTenantBrand`. */
export const brandTag = (slug: string) => `tenant-brand:${slug}`;

/**
 * Marca de una empresa, por slug.
 *
 * Se consulta con `getDb()` —plano de control— porque la pantalla de acceso la
 * necesita ANTES de que exista sesión, y sin sesión no hay conexión al esquema
 * del inquilino.
 *
 * **Va en caché** porque la pide el layout del portal: una consulta en CADA
 * navegación de CADA usuario, para leer un nombre y la ruta de un logo que
 * cambian, con suerte, una vez al año. Es el ejemplo de libro de dato caliente
 * e inmóvil.
 *
 * Tres decisiones que sostienen que esto sea seguro:
 *
 * - **La clave lleva el slug.** Es lo único que separa la marca de una empresa
 *   de la de otra; sin el slug en la clave, el primer inquilino en cargar le
 *   pondría su logo a todos los demás. `unstable_cache` ya incluye los
 *   argumentos, pero se escribe explícito porque de eso depende el aislamiento.
 * - **No lee cookies ni sesión.** Solo el slug que le pasan. Es requisito de
 *   `unstable_cache` y también la razón por la que aquí no puede haber una fuga:
 *   no hay nada del usuario dentro del alcance cacheado.
 * - **Se invalida al guardar**, por etiqueta, desde `actions/brand.ts`. El
 *   `revalidate` de una hora es la red de seguridad para lo que se cambie por
 *   fuera de la aplicación (una migración, un `update` a mano), no el
 *   mecanismo principal.
 */
export function getTenantBrand(slug: string) {
  return unstable_cache(
    async () => {
      const db = getDb();
      const [row] = await db
        .select({
          name: tenants.name,
          brandName: tenants.brandName,
          logoUrl: tenants.logoUrl,
          folioPrefix: tenants.folioPrefix,
        })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return row ?? null;
    },
    ["tenant-brand", slug],
    { tags: [brandTag(slug)], revalidate: 3600 },
  )();
}

/* ------------------------- Bandeja de solicitudes ------------------------- */

export type SignupRow = {
  id: string;
  companyName: string;
  desiredSlug: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  size: string | null;
  industry: string | null;
  note: string | null;
  locale: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewerName: string | null;
  tenantSlug: string | null;
  /** El identificador propuesto ya lo ocupa un inquilino: hay que corregirlo. */
  slugTaken: boolean;
  /** Cuántas veces pidió este mismo correo. >1 es señal de insistencia o error. */
  attempts: number;
};

/**
 * Solicitudes de alta.
 *
 * Las pendientes primero y, dentro de ellas, la más vieja arriba: una bandeja
 * ordenada por "lo más reciente" hace que lo que nadie atendió se hunda, que es
 * exactamente lo contrario de lo que se necesita aquí.
 */
export async function getSignups(limit = 60): Promise<SignupRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: tenantSignups.id,
      companyName: tenantSignups.companyName,
      desiredSlug: tenantSignups.desiredSlug,
      contactName: tenantSignups.contactName,
      email: tenantSignups.email,
      phone: tenantSignups.phone,
      size: tenantSignups.size,
      industry: tenantSignups.industry,
      note: tenantSignups.note,
      locale: tenantSignups.locale,
      status: tenantSignups.status,
      rejectionReason: tenantSignups.rejectionReason,
      createdAt: tenantSignups.createdAt,
      reviewedAt: tenantSignups.reviewedAt,
      reviewerName: users.name,
      tenantSlug: tenants.slug,
      slugTaken: sql<boolean>`exists (
        select 1 from ${tenants} tt where tt.slug = ${tenantSignups.desiredSlug}
      )`,
      attempts: sql<number>`(
        select count(*)::int from ${tenantSignups} s2 where s2.email = ${tenantSignups.email}
      )`,
    })
    .from(tenantSignups)
    .leftJoin(users, eq(users.id, tenantSignups.reviewedBy))
    .leftJoin(tenants, eq(tenants.id, tenantSignups.tenantId))
    // `pending` primero por orden explícito, no por el orden del enum: si
    // mañana se agrega un estado, esto no cambia de significado en silencio.
    // Dentro de las pendientes, la más vieja arriba (segunda clave; para las
    // ya resueltas la expresión es NULL y empatan); el resto, lo más reciente.
    .orderBy(
      sql`case when ${tenantSignups.status} = 'pending' then 0 else 1 end`,
      sql`case when ${tenantSignups.status} = 'pending' then ${tenantSignups.createdAt} end asc nulls last`,
      desc(tenantSignups.createdAt),
    )
    .limit(limit);

  return rows as SignupRow[];
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
