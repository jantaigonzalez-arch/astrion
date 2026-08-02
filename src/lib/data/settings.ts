import "server-only";
import { eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";

export type AppSettings = {
  laborCostPerHour: number;
  laborRatePerHour: number;
};

const DEFAULTS: AppSettings = { laborCostPerHour: 0, laborRatePerHour: 0 };

export async function getSettings(): Promise<AppSettings> {
  const db = await tenantDb();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.id, "global"))
    .limit(1);
  if (!row) return DEFAULTS;
  return {
    laborCostPerHour: Number(row.laborCostPerHour ?? 0),
    laborRatePerHour: Number(row.laborRatePerHour ?? 0),
  };
}
