"use server";

import { z } from "zod";
import { importeOpcional } from "@/lib/importe";
import { revalidateTenant } from "@/lib/revalidate";
import { eq } from "drizzle-orm";
import { currentRole, tenantDb, puedeEn } from "@/lib/tenancy/context";
import { isInternal } from "@/lib/roles";
import { buscarRefacciones, type OpcionRefaccion } from "@/lib/data/parts";
import { spareParts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { applyInventoryMovement } from "@/lib/domain/inventory";

export type PartState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "server";
  partNumber?: string;
};

// Monto opcional: vacío o un número de cero en adelante. Ver `lib/importe.ts`.
const money = importeOpcional;

const PartSchema = z.object({
  partNumber: z.string().min(2).max(80),
  description: z.string().min(3).max(300),
  brand: z.string().max(80).optional(),
  costMxn: money,
  costUsd: money,
  priceMxn: money,
  priceUsd: money,
  stock: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

/** Alta de refacción (soporte: agente/admin). */
export async function createPart(
  _prev: PartState,
  formData: FormData,
): Promise<PartState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("inventario", "editar"))) {
    return { ok: false, error: "auth" };
  }

  const parsed = PartSchema.safeParse({
    partNumber: formData.get("partNumber"),
    description: formData.get("description"),
    brand: (formData.get("brand") as string) || undefined,
    costMxn: (formData.get("costMxn") as string) || undefined,
    costUsd: (formData.get("costUsd") as string) || undefined,
    priceMxn: (formData.get("priceMxn") as string) || undefined,
    priceUsd: (formData.get("priceUsd") as string) || undefined,
    stock: (formData.get("stock") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const partNumber = parsed.data.partNumber.trim().toUpperCase();

  try {
    const db = await tenantDb();
    const [dup] = await db
      .select({ id: spareParts.id })
      .from(spareParts)
      .where(eq(spareParts.partNumber, partNumber))
      .limit(1);
    if (dup) return { ok: false, error: "duplicate" };

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(spareParts)
        .values({
          partNumber,
          description: parsed.data.description,
          brand: parsed.data.brand,
          costMxn: parsed.data.costMxn ?? null,
          costUsd: parsed.data.costUsd ?? null,
          priceMxn: parsed.data.priceMxn ?? null,
          priceUsd: parsed.data.priceUsd ?? null,
          // Nace en 0 y el saldo inicial entra como movimiento: así el stock
          // siempre es la suma del ledger, sin un valor que apareció de la nada.
          stock: 0,
        })
        .returning({ id: spareParts.id });

      const opening = parsed.data.stock ?? 0;
      if (opening > 0) {
        await applyInventoryMovement(tx, {
          partId: created.id,
          kind: "opening",
          quantity: opening,
          unitCostMxn: parsed.data.costMxn ?? null,
          unitCostUsd: parsed.data.costUsd ?? null,
          actorId: session.user.id,
          note: "Saldo inicial al dar de alta la refacción",
        });
      }
    });

    revalidateTenant();
    return { ok: true, partNumber };
  } catch (e) {
    console.error("[part] create error:", e);
    return { ok: false, error: "server" };
  }
}

/** Actualiza costo actual / existencias / datos de una refacción. */
export async function updatePart(
  _prev: PartState,
  formData: FormData,
): Promise<PartState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("inventario", "editar"))) {
    return { ok: false, error: "auth" };
  }

  const id = String(formData.get("id") ?? "");
  const parsed = PartSchema.safeParse({
    partNumber: formData.get("partNumber"),
    description: formData.get("description"),
    brand: (formData.get("brand") as string) || undefined,
    costMxn: (formData.get("costMxn") as string) || undefined,
    costUsd: (formData.get("costUsd") as string) || undefined,
    priceMxn: (formData.get("priceMxn") as string) || undefined,
    priceUsd: (formData.get("priceUsd") as string) || undefined,
    stock: (formData.get("stock") as string) || undefined,
  });
  if (!id || !parsed.success) return { ok: false, error: "invalid" };

  const partNumber = parsed.data.partNumber.trim().toUpperCase();

  try {
    const db = await tenantDb();
    const [dup] = await db
      .select({ id: spareParts.id })
      .from(spareParts)
      .where(eq(spareParts.partNumber, partNumber))
      .limit(1);
    if (dup && dup.id !== id) return { ok: false, error: "duplicate" };

    await db.transaction(async (tx) => {
      // Nota: `stock` ya no se escribe aquí. Es caché del ledger, así que un
      // cambio de existencias se expresa como movimiento de ajuste.
      await tx
        .update(spareParts)
        .set({
          partNumber,
          description: parsed.data.description,
          brand: parsed.data.brand ?? null,
          costMxn: parsed.data.costMxn ?? null,
          costUsd: parsed.data.costUsd ?? null,
          /*
            Los precios de venta se validaban y se TIRABAN: el formulario de
            edición los ofrece, la acción los leía y respondía «guardado», y la
            columna seguía con el valor de antes. Lo encontró
            `scripts/_probe-acciones-equipos.ts`. Vacío borra, igual que el costo.
          */
          priceMxn: parsed.data.priceMxn ?? null,
          priceUsd: parsed.data.priceUsd ?? null,
          active: formData.get("active") === "on",
          updatedAt: new Date(),
        })
        .where(eq(spareParts.id, id));

      // El formulario manda el stock deseado; el ledger guarda la diferencia.
      if (parsed.data.stock !== undefined) {
        const [current] = await tx
          .select({ stock: spareParts.stock })
          .from(spareParts)
          .where(eq(spareParts.id, id))
          .limit(1);

        const delta = parsed.data.stock - (current?.stock ?? 0);
        if (delta !== 0) {
          await applyInventoryMovement(tx, {
            partId: id,
            kind: "adjustment",
            quantity: delta,
            unitCostMxn: parsed.data.costMxn ?? null,
            unitCostUsd: parsed.data.costUsd ?? null,
            actorId: session.user.id,
            note: `Ajuste manual: ${current?.stock ?? 0} → ${parsed.data.stock}`,
          });
        }
      }
    });

    revalidateTenant();
    return { ok: true, partNumber };
  } catch (e) {
    console.error("[part] update error:", e);
    return { ok: false, error: "server" };
  }
}

/**
 * El buscador de refacciones de los formularios —bitácora del ticket, orden de
 * compra, requisición, negocio—. Devuelve veinte coincidencias en vez de que
 * cada pantalla mande el catálogo entero al navegador; ver `buscarRefacciones`.
 *
 * Solo para el personal: el catálogo lleva costos, y un cliente del portal no
 * tiene ningún formulario que lo pida.
 */
export async function buscarRefaccionesAccion(q: string): Promise<OpcionRefaccion[]> {
  if (!isInternal(await currentRole())) return [];
  return buscarRefacciones(String(q ?? "").slice(0, 80));
}
