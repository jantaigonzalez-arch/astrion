import "server-only";
import { domainEvents } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/**
 * Bitácora de dominio: la única copia del pasado que tiene el sistema.
 *
 * Las tablas de negocio guardan estado mutable, así que cada UPDATE borra lo
 * que había antes. Esta bitácora es lo que permite (a) auditar quién cambió
 * qué y cuándo, requisito de cualquier ERP, y (b) reconstruir el estado de un
 * agregado en una fecha dada, que es la única forma de armar features "as-of"
 * para entrenar un modelo sin fuga de información del futuro.
 *
 * Regla: se escribe SIEMPRE dentro de la misma transacción que el cambio que
 * describe. Un evento sin su cambio (o al revés) es peor que no tener nada.
 */

/** Agregados que emiten eventos. Se amplía a medida que crecen los módulos. */
export type AggregateType =
  | "deal"
  | "ticket"
  | "ticket_comment"
  | "spare_part"
  | "lead"
  | "contract"
  | "organization"
  | "contact"
  | "activity"
  | "note"
  | "stage"
  | "deal_product"
  | "equipment"
  | "equipment_module"
  | "equipment_submodule"
  | "goal"
  | "label"
  | "email_template"
  | "automation"
  | "supplier"
  | "requisition"
  | "purchase_order"
  | "supplier_invoice"
  | "supplier_credit_note"
  | "supplier_advance"
  | "payable_import";

/**
 * Tipos de evento en uso. Convención: `agregado.verbo_en_pasado`.
 * Es un union y no un string libre para que un typo no cree silenciosamente
 * un tipo de evento nuevo que ningún consumidor analítico esté leyendo.
 */
export type DomainEventType =
  | "deal.created"
  | "deal.created_from_lead"
  | "ticket.created"
  | "ticket.comment_added"
  | "part.consumed"
  | "part.stock_overdrawn"
  | "part.received"
  // Requisiciones. El circuito completo deja rastro porque su valor es
  // justamente ese: quién pidió, quién autorizó y en qué órdenes acabó.
  | "requisition.created"
  | "requisition.submitted"
  | "requisition.approved"
  | "requisition.rejected"
  | "requisition.cancelled"
  | "requisition.ordered"
  // Compras. `sent` es el evento que congela la orden: a partir de ahí el
  // proveedor tiene una copia y las líneas dejan de ser editables.
  | "purchase_order.created"
  | "purchase_order.sent"
  | "purchase_order.received"
  | "purchase_order.cancelled"
  // Cuentas por pagar. La factura crea la deuda; cada pago la reduce.
  | "supplier_invoice.registered"
  | "supplier_invoice.paid"
  | "supplier_invoice.settled"
  | "supplier_invoice.cancelled"
  // Notas de crédito. Bajan la deuda sin que salga dinero, así que su rastro
  // va separado del de los pagos: el reporte de salidas de caja no debe verlas.
  | "supplier_credit_note.registered"
  | "supplier_credit_note.applied"
  | "supplier_credit_note.cancelled"
  // Anticipos. El dinero sale el día del anticipo; la aplicación solo lo
  // imputa a una factura, no vuelve a mover caja.
  | "supplier_advance.paid"
  | "supplier_advance.applied"
  | "supplier_advance.cancelled"
  // Parcialidades: partir una factura en varios vencimientos.
  | "supplier_invoice.split"
  // Suspensión de compras. Es temporal y con causa, a diferencia de la baja
  // del proveedor, así que deja rastro de las dos puntas.
  | "supplier.suspended"
  | "supplier.reinstated"
  // Importación masiva de cargos y abonos. El lote deja un evento con el
  // recuento; cada documento creado deja el suyo con la fila cruda.
  | "payable_import.committed"
  | "lead.qualified"
  // Migración del sistema anterior. Cada registro importado deja su evento con
  // la fila cruda en el payload: es la única forma de responder después "de
  // dónde salió este dato y qué decía el archivo original".
  | "ticket.imported"
  | "contract.imported"
  | "equipment.imported"
  | "organization.imported"
  // Bajas. Los borrados del sistema son DUROS y en cascada, así que el evento
  // con su snapshot es la única copia que queda del registro eliminado.
  | "deal.deleted"
  | "organization.deleted"
  | "contact.deleted"
  | "contract.deleted"
  | "activity.deleted"
  | "note.deleted"
  | "stage.deleted"
  | "deal_product.deleted"
  | "deal_label.removed"
  | "equipment.deleted"
  | "equipment_module.deleted"
  | "equipment_submodule.deleted"
  | "goal.deleted"
  | "label.deleted"
  | "email_template.deleted"
  | "automation.deleted"
  | "supplier.deleted";

export type EventInput = {
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: DomainEventType;
  /** Datos del cambio. Lo que hoy es payload puede promoverse a columna después. */
  payload?: Record<string, unknown>;
  actorId?: string | null;
  companyId?: string | null;
};

/** Registra un evento. `tx` debe ser la transacción del cambio que lo origina. */
export async function recordEvent(tx: DbOrTx, event: EventInput) {
  await tx.insert(domainEvents).values({
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: event.payload ?? {},
    actorId: event.actorId ?? null,
    companyId: event.companyId ?? null,
  });
}

/**
 * Registra una baja guardando el registro completo en el payload.
 *
 * Los borrados de la app son duros y en cascada: una vez ejecutados, este
 * evento es la única copia que queda de lo que había. Se llama DESPUÉS del
 * delete y con el resultado de su `.returning()`, dentro de la misma
 * transacción, para no pagar un SELECT extra y garantizar que el snapshot es
 * exactamente lo que se borró.
 */
export async function recordDeletion(
  tx: DbOrTx,
  args: {
    aggregateType: AggregateType;
    aggregateId: string;
    eventType: DomainEventType;
    /** La fila devuelta por `.returning()` del delete. */
    snapshot: Record<string, unknown>;
    actorId?: string | null;
    /** Contexto útil para reconstruir qué se llevó la cascada. */
    extra?: Record<string, unknown>;
  },
) {
  await recordEvent(tx, {
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    actorId: args.actorId,
    payload: { snapshot: args.snapshot, ...args.extra },
  });
}

/** Varios eventos en un solo INSERT (mismo criterio: dentro de la transacción). */
export async function recordEvents(tx: DbOrTx, events: EventInput[]) {
  if (!events.length) return;
  await tx.insert(domainEvents).values(
    events.map((e) => ({
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload ?? {},
      actorId: e.actorId ?? null,
      companyId: e.companyId ?? null,
    })),
  );
}
