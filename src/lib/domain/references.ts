import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { requireTenant } from "@/lib/tenancy/context";

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
type SequenceName =
  | "ticket_reference_seq"
  | "crm_deal_reference_seq"
  | "purchase_order_reference_seq"
  | "supplier_invoice_reference_seq"
  | "supplier_credit_note_reference_seq"
  | "supplier_advance_reference_seq"
  | "payable_import_reference_seq"
  | "requisition_reference_seq";

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

/**
 * Prefijo de la empresa activa.
 *
 * Se resuelve aquí adentro y NO se recibe por parámetro a propósito. El
 * prefijo estuvo clavado como "EVO-" y por eso el primer ticket de cualquier
 * otra empresa habría nacido con la marca de Evoelution. Un folio equivocado
 * no falla: se guarda, se manda por correo y se imprime en un reporte firmado.
 * Obligar a las cuatro llamadas a acordarse de pasarlo sería reabrir el mismo
 * error. `getTenantContext()` está memoizado por petición, así que resolverlo
 * aquí no cuesta una consulta extra.
 */
async function folioPrefix(): Promise<string> {
  const { folioPrefix } = await requireTenant();
  return folioPrefix;
}

/** Folio de ticket: EVO-000123, ACM-000045. */
export async function nextTicketReference(tx: DbOrTx): Promise<string> {
  const [prefix, n] = await Promise.all([
    folioPrefix(),
    nextval(tx, "ticket_reference_seq"),
  ]);
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

/**
 * Folio de negocio: EVO-D-000123. La D lo distingue del folio de ticket.
 *
 * `prefix` explícito por la misma razón que en las facturas: sin él, sembrar o
 * importar negocios desde un script es imposible. Era el único de los siete que
 * no lo admitía, y la consecuencia se ve en `seed-crm.ts`: arma el folio a mano
 * —`EVO-D-000001`— sin tocar la secuencia, así que el primer negocio que cree
 * la aplicación después de sembrar pide el número 1 y choca.
 */
export async function nextDealReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "crm_deal_reference_seq"),
  ]);
  return `${p}-D-${String(n).padStart(6, "0")}`;
}

/**
 * Folio de factura de proveedor: EVO-P-000123. La P, de «por pagar».
 *
 * `prefix` explícito es para lo que corre FUERA de una petición —importadores,
 * tareas programadas, pruebas—, donde no hay empresa activa que consultar.
 * Mismo par que `tenantDb()` / `tenantDbFor()`. Es opcional y no obligatorio a
 * propósito: omitirlo da el comportamiento correcto, así que olvidarlo no puede
 * reabrir el error que este helper vino a cerrar.
 */
export async function nextSupplierInvoiceReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "supplier_invoice_reference_seq"),
  ]);
  return `${p}-P-${String(n).padStart(6, "0")}`;
}

/**
 * Folio de nota de crédito: EVO-NC-000123.
 *
 * NC y no una sola letra a propósito: al lado de un folio de factura (P) en un
 * estado de cuenta, dos documentos que rebajan y aumentan la deuda tienen que
 * distinguirse de un vistazo.
 */
export async function nextSupplierCreditNoteReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "supplier_credit_note_reference_seq"),
  ]);
  return `${p}-NC-${String(n).padStart(6, "0")}`;
}

/** Folio de anticipo: EVO-ANT-000123. */
export async function nextSupplierAdvanceReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "supplier_advance_reference_seq"),
  ]);
  return `${p}-ANT-${String(n).padStart(6, "0")}`;
}

/** Folio de lote de importación: EVO-IMP-000123. */
export async function nextPayableImportReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "payable_import_reference_seq"),
  ]);
  return `${p}-IMP-${String(n).padStart(6, "0")}`;
}

/**
 * Folio de requisición: EVO-R-000123.
 *
 * R y no C: la requisición y la orden que sale de ella son dos documentos que
 * van a estar juntos en la misma conversación con el proveedor y con quien
 * autoriza. Si compartieran letra no habría forma de decir cuál se está citando.
 */
export async function nextRequisitionReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "requisition_reference_seq"),
  ]);
  return `${p}-R-${String(n).padStart(6, "0")}`;
}

/**
 * Folio de orden de compra: EVO-C-000123. La C lo distingue de las otras dos.
 *
 * `prefix` explícito por la misma razón que en las facturas: sin él, sembrar o
 * importar órdenes desde un script es imposible, porque `folioPrefix()` necesita
 * una petición viva para saber de qué empresa se trata.
 */
export async function nextPurchaseOrderReference(
  tx: DbOrTx,
  prefix?: string,
): Promise<string> {
  const [p, n] = await Promise.all([
    prefix ? Promise.resolve(prefix) : folioPrefix(),
    nextval(tx, "purchase_order_reference_seq"),
  ]);
  return `${p}-C-${String(n).padStart(6, "0")}`;
}
