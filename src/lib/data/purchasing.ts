import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import {
  inventoryMovements,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
// `users` vive en el esquema de plataforma, no en el del inquilino: es la misma
// persona en todas las empresas. Alcanzable desde la conexión del inquilino
// porque `public` sigue en el search_path.
import { users } from "@/lib/db/platform";
import { incomingByPart } from "@/lib/domain/purchasing";

/**
 * Qué refacciones vienen en camino y para cuándo, indexado por refacción.
 *
 * Cuenta solo lo pendiente de órdenes vivas (enviadas o parciales): un borrador
 * todavía no es un compromiso con nadie, y una recibida ya está en existencia.
 *
 * Lo usa el inventario, que es donde cambia una decisión: "0 piezas" y "0
 * piezas, llegan 10 el martes" se ven igual en la pantalla y llevan a comprar
 * dos veces lo mismo.
 */
export async function getIncomingByPart() {
  const db = await tenantDb();
  return incomingByPart(db);
}

/**
 * Proveedores.
 *
 * `purchasableOnly` no es lo mismo que `onlyActive`, y la diferencia importa:
 * a un proveedor suspendido NO se le levanta una orden nueva, pero SÍ se le
 * captura la factura de lo que ya entregó. Filtrar los suspendidos también del
 * alta de facturas dejaría fuera del sistema una deuda que existe.
 */
export async function getSuppliers(onlyActive = false, purchasableOnly = false) {
  const db = await tenantDb();
  const q = db.select().from(suppliers).orderBy(asc(suppliers.name));
  if (purchasableOnly) {
    return q.where(
      and(eq(suppliers.active, true), isNull(suppliers.suspendedAt)),
    );
  }
  if (onlyActive) return q.where(eq(suppliers.active, true));
  return q;
}

export type OrderRow = {
  id: string;
  reference: string;
  supplierName: string;
  status: string;
  currency: string;
  expectedAt: string | null;
  createdAt: Date;
  lines: number;
  units: number;
  received: number;
  /** Total de la orden en la moneda en que se pactó. */
  total: number;
};

/**
 * Una página del listado de órdenes, con sus totales.
 *
 * ── LOS AGREGADOS VAN EN SQL ───────────────────────────────────────────────
 *
 * El listado no necesita los renglones: traerlos todos para sumarlos sería
 * mover cientos de filas a cambio de cuatro números por orden.
 *
 * ── Y AHORA TAMBIÉN VA PAGINADO ────────────────────────────────────────────
 *
 * Devolvía la tabla ENTERA. Con 2 612 órdenes eran 13 ms y parecía gratis, y
 * ése era el problema: el número de la derecha no tenía tope. Una empresa con
 * tres años de compras tiene decenas de miles de órdenes, y la pantalla las
 * traía todas —consulta, red y HTML— para enseñar las veinticinco de arriba.
 *
 * `count(*) over ()` da el total en la MISMA consulta y no en una segunda: son
 * dos preguntas sobre el mismo conjunto, y separarlas abre la ventana para que
 * el conteo y la página se contradigan si alguien registra una orden en medio.
 * Es lo mismo que ya hace `getProfitDetail`.
 *
 * Se cuenta DESPUÉS de agrupar —y por eso la ventana va sobre el resultado
 * agrupado—: lo que se pagina son órdenes, no renglones de orden.
 */
export async function getPurchaseOrders(
  page?: { limit: number; offset: number },
): Promise<{ rows: OrderRow[]; total: number }> {
  const db = await tenantDb();
  const q = db
    .select({
      total_count: sql<number>`count(*) over ()::int`,
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      supplierName: suppliers.name,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      expectedAt: purchaseOrders.expectedAt,
      createdAt: purchaseOrders.createdAt,
      lines: sql<number>`count(${purchaseOrderLines.id})::int`,
      units: sql<number>`coalesce(sum(${purchaseOrderLines.quantity}), 0)::int`,
      received: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQuantity}), 0)::int`,
      total: sql<number>`coalesce(sum(
        ${purchaseOrderLines.quantity} *
        coalesce(${purchaseOrderLines.unitCostMxn}, ${purchaseOrderLines.unitCostUsd}, 0)
      ), 0)::float8`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.orderId, purchaseOrders.id))
    .groupBy(
      purchaseOrders.id,
      purchaseOrders.reference,
      suppliers.name,
      purchaseOrders.status,
      purchaseOrders.currency,
      purchaseOrders.expectedAt,
      purchaseOrders.createdAt,
    )
    .orderBy(desc(purchaseOrders.createdAt));

  const rows = (await (page ? q.limit(page.limit).offset(page.offset) : q)) as Array<
    OrderRow & { total_count: number }
  >;

  return {
    rows: rows as OrderRow[],
    // Sin filas no hay ventana de dónde leer el total, y cero es la respuesta.
    total: rows[0]?.total_count ?? 0,
  };
}

/** Una orden con todo lo necesario para su pantalla de detalle. */
export async function getPurchaseOrder(id: string) {
  const db = await tenantDb();

  const [order] = await db
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      expectedAt: purchaseOrders.expectedAt,
      notes: purchaseOrders.notes,
      sentAt: purchaseOrders.sentAt,
      closedAt: purchaseOrders.closedAt,
      createdAt: purchaseOrders.createdAt,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierEmail: suppliers.email,
      supplierPhone: suppliers.phone,
      paymentTermsDays: suppliers.paymentTermsDays,
      createdByName: users.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdById))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!order) return null;

  const lines = await db
    .select({
      id: purchaseOrderLines.id,
      partId: purchaseOrderLines.partId,
      partNumber: purchaseOrderLines.partNumber,
      description: purchaseOrderLines.description,
      quantity: purchaseOrderLines.quantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      unitCostMxn: purchaseOrderLines.unitCostMxn,
      unitCostUsd: purchaseOrderLines.unitCostUsd,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, id))
    .orderBy(asc(purchaseOrderLines.partNumber));

  // Las recepciones se leen del ledger, no de una tabla de recepciones: el
  // movimiento de inventario ES el documento de entrada.
  const receipts = await db
    .select({
      id: inventoryMovements.id,
      lineId: inventoryMovements.purchaseOrderLineId,
      quantity: inventoryMovements.quantity,
      balanceAfter: inventoryMovements.balanceAfter,
      occurredAt: inventoryMovements.occurredAt,
      note: inventoryMovements.note,
      actorName: users.name,
    })
    .from(inventoryMovements)
    .leftJoin(users, eq(users.id, inventoryMovements.actorId))
    .where(
      sql`${inventoryMovements.purchaseOrderLineId} in (
        select id from ${purchaseOrderLines} where order_id = ${id}::uuid
      )`,
    )
    .orderBy(desc(inventoryMovements.occurredAt));

  return { order, lines, receipts };
}
