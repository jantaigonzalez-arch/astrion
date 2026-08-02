/**
 * Seed demo del CRM. Ejecuta:  npm run db:seed:crm
 * Crea organizaciones, contactos, negocios y actividades de ejemplo para
 * poder probar el tablero (drag & drop) desde el primer momento.
 * Es idempotente: si ya existen negocios, no vuelve a insertar.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { asc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import * as platform from "../src/lib/db/platform";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES, dealReference } from "../src/lib/crm";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL en .env.local");

  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  // 1) Embudo con etapas (igual que ensureDefaultPipeline en la app).
  let [pipeline] = await db
    .select()
    .from(schema.crmPipelines)
    .orderBy(asc(schema.crmPipelines.order))
    .limit(1);

  if (!pipeline) {
    [pipeline] = await db
      .insert(schema.crmPipelines)
      .values({ name: DEFAULT_PIPELINE_NAME, order: 0 })
      .returning();
    await db.insert(schema.crmStages).values(
      DEFAULT_STAGES.map((s, i) => ({
        pipelineId: pipeline.id,
        name: s.name,
        probability: s.probability,
        order: i,
      })),
    );
    console.log("· Embudo creado:", pipeline.name);
  }

  const stages = await db
    .select()
    .from(schema.crmStages)
    .where(eq(schema.crmStages.pipelineId, pipeline.id))
    .orderBy(asc(schema.crmStages.order));

  const [{ dealCount }] = await db
    .select({ dealCount: sql<number>`count(*)::int` })
    .from(schema.crmDeals);
  if (dealCount > 0) {
    console.log(`· Ya hay ${dealCount} negocio(s); no se insertan demos.`);
    await client.end();
    return;
  }

  // 2) Responsable: el primer admin/vendedor activo.
  const [owner] = await db
    .select()
    .from(platform.users)
    .where(inArray(platform.users.role, ["admin", "sales"]))
    .limit(1);

  // 3) Organizaciones demo.
  const orgs = await db
    .insert(schema.crmOrganizations)
    .values([
      {
        name: "Laboratorios Genoma S.A. de C.V.",
        industry: "Farmacéutica",
        phone: "55 5512 3344",
        ownerId: owner?.id ?? null,
      },
      {
        name: "Analítica del Bajío",
        industry: "Alimentos y bebidas",
        phone: "477 210 8890",
        ownerId: owner?.id ?? null,
      },
      {
        name: "CIATEC — Centro de Innovación",
        industry: "Investigación",
        ownerId: owner?.id ?? null,
      },
    ])
    .returning();

  // 4) Contactos demo.
  const contacts = await db
    .insert(schema.crmContacts)
    .values([
      {
        name: "Q.F.B. Mariana Ruiz",
        position: "Jefa de Control de Calidad",
        email: "mariana.ruiz@labgenoma.mx",
        phone: "55 5512 3345",
        organizationId: orgs[0].id,
        ownerId: owner?.id ?? null,
      },
      {
        name: "Ing. Daniel Ortega",
        position: "Coordinador de Laboratorio",
        email: "d.ortega@analiticabajio.mx",
        organizationId: orgs[1].id,
        ownerId: owner?.id ?? null,
      },
      {
        name: "Dra. Paula Sandoval",
        position: "Investigadora titular",
        email: "psandoval@ciatec.mx",
        organizationId: orgs[2].id,
        ownerId: owner?.id ?? null,
      },
    ])
    .returning();

  // 5) Negocios repartidos en el embudo.
  const demo = [
    {
      title: "Contrato anual de mantenimiento HPLC (3 equipos)",
      stage: 0,
      valueMxn: "185000",
      valueUsd: "9800",
      org: 0,
      contact: 0,
      source: "referido",
    },
    {
      title: "Validación IQ/OQ/PQ de UHPLC Waters",
      stage: 1,
      valueMxn: "96000",
      org: 1,
      contact: 1,
      source: "web_contact",
    },
    {
      title: "Capacitación en troubleshooting cromatográfico",
      stage: 2,
      valueMxn: "48000",
      org: 2,
      contact: 2,
      source: "congreso",
    },
    {
      title: "Renovación de columnas y consumibles 2026",
      stage: 3,
      valueMxn: "132500",
      org: 0,
      contact: 0,
      source: "cliente_existente",
    },
  ];

  const today = new Date();
  const inDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d;
  };

  for (let i = 0; i < demo.length; i++) {
    const d = demo[i];
    const stage = stages[Math.min(d.stage, stages.length - 1)];
    const [deal] = await db
      .insert(schema.crmDeals)
      .values({
        reference: dealReference(i + 1),
        title: d.title,
        pipelineId: pipeline.id,
        stageId: stage.id,
        organizationId: orgs[d.org].id,
        contactId: contacts[d.contact].id,
        ownerId: owner?.id ?? null,
        valueMxn: d.valueMxn,
        valueUsd: d.valueUsd ?? null,
        source: d.source,
        expectedCloseDate: inDays(20 + i * 12).toISOString().slice(0, 10),
        position: 0,
      })
      .returning();

    await db.insert(schema.crmDealEvents).values({
      dealId: deal.id,
      toStageId: stage.id,
      status: "open",
      authorId: owner?.id ?? null,
    });
  }

  // 6) Un par de actividades: una vencida y una futura.
  const [firstDeal] = await db
    .select()
    .from(schema.crmDeals)
    .orderBy(asc(schema.crmDeals.createdAt))
    .limit(1);

  await db.insert(schema.crmActivities).values([
    {
      type: "call",
      subject: "Llamar para confirmar recepción de la cotización",
      dealId: firstDeal.id,
      organizationId: orgs[0].id,
      contactId: contacts[0].id,
      ownerId: owner?.id ?? null,
      createdById: owner?.id ?? null,
      dueAt: inDays(-2),
    },
    {
      type: "visit",
      subject: "Visita técnica al laboratorio para levantamiento",
      dealId: firstDeal.id,
      organizationId: orgs[0].id,
      ownerId: owner?.id ?? null,
      createdById: owner?.id ?? null,
      dueAt: inDays(5),
    },
  ]);

  console.log(
    `✓ CRM demo: ${orgs.length} organizaciones, ${contacts.length} contactos, ${demo.length} negocios, 2 actividades.`,
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
