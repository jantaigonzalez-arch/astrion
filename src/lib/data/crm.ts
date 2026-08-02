import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import {
  contracts,
  crmActivities,
  crmContacts,
  crmDeals,
  crmOrganizations,
  crmPipelines,
  crmStages,
  equipment,
  tickets,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from "@/lib/crm";

/**
 * Garantiza que exista un embudo con etapas. Es idempotente: la primera vez
 * que alguien entra al tablero crea "Ventas Evoelution" con las etapas base,
 * después no hace nada. Evita depender de un seed manual.
 */
export async function ensureDefaultPipeline() {
  const db = await tenantDb();
  const [existing] = await db
    .select({ id: crmPipelines.id })
    .from(crmPipelines)
    .orderBy(asc(crmPipelines.order))
    .limit(1);
  if (existing) return existing.id;

  const [pipeline] = await db
    .insert(crmPipelines)
    .values({ name: DEFAULT_PIPELINE_NAME, order: 0 })
    .returning({ id: crmPipelines.id });

  await db.insert(crmStages).values(
    DEFAULT_STAGES.map((s, i) => ({
      pipelineId: pipeline.id,
      name: s.name,
      probability: s.probability,
      order: i,
    })),
  );
  return pipeline.id;
}

export async function getPipelines() {
  const db = await tenantDb();
  return db.query.crmPipelines.findMany({
    where: eq(crmPipelines.active, true),
    orderBy: [asc(crmPipelines.order)],
    with: { stages: { orderBy: [asc(crmStages.order)] } },
  });
}

export async function getStages(pipelineId: string) {
  const db = await tenantDb();
  return db.query.crmStages.findMany({
    where: eq(crmStages.pipelineId, pipelineId),
    orderBy: [asc(crmStages.order)],
  });
}

/**
 * Tablero kanban: etapas del embudo con sus negocios abiertos.
 * `ownerId` limita la vista a la cartera de un vendedor.
 */
export async function getPipelineBoard(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  const stages = await getStages(pipelineId);

  const deals = await db.query.crmDeals.findMany({
    where: and(
      eq(crmDeals.pipelineId, pipelineId),
      eq(crmDeals.status, "open"),
      ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
    ),
    orderBy: [asc(crmDeals.position), desc(crmDeals.createdAt)],
    with: {
      organization: { columns: { id: true, name: true } },
      contact: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      labelLinks: { with: { label: true } },
    },
  });

  return stages.map((stage) => ({
    stage,
    deals: deals.filter((d) => d.stageId === stage.id),
  }));
}

/** Negocios cerrados (ganados/perdidos) del embudo. */
export async function getClosedDeals(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  return db.query.crmDeals.findMany({
    where: and(
      eq(crmDeals.pipelineId, pipelineId),
      or(eq(crmDeals.status, "won"), eq(crmDeals.status, "lost")),
      ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
    ),
    orderBy: [desc(crmDeals.closedAt)],
    limit: 50,
    with: {
      organization: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      stage: { columns: { id: true, name: true } },
    },
  });
}

export async function getDealById(id: string) {
  const db = await tenantDb();
  return db.query.crmDeals.findFirst({
    where: eq(crmDeals.id, id),
    with: {
      pipeline: { with: { stages: { orderBy: [asc(crmStages.order)] } } },
      stage: true,
      organization: true,
      contact: true,
      owner: { columns: { id: true, name: true, email: true } },
      lead: { columns: { id: true, name: true, email: true, message: true } },
      activities: { orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)] },
      items: { orderBy: (p, { asc: a }) => [a(p.createdAt)] },
      labelLinks: { with: { label: true } },
      notes: {
        orderBy: (n, { desc: d }) => [d(n.createdAt)],
        with: { author: { columns: { id: true, name: true, email: true } } },
      },
      events: {
        orderBy: (e, { desc: d }) => [d(e.createdAt)],
        with: {
          fromStage: { columns: { name: true } },
          toStage: { columns: { name: true } },
          author: { columns: { name: true, email: true } },
        },
      },
    },
  });
}

/* ------------------------- Organizaciones ------------------------- */
export async function getOrganizations(ownerId?: string) {
  const db = await tenantDb();
  return db.query.crmOrganizations.findMany({
    where: ownerId ? eq(crmOrganizations.ownerId, ownerId) : undefined,
    orderBy: [asc(crmOrganizations.name)],
    with: {
      owner: { columns: { id: true, name: true, email: true } },
      client: { columns: { id: true, email: true } },
      contacts: { columns: { id: true } },
      deals: { columns: { id: true, valueMxn: true, status: true } },
    },
  });
}

export async function getOrganizationById(id: string) {
  const db = await tenantDb();
  return db.query.crmOrganizations.findFirst({
    where: eq(crmOrganizations.id, id),
    with: {
      owner: { columns: { id: true, name: true, email: true } },
      client: { columns: { id: true, name: true, email: true } },
      contacts: { orderBy: [asc(crmContacts.name)] },
      deals: {
        orderBy: [desc(crmDeals.createdAt)],
        with: { stage: { columns: { name: true } } },
      },
      activities: {
        orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)],
        limit: 20,
      },
      notes: {
        orderBy: (n, { desc: d }) => [d(n.createdAt)],
        with: { author: { columns: { name: true, email: true } } },
      },
    },
  });
}

/**
 * Vista 360 del laboratorio: lo que ya existe en el resto del portal para la
 * cuenta de cliente enlazada (contratos, equipos y tickets). Devuelve listas
 * vacías si la organización todavía no está vinculada a una cuenta.
 */
export async function getOrganizationPortalData(clientId: string | null) {
  if (!clientId) return { contracts: [], equipment: [], tickets: [] };
  const db = await tenantDb();

  const [contractRows, equipmentRows, ticketRows] = await Promise.all([
    db.query.contracts.findMany({
      where: eq(contracts.clientId, clientId),
      orderBy: [desc(contracts.createdAt)],
      with: { salesRep: { columns: { name: true, email: true } } },
    }),
    db.query.equipment.findMany({
      where: eq(equipment.ownerId, clientId),
      orderBy: [asc(equipment.name)],
      with: { modules: { columns: { id: true } } },
    }),
    db
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(eq(tickets.createdById, clientId))
      .orderBy(desc(tickets.createdAt))
      .limit(10),
  ]);

  return { contracts: contractRows, equipment: equipmentRows, tickets: ticketRows };
}

/**
 * Organizaciones que ya están enlazadas a una cuenta de portal, indexadas por
 * esa cuenta. Sirve para avisar en la lista de usuarios cuáles faltan.
 */
export async function getOrganizationsByClient() {
  const db = await tenantDb();
  const rows = await db
    .select({
      clientId: crmOrganizations.clientId,
      id: crmOrganizations.id,
      name: crmOrganizations.name,
    })
    .from(crmOrganizations)
    .where(sql`${crmOrganizations.clientId} is not null`);

  return new Map(rows.map((r) => [r.clientId as string, r]));
}

/** Contrato generado a partir de un negocio (si ya existe). */
export async function getContractForDeal(dealId: string) {
  const db = await tenantDb();
  const [row] = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      amountMxn: contracts.amountMxn,
    })
    .from(contracts)
    .where(eq(contracts.dealId, dealId))
    .limit(1);
  return row ?? null;
}

/* ------------------------- Contactos ------------------------- */
export async function getContacts(ownerId?: string) {
  const db = await tenantDb();
  return db.query.crmContacts.findMany({
    where: ownerId ? eq(crmContacts.ownerId, ownerId) : undefined,
    orderBy: [asc(crmContacts.name)],
    with: {
      organization: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      deals: { columns: { id: true, status: true } },
    },
  });
}

/* ------------------------- Actividades ------------------------- */
/** Agenda: actividades pendientes primero, ordenadas por vencimiento. */
export async function getActivities(opts?: {
  ownerId?: string;
  onlyPending?: boolean;
}) {
  const db = await tenantDb();
  return db.query.crmActivities.findMany({
    where: and(
      opts?.ownerId ? eq(crmActivities.ownerId, opts.ownerId) : undefined,
      opts?.onlyPending ? eq(crmActivities.done, false) : undefined,
    ),
    orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)],
    limit: 200,
    with: {
      deal: { columns: { id: true, reference: true, title: true } },
      organization: { columns: { id: true, name: true } },
      contact: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
    },
  });
}

/* ------------------------- Métricas ------------------------- */
/** KPIs del embudo: abiertos, valor, ganados/perdidos y actividades vencidas. */
export async function getCrmStats(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  const scope = and(
    eq(crmDeals.pipelineId, pipelineId),
    ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
  );

  const [totals] = await db
    .select({
      openCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'open')::int`,
      openValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'open'), 0)`,
      wonCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'won')::int`,
      wonValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'won'), 0)`,
      lostCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'lost')::int`,
    })
    .from(crmDeals)
    .where(scope);

  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.done, false),
        sql`${crmActivities.dueAt} < now()`,
        ownerId ? eq(crmActivities.ownerId, ownerId) : undefined,
      ),
    );

  const closed = (totals?.wonCount ?? 0) + (totals?.lostCount ?? 0);
  return {
    openCount: totals?.openCount ?? 0,
    openValue: totals?.openValue ?? "0",
    wonCount: totals?.wonCount ?? 0,
    wonValue: totals?.wonValue ?? "0",
    lostCount: totals?.lostCount ?? 0,
    overdueActivities: overdue?.n ?? 0,
    winRate: closed > 0 ? Math.round(((totals?.wonCount ?? 0) / closed) * 100) : null,
  };
}

/* ------------------------- Apoyo para formularios ------------------------- */
/** Responsables posibles de un negocio: vendedores y administradores. */
export async function getCrmOwners() {
  const db = await tenantDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.active, true),
        or(eq(users.role, "sales"), eq(users.role, "admin")),
      ),
    )
    .orderBy(users.name);
}

/** Cuentas de portal (laboratorios) para enlazar una organización ya cliente. */
export async function getClientAccounts() {
  const db = await tenantDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      company: users.company,
    })
    .from(users)
    .where(and(eq(users.active, true), eq(users.role, "client")))
    .orderBy(users.company);
}

/** Listas ligeras para los <select> de los formularios. */
export async function getOrgOptions() {
  const db = await tenantDb();
  return db
    .select({ id: crmOrganizations.id, name: crmOrganizations.name })
    .from(crmOrganizations)
    .orderBy(asc(crmOrganizations.name));
}

export async function getContactOptions() {
  const db = await tenantDb();
  return db
    .select({
      id: crmContacts.id,
      name: crmContacts.name,
      organizationId: crmContacts.organizationId,
    })
    .from(crmContacts)
    .orderBy(asc(crmContacts.name));
}

/** Ids de leads que ya generaron un negocio (para no convertirlos dos veces). */
export async function getConvertedLeadIds() {
  const db = await tenantDb();
  const rows = await db
    .select({ leadId: crmDeals.leadId })
    .from(crmDeals)
    .where(sql`${crmDeals.leadId} is not null`);
  return new Set(rows.map((r) => r.leadId as string));
}

/** Leads del formulario web que aún no se convirtieron en negocio. */
export async function getUnconvertedLeads() {
  const db = await tenantDb();
  const converted = db
    .select({ leadId: crmDeals.leadId })
    .from(crmDeals)
    .where(sql`${crmDeals.leadId} is not null`);

  return db.query.leads.findMany({
    where: (l, { notInArray }) => notInArray(l.id, converted),
    orderBy: (l, { desc: d }) => [d(l.createdAt)],
    limit: 100,
  });
}

export { isNull };
