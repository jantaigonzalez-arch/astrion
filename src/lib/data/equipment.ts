import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { equipment, equipmentModules, tickets } from "@/lib/db/schema";
import { getTenantMember, listTenantMembers } from "@/lib/data/people";

// Null si el id es de alguien de OTRA empresa: el uuid viaja en la URL, así que
// sin esta comprobación la ficha de un cliente ajeno estaba a un cambio de
// dirección de distancia.
export async function getOwner(ownerId: string) {
  return getTenantMember(ownerId);
}

// Historial de tickets de un equipo (para la ficha del equipo).
export async function getTicketsByEquipment(equipmentId: string) {
  const db = await tenantDb();
  return db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.equipmentId, equipmentId))
    .orderBy(desc(tickets.createdAt));
}

/**
 * Laboratorios (clientes) con su inventario, para que el staff levante un
 * servicio a nombre de uno de ellos.
 *
 * Dos consultas fijas, no una por laboratorio.
 *
 * Antes esto era un `Promise.all` sobre `getEquipmentTree(c.id)`: una consulta
 * de inventario **por cada cliente**. Medido en `/admin/tickets/new`, 23 de las
 * 27 consultas de la pantalla eran la misma, cambiando solo el uuid del dueño.
 * El `Promise.all` disimulaba el síntoma —salían en paralelo, así que la
 * latencia parecía constante— pero el trabajo del servidor y las conexiones
 * ocupadas crecían con el padrón: con 200 laboratorios son 200 consultas para
 * llenar dos desplegables.
 *
 * Ahora se piden todos los equipos de esos dueños de una vez y se agrupan
 * aquí. Lo que crece con el padrón es el tamaño del resultado, que es lo que
 * de verdad hay que enseñar, y no el número de viajes a la base.
 */
export async function getClientsWithEquipment() {
  const clients = await listTenantMembers({
    roles: ["client"],
    orderBy: "company",
  });
  if (clients.length === 0) return [];

  const trees = await getEquipmentTreesFor(clients.map((c) => c.id));

  return clients.map((c) => ({ ...c, equipment: trees.get(c.id) ?? [] }));
}

/** El inventario de varios dueños de una sola vez, indexado por dueño. */
export async function getEquipmentTreesFor(ownerIds: readonly string[]) {
  const ids = [...new Set(ownerIds)];
  const grouped = new Map<string, EquipmentTree>();
  if (ids.length === 0) return grouped;

  const db = await tenantDb();
  const rows = await db.query.equipment.findMany({
    where: inArray(equipment.ownerId, ids),
    orderBy: [asc(equipment.createdAt)],
    with: {
      modules: {
        orderBy: [asc(equipmentModules.createdAt)],
        with: { submodules: true },
      },
    },
  });

  // El orden por `createdAt` de la consulta se conserva dentro de cada grupo:
  // recorrer en orden y empujar al final mantiene lo que pidió el `orderBy`.
  for (const row of rows) {
    const bucket = grouped.get(row.ownerId);
    if (bucket) bucket.push(row);
    else grouped.set(row.ownerId, [row]);
  }
  return grouped;
}

type EquipmentTree = Awaited<ReturnType<typeof getEquipmentTree>>;

export async function getEquipmentTree(ownerId: string) {
  const db = await tenantDb();
  return db.query.equipment.findMany({
    where: eq(equipment.ownerId, ownerId),
    orderBy: [asc(equipment.createdAt)],
    with: {
      modules: {
        orderBy: [asc(equipmentModules.createdAt)],
        with: { submodules: true },
      },
    },
  });
}
