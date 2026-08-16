import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  purchaseOrderLines,
  purchaseOrders,
  spareParts,
  suppliers,
} from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { applyInventoryMovement } from "@/lib/domain/inventory";
import { recordEvent } from "@/lib/domain/events";
import type { PurchaseOrderStatus } from "@/lib/db/schema";

/**
 * Compras: la mitad que le faltaba al ledger de inventario.
 *
 * El ledger ya sabía restar —`consumption`— pero nunca sabía de dónde había
 * salido lo que se resta. Todo lo que entraba lo hacía por un `opening` o un
 * `adjustment` escritos a mano, es decir, sin documento detrás. Este módulo es
 * el documento: proveedor → orden → recepción → movimiento.
 *
 * Tres reglas, y las tres existen por la misma razón —que el inventario no
 * pueda decir algo distinto de lo que dice la orden—:
 *
 *  1. RECIBIR ES ESCRIBIR EN EL LEDGER. No hay tabla de recepciones. El
 *     movimiento de inventario, con su `purchaseOrderLineId`, ES la recepción.
 *     Una tabla aparte sería el mismo hecho contado dos veces y tarde o
 *     temprano las dos versiones dejarían de coincidir.
 *
 *  2. NUNCA SE RECIBE MÁS DE LO PEDIDO. Si llegaron 12 de 10, eso no es una
 *     recepción: es una diferencia con el proveedor y se resuelve con él, no
 *     inflando el inventario en silencio. Se rechaza.
 *
 *  3. CANCELAR NO REVIERTE. Una orden parcialmente recibida que se cancela
 *     conserva sus entradas: la mercancía está físicamente en la bodega. Lo
 *     que se cancela es el compromiso de lo que falta, no lo que ya llegó.
 */

/** Cuánto se recibe de cada renglón en esta entrega. */
export type ReceiptLine = { lineId: string; quantity: number };

export type ReceiveResult =
  | { ok: true; status: PurchaseOrderStatus; received: number; lines: number }
  | { ok: false; reason: string };

/**
 * Recibe mercancía contra una orden.
 *
 * Debe llamarse dentro de una transacción: cada renglón toma el lock de su
 * refacción vía `applyInventoryMovement`, y el estado de la orden se decide
 * leyendo los renglones ya actualizados. Fuera de una transacción, una segunda
 * recepción simultánea podría leer los mismos pendientes y recibir de más.
 */
export async function receivePurchaseOrder(
  tx: DbOrTx,
  input: {
    orderId: string;
    lines: ReceiptLine[];
    actorId?: string | null;
    note?: string | null;
  },
): Promise<ReceiveResult> {
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) {
    return { ok: false, reason: "No indicaste ninguna cantidad a recibir." };
  }
  if (wanted.some((l) => !Number.isInteger(l.quantity))) {
    return { ok: false, reason: "Las cantidades recibidas deben ser enteras." };
  }

  // El lock sobre la orden serializa dos recepciones de la MISMA orden. Sin él,
  // ambas leerían los mismos pendientes y entre las dos recibirían de más.
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.orderId))
    .for("update")
    .limit(1);

  if (!order) return { ok: false, reason: "La orden no existe." };
  if (order.status === "cancelled") {
    return { ok: false, reason: "La orden está cancelada." };
  }
  if (order.status === "draft") {
    // Recibir contra un borrador dejaría entradas de inventario respaldadas por
    // un documento que el proveedor nunca vio.
    return {
      ok: false,
      reason: "Marca la orden como enviada antes de recibir mercancía.",
    };
  }
  if (order.status === "received") {
    return { ok: false, reason: "Esta orden ya se recibió completa." };
  }

  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      partId: purchaseOrderLines.partId,
      partNumber: purchaseOrderLines.partNumber,
      quantity: purchaseOrderLines.quantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      unitCostMxn: purchaseOrderLines.unitCostMxn,
      unitCostUsd: purchaseOrderLines.unitCostUsd,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, order.id));

  const byId = new Map(rows.map((r) => [r.id, r]));

  // Se valida TODO antes de escribir nada: una recepción a medias dejaría el
  // inventario alterado y la orden sin actualizar.
  for (const l of wanted) {
    const line = byId.get(l.lineId);
    if (!line) {
      return { ok: false, reason: "Un renglón no pertenece a esta orden." };
    }
    const pending = line.quantity - line.receivedQuantity;
    if (l.quantity > pending) {
      return {
        ok: false,
        reason:
          `De ${line.partNumber} quedan ${pending} por recibir y estás ` +
          `registrando ${l.quantity}. Si llegó de más, acláralo con el ` +
          `proveedor: el inventario no debe absorber la diferencia.`,
      };
    }
  }

  let received = 0;
  for (const l of wanted) {
    const line = byId.get(l.lineId)!;

    await applyInventoryMovement(tx, {
      partId: line.partId,
      kind: "purchase",
      quantity: l.quantity,
      purchaseOrderLineId: line.id,
      // El costo de la orden viaja al movimiento: es el costo real de ESAS
      // piezas, no el del catálogo, que puede haber cambiado desde entonces.
      unitCostMxn: line.unitCostMxn,
      unitCostUsd: line.unitCostUsd,
      note: input.note ?? `Recepción ${order.reference}`,
      actorId: input.actorId ?? null,
    });

    await tx
      .update(purchaseOrderLines)
      .set({ receivedQuantity: line.receivedQuantity + l.quantity })
      .where(eq(purchaseOrderLines.id, line.id));

    received += l.quantity;
  }

  // El estado se deduce de los renglones, no se elige: así no puede quedar en
  // «parcial» una orden que en realidad ya llegó completa.
  const complete = rows.every((r) => {
    const add = wanted.find((w) => w.lineId === r.id)?.quantity ?? 0;
    return r.receivedQuantity + add >= r.quantity;
  });
  const status: PurchaseOrderStatus = complete ? "received" : "partial";

  await tx
    .update(purchaseOrders)
    .set({
      status,
      closedAt: complete ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, order.id));

  await recordEvent(tx, {
    aggregateType: "purchase_order",
    aggregateId: order.id,
    eventType: "purchase_order.received",
    actorId: input.actorId ?? null,
    payload: {
      reference: order.reference,
      status,
      lines: wanted.map((l) => ({
        lineId: l.lineId,
        partNumber: byId.get(l.lineId)?.partNumber,
        quantity: l.quantity,
      })),
    },
  });

  return { ok: true, status, received, lines: wanted.length };
}

/**
 * Envía la orden al proveedor: la congela.
 *
 * A partir de aquí las líneas no se tocan. El proveedor ya tiene una copia con
 * este folio, y editarla de este lado produciría dos documentos distintos con
 * el mismo número — el tipo de discrepancia que aparece meses después, cuando
 * llega la factura y no cuadra con nada.
 */
export async function sendPurchaseOrder(
  tx: DbOrTx,
  input: { orderId: string; actorId?: string | null },
): Promise<{ ok: boolean; reason?: string }> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.orderId))
    .for("update")
    .limit(1);

  if (!order) return { ok: false, reason: "La orden no existe." };
  if (order.status !== "draft") {
    return { ok: false, reason: "Solo se puede enviar una orden en borrador." };
  }

  // Se comprueba AQUÍ y no solo al crear: una orden puede quedarse días en
  // borrador y al proveedor suspenderlo mientras tanto. Enviar es el punto sin
  // retorno —el proveedor recibe su copia— y por eso es el que hay que cerrar.
  const permitido = await assertSupplierPurchasable(tx, order.supplierId);
  if (!permitido.ok) return { ok: false, reason: permitido.reason };

  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, order.id))) as Array<{ n: number }>;

  if (n === 0) {
    return { ok: false, reason: "La orden no tiene renglones." };
  }

  await tx
    .update(purchaseOrders)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(purchaseOrders.id, order.id));

  await recordEvent(tx, {
    aggregateType: "purchase_order",
    aggregateId: order.id,
    eventType: "purchase_order.sent",
    actorId: input.actorId ?? null,
    payload: { reference: order.reference, lines: n },
  });

  return { ok: true };
}

/**
 * Cancela lo que falta por llegar.
 *
 * Lo ya recibido se queda: está en la bodega y el ledger lo registró. Cancelar
 * no es deshacer, es dejar de esperar.
 */
export async function cancelPurchaseOrder(
  tx: DbOrTx,
  input: { orderId: string; reason: string; actorId?: string | null },
): Promise<{ ok: boolean; reason?: string }> {
  const [order] = await tx
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.orderId))
    .for("update")
    .limit(1);

  if (!order) return { ok: false, reason: "La orden no existe." };
  if (order.status === "cancelled") {
    return { ok: false, reason: "La orden ya está cancelada." };
  }
  if (order.status === "received") {
    return { ok: false, reason: "Una orden ya recibida no se cancela." };
  }

  const [pending] = (await tx
    .select({
      n: sql<number>`coalesce(sum(${purchaseOrderLines.quantity} - ${purchaseOrderLines.receivedQuantity}), 0)::int`,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, order.id))) as Array<{ n: number }>;

  await tx
    .update(purchaseOrders)
    .set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(purchaseOrders.id, order.id));

  await recordEvent(tx, {
    aggregateType: "purchase_order",
    aggregateId: order.id,
    eventType: "purchase_order.cancelled",
    actorId: input.actorId ?? null,
    // Cuántas piezas se dejaron de esperar: es el dato que hace falta para
    // entender después por qué el inventario nunca subió.
    payload: {
      reference: order.reference,
      note: input.reason,
      pendingCancelled: pending?.n ?? 0,
      previousStatus: order.status,
    },
  });

  return { ok: true };
}

/* ------------------------- Lecturas ------------------------- */

/**
 * Lo que está pedido y todavía no llega, por refacción.
 *
 * Es la pieza que le faltaba a la alerta de existencias: hasta ahora avisaba
 * «faltan 3» sin saber que ya iban 10 en camino, y el resultado natural era
 * volver a comprar. El pendiente convierte la alerta en una decisión.
 */
export async function incomingByPart(
  db: DbOrTx,
): Promise<Map<string, { quantity: number; expectedAt: string | null }>> {
  const rows = (await db
    .select({
      partId: purchaseOrderLines.partId,
      quantity: sql<number>`sum(${purchaseOrderLines.quantity} - ${purchaseOrderLines.receivedQuantity})::int`,
      // La fecha más próxima entre las órdenes que lo traen: la que de verdad
      // le interesa a quien está viendo si le alcanza.
      expectedAt: sql<string | null>`min(${purchaseOrders.expectedAt})`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(
      and(
        sql`${purchaseOrders.status} in ('sent', 'partial')`,
        sql`${purchaseOrderLines.quantity} > ${purchaseOrderLines.receivedQuantity}`,
      ),
    )
    .groupBy(purchaseOrderLines.partId)) as Array<{
    partId: string;
    quantity: number;
    expectedAt: string | null;
  }>;

  return new Map(
    rows.map((r) => [r.partId, { quantity: r.quantity, expectedAt: r.expectedAt }]),
  );
}

/** Nombre legible del estado, para no repetir el switch en cada pantalla. */
export const PURCHASE_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  partial: "Parcial",
  received: "Recibida",
  cancelled: "Cancelada",
};

/** Refacción tal como la necesita el selector de renglones. */
export async function partsForPicker(db: DbOrTx) {
  return db
    .select({
      id: spareParts.id,
      partNumber: spareParts.partNumber,
      description: spareParts.description,
      stock: spareParts.stock,
      costMxn: spareParts.costMxn,
      costUsd: spareParts.costUsd,
    })
    .from(spareParts)
    .orderBy(spareParts.partNumber);
}

/* ======================= Suspensión de compras ======================= */

/**
 * ¿Se le puede comprar a este proveedor?
 *
 * Un solo lugar donde se contesta, y lo llaman tanto el alta de una orden como
 * su envío. Comprobarlo solo al crear dejaría abierto el camino evidente:
 * dejar la orden en borrador, esperar a que suspendan al proveedor y enviarla
 * igual — y `sent` es justo el punto en que el proveedor recibe su copia y la
 * orden deja de ser reversible.
 */
export async function assertSupplierPurchasable(
  tx: DbOrTx,
  supplierId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [s] = await tx
    .select({
      name: suppliers.name,
      active: suppliers.active,
      suspendedAt: suppliers.suspendedAt,
      suspendReason: suppliers.suspendReason,
    })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);

  if (!s) return { ok: false, reason: "El proveedor no existe." };
  if (!s.active) {
    return { ok: false, reason: `${s.name} está dado de baja.` };
  }
  if (s.suspendedAt) {
    return {
      ok: false,
      reason:
        `${s.name} tiene las compras suspendidas` +
        (s.suspendReason ? `: ${s.suspendReason}` : ".") +
        " Levanta la suspensión antes de comprarle.",
    };
  }
  return { ok: true };
}

/**
 * Suspende las compras a un proveedor.
 *
 * NO toca `active` ni bloquea pagos. Son cosas distintas: dar de baja es «ya no
 * trabajamos con él»; suspender es «no le compres mientras», y lo que ya se le
 * debe se le sigue debiendo. Dejar de pagarle por estar suspendido convierte
 * una medida de compras en un incumplimiento nuestro.
 */
export async function suspendSupplier(
  tx: DbOrTx,
  input: { supplierId: string; reason: string; actorId?: string | null },
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const motivo = input.reason.trim();
  if (motivo.length < 4) {
    return {
      ok: false,
      reason: "Escribe el motivo: sin causa nadie sabe qué tiene que pasar para levantarla.",
    };
  }

  const [s] = await tx
    .select({
      name: suppliers.name,
      suspendedAt: suppliers.suspendedAt,
    })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!s) return { ok: false, reason: "El proveedor no existe." };
  if (s.suspendedAt) return { ok: false, reason: `${s.name} ya está suspendido.` };

  await tx
    .update(suppliers)
    .set({
      suspendedAt: new Date(),
      suspendReason: motivo,
      suspendedById: input.actorId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, input.supplierId));

  // Las órdenes en borrador NO se cancelan: pueden reanudarse si la suspensión
  // se levanta, y cancelarlas por si acaso destruye trabajo que quizá sirva.
  // Lo que no podrán es enviarse mientras dure.
  await recordEvent(tx, {
    aggregateType: "supplier",
    aggregateId: input.supplierId,
    eventType: "supplier.suspended",
    actorId: input.actorId ?? null,
    payload: { nombre: s.name, motivo },
  });

  return { ok: true, name: s.name };
}

/** Levanta la suspensión. También deja rastro: importa cuándo y quién. */
export async function reinstateSupplier(
  tx: DbOrTx,
  input: { supplierId: string; note?: string | null; actorId?: string | null },
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const [s] = await tx
    .select({
      name: suppliers.name,
      suspendedAt: suppliers.suspendedAt,
      suspendReason: suppliers.suspendReason,
    })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!s) return { ok: false, reason: "El proveedor no existe." };
  if (!s.suspendedAt) return { ok: false, reason: `${s.name} no está suspendido.` };

  await tx
    .update(suppliers)
    .set({
      suspendedAt: null,
      suspendReason: null,
      suspendedById: null,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, input.supplierId));

  await recordEvent(tx, {
    aggregateType: "supplier",
    aggregateId: input.supplierId,
    eventType: "supplier.reinstated",
    actorId: input.actorId ?? null,
    payload: {
      nombre: s.name,
      // El motivo original se copia al evento antes de borrarlo del proveedor:
      // es la única forma de reconstruir después por qué estuvo suspendido.
      motivoOriginal: s.suspendReason,
      nota: input.note?.trim() || null,
    },
  });

  return { ok: true, name: s.name };
}
