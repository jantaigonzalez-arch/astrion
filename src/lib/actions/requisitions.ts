"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminRole, isSupport } from "@/lib/roles";
import { currentRole, tenantDb } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { requisitionLines, requisitions } from "@/lib/db/schema";
import {
  approveRequisition,
  cancelRequisition,
  convertToPurchaseOrders,
  createRequisitionFromDeal,
  rejectRequisition,
  submitRequisition,
} from "@/lib/domain/requisitions";

/**
 * Acciones de requisiciones.
 *
 * El reparto de permisos ES el módulo. Soporte y ventas PIDEN —son quienes
 * saben qué hace falta— y solo administración AUTORIZA. Si el mismo rol pudiera
 * hacer las dos cosas, la requisición sería un paso de más antes de la orden en
 * vez de un control, y la primera persona que se diera cuenta dejaría de usarla.
 *
 * Convertir también es de administración: es el acto que compromete dinero con
 * un tercero.
 */

export type RequisitionState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** Recién creada, para que la pantalla pueda navegar a ella. */
  requisitionId?: string;
  /** Renglones que la conversión no pudo llevarse, con su causa. */
  omitidas?: Array<{ description: string; reason: string }>;
};

const uuid = z.string().uuid();

async function quien() {
  const session = await auth();
  const role = await currentRole();
  return { userId: session?.user?.id ?? null, role };
}

/* ------------------------- Alta desde el pedido ------------------------- */

export async function createRequisitionFromDealAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  if (!isSupport(role)) {
    return { ok: false, error: "No tienes permiso para levantar requisiciones." };
  }

  const dealId = uuid.safeParse(formData.get("dealId"));
  if (!dealId.success) return { ok: false, error: "Pedido inválido." };

  const neededBy = (formData.get("neededBy") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      createRequisitionFromDeal(tx, {
        dealId: dealId.data,
        actorId: userId,
        neededBy,
        notes,
      }),
    );

    if (!res.ok) return { ok: false, error: res.reason };

    revalidateTenant();
    return {
      ok: true,
      requisitionId: res.id,
      message: `Requisición ${res.reference} creada con ${res.lineas} ${
        res.lineas === 1 ? "renglón" : "renglones"
      }. Revísala y mándala a autorizar.`,
    };
  } catch (e) {
    console.error("[requisiciones] createFromDeal:", e);
    return { ok: false, error: "No se pudo crear la requisición." };
  }
}

/* ------------------------- Edición del borrador ------------------------- */

/**
 * Resuelve un renglón: le pone refacción y/o proveedor.
 *
 * Es lo que el comprador hace con las líneas que el vendedor dejó en palabras.
 * Solo en borrador: después de mandarla a autorizar, cambiar lo que se pide
 * dejaría al que autoriza firmando otra cosa.
 */
export async function resolveRequisitionLine(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { role } = await quien();
  if (!isSupport(role)) return { ok: false, error: "Sin permiso." };

  const lineId = uuid.safeParse(formData.get("lineId"));
  if (!lineId.success) return { ok: false, error: "Renglón inválido." };

  const partId = uuid.safeParse(formData.get("partId"));
  const supplierId = uuid.safeParse(formData.get("supplierId"));
  const cantidad = Number(formData.get("quantity"));

  try {
    const db = await tenantDb();
    const res = await db.transaction(async (tx) => {
      const [linea] = await tx
        .select({
          id: requisitionLines.id,
          requisitionId: requisitionLines.requisitionId,
          ordered: requisitionLines.orderedQuantity,
        })
        .from(requisitionLines)
        .where(eq(requisitionLines.id, lineId.data))
        .limit(1);
      if (!linea) return { error: "El renglón no existe." } as const;

      const [req] = await tx
        .select({ status: requisitions.status })
        .from(requisitions)
        .where(eq(requisitions.id, linea.requisitionId))
        .limit(1);
      if (!req) return { error: "La requisición no existe." } as const;
      if (req.status !== "draft") {
        return {
          error: "Solo se edita el borrador. Ya se mandó a autorizar.",
        } as const;
      }

      await tx
        .update(requisitionLines)
        .set({
          partId: partId.success ? partId.data : null,
          supplierId: supplierId.success ? supplierId.data : null,
          // El motivo de la sugerencia deja de valer en cuanto alguien elige a
          // mano: mantenerlo diría «última compra: X» junto a un proveedor Y.
          supplierReason: supplierId.success ? "Elegido a mano" : null,
          ...(Number.isInteger(cantidad) && cantidad > linea.ordered
            ? { quantity: cantidad }
            : {}),
        })
        .where(eq(requisitionLines.id, lineId.data));

      return { id: linea.requisitionId } as const;
    });

    if ("error" in res) return { ok: false, error: res.error };
    revalidateTenant();
    return { ok: true, message: "Renglón actualizado." };
  } catch (e) {
    console.error("[requisiciones] resolveLine:", e);
    return { ok: false, error: "No se pudo actualizar el renglón." };
  }
}

/** Quita un renglón del borrador. */
export async function removeRequisitionLine(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { role } = await quien();
  if (!isSupport(role)) return { ok: false, error: "Sin permiso." };

  const lineId = uuid.safeParse(formData.get("lineId"));
  if (!lineId.success) return { ok: false, error: "Renglón inválido." };

  try {
    const db = await tenantDb();
    const res = await db.transaction(async (tx) => {
      const [linea] = await tx
        .select({
          requisitionId: requisitionLines.requisitionId,
          ordered: requisitionLines.orderedQuantity,
        })
        .from(requisitionLines)
        .where(eq(requisitionLines.id, lineId.data))
        .limit(1);
      if (!linea) return { error: "El renglón no existe." } as const;
      if (linea.ordered > 0) {
        return {
          error: "Ese renglón ya se convirtió en orden. Cancela la orden, no el renglón.",
        } as const;
      }

      const [req] = await tx
        .select({ status: requisitions.status })
        .from(requisitions)
        .where(eq(requisitions.id, linea.requisitionId))
        .limit(1);
      if (req?.status !== "draft") {
        return { error: "Solo se edita el borrador." } as const;
      }

      await tx.delete(requisitionLines).where(eq(requisitionLines.id, lineId.data));
      return { ok: true } as const;
    });

    if ("error" in res) return { ok: false, error: res.error };
    revalidateTenant();
    return { ok: true, message: "Renglón eliminado." };
  } catch (e) {
    console.error("[requisiciones] removeLine:", e);
    return { ok: false, error: "No se pudo eliminar el renglón." };
  }
}

/* ------------------------- Circuito ------------------------- */

export async function submitRequisitionAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  if (!isSupport(role)) return { ok: false, error: "Sin permiso." };

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requisición inválida." };

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      submitRequisition(tx, { id: id.data, actorId: userId }),
    );
    if (!res.ok) return { ok: false, error: res.reason };
    revalidateTenant();
    return { ok: true, message: "Enviada a autorizar." };
  } catch (e) {
    console.error("[requisiciones] submit:", e);
    return { ok: false, error: "No se pudo enviar." };
  }
}

export async function approveRequisitionAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  // Autorizar es administración y solo administración: es el único punto donde
  // alguien distinto al que pide asume el gasto.
  if (!isAdminRole(role)) {
    return { ok: false, error: "Solo administración autoriza requisiciones." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requisición inválida." };

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      approveRequisition(tx, { id: id.data, actorId: userId }),
    );
    if (!res.ok) return { ok: false, error: res.reason };
    revalidateTenant();
    return { ok: true, message: "Autorizada. Ya se puede convertir en órdenes." };
  } catch (e) {
    console.error("[requisiciones] approve:", e);
    return { ok: false, error: "No se pudo autorizar." };
  }
}

export async function rejectRequisitionAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  if (!isAdminRole(role)) {
    return { ok: false, error: "Solo administración resuelve requisiciones." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requisición inválida." };

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      rejectRequisition(tx, {
        id: id.data,
        actorId: userId,
        reason: String(formData.get("reason") ?? ""),
      }),
    );
    if (!res.ok) return { ok: false, error: res.reason };
    revalidateTenant();
    return { ok: true, message: "Rechazada." };
  } catch (e) {
    console.error("[requisiciones] reject:", e);
    return { ok: false, error: "No se pudo rechazar." };
  }
}

export async function cancelRequisitionAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  if (!isAdminRole(role)) {
    return { ok: false, error: "Solo administración cancela requisiciones." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requisición inválida." };

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      cancelRequisition(tx, {
        id: id.data,
        actorId: userId,
        reason: String(formData.get("reason") ?? ""),
      }),
    );
    if (!res.ok) return { ok: false, error: res.reason };
    revalidateTenant();
    return { ok: true, message: "Cancelada." };
  } catch (e) {
    console.error("[requisiciones] cancel:", e);
    return { ok: false, error: "No se pudo cancelar." };
  }
}

/* ------------------------- Conversión ------------------------- */

export async function convertRequisitionAction(
  _prev: RequisitionState,
  formData: FormData,
): Promise<RequisitionState> {
  const { userId, role } = await quien();
  if (!isAdminRole(role)) {
    return { ok: false, error: "Solo administración genera órdenes de compra." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Requisición inválida." };

  const lineIds = formData
    .getAll("lineId")
    .map(String)
    .filter((s) => uuid.safeParse(s).success);

  try {
    const db = await tenantDb();
    const res = await db.transaction((tx) =>
      convertToPurchaseOrders(tx, { id: id.data, actorId: userId, lineIds }),
    );
    if (!res.ok) return { ok: false, error: res.reason };

    revalidateTenant();

    const omitidas = res.omitidas.map((o) => ({
      description: o.description,
      reason: o.reason,
    }));

    if (res.orders.length === 0) {
      return {
        ok: false,
        error: "No se generó ninguna orden: ningún renglón estaba listo.",
        omitidas,
      };
    }

    const folios = res.orders.map((o) => o.reference).join(", ");
    return {
      ok: true,
      message: `${res.orders.length === 1 ? "Orden" : "Órdenes"} ${folios} ${
        res.orders.length === 1 ? "creada" : "creadas"
      } en borrador. Revísalas y mándalas al proveedor.`,
      omitidas,
    };
  } catch (e) {
    console.error("[requisiciones] convert:", e);
    return { ok: false, error: "No se pudieron generar las órdenes." };
  }
}
