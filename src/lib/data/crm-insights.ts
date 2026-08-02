import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  crmActivities,
  crmAutomations,
  crmContacts,
  crmDeals,
  crmEmailTemplates,
  crmGoals,
  crmLabels,
  crmOrganizations,
  crmStages,
  products,
  spareParts,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";

/* ========================= Informes ========================= */

/** Embudo: negocios abiertos por etapa (conteo, valor y valor ponderado). */
export async function getFunnelByStage(pipelineId: string, ownerId?: string) {
  const db = getDb();
  const rows = await db
    .select({
      stageId: crmStages.id,
      name: crmStages.name,
      probability: crmStages.probability,
      order: crmStages.order,
      count: sql<number>`count(${crmDeals.id})::int`,
      value: sql<string>`coalesce(sum(${crmDeals.valueMxn}), 0)`,
    })
    .from(crmStages)
    .leftJoin(
      crmDeals,
      and(
        eq(crmDeals.stageId, crmStages.id),
        eq(crmDeals.status, "open"),
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    )
    .where(eq(crmStages.pipelineId, pipelineId))
    .groupBy(crmStages.id, crmStages.name, crmStages.probability, crmStages.order)
    .orderBy(asc(crmStages.order));

  return rows.map((r) => ({
    ...r,
    weighted: (Number(r.value) * r.probability) / 100,
  }));
}

/** Cerrados por mes (últimos 12): ganados vs perdidos. */
export async function getMonthlyClosed(pipelineId: string, ownerId?: string) {
  const db = getDb();
  return db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${crmDeals.closedAt}), 'YYYY-MM')`,
      wonValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'won'), 0)`,
      wonCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'won')::int`,
      lostCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'lost')::int`,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.pipelineId, pipelineId),
        sql`${crmDeals.closedAt} is not null`,
        sql`${crmDeals.closedAt} > now() - interval '12 months'`,
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('month', ${crmDeals.closedAt})`)
    .orderBy(sql`date_trunc('month', ${crmDeals.closedAt})`);
}

/** Pronóstico: negocios abiertos agrupados por mes de cierre estimado. */
export async function getForecastByMonth(pipelineId: string, ownerId?: string) {
  const db = getDb();
  return db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${crmDeals.expectedCloseDate}), 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${crmDeals.valueMxn}), 0)`,
      weighted: sql<string>`coalesce(sum(${crmDeals.valueMxn} * ${crmStages.probability} / 100.0), 0)`,
    })
    .from(crmDeals)
    .innerJoin(crmStages, eq(crmDeals.stageId, crmStages.id))
    .where(
      and(
        eq(crmDeals.pipelineId, pipelineId),
        eq(crmDeals.status, "open"),
        sql`${crmDeals.expectedCloseDate} is not null`,
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    )
    .groupBy(sql`date_trunc('month', ${crmDeals.expectedCloseDate})`)
    .orderBy(sql`date_trunc('month', ${crmDeals.expectedCloseDate})`);
}

/** Ranking de vendedores por monto ganado. */
export async function getOwnerRanking(pipelineId: string) {
  const db = getDb();
  return db
    .select({
      ownerId: crmDeals.ownerId,
      name: users.name,
      email: users.email,
      wonValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'won'), 0)`,
      wonCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'won')::int`,
      openCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'open')::int`,
      lostCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'lost')::int`,
    })
    .from(crmDeals)
    .leftJoin(users, eq(crmDeals.ownerId, users.id))
    .where(eq(crmDeals.pipelineId, pipelineId))
    .groupBy(crmDeals.ownerId, users.name, users.email)
    .orderBy(desc(sql`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'won'), 0)`));
}

/** Motivos de pérdida más frecuentes. */
export async function getLostReasons(pipelineId: string, ownerId?: string) {
  const db = getDb();
  return db
    .select({
      reason: crmDeals.lostReason,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${crmDeals.valueMxn}), 0)`,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.pipelineId, pipelineId),
        eq(crmDeals.status, "lost"),
        sql`${crmDeals.lostReason} is not null and ${crmDeals.lostReason} <> ''`,
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    )
    .groupBy(crmDeals.lostReason)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
}

/** Origen de los negocios (de dónde vienen las oportunidades). */
export async function getSourceBreakdown(pipelineId: string) {
  const db = getDb();
  return db
    .select({
      source: crmDeals.source,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${crmDeals.valueMxn}), 0)`,
    })
    .from(crmDeals)
    .where(eq(crmDeals.pipelineId, pipelineId))
    .groupBy(crmDeals.source)
    .orderBy(desc(sql`count(*)`));
}

/**
 * Duración media (días) que tarda un negocio en cerrarse.
 * Solo considera negocios ya cerrados.
 */
export async function getAvgCycleDays(pipelineId: string, ownerId?: string) {
  const db = getDb();
  const [row] = await db
    .select({
      days: sql<string>`coalesce(avg(extract(epoch from (${crmDeals.closedAt} - ${crmDeals.createdAt})) / 86400), 0)`,
    })
    .from(crmDeals)
    .where(
      and(
        eq(crmDeals.pipelineId, pipelineId),
        sql`${crmDeals.closedAt} is not null`,
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    );
  return Math.round(Number(row?.days ?? 0));
}

/* ========================= Negocios estancados ========================= */

/**
 * Negocios abiertos que superaron el límite de días sin movimiento de su
 * etapa. Equivale al "rotting" de Pipedrive.
 */
export async function getRottingDeals(pipelineId: string, ownerId?: string) {
  const db = getDb();
  return db
    .select({
      id: crmDeals.id,
      reference: crmDeals.reference,
      title: crmDeals.title,
      valueMxn: crmDeals.valueMxn,
      updatedAt: crmDeals.updatedAt,
      stageName: crmStages.name,
      rottingDays: crmStages.rottingDays,
      idleDays: sql<number>`floor(extract(epoch from (now() - ${crmDeals.updatedAt})) / 86400)::int`,
    })
    .from(crmDeals)
    .innerJoin(crmStages, eq(crmDeals.stageId, crmStages.id))
    .where(
      and(
        eq(crmDeals.pipelineId, pipelineId),
        eq(crmDeals.status, "open"),
        sql`${crmStages.rottingDays} > 0`,
        sql`${crmDeals.updatedAt} < now() - (${crmStages.rottingDays} || ' days')::interval`,
        ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
      ),
    )
    .orderBy(asc(crmDeals.updatedAt));
}

/* ========================= Objetivos ========================= */

/** Objetivos con su avance real calculado sobre los negocios ganados. */
export async function getGoalsWithProgress() {
  const db = getDb();
  const goals = await db.query.crmGoals.findMany({
    orderBy: [desc(crmGoals.periodStart)],
    with: {
      owner: { columns: { id: true, name: true, email: true } },
      pipeline: { columns: { id: true, name: true } },
    },
  });

  return Promise.all(
    goals.map(async (g) => {
      const [row] = await db
        .select({
          value: sql<string>`coalesce(sum(${crmDeals.valueMxn}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.status, "won"),
            g.ownerId ? eq(crmDeals.ownerId, g.ownerId) : undefined,
            g.pipelineId ? eq(crmDeals.pipelineId, g.pipelineId) : undefined,
            sql`${crmDeals.closedAt} >= ${g.periodStart}::date`,
            sql`${crmDeals.closedAt} < (${g.periodEnd}::date + interval '1 day')`,
          ),
        );

      const achieved = g.metric === "count" ? (row?.count ?? 0) : Number(row?.value ?? 0);
      const target = Number(g.target);
      return {
        ...g,
        achieved,
        pct: target > 0 ? Math.min(999, Math.round((achieved / target) * 100)) : 0,
      };
    }),
  );
}

/* ========================= Catálogos auxiliares ========================= */

export async function getLabels() {
  const db = getDb();
  return db.select().from(crmLabels).orderBy(asc(crmLabels.name));
}

export async function getEmailTemplates() {
  const db = getDb();
  return db.select().from(crmEmailTemplates).orderBy(asc(crmEmailTemplates.name));
}

export async function getAutomations() {
  const db = getDb();
  return db.query.crmAutomations.findMany({
    orderBy: [asc(crmAutomations.name)],
    with: { triggerStage: { columns: { id: true, name: true } } },
  });
}

/** Catálogo combinado para las líneas de un negocio: productos y refacciones. */
export async function getCatalogOptions() {
  const db = getDb();
  const [prods, parts] = await Promise.all([
    db
      .select({ id: products.id, name: products.nameEs })
      .from(products)
      .where(eq(products.published, true))
      .orderBy(asc(products.nameEs)),
    db
      .select({
        id: spareParts.id,
        partNumber: spareParts.partNumber,
        description: spareParts.description,
        priceMxn: spareParts.priceMxn,
      })
      .from(spareParts)
      .where(eq(spareParts.active, true))
      .orderBy(asc(spareParts.partNumber)),
  ]);
  return { products: prods, parts };
}

/* ========================= Búsqueda global ========================= */

/** Busca en negocios, organizaciones, contactos y actividades a la vez. */
export async function globalSearch(q: string) {
  const term = `%${q.trim()}%`;
  if (q.trim().length < 2) {
    return { deals: [], organizations: [], contacts: [], activities: [] };
  }
  const db = getDb();

  const [deals, organizations, contacts, activities] = await Promise.all([
    db
      .select({
        id: crmDeals.id,
        reference: crmDeals.reference,
        title: crmDeals.title,
        valueMxn: crmDeals.valueMxn,
        status: crmDeals.status,
      })
      .from(crmDeals)
      .where(or(ilike(crmDeals.title, term), ilike(crmDeals.reference, term)))
      .limit(15),
    db
      .select({
        id: crmOrganizations.id,
        name: crmOrganizations.name,
        industry: crmOrganizations.industry,
      })
      .from(crmOrganizations)
      .where(
        or(
          ilike(crmOrganizations.name, term),
          ilike(crmOrganizations.industry, term),
        ),
      )
      .limit(15),
    db
      .select({
        id: crmContacts.id,
        name: crmContacts.name,
        email: crmContacts.email,
        organizationId: crmContacts.organizationId,
      })
      .from(crmContacts)
      .where(
        or(
          ilike(crmContacts.name, term),
          ilike(crmContacts.email, term),
          ilike(crmContacts.phone, term),
        ),
      )
      .limit(15),
    db
      .select({
        id: crmActivities.id,
        subject: crmActivities.subject,
        dealId: crmActivities.dealId,
        done: crmActivities.done,
      })
      .from(crmActivities)
      .where(ilike(crmActivities.subject, term))
      .limit(10),
  ]);

  return { deals, organizations, contacts, activities };
}
