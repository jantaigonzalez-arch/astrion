"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  tickets,
  ticketComments,
  equipment,
  equipmentModules,
  equipmentSubmodules,
  users,
  spareParts,
  commentParts,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";
import {
  generateReference,
  slaDueFrom,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  STAFF_SETTABLE_STATUSES,
} from "@/lib/tickets";

const CreateSchema = z.object({
  subject: z.string().min(4).max(240),
  description: z.string().min(10).max(4000),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  equipmentId: z.string().uuid().optional(),
  moduleId: z.string().uuid().optional(),
});

export type TicketFormState = { ok: boolean; error?: string; reference?: string };

export async function createTicket(
  _prev: TicketFormState,
  formData: FormData,
): Promise<TicketFormState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "auth" };
  const isStaff = isSupport(session.user.role);

  const parsed = CreateSchema.safeParse({
    subject: formData.get("subject"),
    description: formData.get("description"),
    category: formData.get("category"),
    priority: formData.get("priority"),
    equipmentId: formData.get("equipmentId") || undefined,
    moduleId: formData.get("moduleId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();

    // El equipo debe pertenecer a quien crea el ticket (o al cliente dueño).
    let equipmentId: string | null = null;
    let moduleId: string | null = null;
    if (parsed.data.equipmentId) {
      const [own] = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(
          and(
            eq(equipment.id, parsed.data.equipmentId),
            eq(equipment.ownerId, session.user.id),
          ),
        )
        .limit(1);
      if (own) {
        equipmentId = own.id;
        if (parsed.data.moduleId) {
          const [mod] = await db
            .select({ id: equipmentModules.id })
            .from(equipmentModules)
            .where(
              and(
                eq(equipmentModules.id, parsed.data.moduleId),
                eq(equipmentModules.equipmentId, own.id),
              ),
            )
            .limit(1);
          moduleId = mod?.id ?? null;
        }
      }
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets);
    const now = new Date();

    const [row] = await db
      .insert(tickets)
      .values({
        reference: generateReference(count + 1),
        subject: parsed.data.subject,
        description: parsed.data.description,
        category: parsed.data.category,
        priority: parsed.data.priority,
        // El cliente levanta una SOLICITUD: queda pendiente de que el admin
        // la apruebe antes de entrar a la cola de atención. Si la crea el
        // staff desde aquí, se considera ya revisada.
        status: isStaff ? "open" : "pending_review",
        type: isStaff ? "service" : "request",
        createdById: session.user.id,
        equipmentId,
        moduleId,
        slaDueAt: slaDueFrom(now),
      })
      .returning({ reference: tickets.reference });

    revalidatePath("/tickets");
    revalidatePath("/admin/tickets");
    return { ok: true, reference: row.reference };
  } catch (e) {
    console.error("[ticket] create error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------- Levantamiento de servicio creado por el staff ---------- */
const ServiceSchema = CreateSchema.extend({
  clientId: z.string().uuid(),
});

export async function createServiceTicket(
  _prev: TicketFormState,
  formData: FormData,
): Promise<TicketFormState> {
  const session = await auth();
  if (!isSupport(session?.user?.role)) {
    return { ok: false, error: "auth" };
  }

  const parsed = ServiceSchema.safeParse({
    clientId: formData.get("clientId"),
    subject: formData.get("subject"),
    description: formData.get("description"),
    category: formData.get("category"),
    priority: formData.get("priority"),
    equipmentId: formData.get("equipmentId") || undefined,
    moduleId: formData.get("moduleId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = getDb();

    // El equipo debe pertenecer al laboratorio elegido.
    let equipmentId: string | null = null;
    let moduleId: string | null = null;
    if (parsed.data.equipmentId) {
      const [own] = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(
          and(
            eq(equipment.id, parsed.data.equipmentId),
            eq(equipment.ownerId, parsed.data.clientId),
          ),
        )
        .limit(1);
      if (own) {
        equipmentId = own.id;
        if (parsed.data.moduleId) {
          const [mod] = await db
            .select({ id: equipmentModules.id })
            .from(equipmentModules)
            .where(
              and(
                eq(equipmentModules.id, parsed.data.moduleId),
                eq(equipmentModules.equipmentId, own.id),
              ),
            )
            .limit(1);
          moduleId = mod?.id ?? null;
        }
      }
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets);
    const now = new Date();

    // El ticket pertenece al laboratorio (lo ve en su portal), pero lo levantó
    // el staff: entra directo a la cola, sin revisión.
    const [row] = await db
      .insert(tickets)
      .values({
        reference: generateReference(count + 1),
        subject: parsed.data.subject,
        description: parsed.data.description,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: "open",
        type: "service",
        createdById: parsed.data.clientId,
        equipmentId,
        moduleId,
        reviewedById: session.user.id,
        reviewedAt: now,
        slaDueAt: slaDueFrom(now),
      })
      .returning({ reference: tickets.reference });

    revalidatePath("/admin/tickets");
    revalidatePath("/tickets");
    return { ok: true, reference: row.reference };
  } catch (e) {
    console.error("[ticket] service create error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------- Revisión: aprobar / rechazar solicitudes ---------- */
export async function approveTicket(formData: FormData) {
  const session = await auth();
  if (!isSupport(session?.user?.role)) return;

  const ticketId = String(formData.get("ticketId"));
  if (!ticketId) return;

  const db = getDb();
  await db
    .update(tickets)
    .set({
      status: "open", // pasa: entra a la cola de atención
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.status, "pending_review")));

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
}

export async function rejectTicket(formData: FormData) {
  const session = await auth();
  if (!isSupport(session?.user?.role)) return;

  const ticketId = String(formData.get("ticketId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ticketId) return;

  const db = getDb();
  await db
    .update(tickets)
    .set({
      status: "rejected",
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: reason || "Sin motivo especificado.",
      updatedAt: new Date(),
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.status, "pending_review")));

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
}

export async function addComment(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;

  const ticketId = String(formData.get("ticketId"));
  const body = String(formData.get("body") ?? "").trim();
  const internal =
    formData.get("internal") === "on" && isSupport(session.user.role);
  if (!ticketId || body.length < 1) return;

  const db = getDb();

  // Componente al que se refiere la actividad. Se valida la jerarquía:
  // el submódulo debe pertenecer al módulo, y el módulo al equipo.
  const pick = (v: FormDataEntryValue | null) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const inEquipment = pick(formData.get("cEquipmentId"));
  const inModule = pick(formData.get("cModuleId"));
  const inSubmodule = pick(formData.get("cSubmoduleId"));

  let refEquipment: string | null = null;
  let refModule: string | null = null;
  let refSubmodule: string | null = null;

  if (inEquipment) {
    const [foundEq] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(eq(equipment.id, inEquipment))
      .limit(1);
    if (foundEq) {
      refEquipment = foundEq.id;
      if (inModule) {
        const [foundMod] = await db
          .select({ id: equipmentModules.id })
          .from(equipmentModules)
          .where(
            and(
              eq(equipmentModules.id, inModule),
              eq(equipmentModules.equipmentId, foundEq.id),
            ),
          )
          .limit(1);
        if (foundMod) {
          refModule = foundMod.id;
          if (inSubmodule) {
            const [foundSub] = await db
              .select({ id: equipmentSubmodules.id })
              .from(equipmentSubmodules)
              .where(
                and(
                  eq(equipmentSubmodules.id, inSubmodule),
                  eq(equipmentSubmodules.moduleId, foundMod.id),
                ),
              )
              .limit(1);
            refSubmodule = foundSub?.id ?? null;
          }
        }
      }
    }
  }

  // Horas de servicio de la actividad (0 – 999.99).
  const rawHours = pick(formData.get("hours"));
  let hours: string | null = null;
  if (rawHours) {
    const n = Number(rawHours.replace(",", "."));
    if (!Number.isNaN(n) && n > 0 && n < 1000) hours = n.toFixed(2);
  }

  const [createdComment] = await db
    .insert(ticketComments)
    .values({
      ticketId,
      authorId: session.user.id,
      body,
      internal,
      equipmentId: refEquipment,
      moduleId: refModule,
      submoduleId: refSubmodule,
      hours,
    })
    .returning({ id: ticketComments.id });

  // Refacciones usadas: se guarda copia de nº de parte, descripción y costo
  // vigente, y se descuenta la existencia del inventario.
  const partIds = formData.getAll("partIds").map(String).filter(Boolean);
  const qtys = formData.getAll("partQtys").map(String);
  if (partIds.length && createdComment) {
    const catalog = await db
      .select()
      .from(spareParts)
      .where(inArray(spareParts.id, partIds));

    const rows = partIds
      .map((pid, i) => {
        const p = catalog.find((c) => c.id === pid);
        if (!p) return null;
        const q = Math.max(1, Math.min(9999, Number(qtys[i] ?? 1) || 1));
        return {
          commentId: createdComment.id,
          partId: p.id,
          partNumber: p.partNumber,
          description: p.description,
          quantity: q,
          unitCostMxn: p.costMxn,
          unitCostUsd: p.costUsd,
          unitPriceMxn: p.priceMxn,
          unitPriceUsd: p.priceUsd,
        };
      })
      .filter((r) => r !== null);

    if (rows.length) {
      await db.insert(commentParts).values(rows);
      for (const r of rows) {
        await db
          .update(spareParts)
          .set({
            stock: sql`greatest(0, ${spareParts.stock} - ${r.quantity})`,
            updatedAt: new Date(),
          })
          .where(eq(spareParts.id, r.partId!));
      }
    }
  }

  // Marca primera respuesta si un agente/admin contesta (SLA).
  if (isSupport(session.user.role)) {
    await db
      .update(tickets)
      .set({ firstRespondedAt: sql`coalesce(${tickets.firstRespondedAt}, now())`, updatedAt: new Date() })
      .where(eq(tickets.id, ticketId));
  }

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/admin/tickets`);
}

export async function updateTicketStatus(formData: FormData) {
  const session = await auth();
  if (!isSupport(session?.user?.role)) return;

  const ticketId = String(formData.get("ticketId"));
  const status = String(formData.get("status"));
  // La aprobación/rechazo tiene su propio flujo; aquí solo estados operativos.
  if (!STAFF_SETTABLE_STATUSES.includes(status as never)) return;

  const db = getDb();
  await db
    .update(tickets)
    .set({
      status: status as never,
      updatedAt: new Date(),
      ...(status === "resolved" ? { resolvedAt: new Date() } : {}),
    })
    .where(eq(tickets.id, ticketId));

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/admin/tickets`);
}

export async function assignTicket(formData: FormData) {
  const session = await auth();
  if (!isSupport(session?.user?.role)) return;

  const ticketId = String(formData.get("ticketId") ?? "");
  const raw = formData.get("assignedToId");
  // Cadena vacía / ausente = desasignar.
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  if (!ticketId) return;

  const db = getDb();

  // Solo se puede asignar a personal activo (agente o admin).
  let assignedToId: string | null = null;
  if (candidate) {
    const [staff] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, candidate),
          eq(users.active, true),
          inArray(users.role, ["agent", "admin"]),
        ),
      )
      .limit(1);
    if (!staff) return; // asignado inválido: no hacemos nada
    assignedToId = staff.id;
  }

  await db
    .update(tickets)
    .set({ assignedToId, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));

  revalidatePath("/admin/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath(`/en/tickets/${ticketId}`);
  revalidatePath("/dashboard");
}
