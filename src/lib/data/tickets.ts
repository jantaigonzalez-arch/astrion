import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets, ticketComments, leads } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import type { Role } from "@/lib/auth";

export async function getTicketsForUser(userId: string) {
  const db = getDb();
  return db.query.tickets.findMany({
    where: eq(tickets.createdById, userId),
    orderBy: [desc(tickets.createdAt)],
    with: { assignedTo: { columns: { name: true, email: true } } },
  });
}

export async function getAllTickets(status?: string) {
  const db = getDb();
  return db.query.tickets.findMany({
    where: status ? eq(tickets.status, status as never) : undefined,
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { name: true, email: true } },
    },
  });
}

export async function getTicketById(id: string) {
  const db = getDb();
  return db.query.tickets.findFirst({
    where: eq(tickets.id, id),
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
      assignedTo: { columns: { id: true, name: true, email: true } },
      equipment: true,
      module: true,
      comments: {
        orderBy: [ticketComments.createdAt],
        with: {
          author: { columns: { name: true, email: true, role: true } },
          // Componente al que se refiere cada actividad de la bitácora.
          equipment: true,
          module: true,
          submodule: true,
          parts: true,
        },
      },
    },
  });
}

export async function getDashboardStats(role: Role, userId: string) {
  const db = getDb();
  const scope =
    role === "client" ? eq(tickets.createdById, userId) : undefined;

  const rows = await db
    .select({ status: tickets.status, count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(scope)
    .groupBy(tickets.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return {
    total,
    open: byStatus["open"] ?? 0,
    inProgress: byStatus["in_progress"] ?? 0,
    resolved: byStatus["resolved"] ?? 0,
    closed: byStatus["closed"] ?? 0,
  };
}

export async function getLeads() {
  const db = getDb();
  return db.select().from(leads).orderBy(desc(leads.createdAt));
}

export async function getUsers() {
  const db = getDb();
  return db.select().from(users).orderBy(desc(users.createdAt));
}

// Personal que puede atender tickets: agentes y administradores activos.
export async function getAgents() {
  const db = getDb();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.active, true),
        inArray(users.role, ["agent", "admin"]),
      ),
    )
    .orderBy(users.name);
}

// Tickets asignados a un agente concreto.
export async function getTicketsAssignedTo(agentId: string) {
  const db = getDb();
  return db.query.tickets.findMany({
    where: eq(tickets.assignedToId, agentId),
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: { columns: { name: true, email: true, company: true } },
    },
  });
}
