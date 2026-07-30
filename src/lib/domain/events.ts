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
  | "contact";

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
  | "lead.qualified";

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
