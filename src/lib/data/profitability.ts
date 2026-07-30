import "server-only";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tickets } from "@/lib/db/schema";

/**
 * Tickets con sus horas y refacciones, para calcular rentabilidad.
 * El cálculo (ingreso/costo/utilidad) vive en lib/profit.ts.
 */
export async function getTicketsWithCostData() {
  const db = getDb();
  return db.query.tickets.findMany({
    columns: {
      id: true,
      reference: true,
      subject: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
    orderBy: [desc(tickets.createdAt)],
    with: {
      createdBy: {
        columns: { id: true, name: true, email: true, company: true },
      },
      assignedTo: { columns: { name: true, email: true } },
      comments: {
        columns: { hours: true },
        with: {
          parts: {
            columns: {
              quantity: true,
              unitCostMxn: true,
              unitPriceMxn: true,
            },
          },
        },
      },
    },
  });
}
