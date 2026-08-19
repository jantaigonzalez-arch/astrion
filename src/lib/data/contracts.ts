import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { DbOrTx } from "@/lib/db";
import {
  contracts,
  contractEquipment,
  tickets,
  ticketComments,
} from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";

/**
 * Contratos, opcionalmente de un vendedor y opcionalmente una página.
 *
 * `page` es OPCIONAL y no obligatorio a propósito: esta función la usan tres
 * sitios con necesidades distintas. El listado quiere una página; el panel
 * quiere los del vendedor para contarlos; y «contratos por vencer», en la capa
 * de análisis, necesita mirarlos TODOS —un contrato que vence en 40 días puede
 * estar en cualquier página, y paginarlo ahí convertiría el aviso en una
 * lotería—. Obligar a paginar habría roto justo al que no puede paginar.
 */
export async function getContracts(
  salesRepId?: string,
  conexion?: DbOrTx,
  page?: { limit: number; offset: number },
) {
  const db = conexion ?? (await tenantDb());
  return db.query.contracts.findMany({
    where: salesRepId ? eq(contracts.salesRepId, salesRepId) : undefined,
    orderBy: [desc(contracts.createdAt)],
    ...(page ? { limit: page.limit, offset: page.offset } : {}),
    with: {
      client: { columns: { id: true, name: true, email: true, company: true } },
      salesRep: { columns: { id: true, name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/**
 * Cuántos contratos hay, para el paginador.
 *
 * Consulta aparte y no una ventana dentro de la anterior: aquella usa el API
 * relacional —trae equipos y sus enlaces— y ahí no cabe un `count(*) over ()`.
 * Se lanzan en paralelo, así que cuesta latencia cero; lo que se acepta es que
 * entre las dos alguien firme un contrato y el recuento quede corto por uno
 * durante un instante. En un paginador eso es tolerable; en un total de dinero
 * no lo sería.
 */
export async function countContracts(
  salesRepId?: string,
  conexion?: DbOrTx,
): Promise<number> {
  const db = conexion ?? (await tenantDb());
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contracts)
    .where(salesRepId ? eq(contracts.salesRepId, salesRepId) : undefined);
  return row?.n ?? 0;
}

/** Detalle completo: equipos amparados con sus módulos y submódulos. */
export async function getContractById(id: string) {
  const db = await tenantDb();
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
  const db = await tenantDb();
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
  const db = await tenantDb();
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
  const db = await tenantDb();
  return db.query.contracts.findMany({
    where: eq(contracts.clientId, clientId),
    orderBy: [desc(contracts.createdAt)],
    with: {
      salesRep: { columns: { name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/** Vendedores activos (y admins/dueño, que también pueden figurar como responsables). */
export async function getSalesReps() {
  return listTenantMembers({ roles: ["sales", "admin", "owner"] });
}

export { contractEquipment };
