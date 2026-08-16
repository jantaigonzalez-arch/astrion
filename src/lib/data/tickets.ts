import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { tickets, ticketComments, leads } from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import { ACTIVE_STATUSES, QUEUE_STATUSES } from "@/lib/tickets";
import type { MembershipRole } from "@/lib/db/platform";

/**
 * Columnas mínimas de una fila de lista.
 *
 * Las listas del panel muestran folio, asunto y dos insignias: nada más. Traer
 * la fila entera con sus relaciones costaba el doble de bytes por ticket y
 * obligaba a un join que ningún píxel llegaba a usar.
 */
const listColumns = {
  id: tickets.id,
  reference: tickets.reference,
  subject: tickets.subject,
  status: tickets.status,
  priority: tickets.priority,
  category: tickets.category,
  createdAt: tickets.createdAt,
};

export async function getTicketsForUser(
  userId: string,
  { limit, offset = 0 }: { limit?: number; offset?: number } = {},
) {
  const db = await tenantDb();
  return db.query.tickets.findMany({
    where: eq(tickets.createdById, userId),
    orderBy: [desc(tickets.createdAt)],
    with: { assignedTo: { columns: { name: true, email: true } } },
    limit,
    offset: limit ? offset : undefined,
  });
}

/** Cuántos tickets tiene una persona, para paginar los suyos. */
export async function countTicketsForUser(userId: string) {
  const db = await tenantDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(eq(tickets.createdById, userId));
  return row?.n ?? 0;
}

export async function getAllTickets(
  status?: string,
  { limit, offset = 0 }: { limit?: number; offset?: number } = {},
) {
  const db = await tenantDb();
  return db.query.tickets.findMany({
    where: status ? eq(tickets.status, status as never) : undefined,
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { name: true, email: true } },
    },
    limit,
    offset: limit ? offset : undefined,
  });
}

/* ============================================================
   La cola del staff
   ============================================================ */

/**
 * Los tres números del encabezado de la cola, en una consulta.
 *
 * Antes salían de contar en memoria las 602 filas que la pantalla ya había
 * traído. Ahora que la tabla está paginada esa fuente ya no existe —y menos mal:
 * el encabezado tiene que decir el total de la EMPRESA, no el de la página que
 * se está mirando—. Es un solo barrido agregado en vez de tres consultas.
 */
export async function getQueueCounts() {
  const db = await tenantDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending_review')::int`,
      unassigned: sql<number>`count(*) filter (
        where ${tickets.assignedToId} is null
          and ${tickets.status} in ('open','in_progress','waiting')
      )::int`,
      // Compromiso de primera respuesta incumplido y todavía incumplible: el
      // plazo pasó, nadie ha contestado en público y el ticket sigue vivo. Los
      // cerrados sin respuesta no entran —ya no hay nada que correr— y los
      // importados tampoco, porque nacieron sin plazo. Ver `slaState`.
      slaBreached: sql<number>`count(*) filter (
        where ${tickets.slaDueAt} is not null
          and ${tickets.firstRespondedAt} is null
          and ${tickets.slaDueAt} < now()
          and ${tickets.status} in ('pending_review','open','in_progress','waiting')
      )::int`,
    })
    .from(tickets);

  return {
    total: row?.total ?? 0,
    pending: row?.pending ?? 0,
    unassigned: row?.unassigned ?? 0,
    slaBreached: row?.slaBreached ?? 0,
  };
}

/**
 * Solicitudes esperando aprobación.
 *
 * Van acotadas aunque sean pocas. "Son pocas" es una afirmación sobre los datos
 * de hoy, y la bandeja de pendientes es justo la que se desborda cuando alguien
 * se va de vacaciones: es la lista que menos conviene dejar sin techo.
 */
export async function getPendingReviewTickets(limit = 20) {
  const db = await tenantDb();
  return db.query.tickets.findMany({
    where: eq(tickets.status, "pending_review"),
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { name: true, email: true } },
    },
    limit,
  });
}

/**
 * La cola propiamente dicha: todo lo que NO espera revisión, por página.
 *
 * Las pendientes se excluyen porque ya tienen su propia sección arriba;
 * enseñarlas dos veces hacía que el operador atendiera la misma solicitud desde
 * dos sitios.
 */
export async function getQueuePage({
  limit,
  offset,
  onlyBreached = false,
}: {
  limit: number;
  offset: number;
  /** Solo lo que ya incumplió el compromiso de primera respuesta. */
  onlyBreached?: boolean;
}) {
  const db = await tenantDb();
  return db.query.tickets.findMany({
    // El filtro de incumplidos repite la MISMA condición que el conteo del
    // encabezado. Si divergieran, la cifra de arriba y la lista de abajo
    // dirían cosas distintas sobre lo mismo, que es la forma más rápida de que
    // nadie vuelva a creerle al tablero.
    where: onlyBreached
      ? sql`${tickets.slaDueAt} is not null
            and ${tickets.firstRespondedAt} is null
            and ${tickets.slaDueAt} < now()
            and ${tickets.status} in ('pending_review','open','in_progress','waiting')`
      : sql`${tickets.status} <> 'pending_review'`,
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { name: true, email: true } },
    },
    limit,
    offset,
  });
}

export async function getTicketById(id: string) {
  const db = await tenantDb();
  return db.query.tickets.findFirst({
    where: eq(tickets.id, id),
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { id: true, name: true, email: true } },
      equipment: true,
      module: true,
      comments: {
        orderBy: [ticketComments.createdAt],
        with: {
          // `id` para poder resolver el rol del autor por membresía: el rol ya
          // no es una columna de la cuenta, es su papel EN ESTA empresa.
          author: { columns: { id: true, name: true, email: true } },
          // Componente al que se refiere cada actividad de la bitácora.
          equipment: true,
          module: true,
          submodule: true,
          parts: true,
        },
      },
    },
  });
}

export async function getDashboardStats(role: MembershipRole, userId: string) {
  const db = await tenantDb();
  const scope =
    role === "client" ? eq(tickets.createdById, userId) : undefined;

  const rows = await db
    .select({ status: tickets.status, count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(scope)
    .groupBy(tickets.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return {
    total,
    open: byStatus["open"] ?? 0,
    inProgress: byStatus["in_progress"] ?? 0,
    resolved: byStatus["resolved"] ?? 0,
    closed: byStatus["closed"] ?? 0,
  };
}

export async function getLeads() {
  const db = await tenantDb();
  return db.select().from(leads).orderBy(desc(leads.createdAt));
}

// El padrón de la empresa activa, activos e inactivos: es la pantalla desde la
// que se reactiva a alguien, así que ocultar a los inactivos la dejaría sin uso.
export async function getUsers() {
  return listTenantMembers({ orderBy: "createdAt", includeInactive: true });
}

// Personal que puede atender tickets: agentes, administradores y el dueño.
export async function getAgents() {
  return listTenantMembers({ roles: ["agent", "admin", "owner"] });
}

/* ============================================================
   Consultas del panel: acotadas por definición
   ============================================================

   El panel pinta seis filas por tarjeta y una insignia con el total. Antes las
   sacaba de `getAllTickets()` —602 filas con dos joins— y recortaba con
   `.slice(0, 6)` en el JSX: el 99 % de lo leído se tiraba, y el costo crecía
   con el histórico de la empresa mientras la pantalla siempre enseñaba lo
   mismo.

   El conteo viaja en la misma consulta con `count(*) over ()`, que Postgres
   resuelve sobre el resultado ANTES del límite. La alternativa —una consulta
   de lista y otra de conteo— duplica los viajes y abre la puerta a que la
   insignia diga 12 y la lista enseñe 5 de otro instante. */

/** Los últimos tickets: propios si es cliente, de toda la empresa si es staff. */
export async function getRecentTickets(
  opts: { ownerId?: string; limit?: number } = {},
) {
  const db = await tenantDb();
  return db
    .select(listColumns)
    .from(tickets)
    .where(opts.ownerId ? eq(tickets.createdById, opts.ownerId) : undefined)
    .orderBy(desc(tickets.createdAt))
    .limit(opts.limit ?? 6);
}

/** Carga viva de un agente: lo asignado a él que todavía no está cerrado. */
export async function getMyActiveTickets(agentId: string, limit = 5) {
  const db = await tenantDb();
  const rows = await db
    .select({ ...listColumns, total: sql<number>`count(*) over ()::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.assignedToId, agentId),
        inArray(tickets.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(limit);

  return { rows, total: rows[0]?.total ?? 0 };
}

/** La cola sin dueño: trabajo aceptado que nadie tomó. */
export async function getUnassignedTickets(limit = 5) {
  const db = await tenantDb();
  const rows = await db
    .select({ ...listColumns, total: sql<number>`count(*) over ()::int` })
    .from(tickets)
    .where(
      and(
        isNull(tickets.assignedToId),
        inArray(tickets.status, [...QUEUE_STATUSES]),
      ),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(limit);

  return { rows, total: rows[0]?.total ?? 0 };
}

// `getTicketsAssignedTo` vivía aquí: traía TODOS los tickets de un agente, con
// join, para que el panel filtrara los cerrados en JavaScript y enseñara cinco.
// Lo reemplaza `getMyActiveTickets`, que filtra y limita en la consulta.
