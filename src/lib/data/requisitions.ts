import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import {
  crmDeals,
  purchaseOrderLines,
  purchaseOrders,
  requisitionLines,
  requisitions,
  spareParts,
  suppliers,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { necesidadDelPedido, type Necesidad } from "@/lib/domain/requisitions";
import type { DbOrTx } from "@/lib/db";

/**
 * Lecturas de requisiciones.
 *
 * Como en cuentas por pagar, todas aceptan una conexión explícita. No es
 * ornamento: sin ella estas consultas solo se pueden ejercitar levantando una
 * petición con sesión, y el error de `current_date + $1` de la vez pasada se
 * coló justamente porque lo que se probó a mano no era la consulta real.
 */

/** Cuánto le falta a cada requisición para estar convertida del todo. */
const PENDIENTE = sql<number>`(
  select coalesce(sum(rl.quantity - rl.ordered_quantity), 0)::int
    from requisition_lines rl
   where rl.requisition_id = ${requisitions.id}
)`;

/** Renglones que todavía nadie ha identificado contra el catálogo. */
const SIN_IDENTIFICAR = sql<number>`(
  select count(*)::int
    from requisition_lines rl
   where rl.requisition_id = ${requisitions.id}
     and rl.part_id is null
)`;

export async function getRequisitions(conexion?: DbOrTx) {
  const db = conexion ?? (await tenantDb());

  return db
    .select({
      id: requisitions.id,
      reference: requisitions.reference,
      title: requisitions.title,
      status: requisitions.status,
      neededBy: requisitions.neededBy,
      createdAt: requisitions.createdAt,
      dealId: requisitions.dealId,
      dealReference: crmDeals.reference,
      requestedBy: users.name,
      lines: sql<number>`(
        select count(*)::int from requisition_lines rl
         where rl.requisition_id = ${requisitions.id}
      )`,
      pending: PENDIENTE,
      unresolved: SIN_IDENTIFICAR,
    })
    .from(requisitions)
    .leftJoin(crmDeals, eq(crmDeals.id, requisitions.dealId))
    .leftJoin(users, eq(users.id, requisitions.requestedById))
    // Lo abierto primero y por fecha de necesidad: es la cola del comprador.
    // `nulls last` porque una requisición sin fecha no es la más urgente, es la
    // que no dijo para cuándo.
    .orderBy(
      sql`case when ${requisitions.status} in ('draft','submitted','approved','partial') then 0 else 1 end`,
      sql`${requisitions.neededBy} asc nulls last`,
      desc(requisitions.createdAt),
    );
}

export type RequisitionRow = Awaited<ReturnType<typeof getRequisitions>>[number];

export async function getRequisition(id: string, conexion?: DbOrTx) {
  const db = conexion ?? (await tenantDb());

  const [head] = await db
    .select({
      id: requisitions.id,
      reference: requisitions.reference,
      title: requisitions.title,
      status: requisitions.status,
      neededBy: requisitions.neededBy,
      notes: requisitions.notes,
      resolutionReason: requisitions.resolutionReason,
      submittedAt: requisitions.submittedAt,
      approvedAt: requisitions.approvedAt,
      closedAt: requisitions.closedAt,
      createdAt: requisitions.createdAt,
      dealId: requisitions.dealId,
      dealReference: crmDeals.reference,
      dealTitle: crmDeals.title,
      requestedById: requisitions.requestedById,
      approvedById: requisitions.approvedById,
    })
    .from(requisitions)
    .leftJoin(crmDeals, eq(crmDeals.id, requisitions.dealId))
    .where(eq(requisitions.id, id))
    .limit(1);

  if (!head) return null;

  const [pedidoPor, autorizoPor] = await Promise.all([
    nombreDe(db, head.requestedById),
    nombreDe(db, head.approvedById),
  ]);

  const lines = await db
    .select({
      id: requisitionLines.id,
      description: requisitionLines.description,
      quantity: requisitionLines.quantity,
      orderedQuantity: requisitionLines.orderedQuantity,
      notes: requisitionLines.notes,
      partId: requisitionLines.partId,
      partNumber: spareParts.partNumber,
      stock: spareParts.stock,
      supplierId: requisitionLines.supplierId,
      supplierName: suppliers.name,
      supplierReason: requisitionLines.supplierReason,
      supplierSuspended: suppliers.suspendedAt,
    })
    .from(requisitionLines)
    .leftJoin(spareParts, eq(spareParts.id, requisitionLines.partId))
    .leftJoin(suppliers, eq(suppliers.id, requisitionLines.supplierId))
    .where(eq(requisitionLines.requisitionId, id))
    .orderBy(asc(requisitionLines.createdAt));

  // Las órdenes que salieron de aquí. Es la mitad que le falta a la
  // trazabilidad: sin esto se puede ir de la orden a la requisición pero no al
  // revés, y la pregunta que se hace en voz alta es siempre «¿ya se pidió?».
  const orders = await db
    .selectDistinct({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      supplier: suppliers.name,
      expectedAt: purchaseOrders.expectedAt,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(
      requisitionLines,
      eq(requisitionLines.id, purchaseOrderLines.requisitionLineId),
    )
    .where(eq(requisitionLines.requisitionId, id))
    .orderBy(desc(purchaseOrders.reference));

  return { ...head, pedidoPor, autorizoPor, lines, orders };
}

export type RequisitionDetail = NonNullable<
  Awaited<ReturnType<typeof getRequisition>>
>;

async function nombreDe(db: DbOrTx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [u] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return u?.name ?? u?.email ?? null;
}

/**
 * La vista previa de un pedido: la resta, antes de escribir nada.
 *
 * Sale de la misma función que usa el alta, a propósito. Dos caminos distintos
 * para el mismo número acaban divergiendo, y el día que diverjan el usuario
 * verá 4 en la pantalla y 7 en el documento.
 */
export async function getNecesidadDePedido(
  dealId: string,
  conexion?: DbOrTx,
): Promise<Necesidad[]> {
  const db = conexion ?? (await tenantDb());
  return necesidadDelPedido(db, dealId);
}

/** Las requisiciones de un pedido, para enseñarlas en el detalle del negocio. */
export async function getRequisitionsForDeal(dealId: string, conexion?: DbOrTx) {
  const db = conexion ?? (await tenantDb());
  return db
    .select({
      id: requisitions.id,
      reference: requisitions.reference,
      status: requisitions.status,
      createdAt: requisitions.createdAt,
      pending: PENDIENTE,
    })
    .from(requisitions)
    .where(eq(requisitions.dealId, dealId))
    .orderBy(desc(requisitions.createdAt));
}
