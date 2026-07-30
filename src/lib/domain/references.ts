import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";

/**
 * Folios por secuencia de Postgres.
 *
 * Antes se generaban con `count(*) + 1`, que tiene dos fallas:
 *  1. Reutiliza números. Al borrar una fila el contador baja y el folio
 *     siguiente choca con uno existente → violación de unique.
 *  2. Colisiona entre inserciones concurrentes: dos usuarios creando a la vez
 *     leen el mismo count y piden el mismo folio.
 *
 * `nextval` es atómico y no reutiliza, a cambio de poder dejar huecos si una
 * transacción se aborta. Un hueco es aceptable; un folio duplicado no.
 */

/** Secuencias declaradas en el schema. Union cerrado: nada de nombres libres. */
type SequenceName = "ticket_reference_seq" | "crm_deal_reference_seq";

async function nextval(tx: DbOrTx, sequence: SequenceName): Promise<number> {
  // sql.raw es seguro aquí porque `sequence` es un union cerrado de literales
  // definidos en este archivo: nunca llega de la entrada del usuario.
  const rows = (await tx.execute(
    sql`select nextval(${sql.raw(`'${sequence}'`)})::int as n`,
  )) as unknown as Array<{ n: number }>;

  const n = Number(rows[0]?.n);
  if (!Number.isFinite(n)) {
    throw new Error(`No se pudo obtener folio de la secuencia ${sequence}`);
  }
  return n;
}

/** Folio de ticket: EVO-000123. */
export async function nextTicketReference(tx: DbOrTx): Promise<string> {
  const n = await nextval(tx, "ticket_reference_seq");
  return `EVO-${String(n).padStart(6, "0")}`;
}

/** Folio de negocio: EVO-D-000123. */
export async function nextDealReference(tx: DbOrTx): Promise<string> {
  const n = await nextval(tx, "crm_deal_reference_seq");
  return `EVO-D-${String(n).padStart(6, "0")}`;
}
