import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  contracts,
  contractEquipment,
  tickets,
  ticketComments,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";

export async function getContracts(salesRepId?: string) {
  const db = getDb();
  return db.query.contracts.findMany({
    where: salesRepId ? eq(contracts.salesRepId, salesRepId) : undefined,
    orderBy: [desc(contracts.createdAt)],
    with: {
      client: { columns: { id: true, name: true, email: true, company: true } },
      salesRep: { columns: { id: true, name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/** Detalle completo: equipos amparados con sus módulos y submódulos. */
export async function getContractById(id: string) {
  const db = getDb();
  return db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: {
      client: {
        columns: {
          id: true,
          name: true,
          email: true,
          company: true,
          phone: true,
        },
      },
      salesRep: { columns: { id: true, name: true, email: true } },
      // Negocio del CRM que originó el contrato (trazabilidad comercial).
      deal: { columns: { id: true, reference: true, title: true } },
      equipmentLinks: {
        with: {
          equipment: {
            with: { modules: { with: { submodules: true } } },
          },
        },
      },
    },
  });
}

/** Horas y refacciones de cada ticket, para calcular utilidad consolidada. */
export async function getProfitInputsForTickets(ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  const db = getDb();
  const rows = await db.query.ticketComments.findMany({
    where: inArray(ticketComments.ticketId, ticketIds),
    columns: { id: true, ticketId: true, hours: true },
    with: {
      parts: {
        columns: { quantity: true, unitCostMxn: true, unitPriceMxn: true },
      },
    },
  });

  // Agrupa por ticket.
  const byTicket = new Map<
    string,
    {
      hours: number;
      parts: {
        quantity: number;
        unitCostMxn: string | null;
        unitPriceMxn: string | null;
      }[];
    }
  >();
  for (const r of rows) {
    const cur = byTicket.get(r.ticketId) ?? { hours: 0, parts: [] };
    cur.hours += Number(r.hours ?? 0);
    cur.parts.push(...r.parts);
    byTicket.set(r.ticketId, cur);
  }
  return Array.from(byTicket.entries()).map(([ticketId, v]) => ({
    ticketId,
    ...v,
  }));
}

/** Tickets de los equipos amparados por el contrato. */
export async function getTicketsForEquipmentIds(equipmentIds: string[]) {
  if (equipmentIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      equipmentId: tickets.equipmentId,
    })
    .from(tickets)
    .where(inArray(tickets.equipmentId, equipmentIds))
    .orderBy(desc(tickets.createdAt));
}

/** Contratos de un laboratorio (para su ficha). */
export async function getContractsForClient(clientId: string) {
  const db = getDb();
  return db.query.contracts.findMany({
    where: eq(contracts.clientId, clientId),
    orderBy: [desc(contracts.createdAt)],
    with: {
      salesRep: { columns: { name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/** Vendedores activos (y admins, que también pueden figurar como responsables). */
export async function getSalesReps() {
  const db = getDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ["sales", "admin"])))
    .orderBy(users.name);
}

export { contractEquipment };
