import "server-only";
import type { DbOrTx } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { spareParts } from "@/lib/db/schema";

export async function getSpareParts(onlyActive = false, conexion?: DbOrTx) {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN.

    Una descarga corre por el pool de SOLO LECTURA para no ocupar una de las dos
    conexiones que la empresa tiene para su trabajo del día. Opcional y con el
    mismo comportamiento al omitirla, así que ninguna de las llamadas que ya
    existían cambia. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());
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
