"use server";

import { revalidateTenant } from "@/lib/revalidate";
import { and, eq } from "drizzle-orm";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { crmAutomations, crmDealLabels, crmDealProducts, crmDeals, crmEmailTemplates, crmGoals, crmLabels, crmStages } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { lineTotal } from "@/lib/crm";
import { recordDeletion } from "@/lib/domain/events";

async function requireSales() {
  const session = await auth();
  if (!(await puedeEn("ventas", "editar"))) return null;
  return session!;
}

async function requireAdmin() {
  const session = await auth();
  if (!(await puedeEn("ventas", "administrar"))) return null;
  return session!;
}

/* ========================= Líneas de producto ========================= */

/**
 * Recalcula el valor del negocio como la suma de sus líneas.
 * Igual que Pipedrive: si el negocio tiene productos, el valor deja de ser
 * un número suelto y pasa a derivarse de la cotización.
 */
async function recalcDealValue(dealId: string) {
  const db = await tenantDb();
  const items = await db
    .select({
      quantity: crmDealProducts.quantity,
      unitPriceMxn: crmDealProducts.unitPriceMxn,
      discountPct: crmDealProducts.discountPct,
    })
    .from(crmDealProducts)
    .where(eq(crmDealProducts.dealId, dealId));

  // Sin líneas, el valor se BORRA en vez de dejarse como estaba.
  //
  // Antes había un `if (items.length === 0) return;` y el efecto era un importe
  // fantasma: cargabas una partida de 100 000, la borrabas, y el negocio seguía
  // valiendo 100 000 sin una sola línea que lo respaldara. Ese número entraba
  // en el pronóstico, en el ranking y en los objetivos, y no había forma de
  // llegar a él desde la cotización porque la cotización estaba vacía.
  //
  // Cero sería igual de mentiroso al revés: diría que el negocio no vale nada.
  // `null` es lo único cierto —"todavía no hay importe"— y devuelve el campo a
  // captura manual, que es justo de donde venía antes de tener partidas.
  const total = items.length
    ? items.reduce((acc, i) => acc + lineTotal(i), 0).toFixed(2)
    : null;

  await db
    .update(crmDeals)
    .set({ valueMxn: total, updatedAt: new Date() })
    .where(eq(crmDeals.id, dealId));
}

export async function addDealItem(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const dealId = String(formData.get("dealId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "1");
  const unitPriceMxn = String(formData.get("unitPriceMxn") ?? "0").replace(
    /[^0-9.]/g,
    "",
  );
  const discountPct = String(formData.get("discountPct") ?? "0").replace(
    /[^0-9.]/g,
    "",
  );
  // El selector envía "product:<id>" o "part:<id>"; texto libre si va vacío.
  const catalogRef = String(formData.get("catalogRef") ?? "");
  if (!dealId || !name) return;

  const [kind, refId] = catalogRef.includes(":")
    ? catalogRef.split(":")
    : [null, null];

  const db = await tenantDb();
  await db.insert(crmDealProducts).values({
    dealId,
    name,
    quantity: quantity || "1",
    unitPriceMxn: unitPriceMxn || "0",
    discountPct: discountPct || "0",
    productId: kind === "product" ? refId : null,
    partId: kind === "part" ? refId : null,
  });

  await recalcDealValue(dealId);
  revalidateTenant();
}

export async function deleteDealItem(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  const dealId = String(formData.get("dealId") ?? "");
  if (!id || !dealId) return;

  const db = await tenantDb();
  // Una línea borrada cambia el valor del negocio: es cambio con efecto en
  // dinero, así que el snapshot importa para poder auditar la diferencia.
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crmDealProducts)
      .where(eq(crmDealProducts.id, id))
      .returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "deal_product",
      aggregateId: id,
      eventType: "deal_product.deleted",
      actorId: session.user.id,
      snapshot: row,
      extra: { dealId },
    });
  });
  await recalcDealValue(dealId);
  revalidateTenant();
}

/* ========================= Etiquetas ========================= */

export async function createLabel(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "primary");
  if (!name) return;

  const db = await tenantDb();
  await db.insert(crmLabels).values({ name, color });
  revalidateTenant();
}

export async function deleteLabel(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(crmLabels).where(eq(crmLabels.id, id)).returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "label",
      aggregateId: id,
      eventType: "label.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
}

/** Añade o quita una etiqueta de un negocio. */
export async function toggleDealLabel(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const dealId = String(formData.get("dealId") ?? "");
  const labelId = String(formData.get("labelId") ?? "");
  const attach = formData.get("attach") === "1";
  if (!dealId || !labelId) return;

  const db = await tenantDb();
  if (attach) {
    await db
      .insert(crmDealLabels)
      .values({ dealId, labelId })
      .onConflictDoNothing();
  } else {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(crmDealLabels)
        .where(
          and(eq(crmDealLabels.dealId, dealId), eq(crmDealLabels.labelId, labelId)),
        )
        .returning();
      if (!row) return;
      await recordDeletion(tx, {
        aggregateType: "deal",
        aggregateId: dealId,
        eventType: "deal_label.removed",
        actorId: session.user.id,
        snapshot: row,
        extra: { labelId },
      });
    });
  }
  revalidateTenant();
}

/* ========================= Objetivos ========================= */

export async function createGoal(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;

  const name = String(formData.get("name") ?? "").trim();
  const ownerId = (formData.get("ownerId") as string) || null;
  const pipelineId = (formData.get("pipelineId") as string) || null;
  const metric = String(formData.get("metric") ?? "revenue");
  const target = String(formData.get("target") ?? "0").replace(/[^0-9.]/g, "");
  const periodStart = String(formData.get("periodStart") ?? "");
  const periodEnd = String(formData.get("periodEnd") ?? "");
  if (!name || !target || !periodStart || !periodEnd) return;

  const db = await tenantDb();
  await db.insert(crmGoals).values({
    name,
    ownerId,
    pipelineId,
    metric: metric === "count" ? "count" : "revenue",
    target,
    periodStart,
    periodEnd,
  });
  revalidateTenant();
}

export async function deleteGoal(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(crmGoals).where(eq(crmGoals.id, id)).returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "goal",
      aggregateId: id,
      eventType: "goal.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
}

/* ========================= Plantillas de correo ========================= */

export async function createEmailTemplate(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!name || !subject || !body) return;

  const db = await tenantDb();
  await db
    .insert(crmEmailTemplates)
    .values({ name, subject, body, createdById: session.user.id });
  revalidateTenant();
}

export async function deleteEmailTemplate(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crmEmailTemplates)
      .where(eq(crmEmailTemplates.id, id))
      .returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "email_template",
      aggregateId: id,
      eventType: "email_template.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
}

/* ========================= Automatizaciones ========================= */

export async function createAutomation(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;

  const name = String(formData.get("name") ?? "").trim();
  const triggerStageId = String(formData.get("triggerStageId") ?? "");
  const activityType = String(formData.get("activityType") ?? "call");
  const activitySubject = String(formData.get("activitySubject") ?? "").trim();
  const dueInDays = Number(formData.get("dueInDays") ?? 1);
  if (!name || !triggerStageId || !activitySubject) return;

  const db = await tenantDb();
  await db.insert(crmAutomations).values({
    name,
    triggerStageId,
    activityType: activityType as
      | "call"
      | "meeting"
      | "email"
      | "task"
      | "demo"
      | "visit",
    activitySubject,
    dueInDays: Math.max(0, Math.min(365, dueInDays)),
  });
  revalidateTenant();
}

export async function toggleAutomation(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  if (!id) return;
  const db = await tenantDb();
  await db.update(crmAutomations).set({ active }).where(eq(crmAutomations.id, id));
  revalidateTenant();
}

export async function deleteAutomation(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  // Una automatización borrada cambia el comportamiento del sistema (deja de
  // agendar seguimientos), así que su baja es información de auditoría.
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crmAutomations)
      .where(eq(crmAutomations.id, id))
      .returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "automation",
      aggregateId: id,
      eventType: "automation.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
}

/* ========================= Días de estancamiento ========================= */

/** Ajusta el límite de días sin movimiento de una etapa. */
export async function updateStageRotting(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  const days = Number(formData.get("rottingDays") ?? 0);
  if (!id) return;
  const db = await tenantDb();
  await db
    .update(crmStages)
    .set({ rottingDays: Math.max(0, Math.min(365, days)) })
    .where(eq(crmStages.id, id));
  revalidateTenant();
}
