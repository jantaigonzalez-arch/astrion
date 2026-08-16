import "server-only";
import { eq } from "drizzle-orm";
import { inventoryMovements, spareParts } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/**
 * Existencias como ledger.
 *
 * Antes el stock se mutaba en sitio con `greatest(0, stock - qty)`, lo que
 * causaba dos pérdidas de información: no quedaba registro del movimiento
 * (imposible reconstruir el inventario de la semana pasada, ni entrenar nada
 * sobre consumo de refacciones), y el sobregiro se silenciaba — si pedías 5
 * y había 2, el stock quedaba en 0 y el faltante de 3 desaparecía.
 *
 * Ahora: cada cambio inserta un movimiento firmado y `spare_parts.stock` se
 * recalcula como caché. El stock PUEDE quedar negativo: refleja el consumo
 * real y el faltante queda visible para compras (ver `getStockAlerts`).
 */

export type MovementKind =
  | "opening"
  | "consumption"
  | "purchase"
  | "return"
  | "adjustment";

export type MovementInput = {
  partId: string;
  kind: MovementKind;
  /** Firmado: negativo = salida, positivo = entrada. */
  quantity: number;
  ticketCommentId?: string | null;
  /** Origen de la entrada, cuando el movimiento es la recepción de una compra. */
  purchaseOrderLineId?: string | null;
  unitCostMxn?: string | null;
  unitCostUsd?: string | null;
  note?: string | null;
  actorId?: string | null;
  companyId?: string | null;
};

export type MovementResult = {
  partId: string;
  partNumber: string;
  quantity: number;
  balanceAfter: number;
  /** El saldo quedó bajo cero: hay faltante físico que reponer. */
  overdrawn: boolean;
  /** Cuántas piezas faltaron respecto de lo disponible antes del movimiento. */
  shortfall: number;
};

/**
 * Aplica un movimiento y devuelve el saldo resultante.
 *
 * Debe llamarse dentro de una transacción: toma un lock de la fila de la
 * refacción (`for update`) para que dos consumos simultáneos no lean el mismo
 * saldo y escriban balances contradictorios.
 */
export async function applyInventoryMovement(
  tx: DbOrTx,
  input: MovementInput,
): Promise<MovementResult> {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new Error(
      `Movimiento de inventario inválido: quantity debe ser un entero distinto de 0 (recibido ${input.quantity})`,
    );
  }

  // `for update` serializa los movimientos de esta refacción: sin el lock, dos
  // transacciones concurrentes calcularían el mismo balanceAfter.
  const [part] = await tx
    .select({
      id: spareParts.id,
      partNumber: spareParts.partNumber,
      stock: spareParts.stock,
      companyId: spareParts.companyId,
    })
    .from(spareParts)
    .where(eq(spareParts.id, input.partId))
    .for("update")
    .limit(1);

  if (!part) {
    throw new Error(`Refacción inexistente: ${input.partId}`);
  }

  const balanceAfter = part.stock + input.quantity;
  const shortfall = balanceAfter < 0 ? Math.abs(balanceAfter) : 0;

  await tx.insert(inventoryMovements).values({
    partId: part.id,
    companyId: input.companyId ?? part.companyId ?? null,
    kind: input.kind,
    quantity: input.quantity,
    balanceAfter,
    ticketCommentId: input.ticketCommentId ?? null,
    purchaseOrderLineId: input.purchaseOrderLineId ?? null,
    unitCostMxn: input.unitCostMxn ?? null,
    unitCostUsd: input.unitCostUsd ?? null,
    note: input.note ?? null,
    actorId: input.actorId ?? null,
  });

  // Único lugar del código que escribe spare_parts.stock.
  await tx
    .update(spareParts)
    .set({ stock: balanceAfter, updatedAt: new Date() })
    .where(eq(spareParts.id, part.id));

  return {
    partId: part.id,
    partNumber: part.partNumber,
    quantity: input.quantity,
    balanceAfter,
    overdrawn: balanceAfter < 0,
    shortfall,
  };
}

/** Consumo de refacciones en la bitácora de un ticket. Azúcar sobre lo anterior. */
export async function consumePart(
  tx: DbOrTx,
  input: Omit<MovementInput, "kind" | "quantity"> & { quantity: number },
): Promise<MovementResult> {
  if (input.quantity <= 0) {
    throw new Error("El consumo debe ser una cantidad positiva");
  }
  return applyInventoryMovement(tx, {
    ...input,
    kind: "consumption",
    quantity: -input.quantity,
  });
}
