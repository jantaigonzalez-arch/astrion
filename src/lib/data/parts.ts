import "server-only";
import { asc, eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { spareParts } from "@/lib/db/schema";

export async function getSpareParts(onlyActive = false) {
  const db = await tenantDb();
  const q = db.select().from(spareParts).orderBy(asc(spareParts.partNumber));
  if (onlyActive) return q.where(eq(spareParts.active, true));
  return q;
}

export async function getSparePartById(id: string) {
  const db = await tenantDb();
  const [p] = await db
    .select()
    .from(spareParts)
    .where(eq(spareParts.id, id))
    .limit(1);
  return p ?? null;
}
