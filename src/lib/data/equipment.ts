import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { equipment, equipmentModules, tickets } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";

export async function getOwner(ownerId: string) {
  const db = getDb();
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      company: users.company,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  return u ?? null;
}

// Historial de tickets de un equipo (para la ficha del equipo).
export async function getTicketsByEquipment(equipmentId: string) {
  const db = getDb();
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

// Laboratorios (clientes) con su inventario, para que el staff levante
// un servicio a nombre de uno de ellos.
export async function getClientsWithEquipment() {
  const db = getDb();
  const clients = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      company: users.company,
    })
    .from(users)
    .where(eq(users.role, "client"))
    .orderBy(asc(users.company));

  return Promise.all(
    clients.map(async (c) => ({
      ...c,
      equipment: await getEquipmentTree(c.id),
    })),
  );
}

export async function getEquipmentTree(ownerId: string) {
  const db = getDb();
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
