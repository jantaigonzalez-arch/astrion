"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";

export type SettingsState = { ok: boolean; error?: string };

const money = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string") return null;
  const clean = v.replace(/[^0-9.]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isNaN(n) || n < 0 ? null : n.toFixed(2);
};

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) return { ok: false, error: "auth" };

  const laborCostPerHour = money(formData.get("laborCostPerHour"));
  const laborRatePerHour = money(formData.get("laborRatePerHour"));

  try {
    const db = getDb();
    await db
      .insert(settings)
      .values({ id: "global", laborCostPerHour, laborRatePerHour })
      .onConflictDoUpdate({
        target: settings.id,
        set: { laborCostPerHour, laborRatePerHour, updatedAt: new Date() },
      });

    revalidatePath("/admin/configuracion");
    revalidatePath("/admin/contratos");
    return { ok: true };
  } catch (e) {
    console.error("[settings] update error:", e);
    return { ok: false, error: "server" };
  }
}
