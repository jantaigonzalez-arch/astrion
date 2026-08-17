"use server";

import { z } from "zod";
import { revalidateTenant } from "@/lib/revalidate";
import { and, eq, inArray, sql } from "drizzle-orm";
import { tenantDb, currentRole } from "@/lib/tenancy/context";
import {
  tickets,
  ticketComments,
  equipment,
  equipmentModules,
  equipmentSubmodules,
  spareParts,
  commentParts,
} from "@/lib/db/schema";
import { getTenantMember } from "@/lib/data/people";
import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";
import {
  slaDueFrom,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  STAFF_SETTABLE_STATUSES,
} from "@/lib/tickets";
import { nextTicketReference } from "@/lib/domain/references";
import { recordEvent } from "@/lib/domain/events";
import { consumePart } from "@/lib/domain/inventory";

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
  const isStaff = isSupport(await currentRole());

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
    const db = await tenantDb();

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

    const now = new Date();

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tickets)
        .values({
          reference: await nextTicketReference(tx),
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
        .returning({ id: tickets.id, reference: tickets.reference });

      await recordEvent(tx, {
        aggregateType: "ticket",
        aggregateId: created.id,
        eventType: "ticket.created",
        actorId: session.user.id,
        payload: {
          reference: created.reference,
          category: parsed.data.category,
          priority: parsed.data.priority,
          status: isStaff ? "open" : "pending_review",
          type: isStaff ? "service" : "request",
          equipmentId,
          moduleId,
          slaDueAt: slaDueFrom(now).toISOString(),
        },
      });

      return created;
    });

    // Solo si ya entró a la cola. Una solicitud pendiente de revisión todavía
    // puede rechazarse, y predecir sobre algo que quizá no ocurra ensucia la
    // medición con casos que nunca van a tener desenlace.

    revalidateTenant();
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
  if (!session?.user || !isSupport(await currentRole())) {
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
    const db = await tenantDb();

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

    const now = new Date();

    // El ticket pertenece al laboratorio (lo ve en su portal), pero lo levantó
    // el staff: entra directo a la cola, sin revisión.
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tickets)
        .values({
          reference: await nextTicketReference(tx),
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
        .returning({ id: tickets.id, reference: tickets.reference });

      await recordEvent(tx, {
        aggregateType: "ticket",
        aggregateId: created.id,
        eventType: "ticket.created",
        actorId: session.user.id,
        payload: {
          reference: created.reference,
          category: parsed.data.category,
          priority: parsed.data.priority,
          status: "open",
          type: "service",
          clientId: parsed.data.clientId,
          equipmentId,
          moduleId,
          slaDueAt: slaDueFrom(now).toISOString(),
        },
      });

      return created;
    });

    // Un levantamiento del staff nace en la cola: se predice de una vez.

    revalidateTenant();
    return { ok: true, reference: row.reference };
  } catch (e) {
    console.error("[ticket] service create error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------- Revisión: aprobar / rechazar solicitudes ---------- */
export async function approveTicket(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isSupport(await currentRole())) return;

  const ticketId = String(formData.get("ticketId"));
  if (!ticketId) return;

  const db = await tenantDb();
  const approved = await db
    .update(tickets)
    .set({
      status: "open", // pasa: entra a la cola de atención
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.status, "pending_review")))
    .returning({ id: tickets.id });

  // Recién aquí la solicitud se vuelve un servicio que va a ocurrir. Se
  // comprueba que el UPDATE haya tocado algo: el `where` filtra por estado, así
  // que un doble clic no debe emitir una segunda predicción.

  revalidateTenant();
}

export async function rejectTicket(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isSupport(await currentRole())) return;

  const ticketId = String(formData.get("ticketId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ticketId) return;

  const db = await tenantDb();
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

  revalidateTenant();
}

export async function addComment(formData: FormData) {
  const session = await auth();
  if (!session?.user) return;

  const ticketId = String(formData.get("ticketId"));
  const body = String(formData.get("body") ?? "").trim();
  const role = await currentRole();
  const staff = isSupport(role);
  const internal = formData.get("internal") === "on" && staff;
  if (!ticketId || body.length < 1) return;

  const db = await tenantDb();

  /*
    A qué ticket se escribe: se comprueba, no se acepta.

    Esta acción solo verificaba que hubiera sesión. El `ticketId` llega en el
    formulario, así que cualquiera con cuenta en la empresa podía escribir en el
    ticket de otro cliente con solo cambiar ese campo. La LECTURA sí estaba
    protegida —la ficha devuelve 404 si el ticket no es tuyo—, y esa asimetría
    es lo que la hacía fácil de pasar por alto: la pantalla se veía correcta.

    El staff escribe en cualquier ticket de su empresa; el cliente, solo en los
    suyos. El `tenantDb()` ya acota al esquema de la empresa, así que lo que
    falta comprobar es la pertenencia dentro de ella.
  */
  const [target] = await db
    .select({ id: tickets.id, createdById: tickets.createdById })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!target) return;
  if (!staff && target.createdById !== session.user.id) return;

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

  /*
    Horas y refacciones son SOLO del staff.

    No es una restricción de interfaz sino de consecuencias: las horas entran en
    la rentabilidad del servicio y del contrato, y cada refacción declarada
    descuenta existencias del almacén por el ledger de inventario. La pantalla
    del cliente nunca ofreció esos campos, pero la acción los leía igual de
    quien fuera —y una acción acepta el formulario que le manden, no el que se
    dibujó—. Un cliente podía mover el inventario de la empresa.
  */
  const rawHours = staff ? pick(formData.get("hours")) : null;
  let hours: string | null = null;
  if (rawHours) {
    const n = Number(rawHours.replace(",", "."));
    if (!Number.isNaN(n) && n > 0 && n < 1000) hours = n.toFixed(2);
  }

  const partIds = staff
    ? formData.getAll("partIds").map(String).filter(Boolean)
    : [];
  const qtys = staff ? formData.getAll("partQtys").map(String) : [];

  // La bitácora, el consumo de refacciones, el movimiento de inventario y la
  // marca de SLA son un solo hecho operativo. Antes eran escrituras sueltas:
  // si fallaba a mitad quedaba el comentario sin las refacciones, o refacciones
  // descontadas del stock sin comentario que las justificara.
  await db.transaction(async (tx) => {
    const [createdComment] = await tx
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

    await recordEvent(tx, {
      aggregateType: "ticket",
      aggregateId: ticketId,
      eventType: "ticket.comment_added",
      actorId: session.user.id,
      payload: {
        commentId: createdComment.id,
        internal,
        hours,
        equipmentId: refEquipment,
        moduleId: refModule,
        submoduleId: refSubmodule,
      },
    });

    // Refacciones usadas: se guarda copia de nº de parte, descripción y costo
    // vigente, y se registra la salida en el ledger de inventario.
    if (partIds.length && createdComment) {
      const catalog = await tx
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
        await tx.insert(commentParts).values(rows);

        // Un movimiento por refacción, con lock de fila: dos técnicos
        // registrando consumo de la misma pieza a la vez ya no se pisan.
        for (const r of rows) {
          const moved = await consumePart(tx, {
            partId: r.partId,
            quantity: r.quantity,
            ticketCommentId: createdComment.id,
            unitCostMxn: r.unitCostMxn,
            unitCostUsd: r.unitCostUsd,
            actorId: session.user.id,
            note: `Consumo en bitácora del ticket`,
          });

          await recordEvent(tx, {
            aggregateType: "spare_part",
            aggregateId: r.partId,
            // Un sobregiro se registra como evento propio para que el panel de
            // refacciones y compras puedan reaccionar, en vez de silenciarse.
            eventType: moved.overdrawn ? "part.stock_overdrawn" : "part.consumed",
            actorId: session.user.id,
            payload: {
              ticketId,
              commentId: createdComment.id,
              partNumber: r.partNumber,
              quantity: r.quantity,
              balanceAfter: moved.balanceAfter,
              shortfall: moved.shortfall,
            },
          });
        }
      }
    }

    /*
      El reloj del SLA para con una respuesta PÚBLICA del staff, no con
      cualquiera.

      Antes lo paraba también una nota interna, y eso mide lo contrario de lo
      prometido: el compromiso es con el cliente, y el cliente no ve las notas
      internas. Contarlas habría inflado el cumplimiento contra uno mismo —el
      tablero diría «respondido en 12 minutos» mientras el laboratorio sigue sin
      recibir noticia—.

      No es hipotético: los 534 comentarios traídos del sistema anterior están
      marcados como internos, así que bajo la regla vieja habrían parado 534
      relojes sin que nadie le contestara nunca a nadie.
    */
    if (staff && !internal) {
      await tx
        .update(tickets)
        .set({
          firstRespondedAt: sql`coalesce(${tickets.firstRespondedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId));
    }
  });

  revalidateTenant();
}

export async function updateTicketStatus(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isSupport(await currentRole())) return;

  const ticketId = String(formData.get("ticketId"));
  const status = String(formData.get("status"));
  // La aprobación/rechazo tiene su propio flujo; aquí solo estados operativos.
  if (!STAFF_SETTABLE_STATUSES.includes(status as never)) return;

  const db = await tenantDb();

  /*
    Dos cosas que este UPDATE no hacía y ahora sí.

    **No se salta la revisión.** El `where` solo filtraba por id, así que una
    solicitud en `pending_review` podía pasar directo a `resolved` sin aprobarse
    nunca —quedando con `reviewed_by_id` en nulo, o sea sin constancia de quién
    la autorizó—, y un ticket `rejected` podía revivir a `open` sin dejar
    rastro. Esos dos estados tienen su propio flujo (`approveTicket` /
    `rejectTicket`), que sí se protege así; aquí faltaba el mismo cuidado.

    **La fecha de resolución se limpia al reabrir.** Antes solo se escribía al
    resolver y no se tocaba nunca más: un ticket reabierto quedaba «en proceso»
    con fecha de resolución puesta. Eso no es solo raro de leer — es la columna
    con la que el laboratorio de ML aprende «días hasta resolverse», así que un
    reabierto le enseñaba un desenlace que no ocurrió. Hoy no hay ninguno así en
    los datos porque nadie ha reabierto un ticket todavía; el primero que lo
    haga estrena el problema.
  */
  const reopening = status === "open" || status === "in_progress" || status === "waiting";

  await db
    .update(tickets)
    .set({
      status: status as never,
      updatedAt: new Date(),
      ...(status === "resolved" ? { resolvedAt: new Date() } : {}),
      ...(reopening ? { resolvedAt: null } : {}),
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        sql`${tickets.status} not in ('pending_review', 'rejected')`,
      ),
    );

  // El servicio terminó: ya se sabe cuántas horas llevó de verdad.
  //
  // Se intenta en los dos estados terminales, y no en uno solo, porque los dos
  // flujos existen: hay tickets que se cierran sin pasar por resuelto y
  // técnicos que registran la última actividad después de marcar resuelto. El
  // desenlace se escribe la primera vez que hay horas en la bitácora y no se
  // vuelve a tocar —una predicción tiene un desenlace—, así que llamar dos
  // veces es inofensivo.
  if (status === "resolved" || status === "closed") {
  }

  revalidateTenant();
}

export async function assignTicket(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isSupport(await currentRole())) return;

  const ticketId = String(formData.get("ticketId") ?? "");
  const raw = formData.get("assignedToId");
  // Cadena vacía / ausente = desasignar.
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  if (!ticketId) return;

  const db = await tenantDb();

  // Solo se puede asignar a personal activo DE ESTA empresa. La pertenencia no
  // es un detalle: el id viaja en el formulario, y sin comprobarla se le podía
  // asignar un ticket al agente de otro inquilino — que además lo vería en su
  // bandeja sin tener nada que ver con este cliente.
  let assignedToId: string | null = null;
  if (candidate) {
    const staff = await getTenantMember(candidate);
    if (!staff?.memberActive || !staff.accountActive || !isSupport(staff.role)) return;
    assignedToId = staff.id;
  }

  await db
    .update(tickets)
    .set({ assignedToId, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId));

  revalidateTenant();
}
