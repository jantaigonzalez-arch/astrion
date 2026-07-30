"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  crmActivities,
  crmAutomations,
  crmContacts,
  crmDealEvents,
  crmDeals,
  crmNotes,
  crmOrganizations,
  crmStages,
  leads,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isAdminRole, isSalesRole } from "@/lib/roles";
import { nextDealReference } from "@/lib/domain/references";
import { recordEvent } from "@/lib/domain/events";

export type CrmState = {
  ok: boolean;
  error?: "auth" | "invalid" | "server";
  id?: string;
  reference?: string;
};

/** Monto opcional: acepta "185,000.50" o vacío. */
const money = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const clean = v.replace(/[^0-9.]/g, "");
    return clean || undefined;
  })
  .refine((v) => v === undefined || !Number.isNaN(Number(v)), {
    message: "monto inválido",
  });

const optUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
    message: "id inválido",
  });

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined));

/** Solo perfiles comerciales (vendedor/admin) operan el CRM. */
async function requireSales() {
  const session = await auth();
  if (!isSalesRole(session?.user?.role)) return null;
  return session!;
}

function revalidateCrm(dealId?: string) {
  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/actividades");
  revalidatePath("/admin/crm/informes");
  if (dealId) revalidatePath(`/admin/crm/negocios/${dealId}`);
}

/**
 * Dispara las automatizaciones activas de una etapa: crea la actividad
 * configurada para que el siguiente paso nunca quede sin agendar.
 * No lanza excepción: una automatización rota no debe bloquear el arrastre.
 */
async function runStageAutomations(
  dealId: string,
  stageId: string,
  userId: string,
) {
  try {
    const db = getDb();
    const rules = await db
      .select()
      .from(crmAutomations)
      .where(
        and(
          eq(crmAutomations.triggerStageId, stageId),
          eq(crmAutomations.active, true),
        ),
      );
    if (rules.length === 0) return;

    const [deal] = await db
      .select({
        organizationId: crmDeals.organizationId,
        contactId: crmDeals.contactId,
        ownerId: crmDeals.ownerId,
      })
      .from(crmDeals)
      .where(eq(crmDeals.id, dealId))
      .limit(1);

    await db.insert(crmActivities).values(
      rules.map((r) => {
        const due = new Date();
        due.setDate(due.getDate() + r.dueInDays);
        return {
          type: r.activityType,
          subject: r.activitySubject,
          notes: `Creada automáticamente por la regla «${r.name}».`,
          dueAt: due,
          dealId,
          organizationId: deal?.organizationId ?? null,
          contactId: deal?.contactId ?? null,
          ownerId: deal?.ownerId ?? userId,
          createdById: userId,
        };
      }),
    );
  } catch (e) {
    console.error("[crm] automations error:", e);
  }
}

/* ========================= Negocios ========================= */

const DealSchema = z.object({
  title: z.string().min(2).max(240),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  organizationId: optUuid,
  contactId: optUuid,
  ownerId: optUuid,
  valueMxn: money,
  valueUsd: money,
  expectedCloseDate: optText(20),
  source: optText(80),
  leadId: optUuid,
});

function dealFields(formData: FormData) {
  return {
    title: formData.get("title"),
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    organizationId: (formData.get("organizationId") as string) || undefined,
    contactId: (formData.get("contactId") as string) || undefined,
    ownerId: (formData.get("ownerId") as string) || undefined,
    valueMxn: (formData.get("valueMxn") as string) || undefined,
    valueUsd: (formData.get("valueUsd") as string) || undefined,
    expectedCloseDate: (formData.get("expectedCloseDate") as string) || undefined,
    source: (formData.get("source") as string) || undefined,
    leadId: (formData.get("leadId") as string) || undefined,
  };
}

export async function createDeal(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = DealSchema.safeParse(dealFields(formData));
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();

    // Negocio + su evento de alta + calificación del lead son un solo hecho:
    // o quedan los tres, o ninguno. Antes eran escrituras sueltas y un fallo
    // a mitad dejaba un negocio sin historial.
    const created = await db.transaction(async (tx) => {
      // Nuevo negocio: al tope de su columna del kanban.
      const [{ minPos }] = await tx
        .select({ minPos: sql<number>`coalesce(min(${crmDeals.position}), 0)::int` })
        .from(crmDeals)
        .where(eq(crmDeals.stageId, parsed.data.stageId));

      const [deal] = await tx
        .insert(crmDeals)
        .values({
          reference: await nextDealReference(tx),
          title: parsed.data.title.trim(),
          pipelineId: parsed.data.pipelineId,
          stageId: parsed.data.stageId,
          organizationId: parsed.data.organizationId ?? null,
          contactId: parsed.data.contactId ?? null,
          // Sin responsable explícito, el negocio queda a nombre de quien lo crea.
          ownerId: parsed.data.ownerId ?? session.user.id,
          valueMxn: parsed.data.valueMxn ?? null,
          valueUsd: parsed.data.valueUsd ?? null,
          expectedCloseDate: parsed.data.expectedCloseDate ?? null,
          source: parsed.data.source ?? null,
          leadId: parsed.data.leadId ?? null,
          position: minPos - 1,
        })
        .returning({ id: crmDeals.id, reference: crmDeals.reference });

      // Proyección propia del CRM: alimenta la línea de tiempo del negocio.
      await tx.insert(crmDealEvents).values({
        dealId: deal.id,
        toStageId: parsed.data.stageId,
        status: "open",
        authorId: session.user.id,
      });

      // Bitácora de plataforma: auditoría + historia para features de ML.
      await recordEvent(tx, {
        aggregateType: "deal",
        aggregateId: deal.id,
        eventType: "deal.created",
        actorId: session.user.id,
        payload: {
          reference: deal.reference,
          pipelineId: parsed.data.pipelineId,
          stageId: parsed.data.stageId,
          valueMxn: parsed.data.valueMxn ?? null,
          valueUsd: parsed.data.valueUsd ?? null,
          source: parsed.data.source ?? null,
          leadId: parsed.data.leadId ?? null,
        },
      });

      // El lead de origen queda marcado como calificado.
      if (parsed.data.leadId) {
        await tx
          .update(leads)
          .set({ status: "qualified" })
          .where(eq(leads.id, parsed.data.leadId));
        await recordEvent(tx, {
          aggregateType: "lead",
          aggregateId: parsed.data.leadId,
          eventType: "lead.qualified",
          actorId: session.user.id,
          payload: { dealId: deal.id, dealReference: deal.reference },
        });
      }

      return deal;
    });

    // Fuera de la transacción a propósito: las automatizaciones son un efecto
    // secundario (agendan seguimientos) y ya fallan en silencio. Si fallaran
    // dentro, Postgres abortaría la transacción entera y se perdería el
    // negocio por no haber podido crear una tarea de recordatorio.
    await runStageAutomations(created.id, parsed.data.stageId, session.user.id);

    if (parsed.data.leadId) revalidatePath("/admin/leads");
    revalidateCrm();
    return { ok: true, id: created.id, reference: created.reference };
  } catch (e) {
    console.error("[crm] createDeal error:", e);
    return { ok: false, error: "server" };
  }
}

export async function updateDeal(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = DealSchema.extend({ id: z.string().uuid() }).safeParse({
    ...dealFields(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    const [current] = await db
      .select({ id: crmDeals.id, stageId: crmDeals.stageId })
      .from(crmDeals)
      .where(eq(crmDeals.id, parsed.data.id))
      .limit(1);
    if (!current) return { ok: false, error: "invalid" };

    await db
      .update(crmDeals)
      .set({
        title: parsed.data.title.trim(),
        stageId: parsed.data.stageId,
        organizationId: parsed.data.organizationId ?? null,
        contactId: parsed.data.contactId ?? null,
        ownerId: parsed.data.ownerId ?? null,
        valueMxn: parsed.data.valueMxn ?? null,
        valueUsd: parsed.data.valueUsd ?? null,
        expectedCloseDate: parsed.data.expectedCloseDate ?? null,
        source: parsed.data.source ?? null,
        updatedAt: new Date(),
      })
      .where(eq(crmDeals.id, current.id));

    if (current.stageId !== parsed.data.stageId) {
      await db.insert(crmDealEvents).values({
        dealId: current.id,
        fromStageId: current.stageId,
        toStageId: parsed.data.stageId,
        authorId: session.user.id,
      });
      await runStageAutomations(current.id, parsed.data.stageId, session.user.id);
    }

    revalidateCrm(current.id);
    return { ok: true, id: current.id };
  } catch (e) {
    console.error("[crm] updateDeal error:", e);
    return { ok: false, error: "server" };
  }
}

/**
 * Mueve un negocio en el tablero (drag & drop).
 * `position` es el índice destino dentro de la columna; se normaliza el orden
 * de toda la etapa para que quede consistente.
 */
export async function moveDeal(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const dealId = String(formData.get("dealId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  const index = Number(formData.get("index") ?? 0);
  if (!dealId || !stageId) return;

  const db = getDb();
  const [deal] = await db
    .select({ id: crmDeals.id, stageId: crmDeals.stageId })
    .from(crmDeals)
    .where(eq(crmDeals.id, dealId))
    .limit(1);
  if (!deal) return;

  // Orden actual de la columna destino, sin el negocio que se mueve.
  const rest = (
    await db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(eq(crmDeals.stageId, stageId), eq(crmDeals.status, "open")))
      .orderBy(crmDeals.position)
  )
    .map((r) => r.id)
    .filter((id) => id !== dealId);

  const target = Math.max(0, Math.min(index, rest.length));
  rest.splice(target, 0, dealId);

  await db
    .update(crmDeals)
    .set({ stageId, updatedAt: new Date() })
    .where(eq(crmDeals.id, dealId));

  // Reescribe posiciones 0..n de la columna destino.
  for (let i = 0; i < rest.length; i++) {
    await db.update(crmDeals).set({ position: i }).where(eq(crmDeals.id, rest[i]));
  }

  if (deal.stageId !== stageId) {
    await db.insert(crmDealEvents).values({
      dealId,
      fromStageId: deal.stageId,
      toStageId: stageId,
      authorId: session.user.id,
    });
    await runStageAutomations(dealId, stageId, session.user.id);
  }

  revalidateCrm(dealId);
}

/** Marca el negocio como ganado, perdido o lo reabre. */
export async function setDealStatus(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const dealId = String(formData.get("dealId") ?? "");
  const status = String(formData.get("status") ?? "");
  const lostReason = (formData.get("lostReason") as string) || null;
  if (!dealId || !["open", "won", "lost"].includes(status)) return;

  const db = getDb();
  await db
    .update(crmDeals)
    .set({
      status: status as "open" | "won" | "lost",
      lostReason: status === "lost" ? lostReason : null,
      closedAt: status === "open" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(crmDeals.id, dealId));

  await db.insert(crmDealEvents).values({
    dealId,
    status: status as "open" | "won" | "lost",
    authorId: session.user.id,
  });

  revalidateCrm(dealId);
}

export async function deleteDeal(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  await db.delete(crmDeals).where(eq(crmDeals.id, id));
  revalidateCrm();
  redirect("/admin/crm");
}

/* ========================= Organizaciones ========================= */

const OrgSchema = z.object({
  name: z.string().min(2).max(200),
  industry: optText(120),
  website: optText(255),
  phone: optText(40),
  address: optText(1000),
  ownerId: optUuid,
  clientId: optUuid,
  notes: optText(2000),
});

/**
 * Una cuenta del portal representa como mucho a una organización. Al vincular
 * `clientId` a `orgId`, suelta el vínculo de cualquier otra ficha que tuviera
 * esa misma cuenta (el mismo invariante que aplica `updateUser`).
 */
async function enforceSingleClientLink(clientId: string, orgId: string) {
  const db = getDb();
  const stale = await db
    .update(crmOrganizations)
    .set({ clientId: null })
    .where(
      and(eq(crmOrganizations.clientId, clientId), ne(crmOrganizations.id, orgId)),
    )
    .returning({ id: crmOrganizations.id });
  for (const o of stale) revalidatePath(`/admin/crm/organizaciones/${o.id}`);
}

function orgFields(formData: FormData) {
  return {
    name: formData.get("name"),
    industry: (formData.get("industry") as string) || undefined,
    website: (formData.get("website") as string) || undefined,
    phone: (formData.get("phone") as string) || undefined,
    address: (formData.get("address") as string) || undefined,
    ownerId: (formData.get("ownerId") as string) || undefined,
    clientId: (formData.get("clientId") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  };
}

export async function createOrganization(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = OrgSchema.safeParse(orgFields(formData));
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    const [created] = await db
      .insert(crmOrganizations)
      .values({
        name: parsed.data.name.trim(),
        industry: parsed.data.industry ?? null,
        website: parsed.data.website ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        ownerId: parsed.data.ownerId ?? session.user.id,
        clientId: parsed.data.clientId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: crmOrganizations.id });

    if (parsed.data.clientId) {
      await enforceSingleClientLink(parsed.data.clientId, created.id);
    }
    revalidatePath("/admin/crm/organizaciones");
    revalidatePath("/admin/users");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("[crm] createOrganization error:", e);
    return { ok: false, error: "server" };
  }
}

export async function updateOrganization(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = OrgSchema.extend({ id: z.string().uuid() }).safeParse({
    ...orgFields(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    await db
      .update(crmOrganizations)
      .set({
        name: parsed.data.name.trim(),
        industry: parsed.data.industry ?? null,
        website: parsed.data.website ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        ownerId: parsed.data.ownerId ?? null,
        clientId: parsed.data.clientId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(crmOrganizations.id, parsed.data.id));

    if (parsed.data.clientId) {
      await enforceSingleClientLink(parsed.data.clientId, parsed.data.id);
    }
    revalidatePath("/admin/crm/organizaciones");
    revalidatePath(`/admin/crm/organizaciones/${parsed.data.id}`);
    revalidatePath("/admin/users");
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    console.error("[crm] updateOrganization error:", e);
    return { ok: false, error: "server" };
  }
}

export async function deleteOrganization(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  await db.delete(crmOrganizations).where(eq(crmOrganizations.id, id));
  revalidatePath("/admin/crm/organizaciones");
  redirect("/admin/crm/organizaciones");
}

/* ========================= Contactos ========================= */

const ContactSchema = z.object({
  name: z.string().min(2).max(160),
  email: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : undefined))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
      message: "correo inválido",
    }),
  phone: optText(40),
  position: optText(140),
  organizationId: optUuid,
  ownerId: optUuid,
  notes: optText(2000),
});

function contactFields(formData: FormData) {
  return {
    name: formData.get("name"),
    email: (formData.get("email") as string) || undefined,
    phone: (formData.get("phone") as string) || undefined,
    position: (formData.get("position") as string) || undefined,
    organizationId: (formData.get("organizationId") as string) || undefined,
    ownerId: (formData.get("ownerId") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  };
}

export async function createContact(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = ContactSchema.safeParse(contactFields(formData));
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    const [created] = await db
      .insert(crmContacts)
      .values({
        name: parsed.data.name.trim(),
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        position: parsed.data.position ?? null,
        organizationId: parsed.data.organizationId ?? null,
        ownerId: parsed.data.ownerId ?? session.user.id,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: crmContacts.id });

    revalidatePath("/admin/crm/contactos");
    if (parsed.data.organizationId)
      revalidatePath(`/admin/crm/organizaciones/${parsed.data.organizationId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("[crm] createContact error:", e);
    return { ok: false, error: "server" };
  }
}

export async function updateContact(
  _prev: CrmState,
  formData: FormData,
): Promise<CrmState> {
  const session = await requireSales();
  if (!session) return { ok: false, error: "auth" };

  const parsed = ContactSchema.extend({ id: z.string().uuid() }).safeParse({
    ...contactFields(formData),
    id: formData.get("id"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();
    await db
      .update(crmContacts)
      .set({
        name: parsed.data.name.trim(),
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        position: parsed.data.position ?? null,
        organizationId: parsed.data.organizationId ?? null,
        ownerId: parsed.data.ownerId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(crmContacts.id, parsed.data.id));

    revalidatePath("/admin/crm/contactos");
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    console.error("[crm] updateContact error:", e);
    return { ok: false, error: "server" };
  }
}

export async function deleteContact(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  await db.delete(crmContacts).where(eq(crmContacts.id, id));
  revalidatePath("/admin/crm/contactos");
}

/* ========================= Actividades ========================= */

export async function createActivity(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const subject = String(formData.get("subject") ?? "").trim();
  const type = String(formData.get("type") ?? "call");
  const dueRaw = String(formData.get("dueAt") ?? "");
  const dealId = (formData.get("dealId") as string) || null;
  const contactId = (formData.get("contactId") as string) || null;
  const organizationId = (formData.get("organizationId") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const ownerId = (formData.get("ownerId") as string) || session.user.id;
  if (!subject) return;

  const db = getDb();
  await db.insert(crmActivities).values({
    subject,
    type: type as "call" | "meeting" | "email" | "task" | "demo" | "visit",
    // datetime-local llega sin zona: lo interpretamos en la zona del servidor.
    dueAt: dueRaw ? new Date(dueRaw) : null,
    dealId,
    contactId,
    organizationId,
    notes,
    ownerId,
    createdById: session.user.id,
  });

  revalidateCrm(dealId ?? undefined);
  if (organizationId) revalidatePath(`/admin/crm/organizaciones/${organizationId}`);
}

/** Marca/desmarca una actividad como completada. */
export async function toggleActivity(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  const done = formData.get("done") === "1";
  if (!id) return;

  const db = getDb();
  const [row] = await db
    .update(crmActivities)
    .set({ done, doneAt: done ? new Date() : null })
    .where(eq(crmActivities.id, id))
    .returning({ dealId: crmActivities.dealId });

  revalidateCrm(row?.dealId ?? undefined);
}

export async function deleteActivity(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  const [row] = await db
    .delete(crmActivities)
    .where(eq(crmActivities.id, id))
    .returning({ dealId: crmActivities.dealId });
  revalidateCrm(row?.dealId ?? undefined);
}

/* ========================= Notas ========================= */

export async function createNote(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const body = String(formData.get("body") ?? "").trim();
  const dealId = (formData.get("dealId") as string) || null;
  const contactId = (formData.get("contactId") as string) || null;
  const organizationId = (formData.get("organizationId") as string) || null;
  if (!body) return;

  const db = getDb();
  await db.insert(crmNotes).values({
    body,
    dealId,
    contactId,
    organizationId,
    authorId: session.user.id,
  });

  revalidateCrm(dealId ?? undefined);
  if (organizationId) revalidatePath(`/admin/crm/organizaciones/${organizationId}`);
}

export async function deleteNote(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  const [row] = await db
    .delete(crmNotes)
    .where(eq(crmNotes.id, id))
    .returning({ dealId: crmNotes.dealId });
  revalidateCrm(row?.dealId ?? undefined);
}

/* ========================= Etapas del embudo ========================= */

export async function createStage(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;

  const pipelineId = String(formData.get("pipelineId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const probability = Number(formData.get("probability") ?? 50);
  if (!pipelineId || !name) return;

  const db = getDb();
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${crmStages.order}), -1)::int` })
    .from(crmStages)
    .where(eq(crmStages.pipelineId, pipelineId));

  await db.insert(crmStages).values({
    pipelineId,
    name,
    probability: Math.max(0, Math.min(100, probability)),
    order: maxOrder + 1,
  });

  revalidatePath("/admin/crm/configuracion");
  revalidatePath("/admin/crm");
}

export async function updateStage(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const probability = Number(formData.get("probability") ?? 50);
  // Días sin movimiento tras los que la tarjeta se marca estancada (0 = off).
  const rottingDays = Number(formData.get("rottingDays") ?? 0);
  if (!id || !name) return;

  const db = getDb();
  await db
    .update(crmStages)
    .set({
      name,
      probability: Math.max(0, Math.min(100, probability)),
      rottingDays: Math.max(0, Math.min(365, rottingDays)),
    })
    .where(eq(crmStages.id, id));

  revalidatePath("/admin/crm/configuracion");
  revalidatePath("/admin/crm");
}

/** Sube o baja una etapa en el embudo (intercambia el orden con su vecina). */
export async function moveStage(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;

  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!id || !["up", "down"].includes(dir)) return;

  const db = getDb();
  const [stage] = await db
    .select()
    .from(crmStages)
    .where(eq(crmStages.id, id))
    .limit(1);
  if (!stage) return;

  const siblings = await db
    .select()
    .from(crmStages)
    .where(eq(crmStages.pipelineId, stage.pipelineId))
    .orderBy(crmStages.order);

  const i = siblings.findIndex((s) => s.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= siblings.length) return;

  await db
    .update(crmStages)
    .set({ order: siblings[j].order })
    .where(eq(crmStages.id, siblings[i].id));
  await db
    .update(crmStages)
    .set({ order: siblings[i].order })
    .where(eq(crmStages.id, siblings[j].id));

  revalidatePath("/admin/crm/configuracion");
  revalidatePath("/admin/crm");
}

/** Elimina una etapa solo si está vacía (evita perder negocios). */
export async function deleteStage(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmDeals)
    .where(eq(crmDeals.stageId, id));
  if (n > 0) return;

  await db.delete(crmStages).where(eq(crmStages.id, id));
  revalidatePath("/admin/crm/configuracion");
  revalidatePath("/admin/crm");
}

/* ========================= Lead → Negocio ========================= */

/**
 * Convierte un lead del formulario web en organización + contacto + negocio,
 * colocándolo en la primera etapa del embudo.
 */
export async function convertLeadToDeal(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const leadId = String(formData.get("leadId") ?? "");
  const pipelineId = String(formData.get("pipelineId") ?? "");
  if (!leadId || !pipelineId) return;

  const db = getDb();

  // Convertir un lead crea hasta 4 filas enlazadas (organización, contacto,
  // negocio, evento) y marca el lead. Sin transacción, un fallo a mitad dejaba
  // un contacto huérfano y el lead sin convertir: al reintentar se duplicaba.
  const dealId = await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return null;

    const [firstStage] = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipelineId))
      .orderBy(crmStages.order)
      .limit(1);
    if (!firstStage) return null;

    // Reutiliza la organización si ya existe una con el mismo nombre.
    let organizationId: string | null = null;
    const orgName = lead.company?.trim();
    if (orgName) {
      const [existing] = await tx
        .select({ id: crmOrganizations.id })
        .from(crmOrganizations)
        .where(eq(crmOrganizations.name, orgName))
        .limit(1);
      organizationId =
        existing?.id ??
        (
          await tx
            .insert(crmOrganizations)
            .values({ name: orgName, ownerId: session.user.id })
            .returning({ id: crmOrganizations.id })
        )[0].id;
    }

    const [contact] = await tx
      .insert(crmContacts)
      .values({
        name: lead.name,
        email: lead.email,
        organizationId,
        ownerId: session.user.id,
        notes: lead.message,
      })
      .returning({ id: crmContacts.id });

    const [deal] = await tx
      .insert(crmDeals)
      .values({
        reference: await nextDealReference(tx),
        title: orgName
          ? `${orgName} — oportunidad web`
          : `${lead.name} — oportunidad web`,
        pipelineId,
        stageId: firstStage.id,
        organizationId,
        contactId: contact.id,
        ownerId: session.user.id,
        source: lead.source ?? "web_contact",
        leadId: lead.id,
        position: 0,
      })
      .returning({ id: crmDeals.id, reference: crmDeals.reference });

    await tx.insert(crmDealEvents).values({
      dealId: deal.id,
      toStageId: firstStage.id,
      status: "open",
      authorId: session.user.id,
    });

    await tx.update(leads).set({ status: "qualified" }).where(eq(leads.id, lead.id));

    await recordEvent(tx, {
      aggregateType: "deal",
      aggregateId: deal.id,
      eventType: "deal.created_from_lead",
      actorId: session.user.id,
      payload: {
        reference: deal.reference,
        leadId: lead.id,
        organizationId,
        contactId: contact.id,
        pipelineId,
        stageId: firstStage.id,
        source: lead.source ?? "web_contact",
      },
    });

    return deal.id;
  });

  if (!dealId) return;

  revalidatePath("/admin/leads");
  revalidateCrm();
  // redirect() FUERA de la transacción: lanza NEXT_REDIRECT como control de
  // flujo, y dentro del bloque haría rollback de todo lo que acabamos de
  // escribir. Es el error clásico al meter Server Actions en transacciones.
  redirect(`/admin/crm/negocios/${dealId}`);
}
