"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { spareParts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";

export type PartState = {
  ok: boolean;
  error?: "auth" | "invalid" | "duplicate" | "server";
  partNumber?: string;
};

const money = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const clean = v.replace(/[^0-9.]/g, "");
    return clean || undefined;
  })
  .refine((v) => v === undefined || !Number.isNaN(Number(v)));

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
  if (!isSupport(session?.user?.role)) return { ok: false, error: "auth" };

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
    const db = getDb();
    const [dup] = await db
      .select({ id: spareParts.id })
      .from(spareParts)
      .where(eq(spareParts.partNumber, partNumber))
      .limit(1);
    if (dup) return { ok: false, error: "duplicate" };

    await db.insert(spareParts).values({
      partNumber,
      description: parsed.data.description,
      brand: parsed.data.brand,
      costMxn: parsed.data.costMxn ?? null,
      costUsd: parsed.data.costUsd ?? null,
      priceMxn: parsed.data.priceMxn ?? null,
      priceUsd: parsed.data.priceUsd ?? null,
      stock: parsed.data.stock ?? 0,
    });

    revalidatePath("/admin/refacciones");
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
  if (!isSupport(session?.user?.role)) return { ok: false, error: "auth" };

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
    const db = getDb();
    const [dup] = await db
      .select({ id: spareParts.id })
      .from(spareParts)
      .where(eq(spareParts.partNumber, partNumber))
      .limit(1);
    if (dup && dup.id !== id) return { ok: false, error: "duplicate" };

    await db
      .update(spareParts)
      .set({
        partNumber,
        description: parsed.data.description,
        brand: parsed.data.brand ?? null,
        costMxn: parsed.data.costMxn ?? null,
        costUsd: parsed.data.costUsd ?? null,
        stock: parsed.data.stock ?? 0,
        active: formData.get("active") === "on",
        updatedAt: new Date(),
      })
      .where(eq(spareParts.id, id));

    revalidatePath("/admin/refacciones");
    return { ok: true, partNumber };
  } catch (e) {
    console.error("[part] update error:", e);
    return { ok: false, error: "server" };
  }
}
