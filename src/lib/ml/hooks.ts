import "server-only";
import { sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { issuePrediction, settleOutcome } from "./serve";

/**
 * Los dos momentos en los que el ciclo de ML toca la operación.
 *
 * Vive aquí y no dentro de `actions/tickets.ts` para que el flujo del ticket se
 * pueda leer sin saber nada de modelos: allá se ve una línea que dice "avisa al
 * laboratorio", y el laboratorio decide si tiene algo que decir.
 *
 * Todo lo de este módulo se invoca DESPUÉS de que la transacción del ticket
 * confirmó, nunca dentro. Es deliberado: una predicción es información
 * derivada, y no puede tener el poder de abortar el hecho del que deriva. Si
 * esto falla, el ticket ya existe y el peor caso es que a esa fila le falte su
 * predicción — visible en el laboratorio, sin consecuencias en la operación.
 */

/**
 * El ticket entró a la cola de atención.
 *
 * Es el momento correcto para predecir sus horas: los rasgos ya están fijados y
 * todavía no trabajó nadie, que es lo que hace útil el número. Predecir al
 * cerrar sería contar lo que ya se sabe.
 */
export async function onTicketOpened(ticketId: string): Promise<void> {
  try {
    await issuePrediction("service_hours", ticketId);

    const ctx = await ticketContext(ticketId);
    if (!ctx?.equipmentId) return;

    // ORDEN CRÍTICO. Primero se cierra el intervalo que este ticket acaba de
    // terminar, y solo después se abre el siguiente. Al revés, la predicción
    // recién emitida sería la que encontraría `settleOutcome` como abierta y se
    // cerraría contra el intervalo anterior: el modelo quedaría medido contra
    // un pasado que no predijo.
    if (ctx.prevAt) {
      const days = (ctx.createdAt.getTime() - ctx.prevAt.getTime()) / 86_400_000;
      // Se registra el intervalo real aunque caiga fuera del rango que el
      // dataset aprende (1 a 1000 días). El histórico filtra para no entrenar
      // con basura; la medición NO filtra, porque un equipo que reaparece a los
      // tres años es precisamente el caso en que el modelo falló, y esconderlo
      // haría que la deriva se viera mejor de lo que es.
      await settleOutcome("equipment", ctx.equipmentId, days);
    }

    await issuePrediction("maintenance_interval", ctx.equipmentId);
  } catch (e) {
    console.error(`[ml] enganche de apertura falló en ${ticketId}:`, e);
  }
}

/**
 * El servicio terminó: ya se sabe cuántas horas llevó.
 *
 * Solo registra el desenlace si hay horas en la bitácora. Un ticket cerrado sin
 * horas no es un servicio de cero horas, es un servicio del que no se registró
 * nada — la misma regla con la que el histórico lo excluye del entrenamiento.
 * Medir contra un cero inventado castigaría al modelo por acertar.
 */
export async function onTicketSettled(ticketId: string): Promise<void> {
  try {
    const db = await tenantDb();
    const rows = (await db.execute(sql`
      select coalesce(sum(c.hours), 0)::float8 as hours
        from ticket_comments c
       where c.ticket_id = ${ticketId} and c.hours is not null
    `)) as unknown as Array<Record<string, unknown>>;

    const hours = Number(rows[0]?.hours ?? 0);
    if (!(hours > 0)) return;

    await settleOutcome("ticket", ticketId, hours);
  } catch (e) {
    console.error(`[ml] enganche de cierre falló en ${ticketId}:`, e);
  }
}

/* ------------------------- Apoyo ------------------------- */

type TicketContext = {
  equipmentId: string | null;
  createdAt: Date;
  /** Cuándo se abrió el servicio ANTERIOR de ese mismo equipo. */
  prevAt: Date | null;
};

async function ticketContext(ticketId: string): Promise<TicketContext | null> {
  const db = await tenantDb();
  const rows = (await db.execute(sql`
    select t.equipment_id::text as equipment_id,
           t.created_at as created_at,
           (select p.created_at
              from tickets p
             where p.equipment_id = t.equipment_id
               and p.created_at < t.created_at
             order by p.created_at desc
             limit 1) as prev_at
      from tickets t
     where t.id = ${ticketId}
     limit 1
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0];
  if (!r) return null;

  return {
    equipmentId: r.equipment_id ? String(r.equipment_id) : null,
    createdAt: new Date(String(r.created_at)),
    prevAt: r.prev_at ? new Date(String(r.prev_at)) : null,
  };
}
