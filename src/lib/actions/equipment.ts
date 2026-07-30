"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  equipment,
  equipmentModules,
  equipmentSubmodules,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";
import { saveImage } from "@/lib/uploads";
import { EQUIPMENT_BRANDS } from "@/lib/equipment";

export type EquipState = { ok: boolean; error?: string };

async function requireStaff() {
  const session = await auth();
  // Solo soporte (agente/admin) administra el inventario de equipos.
  if (!isSupport(session?.user?.role)) return null;
  return session;
}

function revalidateLab(ownerId: string) {
  revalidatePath(`/admin/users/${ownerId}/equipos`);
  revalidatePath(`/en/admin/users/${ownerId}/equipos`);
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
    const db = getDb();
    await db.insert(equipment).values({
      ownerId: parsed.data.ownerId,
      brand: parsed.data.brand,
      name: parsed.data.name,
      model: parsed.data.model,
      photo,
    });
    revalidateLab(parsed.data.ownerId);
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
    const db = getDb();
    await db.insert(equipmentModules).values({
      equipmentId: parsed.data.equipmentId,
      brand: parsed.data.brand,
      name: parsed.data.name,
      serialNumber: parsed.data.serialNumber,
      photo,
    });
    revalidateLab(parsed.data.ownerId);
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
    const db = getDb();
    await db.insert(equipmentSubmodules).values({
      moduleId: parsed.data.moduleId,
      name: parsed.data.name,
      serialNumber: parsed.data.serialNumber,
      photo,
    });
    revalidateLab(parsed.data.ownerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "server" };
  }
}

/* ------------------------- Eliminar ------------------------- */
export async function deleteEquipmentItem(formData: FormData) {
  if (!(await requireStaff())) return;
  const kind = String(formData.get("kind"));
  const id = String(formData.get("id"));
  const ownerId = String(formData.get("ownerId"));
  if (!id) return;
  const db = getDb();
  if (kind === "equipment") {
    await db.delete(equipment).where(eq(equipment.id, id));
  } else if (kind === "module") {
    await db.delete(equipmentModules).where(eq(equipmentModules.id, id));
  } else if (kind === "submodule") {
    await db.delete(equipmentSubmodules).where(eq(equipmentSubmodules.id, id));
  }
  revalidateLab(ownerId);
}
