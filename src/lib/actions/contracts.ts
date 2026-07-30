"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contracts, contractEquipment, equipment } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isAdminRole, isSalesRole } from "@/lib/roles";

export type ContractState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "server";
  number?: string;
};

// Monto opcional: acepta "12,500.50" o vacío.
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

export async function createContract(
  _prev: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const session = await auth();
  // El administrador da de alta los contratos.
  if (!isAdminRole(session?.user?.role)) return { ok: false, error: "auth" };

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

  try {
    const db = getDb();

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
        clientId: parsed.data.clientId,
        salesRepId: parsed.data.salesRepId ?? null,
        dealId: parsed.data.dealId ?? null,
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
        .where(eq(equipment.ownerId, parsed.data.clientId));
      const allowed = new Set(owned.map((e) => e.id));
      const rows = selected
        .filter((id) => allowed.has(id))
        .map((equipmentId) => ({ contractId: created.id, equipmentId }));
      if (rows.length) await db.insert(contractEquipment).values(rows);
    }

    revalidatePath("/admin/contratos");
    // Si nació de un negocio, su ficha debe mostrar el contrato ya enlazado.
    if (parsed.data.dealId) {
      revalidatePath(`/admin/crm/negocios/${parsed.data.dealId}`);
    }
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
  if (!isAdminRole(session?.user?.role)) return { ok: false, error: "auth" };

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
    const db = getDb();

    const [current] = await db
      .select({ id: contracts.id, clientId: contracts.clientId })
      .from(contracts)
      .where(eq(contracts.id, parsed.data.id))
      .limit(1);
    if (!current) return { ok: false, error: "invalid" };

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
        salesRepId: parsed.data.salesRepId ?? null,
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

    revalidatePath("/admin/contratos");
    revalidatePath(`/admin/contratos/${current.id}`);
    revalidatePath(`/admin/contratos/${current.id}/editar`);
    return { ok: true, number };
  } catch (e) {
    console.error("[contract] update error:", e);
    return { ok: false, error: "server" };
  }
}

export async function deleteContract(formData: FormData) {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = getDb();
  await db.delete(contracts).where(eq(contracts.id, id));
  revalidatePath("/admin/contratos");
  redirect("/admin/contratos");
}

/** Vincula o desvincula un equipo de un contrato existente. */
export async function toggleContractEquipment(formData: FormData) {
  const session = await auth();
  if (!isSalesRole(session?.user?.role)) return;

  const contractId = String(formData.get("contractId") ?? "");
  const equipmentId = String(formData.get("equipmentId") ?? "");
  const attach = formData.get("attach") === "1";
  if (!contractId || !equipmentId) return;

  const db = getDb();
  if (attach) {
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
  revalidatePath(`/admin/contratos/${contractId}`);
  revalidatePath("/admin/contratos");
}
