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
  /** Fin de la prueba. Nulo = no se le acaba. Ver `lib/suscripcion.ts`. */
  trialEndsAt: Date | null;
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
    return r ? filaAStats(r) : null;
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
      trialEndsAt: tenants.trialEndsAt,
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

  const esquemas = rows.map((r) => r.schemaName).filter((x): x is string => Boolean(x));

  // La caché devuelve filas PLANAS y el mapa se arma aquí: ver `statsDeTodos`.
  const planas = await statsDeTodos(esquemas);
  const stats = new Map(
    planas.map((p) => [
      p.esquema,
      { ...p, lastActivity: p.lastActivity ? new Date(p.lastActivity) : null },
    ]),
  );

  return rows.map((r) => ({
    ...r,
    stats: r.schemaName ? (stats.get(r.schemaName) ?? null) : null,
  }));
}

/**
 * Los conteos de TODOS los inquilinos, en una consulta y en caché.
 *
 * ── POR QUÉ UNA Y NO UNA POR INQUILINO ─────────────────────────────────────
 *
 * Era `Promise.all(rows.map(statsFor))`: una consulta por empresa, cada una con
 * seis `count(*)` completos. Medido con 3 inquilinos: 21 consultas y 33 ms. Con
 * 100 serían 700, disparadas a la vez contra un pool de 10 conexiones — así que
 * no solo tarda: hace cola y le quita conexiones al resto del sistema mientras
 * alguien mira un panel.
 *
 * Es la peor forma de escalado que tenía el sistema, porque crece con el número
 * de clientes Y con lo que cada uno haya acumulado. Un `union all` la deja en un
 * solo viaje.
 *
 * ── Y POR QUÉ ADEMÁS EN CACHÉ ──────────────────────────────────────────────
 *
 * Porque el viaje sigue costando lo que cuesta contar filas: seis recorridos
 * completos por inquilino. Juntarlas quita las idas y vueltas, no el trabajo.
 * Cinco minutos de antigüedad en un panel que dice cuán grande es cada empresa
 * no le cambia la decisión a nadie; contar 600 tablas enteras cada vez que
 * alguien abre la consola, sí.
 *
 * No lleva etiqueta de inquilino: esta pantalla es de plataforma y por
 * definición mira a todos. La clave sí lleva la lista de esquemas, así que dar
 * de alta una empresa estrena entrada en vez de heredar la de antes.
 *
 * ── DEVUELVE FILAS PLANAS, NO UN MAPA NI FECHAS ────────────────────────────
 *
 * Lo que entra a esta caché se serializa para guardarse. Un `Map` no sobrevive
 * a ese viaje y un `Date` vuelve convertido en texto, así que la primera
 * versión de esto reventaba la consola entera con un 500. Sale una lista de
 * objetos con tipos primitivos y quien llama arma el mapa y las fechas — que es
 * trabajo de microsegundos y la diferencia entre que funcione y que no.
 *
 * ── LO QUE NO SE HIZO ──────────────────────────────────────────────────────
 *
 * Cambiar los conteos por las estimaciones de `pg_class`, que serían O(1) por
 * inquilino en vez de un recorrido. Habría sido más rápido y habría cambiado lo
 * que la pantalla dice —de «14 151 tickets» a «≈14 000»—, y eso es una decisión
 * de producto, no de rendimiento.
 */
type StatsPlanas = Omit<TenantStats, "lastActivity"> & {
  esquema: string;
  /** ISO, no `Date`: ver la nota de arriba sobre la serialización. */
  lastActivity: string | null;
};

const statsDeTodos = unstable_cache(
  async (esquemas: string[]): Promise<StatsPlanas[]> => {
    // Se valida cada nombre: van interpolados, no parametrizados.
    const validos = esquemas.filter((e) => /^tenant_[a-z0-9_]{1,50}$/.test(e));
    if (validos.length === 0) return [];

    const db = getDb();
    const ramas = validos.map(
      (e) => `select
        '${e}'                                                            as esquema,
        (select count(*)::int from "${e}"."tickets")                      as tickets,
        (select count(*)::int from "${e}"."tickets"
          where status in ('open','in_progress','pending_review'))        as open_tickets,
        (select count(*)::int from "${e}"."crm_organizations")            as organizations,
        (select count(*)::int from "${e}"."contracts")                    as contracts,
        (select count(*)::int from "${e}"."equipment")                    as equipment,
        (select count(*)::int from "${e}"."domain_events")                as events,
        (select max(created_at) from "${e}"."tickets")                    as last_activity`,
    );

    const out: StatsPlanas[] = [];

    // Rama a rama si la consulta única falla: un esquema a medio aprovisionar
    // —existe pero no está migrado— tumba el `union all` entero, y entonces la
    // consola se quedaría sin cifras de NADIE por culpa de uno. Es el mismo
    // criterio del `catch` de `statsFor`, aplicado al conjunto.
    try {
      const filas = (await db.execute(
        sql.raw(ramas.join("\nunion all\n")),
      )) as unknown as Array<Record<string, unknown>>;
      for (const r of filas) out.push(filaAPlana(String(r.esquema), r));
      return out;
    } catch {
      const sueltos = await Promise.all(
        validos.map(async (e) => [e, await statsFor(e)] as const),
      );
      for (const [esquema, st] of sueltos) {
        if (!st) continue;
        out.push({
          ...st,
          esquema,
          lastActivity: st.lastActivity ? st.lastActivity.toISOString() : null,
        });
      }
      return out;
    }
  },
  ["platform-tenant-stats"],
  { tags: ["platform-tenant-stats"], revalidate: 300 },
);

/** La fila cruda del conteo, en tipos que sobreviven a la caché. */
function filaAPlana(esquema: string, r: Record<string, unknown>): StatsPlanas {
  return {
    esquema,
    tickets: Number(r.tickets ?? 0),
    openTickets: Number(r.open_tickets ?? 0),
    organizations: Number(r.organizations ?? 0),
    contracts: Number(r.contracts ?? 0),
    equipment: Number(r.equipment ?? 0),
    events: Number(r.events ?? 0),
    lastActivity: r.last_activity ? new Date(String(r.last_activity)).toISOString() : null,
  };
}

/** Lo mismo para UN esquema, con `Date` de vuelta. Lo usa `statsFor`. */
function filaAStats(r: Record<string, unknown>): TenantStats {
  const plana = filaAPlana("", r);
  return {
    tickets: plana.tickets,
    openTickets: plana.openTickets,
    organizations: plana.organizations,
    contracts: plana.contracts,
    equipment: plana.equipment,
    events: plana.events,
    lastActivity: plana.lastActivity ? new Date(plana.lastActivity) : null,
  };
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
          /*
            EL MEMBRETE VIAJA EN LA MISMA FILA, y no en una consulta aparte.

            Es la misma fila de `tenants`, el mismo caché y la misma etiqueta de
            invalidación: pedirlo por separado serían dos consultas y dos cachés
            que pueden discrepar —el logo nuevo con el pie viejo— sin que nadie
            entienda por qué. El layout no lo usa y no le cuesta nada llevarlo:
            son cinco columnas de texto en una fila que ya se está leyendo.
          */
          documentLogoUrl: tenants.documentLogoUrl,
          tagline: tenants.tagline,
          contactAddress: tenants.contactAddress,
          contactPhone: tenants.contactPhone,
          contactEmail: tenants.contactEmail,
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

/* ═══════════════════ Capacidad de la plataforma ═══════════════════ */

export type UsoDeRecurso = {
  etiqueta: string;
  usado: number;
  techo: number;
  /** Cómo se escribe el valor: «70 de 300», «18 MB de 43 GB». */
  sufijo?: string;
  /** Por qué ese techo es el techo. Se enseña bajo la barra. */
  nota: string;
};

export type CapacidadPlataforma = {
  recursos: UsoDeRecurso[];
  /** Peso de cada inquilino, en MB. Otro eje, por eso va en otro gráfico. */
  porInquilino: Array<{ etiqueta: string; mb: number }>;
  /** Lo que la base NO puede saber, dicho en la pantalla. */
  fueraDeAlcance: string;
};

/**
 * QUÉ TAN LLENA ESTÁ LA PLATAFORMA, con lo que la base sabe de sí misma.
 *
 * ── POR QUÉ NO SALE NI CPU NI RAM ──────────────────────────────────────────
 *
 * Porque la aplicación corre DENTRO de un contenedor y desde ahí `/proc` habla
 * del contenedor, no del anfitrión: leerlo daría un número que parece una
 * medición y no lo es. Sacarlo de verdad pide montar métricas del sistema, que
 * es infraestructura nueva para un dato que hoy dice «sobra de todo» —la carga
 * del servidor no pasa de 0,13 con dos núcleos—.
 *
 * Así que esta pantalla enseña SOLO lo que Postgres puede responder de sí mismo
 * y lo que el código declara como techo, y dice en voz alta lo que deja fuera.
 * Un tablero de capacidad que calla sus puntos ciegos es peor que no tenerlo:
 * hace creer que la respuesta está completa.
 *
 * ── EL TECHO DE EMPRESAS NO ES DEL SERVIDOR, ES DEL CÓDIGO ────────────────
 *
 * `connectionCeiling()` deriva de `DB_TENANT_CONN_BUDGET` y `DB_TENANT_POOL_MAX`
 * cuántos inquilinos pueden estar TRABAJANDO a la vez. No es cuántos caben dados
 * de alta —eso lo limita el disco, y con inquilinos de decenas de megas está
 * lejos— sino cuántos pueden tener su pool abierto al mismo tiempo. Es el número
 * que se toca cuando hace falta más, y por eso se enseña junto a lo que consume
 * de `max_connections`, que es contra lo que hay que compararlo.
 */
export async function capacidadDePlataforma(): Promise<CapacidadPlataforma> {
  const db = getDb();
  const { connectionCeiling } = await import("@/lib/tenancy/context");
  const techo = connectionCeiling();

  const [ajustes] = (await db.execute(sql`
    select current_setting('max_connections')::int as max_conexiones,
           (select count(*)::int from pg_stat_activity) as en_uso
  `)) as unknown as Array<{ max_conexiones: number; en_uso: number }>;

  const tamanos = (await db.execute(sql`
    select n.nspname as esquema,
           (sum(pg_total_relation_size(c.oid)) / 1048576.0)::float8 as mb
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname like 'tenant_%'
     group by n.nspname
     order by 2 desc
  `)) as unknown as Array<{ esquema: string; mb: number }>;

  const [inquilinos] = (await db.execute(sql`
    select count(*)::int as n from tenants
  `)) as unknown as Array<{ n: number }>;

  const maxConn = Number(ajustes?.max_conexiones ?? 0);
  const enUso = Number(ajustes?.en_uso ?? 0);

  return {
    recursos: [
      {
        etiqueta: "Conexiones abiertas ahora",
        usado: enUso,
        techo: maxConn,
        sufijo: "conexiones",
        nota: "Lo que hay conectado en este instante, contra el máximo de Postgres.",
      },
      {
        etiqueta: "Conexiones reservadas en el peor caso",
        usado: techo.techoTotal,
        techo: maxConn,
        sufijo: "conexiones",
        nota: `${techo.poolsEnCache} empresas × ${techo.porInquilino} conexiones, más ${techo.techoControl} del plano de control. Es el tope que el código se permite, no lo que usa.`,
      },
      {
        etiqueta: "Empresas dadas de alta",
        usado: Number(inquilinos?.n ?? 0),
        techo: techo.poolsEnCache,
        sufijo: "empresas",
        nota: `El techo es cuántas pueden estar TRABAJANDO a la vez. Pasado ese número siguen entrando: la que lleva más tiempo inactiva cierra su pool y la siguiente paga una reconexión de milisegundos.`,
      },
    ],
    porInquilino: tamanos.map((t) => ({
      etiqueta: t.esquema.replace(/^tenant_/, ""),
      mb: Math.round(Number(t.mb) * 10) / 10,
    })),
    fueraDeAlcance:
      "CPU y memoria del servidor no aparecen: `/proc` está acotado por cgroups, así que desde el contenedor solo se ve lo suyo y medirlas de verdad pide métricas del sistema. El DISCO sí se mide —los volúmenes montados viven en el anfitrión— y está abajo; se dio por imposible junto con las otras dos y no lo era.",
  };
}
