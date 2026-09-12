"use server";

import { z } from "zod";
import { importeOpcional } from "@/lib/importe";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { normalizarTelefono } from "@/lib/telefono";
import { revalidateTenant } from "@/lib/revalidate";
import { purchaseOrderLines, purchaseOrders, spareParts, suppliers } from "@/lib/db/schema";
import { nextPurchaseOrderReference } from "@/lib/domain/references";
import { recordEvent, recordDeletion } from "@/lib/domain/events";
import { assertSupplierPurchasable, cancelPurchaseOrder, receivePurchaseOrder, reinstateSupplier, sendPurchaseOrder, suspendSupplier } from "@/lib/domain/purchasing";

/**
 * Acciones de compras.
 *
 * Reparto de permisos: soporte (agente o admin) puede levantar y recibir
 * órdenes porque es quien sabe qué refacción hace falta y quién abre la caja
 * cuando llega. Cancelar y borrar proveedores queda en administrador: son las
 * dos operaciones que dejan huella hacia atrás.
 */

export type PurchaseState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** Folio recién creado, para que la pantalla pueda navegar a la orden. */
  orderId?: string;
};

// Monto opcional: vacío o un número de cero en adelante. Ver `lib/importe.ts`.
const money = importeOpcional;

/* ------------------------- Proveedores ------------------------- */

const SupplierSchema = z.object({
  name: z.string().min(2).max(200),
  // El RFC mexicano son 12 posiciones para persona moral y 13 para física. No
  // se valida la estructura completa a propósito: hay proveedores extranjeros
  // sin RFC y rechazar la alta por eso bloquearía una compra real.
  rfc: z.string().max(13).optional(),
  contactName: z.string().max(160).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  address: z.string().max(1000).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(0),
  currency: z.enum(["MXN", "USD", "EUR"]).default("MXN"),
  notes: z.string().max(2000).optional(),
});

export async function createSupplier(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  if (!(await puedeEn("compras", "editar"))) {
    return { ok: false, error: "No tienes permiso para dar de alta proveedores." };
  }

  const parsed = SupplierSchema.safeParse({
    name: formData.get("name"),
    rfc: (formData.get("rfc") as string) || undefined,
    contactName: (formData.get("contactName") as string) || undefined,
    email: (formData.get("email") as string) || undefined,
    phone: (formData.get("phone") as string) || undefined,
    address: (formData.get("address") as string) || undefined,
    paymentTermsDays: (formData.get("paymentTermsDays") as string) || 0,
    currency: (formData.get("currency") as string) || "MXN",
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Revisa los datos del proveedor." };
  }

  const d = parsed.data;
  try {
    const db = await tenantDb();
    await db
      .insert(suppliers)
      .values({
        name: d.name.trim(),
        rfc: d.rfc?.trim().toUpperCase() || null,
        contactName: d.contactName?.trim() || null,
        email: d.email?.trim().toLowerCase() || null,
        phone: normalizarTelefono(d.phone),
        address: d.address?.trim() || null,
        paymentTermsDays: d.paymentTermsDays,
        currency: d.currency,
        notes: d.notes?.trim() || null,
      });

    revalidateTenant();
    return { ok: true, message: `Proveedor «${d.name.trim()}» dado de alta.` };
  } catch (e) {
    console.error("[compras] createSupplier:", e);
    return { ok: false, error: "No se pudo guardar el proveedor." };
  }
}

/**
 * Corrección de los datos de un proveedor, incluida su alta y baja.
 *
 * `active` viaja en el mismo formulario y no en un botón aparte porque es la
 * única salida del callejón que dejaba `deleteSupplier`: a un proveedor con
 * historial no se le borra, se le desactiva, y el constructor de órdenes solo
 * lista activos. Sin esta acción, desactivar por error significaba no volver a
 * comprarle nunca — y los días de crédito o un RFC mal capturado se quedaban
 * mal para siempre, que es de lo que después salen las cuentas por pagar.
 */
export async function updateSupplier(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  if (!(await puedeEn("compras", "editar"))) {
    return { ok: false, error: "No tienes permiso para editar proveedores." };
  }

  const id = String(formData.get("supplierId") ?? "");
  if (!id) return { ok: false, error: "Falta el proveedor." };

  const parsed = SupplierSchema.safeParse({
    name: formData.get("name"),
    rfc: (formData.get("rfc") as string) || undefined,
    contactName: (formData.get("contactName") as string) || undefined,
    email: (formData.get("email") as string) || undefined,
    phone: (formData.get("phone") as string) || undefined,
    address: (formData.get("address") as string) || undefined,
    paymentTermsDays: (formData.get("paymentTermsDays") as string) || 0,
    currency: (formData.get("currency") as string) || "MXN",
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Revisa los datos del proveedor." };
  }

  const d = parsed.data;
  const active = formData.get("active") === "on";

  try {
    const db = await tenantDb();
    const [row] = await db
      .update(suppliers)
      .set({
        name: d.name.trim(),
        rfc: d.rfc?.trim().toUpperCase() || null,
        contactName: d.contactName?.trim() || null,
        email: d.email?.trim().toLowerCase() || null,
        phone: normalizarTelefono(d.phone),
        address: d.address?.trim() || null,
        paymentTermsDays: d.paymentTermsDays,
        // La moneda es del proveedor, no de sus órdenes: las ya emitidas
        // conservan la suya, que quedó guardada en cada una.
        currency: d.currency,
        notes: d.notes?.trim() || null,
        active,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning({ id: suppliers.id, active: suppliers.active });

    if (!row) return { ok: false, error: "El proveedor no existe." };

    revalidateTenant();
    return {
      ok: true,
      message: active
        ? `Proveedor «${d.name.trim()}» actualizado.`
        : `«${d.name.trim()}» quedó inactivo: no va a aparecer al levantar una orden.`,
    };
  } catch (e) {
    console.error("[compras] updateSupplier:", e);
    return { ok: false, error: "No se pudo guardar el proveedor." };
  }
}

/**
 * Baja de proveedor.
 *
 * Si ya tiene órdenes NO se borra, se desactiva: la FK es `restrict` justamente
 * para que el historial de compra no se pueda evaporar por un clic. Se elimina
 * de verdad solo cuando nunca se le compró nada, que es el caso del alta mal
 * capturada.
 */
export async function deleteSupplier(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!(await puedeEn("compras", "administrar"))) {
    return { ok: false, error: "Solo un administrador da de baja proveedores." };
  }

  const id = String(formData.get("supplierId") ?? "");
  if (!id) return { ok: false, error: "Falta el proveedor." };

  try {
    const db = await tenantDb();
    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.supplierId, id))
        .limit(1);

      if (order) {
        await tx
          .update(suppliers)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(suppliers.id, id));
        return "deactivated" as const;
      }

      const [gone] = await tx
        .delete(suppliers)
        .where(eq(suppliers.id, id))
        .returning();
      if (!gone) return "missing" as const;

      await recordDeletion(tx, {
        aggregateType: "supplier",
        aggregateId: id,
        eventType: "supplier.deleted",
        snapshot: gone as unknown as Record<string, unknown>,
        actorId: session!.user.id,
      });
      return "deleted" as const;
    });

    revalidateTenant();
    if (result === "missing") return { ok: false, error: "El proveedor no existe." };
    return {
      ok: true,
      message:
        result === "deleted"
          ? "Proveedor eliminado."
          : "El proveedor tiene compras registradas, así que se desactivó en " +
            "lugar de borrarse. Su historial se conserva.",
    };
  } catch (e) {
    console.error("[compras] deleteSupplier:", e);
    return { ok: false, error: "No se pudo dar de baja el proveedor." };
  }
}

/* ------------------------- Órdenes ------------------------- */

const OrderSchema = z.object({
  supplierId: z.string().uuid(),
  currency: z.enum(["MXN", "USD", "EUR"]).default("MXN"),
  expectedAt: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Levanta una orden en borrador con sus renglones.
 *
 * Los renglones llegan como arreglos paralelos del formulario (`line-part`,
 * `line-qty`, `line-cost`), que es como el navegador manda una tabla dinámica.
 * Se recorren por índice y se descarta cualquiera sin refacción o sin cantidad:
 * el formulario siempre trae un renglón vacío al final para poder agregar.
 */
export async function createPurchaseOrder(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!(await puedeEn("compras", "editar"))) {
    return { ok: false, error: "No tienes permiso para crear órdenes de compra." };
  }

  const parsed = OrderSchema.safeParse({
    supplierId: formData.get("supplierId"),
    currency: (formData.get("currency") as string) || "MXN",
    expectedAt: (formData.get("expectedAt") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Elige un proveedor válido." };
  }

  const partIds = formData.getAll("line-part").map(String);
  const qtys = formData.getAll("line-qty").map(String);
  const costs = formData.getAll("line-cost").map(String);

  const draft: Array<{ partId: string; quantity: number; cost?: string }> = [];
  for (let i = 0; i < partIds.length; i++) {
    const partId = partIds[i]?.trim();
    const quantity = Number(qtys[i]);
    if (!partId) continue;
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    /*
      Vacío hereda el costo del catálogo (más abajo); un negativo o algo que no
      es número se RECHAZA. Antes, el fallo de validación también se tomaba
      por vacío: se tecleaba «-50» o «12o» y la orden salía con el costo del
      catálogo y un «Orden creada». Lo encontró
      `scripts/_probe-acciones-compras.ts`.
    */
    const cost = money.safeParse(costs[i] ?? "");
    if (!cost.success) {
      return { ok: false, error: "Un renglón trae un costo que no es un importe." };
    }
    draft.push({ partId, quantity, cost: cost.data });
  }

  if (draft.length === 0) {
    return {
      ok: false,
      error: "Agrega al menos un renglón con refacción y cantidad.",
    };
  }
  // El id viaja en el formulario: si no tiene forma de uuid no se le pregunta
  // a la base, que respondería con un error de tipo y no con este mensaje.
  if (draft.some((l) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l.partId))) {
    return { ok: false, error: "Un renglón apunta a una refacción inexistente." };
  }

  const d = parsed.data;
  try {
    const db = await tenantDb();
    const created = await db.transaction(async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, d.supplierId))
        .limit(1);
      if (!supplier) return { error: "El proveedor no existe." } as const;

      // Suspendido o dado de baja: ni siquiera se abre el borrador. El envío lo
      // vuelve a comprobar, porque entre una cosa y otra pueden pasar días.
      const permitido = await assertSupplierPurchasable(tx, supplier.id);
      if (!permitido.ok) return { error: permitido.reason } as const;

      // Se leen las refacciones de una sola vez y se copian número y
      // descripción al renglón: la orden debe seguir diciendo lo mismo dentro
      // de un año aunque el catálogo se corrija mañana. Solo las de ESTA
      // orden: leía el catálogo entero —6 609 filas— para validar tres.
      const parts = await tx
        .select({
          id: spareParts.id,
          partNumber: spareParts.partNumber,
          description: spareParts.description,
          costMxn: spareParts.costMxn,
          costUsd: spareParts.costUsd,
        })
        .from(spareParts)
        .where(inArray(spareParts.id, [...new Set(draft.map((l) => l.partId))]));
      const byId = new Map(parts.map((p) => [p.id, p]));

      if (draft.some((l) => !byId.has(l.partId))) {
        return { error: "Un renglón apunta a una refacción inexistente." } as const;
      }

      const reference = await nextPurchaseOrderReference(tx);
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          reference,
          supplierId: supplier.id,
          currency: d.currency,
          expectedAt: d.expectedAt || null,
          notes: d.notes?.trim() || null,
          createdById: session!.user.id,
        })
        .returning({ id: purchaseOrders.id });

      const usd = d.currency === "USD";
      await tx.insert(purchaseOrderLines).values(
        draft.map((l) => {
          const part = byId.get(l.partId)!;
          // Si no se capturó costo, se hereda el del catálogo en la moneda de
          // la orden. Es una estimación de arranque, no un compromiso: cuando
          // llegue la factura se corrige en la recepción.
          const fallback = usd ? part.costUsd : part.costMxn;
          const value = l.cost ?? fallback ?? null;
          return {
            orderId: order.id,
            partId: part.id,
            partNumber: part.partNumber,
            description: part.description,
            quantity: l.quantity,
            unitCostMxn: usd ? null : value,
            unitCostUsd: usd ? value : null,
          };
        }),
      );

      await recordEvent(tx, {
        aggregateType: "purchase_order",
        aggregateId: order.id,
        eventType: "purchase_order.created",
        actorId: session!.user.id,
        payload: {
          reference,
          supplier: supplier.name,
          currency: d.currency,
          lines: draft.length,
          units: draft.reduce((a, l) => a + l.quantity, 0),
        },
      });

      return { id: order.id, reference } as const;
    });

    if ("error" in created) return { ok: false, error: created.error };

    revalidateTenant();
    return {
      ok: true,
      orderId: created.id,
      message: `Orden ${created.reference} creada en borrador. Revísala y márcala como enviada.`,
    };
  } catch (e) {
    console.error("[compras] createPurchaseOrder:", e);
    return { ok: false, error: "No se pudo crear la orden." };
  }
}

export async function sendOrder(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!(await puedeEn("compras", "editar"))) {
    return { ok: false, error: "No tienes permiso." };
  }

  try {
    const db = await tenantDb();
    const r = await db.transaction((tx) =>
      sendPurchaseOrder(tx, {
        orderId: String(formData.get("orderId") ?? ""),
        actorId: session!.user.id,
      }),
    );
    revalidateTenant();
    return r.ok
      ? {
          ok: true,
          message:
            "Orden enviada. A partir de ahora los renglones ya no se pueden " +
            "cambiar y la mercancía se puede recibir.",
        }
      : { ok: false, error: r.reason };
  } catch (e) {
    console.error("[compras] sendOrder:", e);
    return { ok: false, error: "No se pudo enviar la orden." };
  }
}

/**
 * Registra la llegada de mercancía.
 *
 * Es la única acción del módulo que mueve el inventario, y por eso corre entera
 * dentro de una transacción: si un renglón falla, ninguna pieza entra.
 */
export async function receiveOrder(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!(await puedeEn("compras", "editar"))) {
    return { ok: false, error: "No tienes permiso para recibir mercancía." };
  }

  const lineIds = formData.getAll("receive-line").map(String);
  const qtys = formData.getAll("receive-qty").map(String);
  const lines = lineIds
    .map((lineId, i) => ({ lineId, quantity: Number(qtys[i]) }))
    .filter((l) => l.lineId && Number.isFinite(l.quantity) && l.quantity > 0);

  try {
    const db = await tenantDb();
    const r = await db.transaction((tx) =>
      receivePurchaseOrder(tx, {
        orderId: String(formData.get("orderId") ?? ""),
        lines,
        note: (formData.get("note") as string)?.trim() || null,
        actorId: session!.user.id,
      }),
    );

    revalidateTenant();
    if (!r.ok) return { ok: false, error: r.reason };

    return {
      ok: true,
      message:
        r.status === "received"
          ? `${r.received} piezas entraron al inventario. La orden queda completa.`
          : `${r.received} piezas entraron al inventario. La orden sigue con pendientes.`,
    };
  } catch (e) {
    console.error("[compras] receiveOrder:", e);
    return { ok: false, error: "No se pudo registrar la recepción." };
  }
}

export async function cancelOrder(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!(await puedeEn("compras", "administrar"))) {
    return { ok: false, error: "Solo un administrador cancela órdenes." };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    // Mismo criterio que al retirar un modelo: dentro de un año, «por qué se
    // canceló» es la única pregunta que va a importar.
    return { ok: false, error: "Escribe el motivo. Queda en el historial." };
  }

  try {
    const db = await tenantDb();
    const r = await db.transaction((tx) =>
      cancelPurchaseOrder(tx, {
        orderId: String(formData.get("orderId") ?? ""),
        reason,
        actorId: session!.user.id,
      }),
    );
    revalidateTenant();
    return r.ok
      ? {
          ok: true,
          message:
            "Orden cancelada. Lo que ya se había recibido se queda en el " +
            "inventario: la mercancía está en la bodega.",
        }
      : { ok: false, error: r.reason };
  } catch (e) {
    console.error("[compras] cancelOrder:", e);
    return { ok: false, error: "No se pudo cancelar la orden." };
  }
}

/* ======================= Suspensión de compras ======================= */

/**
 * Suspender es de administración, no de soporte.
 *
 * Un agente levanta órdenes porque sabe qué refacción hace falta; cortar la
 * relación con un proveedor —aunque sea temporalmente— afecta a toda la
 * operación y a menudo tiene detrás una disputa comercial o fiscal.
 */
export async function suspendSupplierAction(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("compras", "administrar"))) {
    return { ok: false, error: "Solo un administrador suspende proveedores." };
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!supplierId) return { ok: false, error: "Falta el proveedor." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      suspendSupplier(tx, { supplierId, reason, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message: `${result.name}: compras suspendidas. Lo que ya se le debe se le sigue pagando.`,
    };
  } catch (e) {
    console.error("[compras] suspendSupplier:", e);
    return { ok: false, error: "No se pudo suspender al proveedor." };
  }
}

export async function reinstateSupplierAction(
  _prev: PurchaseState,
  formData: FormData,
): Promise<PurchaseState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("compras", "administrar"))) {
    return { ok: false, error: "Solo un administrador levanta la suspensión." };
  }

  const supplierId = String(formData.get("supplierId") ?? "");
  const note = String(formData.get("note") ?? "") || undefined;
  if (!supplierId) return { ok: false, error: "Falta el proveedor." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      reinstateSupplier(tx, { supplierId, note, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return { ok: true, message: `${result.name}: ya se le puede comprar.` };
  } catch (e) {
    console.error("[compras] reinstateSupplier:", e);
    return { ok: false, error: "No se pudo levantar la suspensión." };
  }
}
