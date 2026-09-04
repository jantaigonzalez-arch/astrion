"use server";

import { z } from "zod";
import { revalidateTenant } from "@/lib/revalidate";
import { eq } from "drizzle-orm";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { equipment, equipmentModules, equipmentSubmodules } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { saveImage } from "@/lib/uploads";
import { recordDeletion } from "@/lib/domain/events";
import { EQUIPMENT_BRANDS } from "@/lib/equipment";

export type EquipState = { ok: boolean; error?: string };

async function requireStaff() {
  const session = await auth();
  // Solo soporte (agente/admin) administra el inventario de equipos.
  if (!(await puedeEn("servicio", "editar"))) return null;
  return session;
}

const brandEnum = z.enum(EQUIPMENT_BRANDS);

/* ------------------------- Equipo ------------------------- */
const EquipmentSchema = z.object({
  ownerId: z.string().uuid(),
  brand: brandEnum,
  name: z.string().min(2).max(200),
  model: z.string().max(160).optional(),
});

export async function addEquipment(
  _prev: EquipState,
  formData: FormData,
): Promise<EquipState> {
  if (!(await requireStaff())) return { ok: false, error: "auth" };
  const parsed = EquipmentSchema.safeParse({
    ownerId: formData.get("ownerId"),
    brand: formData.get("brand"),
    name: formData.get("name"),
    model: formData.get("model") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const photo = await saveImage(formData.get("photo"), "equipment");
    const db = await tenantDb();
    await db.insert(equipment).values({
      ownerId: parsed.data.ownerId,
      brand: parsed.data.brand,
      name: parsed.data.name,
      model: parsed.data.model,
      photo,
    });
    revalidateTenant();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "server" };
  }
}

/* ------------------------- Módulo ------------------------- */
const ModuleSchema = z.object({
  ownerId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  brand: brandEnum,
  name: z.string().min(2).max(200),
  serialNumber: z.string().max(120).optional(),
});

export async function addModule(
  _prev: EquipState,
  formData: FormData,
): Promise<EquipState> {
  if (!(await requireStaff())) return { ok: false, error: "auth" };
  const parsed = ModuleSchema.safeParse({
    ownerId: formData.get("ownerId"),
    equipmentId: formData.get("equipmentId"),
    brand: formData.get("brand"),
    name: formData.get("name"),
    serialNumber: formData.get("serialNumber") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const photo = await saveImage(formData.get("photo"), "equipment");
    const db = await tenantDb();
    await db.insert(equipmentModules).values({
      equipmentId: parsed.data.equipmentId,
      brand: parsed.data.brand,
      name: parsed.data.name,
      serialNumber: parsed.data.serialNumber,
      photo,
    });
    revalidateTenant();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "server" };
  }
}

/* ------------------------- Submódulo ------------------------- */
const SubmoduleSchema = z.object({
  ownerId: z.string().uuid(),
  moduleId: z.string().uuid(),
  name: z.string().min(1).max(200),
  serialNumber: z.string().max(120).optional(),
});

export async function addSubmodule(
  _prev: EquipState,
  formData: FormData,
): Promise<EquipState> {
  if (!(await requireStaff())) return { ok: false, error: "auth" };
  const parsed = SubmoduleSchema.safeParse({
    ownerId: formData.get("ownerId"),
    moduleId: formData.get("moduleId"),
    name: formData.get("name"),
    serialNumber: formData.get("serialNumber") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const photo = await saveImage(formData.get("photo"), "equipment");
    const db = await tenantDb();
    await db.insert(equipmentSubmodules).values({
      moduleId: parsed.data.moduleId,
      name: parsed.data.name,
      serialNumber: parsed.data.serialNumber,
      photo,
    });
    revalidateTenant();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "server" };
  }
}

/* ------------------------- Eliminar ------------------------- */
export async function deleteEquipmentItem(formData: FormData) {
  const session = await requireStaff();
  if (!session) return;
  const kind = String(formData.get("kind"));
  const id = String(formData.get("id"));
  if (!id) return;
  const db = await tenantDb();

  // Borrar un equipo arrastra sus módulos y submódulos por cascada, y deja los
  // tickets que lo referenciaban con equipment_id en null: el snapshot es la
  // única forma de saber después a qué equipo se refería un ticket histórico.
  await db.transaction(async (tx) => {
    if (kind === "equipment") {
      const [row] = await tx.delete(equipment).where(eq(equipment.id, id)).returning();
      if (!row) return;
      await recordDeletion(tx, {
        aggregateType: "equipment",
        aggregateId: id,
        eventType: "equipment.deleted",
        actorId: session.user.id,
        snapshot: row,
      });
    } else if (kind === "module") {
      const [row] = await tx
        .delete(equipmentModules)
        .where(eq(equipmentModules.id, id))
        .returning();
      if (!row) return;
      await recordDeletion(tx, {
        aggregateType: "equipment_module",
        aggregateId: id,
        eventType: "equipment_module.deleted",
        actorId: session.user.id,
        snapshot: row,
      });
    } else if (kind === "submodule") {
      const [row] = await tx
        .delete(equipmentSubmodules)
        .where(eq(equipmentSubmodules.id, id))
        .returning();
      if (!row) return;
      await recordDeletion(tx, {
        aggregateType: "equipment_submodule",
        aggregateId: id,
        eventType: "equipment_submodule.deleted",
        actorId: session.user.id,
        snapshot: row,
      });
    }
  });
  revalidateTenant();
}
