"use server";

import { vetoLista69b } from "@/lib/domain/lista-69b";
import { z } from "zod";
import { importeOpcional } from "@/lib/importe";
import { revalidateTenant } from "@/lib/revalidate";
import { redirectAfterAction } from "@/lib/nav-server";
import { and, eq } from "drizzle-orm";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { contracts, contractEquipment, crmDeals, crmOrganizations, equipment } from "@/lib/db/schema";
import { getTenantMember } from "@/lib/data/people";
import { auth } from "@/lib/auth";
import { isSalesRole } from "@/lib/roles";
import { recordDeletion } from "@/lib/domain/events";

export type ContractState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "lista69b" | "server";
  /** Con `lista69b`: el porqué, con el nombre del cliente. Ver `vetoLista69b`. */
  motivo?: string;
  number?: string;
};

// Monto opcional: vacío o un número de cero en adelante. Ver `lib/importe.ts`.
const money = importeOpcional;

const ContractSchema = z.object({
  number: z.string().min(2).max(60),
  clientId: z.string().uuid(),
  salesRepId: z.string().uuid().optional(),
  // Negocio del CRM que dio origen al contrato (opcional).
  dealId: z.string().uuid().optional(),
  amountMxn: money,
  amountUsd: money,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Comprueba que las personas del contrato sean de ESTA empresa.
 *
 * `clientId` y `salesRepId` solo se validaban como uuid, y la clave foránea
 * apunta a `public.users` —el padrón de toda la plataforma—, así que bastaba
 * mandar un uuid con formato correcto para firmar un contrato a nombre de
 * alguien de otro inquilino. Es la misma comprobación que ya hacen `assignTicket`
 * y el CRM; aquí faltaba.
 *
 * Devuelve `null` cuando algo no cuadra, para que quien llama lo trate como
 * dato inválido en vez de guardar a medias.
 */
async function validateParties(clientId: string, salesRepId?: string) {
  const client = await getTenantMember(clientId);
  if (!client?.memberActive || !client.accountActive) return null;
  // El titular de un contrato es un laboratorio, no un empleado.
  if (client.role !== "client") return null;

  if (salesRepId) {
    const rep = await getTenantMember(salesRepId);
    if (!rep?.memberActive || !rep.accountActive || !isSalesRole(rep.role)) return null;
    return { clientId: client.id, salesRepId: rep.id };
  }
  return { clientId: client.id, salesRepId: null as string | null };
}

/**
 * El negocio de origen debe ser del MISMO cliente que el contrato.
 *
 * Importa más desde que existe el módulo de Clientes: la regla `ES_CLIENTE`
 * cuenta «contrato unido a negocio» como prueba de compra, así que un enlace
 * cruzado convertiría en cliente a una organización que nunca compró nada.
 * Devuelve `undefined` si el negocio no sirve, para guardarlo sin enlace en vez
 * de rechazar el contrato entero por un campo opcional.
 */
async function validateDeal(dealId: string | undefined, clientId: string) {
  if (!dealId) return undefined;
  const db = await tenantDb();
  const [row] = await db
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .innerJoin(crmOrganizations, eq(crmOrganizations.id, crmDeals.organizationId))
    .where(and(eq(crmDeals.id, dealId), eq(crmOrganizations.clientId, clientId)))
    .limit(1);
  return row?.id;
}

export async function createContract(
  _prev: ContractState,
  formData: FormData,
): Promise<ContractState> {
  // El administrador da de alta los contratos.
  if (!(await puedeEn("clientes", "administrar"))) return { ok: false, error: "auth" };

  const parsed = ContractSchema.safeParse({
    number: formData.get("number"),
    clientId: formData.get("clientId"),
    salesRepId: formData.get("salesRepId") || undefined,
    dealId: (formData.get("dealId") as string) || undefined,
    amountMxn: (formData.get("amountMxn") as string) || undefined,
    amountUsd: (formData.get("amountUsd") as string) || undefined,
    startDate: (formData.get("startDate") as string) || undefined,
    endDate: (formData.get("endDate") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const number = parsed.data.number.trim();

  const parties = await validateParties(parsed.data.clientId, parsed.data.salesRepId);
  if (!parties) return { ok: false, error: "invalid" };

  // Un contrato NUEVO con un cliente en la lista 69-B, si la empresa lo bloquea
  // (0038, Configuración → Clientes). Los ya firmados no se tocan.
  const veto69b = await vetoLista69b(await tenantDb(), parties.clientId, "contratos");
  if (veto69b) return { ok: false, error: "lista69b", motivo: veto69b };

  try {
    const db = await tenantDb();
    const dealId = await validateDeal(parsed.data.dealId, parties.clientId);

    const [dup] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.number, number))
      .limit(1);
    if (dup) return { ok: false, error: "duplicate" };

    const [created] = await db
      .insert(contracts)
      .values({
        number,
        clientId: parties.clientId,
        salesRepId: parties.salesRepId,
        dealId: dealId ?? null,
        amountMxn: parsed.data.amountMxn ?? null,
        amountUsd: parsed.data.amountUsd ?? null,
        startDate: parsed.data.startDate ?? null,
        endDate: parsed.data.endDate ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: contracts.id });

    // Equipos amparados: solo los que pertenecen a ese laboratorio.
    const selected = formData.getAll("equipmentIds").map(String).filter(Boolean);
    if (selected.length) {
      const owned = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(eq(equipment.ownerId, parties.clientId));
      const allowed = new Set(owned.map((e) => e.id));
      const rows = selected
        .filter((id) => allowed.has(id))
        .map((equipmentId) => ({ contractId: created.id, equipmentId }));
      if (rows.length) await db.insert(contractEquipment).values(rows);
    }

    // Una sola llamada cubre el subárbol de la empresa, incluida la ficha del
    // negocio que originó el contrato.
    revalidateTenant();
    return { ok: true, number };
  } catch (e) {
    console.error("[contract] create error:", e);
    return { ok: false, error: "server" };
  }
}

/* ---------------- Editar contrato ---------------- */
const UpdateContractSchema = ContractSchema.omit({ clientId: true }).extend({
  id: z.string().uuid(),
});

export async function updateContract(
  _prev: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("clientes", "administrar"))) {
    return { ok: false, error: "auth" };
  }

  const parsed = UpdateContractSchema.safeParse({
    id: formData.get("id"),
    number: formData.get("number"),
    salesRepId: formData.get("salesRepId") || undefined,
    amountMxn: (formData.get("amountMxn") as string) || undefined,
    amountUsd: (formData.get("amountUsd") as string) || undefined,
    startDate: (formData.get("startDate") as string) || undefined,
    endDate: (formData.get("endDate") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const number = parsed.data.number.trim();

  try {
    const db = await tenantDb();

    const [current] = await db
      .select({ id: contracts.id, clientId: contracts.clientId })
      .from(contracts)
      .where(eq(contracts.id, parsed.data.id))
      .limit(1);
    if (!current) return { ok: false, error: "invalid" };

    // El cliente del contrato no se puede cambiar (el esquema de edición lo
    // omite), pero el vendedor sí, y llega por formulario: se valida contra el
    // padrón de la empresa igual que al crearlo.
    const parties = await validateParties(current.clientId, parsed.data.salesRepId);
    if (!parties) return { ok: false, error: "invalid" };

    // El número debe seguir siendo único (excluyendo este mismo contrato).
    const [dup] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.number, number))
      .limit(1);
    if (dup && dup.id !== current.id) return { ok: false, error: "duplicate" };

    await db
      .update(contracts)
      .set({
        number,
        salesRepId: parties.salesRepId,
        amountMxn: parsed.data.amountMxn ?? null,
        amountUsd: parsed.data.amountUsd ?? null,
        startDate: parsed.data.startDate ?? null,
        endDate: parsed.data.endDate ?? null,
        notes: parsed.data.notes ?? null,
      })
      .where(eq(contracts.id, current.id));

    // Re-sincroniza los equipos amparados (solo los del propio laboratorio).
    const selected = formData.getAll("equipmentIds").map(String).filter(Boolean);
    const owned = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(eq(equipment.ownerId, current.clientId));
    const allowed = new Set(owned.map((e) => e.id));

    await db
      .delete(contractEquipment)
      .where(eq(contractEquipment.contractId, current.id));

    const rows = selected
      .filter((id) => allowed.has(id))
      .map((equipmentId) => ({ contractId: current.id, equipmentId }));
    if (rows.length) await db.insert(contractEquipment).values(rows);

    revalidateTenant();
    return { ok: true, number };
  } catch (e) {
    console.error("[contract] update error:", e);
    return { ok: false, error: "server" };
  }
}

export async function deleteContract(formData: FormData) {
  const session = await auth();
  if (!session?.user || !(await puedeEn("clientes", "administrar"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = await tenantDb();
  // Un contrato es un documento con dinero: su baja es el borrado con más peso
  // de auditoría del sistema. Se guardan también los equipos que amparaba,
  // porque la cascada de contract_equipment se los lleva.
  await db.transaction(async (tx) => {
    const covered = await tx
      .select({ equipmentId: contractEquipment.equipmentId })
      .from(contractEquipment)
      .where(eq(contractEquipment.contractId, id));

    const [row] = await tx.delete(contracts).where(eq(contracts.id, id)).returning();
    if (!row) return;
    await recordDeletion(tx, {
      aggregateType: "contract",
      aggregateId: id,
      eventType: "contract.deleted",
      actorId: session.user.id,
      snapshot: row,
      extra: { equipmentIds: covered.map((e) => e.equipmentId) },
    });
  });
  revalidateTenant();
  await redirectAfterAction("/admin/contratos");
}

/**
 * Vincula o desvincula un equipo de un contrato existente.
 *
 * **Un contrato solo puede amparar equipo de su propio cliente**, y esa
 * comprobación faltaba justo aquí.
 *
 * `createContract` sí filtra —cruza los equipos elegidos contra los del
 * laboratorio y descarta el resto—, pero esta acción insertaba cualquier id que
 * llegara en el formulario. La comprobación existía en un camino y faltaba en
 * el otro, que es exactamente como se cuelan estas cosas.
 *
 * Lo que costaba no era teórico. Un equipo ajeno amparado arrastra sus tickets
 * a la pantalla del contrato —`getTicketsForEquipmentIds` los busca por equipo,
 * no por cliente—, así que el contrato de un laboratorio terminaba mostrando el
 * historial de servicio de otro, con sus horas y sus refacciones sumando a la
 * utilidad consolidada. En estos datos ya hay tres enlaces así, heredados del
 * importador, que enlaza por número de serie sin mirar de quién es el equipo.
 *
 * Desvincular NO se valida: si un enlace equivocado ya existe, hay que poder
 * quitarlo. Exigir que el equipo fuera del cliente para poder soltarlo dejaría
 * los errores clavados para siempre.
 */
export async function toggleContractEquipment(formData: FormData) {
  const session = await auth();
  if (!session?.user || !(await puedeEn("clientes", "editar"))) return;

  const contractId = String(formData.get("contractId") ?? "");
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const attach = formData.get("attach") === "1";
  if (!contractId || !equipmentId) return;

  const db = await tenantDb();
  if (attach) {
    const [ok] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .innerJoin(contracts, eq(contracts.clientId, equipment.ownerId))
      .where(and(eq(equipment.id, equipmentId), eq(contracts.id, contractId)))
      .limit(1);
    if (!ok) return;

    await db.insert(contractEquipment).values({ contractId, equipmentId }).onConflictDoNothing();
  } else {
    await db
      .delete(contractEquipment)
      .where(
        and(
          eq(contractEquipment.contractId, contractId),
          eq(contractEquipment.equipmentId, equipmentId),
        ),
      );
  }
  revalidateTenant();
}
