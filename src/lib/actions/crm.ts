"use server";

import { z } from "zod";
import { revalidateTenant } from "@/lib/revalidate";
import { redirectAfterAction } from "@/lib/nav-server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { tenantDb, currentRole } from "@/lib/tenancy/context";
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
  settings,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isAdminRole, isSalesRole } from "@/lib/roles";
import { getTenantMember } from "@/lib/data/people";
import { nextDealReference } from "@/lib/domain/references";
import { recordDeletion, recordEvent } from "@/lib/domain/events";

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
  if (!isSalesRole(await currentRole())) return null;
  return session!;
}

/**
 * Resuelve el responsable comercial de un negocio, organización o contacto.
 *
 * Reemplaza a dos expresiones que se repetían seis veces y que **no decían lo
 * mismo**: al crear era `ownerId ?? session.user.id` y al editar
 * `ownerId ?? null`. Los tres formularios rotulan la opción vacía «— Yo
 * mismo —», así que editar cualquier ficha y dejar esa opción no la ponía a tu
 * nombre: la dejaba SIN responsable. Y como toda la vista comercial filtra por
 * `ownerId = yo`, la ficha desaparecía de la cartera de todos los vendedores y
 * solo la veía un administrador. Nadie iba a relacionar una cosa con la otra.
 *
 * Ahora vacío significa siempre lo que dice la etiqueta: yo.
 *
 * Y de paso valida la membresía, que es la otra mitad del problema. `ownerId`
 * apunta por clave foránea a `public.users` —el padrón de TODA la plataforma—,
 * así que hasta ahora bastaba con mandar un uuid con formato válido para dejar
 * un negocio a nombre de alguien de otra empresa; el ranking de vendedores lo
 * habría mostrado después con su nombre y su correo. Es exactamente la
 * comprobación que `assignTicket` ya hacía y que el CRM nunca tuvo.
 *
 * Devuelve `undefined` cuando el candidato no es miembro: quien llama traduce
 * eso a un error de validación en vez de guardar a medias.
 */
async function resolveOwner(
  candidate: string | undefined,
  session: { user: { id: string } },
): Promise<string | undefined> {
  if (!candidate || candidate === session.user.id) return session.user.id;

  const member = await getTenantMember(candidate);
  // Se exige pertenencia viva Y perfil comercial: dejarle la cartera a alguien
  // que ya no trabaja aquí, o a un cliente, es una ficha que nadie va a
  // atender. `isSalesRole` ya incluye a `owner`.
  if (!member?.memberActive || !member.accountActive) return undefined;
  if (!isSalesRole(member.role)) return undefined;

  return member.id;
}

// Una sola llamada cubre el subárbol entero de la empresa; el parámetro que
// tenía antes distinguía un caso que hacía exactamente lo mismo.
function revalidateCrm() {
  revalidateTenant();
}

/**
 * Estampa la moneda y el tipo de cambio con los que se guarda un negocio.
 *
 * El problema que resuelve: `value_usd` se capturaba, se guardaba… y **nadie lo
 * leía**. Ni el tablero, ni el embudo, ni el pronóstico, ni el ranking, ni los
 * objetivos: todos suman `value_mxn`. Una oportunidad de USD 80 000 aparecía
 * como «—» en su tarjeta y aportaba cero al pipeline. Un error silencioso y
 * siempre en la misma dirección: el pronóstico quedaba corto.
 *
 * La conversión se hace copiando aquí el tipo de cambio que la empresa fijó en
 * Configuración → Moneda, junto con la fecha. No se lee la configuración al
 * pintar los informes, y esa es la decisión de fondo: si los informes leyeran el
 * tipo de cambio de hoy, tocarlo reescribiría el cierre de meses ya reportados y
 * dos personas mirando el mismo trimestre en semanas distintas verían números
 * distintos. Copiado en el negocio, cada cifra conserva la paridad con la que se
 * pactó, que es además lo que un auditor va a pedir.
 *
 * Sin tipo de cambio configurado no se inventa ninguno: el negocio queda en
 * dólares sin convertir y las pantallas lo muestran aparte.
 */
async function stampFx(
  db: Awaited<ReturnType<typeof tenantDb>>,
  values: { valueMxn?: string; valueUsd?: string },
): Promise<{ currency: string | null; fxRate: string | null; fxDate: string | null }> {
  // Solo hay algo que convertir cuando el importe está en dólares y no hay un
  // equivalente en pesos capturado a mano, que siempre manda sobre el cálculo.
  if (!values.valueUsd || values.valueMxn) {
    return { currency: values.valueMxn ? "MXN" : null, fxRate: null, fxDate: null };
  }

  const [row] = await db
    .select({ usdRate: settings.usdRate })
    .from(settings)
    .where(eq(settings.id, "global"))
    .limit(1);

  const rate = Number(row?.usdRate ?? 0);
  if (!(rate > 0)) return { currency: "USD", fxRate: null, fxDate: null };

  return {
    currency: "USD",
    fxRate: rate.toFixed(4),
    // Fecha local del servidor: es el día que la empresa dirá que pactó esa
    // paridad, no el día UTC.
    fxDate: new Date().toLocaleDateString("en-CA"),
  };
}

/**
 * A qué embudo pertenece una etapa. `null` si la etapa no existe.
 *
 * El tablero se dibuja como `stages.map(s => deals.filter(d => d.stageId === s.id))`
 * sobre los negocios de UN embudo. Así que un negocio cuyo `pipeline_id` dice A
 * y cuya etapa vive en B no cae en ninguna columna: **desaparece del tablero**
 * sin dejar de existir, sin dejar de contar en los informes y sin ningún aviso.
 *
 * Nada lo impedía. Hoy la interfaz no deja llegar a ese estado —el embudo viaja
 * en un campo oculto y el selector solo ofrece etapas del embudo actual—, pero
 * eso es una propiedad del formulario, no del sistema: una server action acepta
 * cualquier `formData`, y el día que haya un segundo embudo la primera
 * automatización o importación que mueva etapas puede producirlo.
 *
 * Se comprueba en el borde, que es donde el dato entra.
 */
async function pipelineOfStage(
  db: Awaited<ReturnType<typeof tenantDb>>,
  stageId: string,
): Promise<string | null> {
  const [stage] = await db
    .select({ pipelineId: crmStages.pipelineId })
    .from(crmStages)
    .where(eq(crmStages.id, stageId))
    .limit(1);
  return stage?.pipelineId ?? null;
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
    const db = await tenantDb();
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();

    // Negocio + su evento de alta + calificación del lead son un solo hecho:
    // o quedan los tres, o ninguno. Antes eran escrituras sueltas y un fallo
    // a mitad dejaba un negocio sin historial.
    // La etapa manda sobre el embudo: si no coinciden, el negocio nacería
    // invisible en el tablero. Ver `pipelineOfStage`.
    if ((await pipelineOfStage(db, parsed.data.stageId)) !== parsed.data.pipelineId) {
      return { ok: false, error: "invalid" };
    }

    const fx = await stampFx(db, {
      valueMxn: parsed.data.valueMxn,
      valueUsd: parsed.data.valueUsd,
    });

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
          ownerId: owner,
          valueMxn: parsed.data.valueMxn ?? null,
          valueUsd: parsed.data.valueUsd ?? null,
          ...fx,
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

    if (parsed.data.leadId) revalidateTenant();
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();
    const [current] = await db
      .select({ id: crmDeals.id, stageId: crmDeals.stageId })
      .from(crmDeals)
      .where(eq(crmDeals.id, parsed.data.id))
      .limit(1);
    if (!current) return { ok: false, error: "invalid" };

    // El embudo se DERIVA de la etapa elegida y se escribe junto con ella.
    // Antes `pipelineId` viajaba en el formulario y nunca se guardaba, así que
    // los dos campos podían separarse en silencio.
    const pipelineId = await pipelineOfStage(db, parsed.data.stageId);
    if (!pipelineId) return { ok: false, error: "invalid" };

    // Se vuelve a estampar porque el importe pudo cambiar de moneda al editar.
    const fx = await stampFx(db, {
      valueMxn: parsed.data.valueMxn,
      valueUsd: parsed.data.valueUsd,
    });

    await db
      .update(crmDeals)
      .set({
        title: parsed.data.title.trim(),
        pipelineId,
        stageId: parsed.data.stageId,
        organizationId: parsed.data.organizationId ?? null,
        contactId: parsed.data.contactId ?? null,
        ownerId: owner,
        valueMxn: parsed.data.valueMxn ?? null,
        valueUsd: parsed.data.valueUsd ?? null,
        ...fx,
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

    revalidateCrm();
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

  const db = await tenantDb();
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

  // El arrastre solo ofrece columnas del embudo abierto, pero la acción acepta
  // cualquier `formData`: el embudo se recalcula desde la etapa destino en vez
  // de darlo por bueno.
  const pipelineId = await pipelineOfStage(db, stageId);
  if (!pipelineId) return;

  await db
    .update(crmDeals)
    .set({ stageId, pipelineId, updatedAt: new Date() })
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

  revalidateCrm();
}

/** Marca el negocio como ganado, perdido o lo reabre. */
export async function setDealStatus(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const dealId = String(formData.get("dealId") ?? "");
  const status = String(formData.get("status") ?? "");
  const lostReason = (formData.get("lostReason") as string) || null;
  if (!dealId || !["open", "won", "lost"].includes(status)) return;

  const db = await tenantDb();
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

  revalidateCrm();
}

export async function deleteDeal(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  // El borrado es duro y arrastra actividades, notas y líneas por cascada.
  // El evento con snapshot queda como única copia de lo que había.
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(crmDeals).where(eq(crmDeals.id, id)).returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "deal",
      aggregateId: id,
      eventType: "deal.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateCrm();
  await redirectAfterAction("/admin/crm");
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
  const db = await tenantDb();
  const stale = await db
    .update(crmOrganizations)
    .set({ clientId: null })
    .where(
      and(eq(crmOrganizations.clientId, clientId), ne(crmOrganizations.id, orgId)),
    )
    .returning({ id: crmOrganizations.id });
  // Antes se revalidaba la ficha de cada organización desvinculada; ahora una
  // sola llamada cubre el subárbol entero, así que basta con saber si hubo
  // alguna.
  if (stale.length > 0) revalidateTenant();
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();
    const [created] = await db
      .insert(crmOrganizations)
      .values({
        name: parsed.data.name.trim(),
        industry: parsed.data.industry ?? null,
        website: parsed.data.website ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        ownerId: owner,
        clientId: parsed.data.clientId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: crmOrganizations.id });

    if (parsed.data.clientId) {
      await enforceSingleClientLink(parsed.data.clientId, created.id);
    }
    revalidateTenant();
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();
    await db
      .update(crmOrganizations)
      .set({
        name: parsed.data.name.trim(),
        industry: parsed.data.industry ?? null,
        website: parsed.data.website ?? null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        ownerId: owner,
        clientId: parsed.data.clientId ?? null,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(crmOrganizations.id, parsed.data.id));

    if (parsed.data.clientId) {
      await enforceSingleClientLink(parsed.data.clientId, parsed.data.id);
    }
    revalidateTenant();
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    console.error("[crm] updateOrganization error:", e);
    return { ok: false, error: "server" };
  }
}

/**
 * Toma una organización sin responsable y la pone a tu nombre.
 *
 * Es la contraparte de que la bandeja «sin asignar» sea visible para todo el
 * equipo comercial: si cualquiera la ve, cualquiera tiene que poder tomarla sin
 * pedirle a un administrador que reparta.
 *
 * La condición `owner_id is null` viaja DENTRO del `update` y no en un `if`
 * previo. Con dos vendedores mirando la misma bandeja —que es exactamente lo
 * que va a pasar— comprobar antes y escribir después deja que el segundo pise
 * al primero: los dos leerían "sin dueño" y el último en escribir se la
 * quedaría, sin que el primero se entere de que la perdió. Así, el segundo
 * `update` no afecta ninguna fila y la acción se lo dice.
 */
export async function claimOrganization(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = await tenantDb();
  await db
    .update(crmOrganizations)
    .set({ ownerId: session.user.id })
    .where(and(eq(crmOrganizations.id, id), isNull(crmOrganizations.ownerId)));

  revalidateTenant();
}

export async function deleteOrganization(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crmOrganizations)
      .where(eq(crmOrganizations.id, id))
      .returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "organization",
      aggregateId: id,
      eventType: "organization.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
  await redirectAfterAction("/admin/crm/organizaciones");
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();
    const [created] = await db
      .insert(crmContacts)
      .values({
        name: parsed.data.name.trim(),
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        position: parsed.data.position ?? null,
        organizationId: parsed.data.organizationId ?? null,
        ownerId: owner,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: crmContacts.id });

    revalidateTenant();
    if (parsed.data.organizationId)
      revalidateTenant();
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

  // Un responsable que no es miembro comercial de esta empresa se rechaza
  // como dato inválido, no se guarda como nulo: guardar a medias dejaría la
  // ficha sin dueño sin decírselo a nadie.
  const owner = await resolveOwner(parsed.data.ownerId, session);
  if (!owner) return { ok: false, error: "invalid" };

  try {
    const db = await tenantDb();
    await db
      .update(crmContacts)
      .set({
        name: parsed.data.name.trim(),
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        position: parsed.data.position ?? null,
        organizationId: parsed.data.organizationId ?? null,
        ownerId: owner,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(crmContacts.id, parsed.data.id));

    revalidateTenant();
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    console.error("[crm] updateContact error:", e);
    return { ok: false, error: "server" };
  }
}

export async function deleteContact(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(crmContacts)
      .where(eq(crmContacts.id, id))
      .returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "contact",
      aggregateId: id,
      eventType: "contact.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
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

  const db = await tenantDb();
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

  revalidateCrm();
  if (organizationId) revalidateTenant();
}

/** Marca/desmarca una actividad como completada. */
export async function toggleActivity(formData: FormData) {
  const session = await requireSales();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  const done = formData.get("done") === "1";
  if (!id) return;

  const db = await tenantDb();
  await db
    .update(crmActivities)
    .set({ done, doneAt: done ? new Date() : null })
    .where(eq(crmActivities.id, id));

  revalidateCrm();
}

export async function deleteActivity(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(crmActivities)
      .where(eq(crmActivities.id, id))
      .returning();
    if (!deleted) return null;
    await recordDeletion(tx, {
      aggregateType: "activity",
      aggregateId: id,
      eventType: "activity.deleted",
      actorId: session.user.id,
      snapshot: deleted,
    });
    return deleted;
  });
  revalidateCrm();
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

  const db = await tenantDb();
  await db.insert(crmNotes).values({
    body,
    dealId,
    contactId,
    organizationId,
    authorId: session.user.id,
  });

  revalidateCrm();
  if (organizationId) revalidateTenant();
}

export async function deleteNote(formData: FormData) {
  const session = await requireSales();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(crmNotes)
      .where(eq(crmNotes.id, id))
      .returning();
    if (!deleted) return null;
    await recordDeletion(tx, {
      aggregateType: "note",
      aggregateId: id,
      eventType: "note.deleted",
      actorId: session.user.id,
      snapshot: deleted,
    });
    return deleted;
  });
  revalidateCrm();
}

/* ========================= Etapas del embudo ========================= */

export async function createStage(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;

  const pipelineId = String(formData.get("pipelineId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const probability = Number(formData.get("probability") ?? 50);
  if (!pipelineId || !name) return;

  const db = await tenantDb();
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

  revalidateTenant();
}

export async function updateStage(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const probability = Number(formData.get("probability") ?? 50);
  // Días sin movimiento tras los que la tarjeta se marca estancada (0 = off).
  const rottingDays = Number(formData.get("rottingDays") ?? 0);
  if (!id || !name) return;

  const db = await tenantDb();
  await db
    .update(crmStages)
    .set({
      name,
      probability: Math.max(0, Math.min(100, probability)),
      rottingDays: Math.max(0, Math.min(365, rottingDays)),
    })
    .where(eq(crmStages.id, id));

  revalidateTenant();
}

/** Sube o baja una etapa en el embudo (intercambia el orden con su vecina). */
export async function moveStage(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;

  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!id || !["up", "down"].includes(dir)) return;

  const db = await tenantDb();
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

  revalidateTenant();
}

/** Elimina una etapa solo si está vacía (evita perder negocios). */
export async function deleteStage(formData: FormData) {
  const session = await auth();
  if (!session?.user || !isAdminRole(await currentRole())) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = await tenantDb();
  // La comprobación de "etapa vacía" y el borrado van en la misma transacción:
  // sueltas, alguien podía mover un negocio a esta etapa entre el count y el
  // delete, y la cascada de crm_stages se lo habría llevado.
  await db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmDeals)
      .where(eq(crmDeals.stageId, id));
    if (n > 0) return;

    const [row] = await tx.delete(crmStages).where(eq(crmStages.id, id)).returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "stage",
      aggregateId: id,
      eventType: "stage.deleted",
      actorId: session.user.id,
      snapshot: row,
    });
  });
  revalidateTenant();
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

  const db = await tenantDb();

  // Convertir un lead crea hasta 4 filas enlazadas (organización, contacto,
  // negocio, evento) y marca el lead. Sin transacción, un fallo a mitad dejaba
  // un contacto huérfano y el lead sin convertir: al reintentar se duplicaba.
  const dealId = await db.transaction(async (tx) => {
    /*
      El lead se bloquea y se comprueba que siga sin convertir, dentro de la
      misma transacción.

      Sin esto, convertir no era idempotente: un doble clic —o dos comerciales
      mirando la misma bandeja— creaba DOS negocios y DOS contactos del mismo
      lead, ambos sumando al pronóstico. El botón no se desactiva por estado, así
      que era cuestión de tiempo.

      `for update` es lo que lo cierra de verdad. Con un simple `select` las dos
      peticiones leerían «nuevo» a la vez y las dos seguirían adelante; el
      bloqueo hace que la segunda espere a que la primera termine y encuentre el
      lead ya calificado.
    */
    const [lead] = await tx
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .for("update")
      .limit(1);
    if (!lead) return null;

    // Ya convertido: en vez de no hacer nada —que se lee como "el botón no
    // funciona"— se lleva al negocio que salió de este lead la primera vez.
    if (lead.status === "qualified") {
      const [existing] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(eq(crmDeals.leadId, lead.id))
        .limit(1);
      return existing?.id ?? null;
    }

    const [firstStage] = await tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.pipelineId, pipelineId))
      .orderBy(crmStages.order)
      .limit(1);
    if (!firstStage) return null;

    // Reutiliza la organización si ya existe una con el mismo nombre.
    //
    // La comparación ignora mayúsculas y espacios de sobra: quien llena el
    // formulario web escribe «Lab Genoma», «lab genoma» o «LAB GENOMA» según el
    // día, y con una igualdad exacta cada variante abría una ficha nueva del
    // mismo laboratorio. Duplicar organizaciones es de lo más caro de deshacer
    // en un CRM, porque los negocios ya quedaron repartidos entre las copias.
    let organizationId: string | null = null;
    const orgName = lead.company?.trim();
    if (orgName) {
      const [existing] = await tx
        .select({ id: crmOrganizations.id })
        .from(crmOrganizations)
        .where(sql`lower(btrim(${crmOrganizations.name})) = lower(${orgName})`)
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

  revalidateTenant();
  revalidateCrm();
  // redirect() FUERA de la transacción: lanza NEXT_REDIRECT como control de
  // flujo, y dentro del bloque haría rollback de todo lo que acabamos de
  // escribir. Es el error clásico al meter Server Actions en transacciones.
  await redirectAfterAction(`/admin/crm/negocios/${dealId}`);
}
