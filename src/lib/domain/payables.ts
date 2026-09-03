import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  purchaseOrders,
  suppliers,
  supplierInvoiceOrders,
  supplierInvoices,
  supplierPayments,
  supplierCreditNotes,
  supplierCreditNoteApplications,
  supplierInvoiceInstallments,
  supplierAdvances,
  supplierAdvanceApplications,
  type PaymentMethod,
  type SupplierInvoiceStatus,
  type SupplierCreditNoteStatus,
  type SupplierAdvanceStatus,
} from "@/lib/db/schema";
import { recordDeletion, recordEvent } from "@/lib/domain/events";
import {
  nextSupplierInvoiceReference,
  nextSupplierCreditNoteReference,
  nextSupplierAdvanceReference,
} from "@/lib/domain/references";

/**
 * Cuentas por pagar.
 *
 * La deuda nace con la FACTURA del proveedor, no con la orden ni con la
 * recepción. La orden dice qué se pidió; la factura dice cuánto se debe, desde
 * cuándo y hasta cuándo — y es además el documento fiscal contra el que se
 * concilia. Ver el comentario de `supplierInvoices` en el esquema.
 *
 * El saldo NO se guarda en una columna. Se construye con los pagos, igual que
 * las existencias se construyen con los movimientos de inventario: cada pago
 * deja el saldo resultante en su propia fila. Un campo `saldo` mutable se
 * desincroniza del historial en el primer error, y a partir de ahí no hay forma
 * de saber cuál de los dos miente.
 *
 * Todas estas funciones reciben `tx` y deben correr dentro de una transacción:
 * escriben en varias tablas y emiten evento, y un fallo a la mitad dejaría la
 * factura sin su pago o el pago sin su evento.
 */

/** Tolerancia al cuadrar subtotal + impuestos contra el total. */
const CENTAVO = 0.01;

const dinero = (v: string | number | null | undefined) => Number(v ?? 0);
const aDosDecimales = (n: number) => n.toFixed(2);

export type RegisterInvoiceInput = {
  supplierId: string;
  /** Folio impreso en la factura del proveedor. */
  supplierFolio?: string | null;
  /** UUID del CFDI. Único en toda la empresa: ver la nota de duplicados abajo. */
  cfdiUuid?: string | null;
  currency?: string;
  fxRate?: string | null;
  fxDate?: string | null;
  subtotal: number;
  taxTotal?: number;
  total: number;
  /** `YYYY-MM-DD`. */
  issuedAt: string;
  /** Si se omite, sale de los días de crédito del proveedor. */
  dueAt?: string | null;
  /** Órdenes que ampara. Pueden ser varias, o ninguna (un flete, un servicio). */
  orderIds?: string[];
  notes?: string | null;
  actorId?: string | null;
  /** Prefijo de folio explícito, para lo que corre fuera de una petición. */
  folioPrefix?: string;
};

export type RegisterInvoiceResult =
  | { ok: true; invoiceId: string; reference: string; dueAt: string }
  | { ok: false; reason: string };

/**
 * Captura la factura de un proveedor y crea la deuda.
 *
 * Valida TODO antes de escribir: una factura a medias —capturada pero sin sus
 * órdenes, o con el vencimiento sin calcular— es peor que ninguna, porque
 * aparece en el listado de pagos como si estuviera completa.
 */
export async function registerSupplierInvoice(
  tx: DbOrTx,
  input: RegisterInvoiceInput,
): Promise<RegisterInvoiceResult> {
  const subtotal = dinero(input.subtotal);
  const taxTotal = dinero(input.taxTotal ?? 0);
  const total = dinero(input.total);

  if (total <= 0) {
    return { ok: false, reason: "El total de la factura debe ser mayor que cero." };
  }
  if (subtotal < 0 || taxTotal < 0) {
    return { ok: false, reason: "Ni el subtotal ni los impuestos pueden ser negativos." };
  }

  // El total no se recalcula, se COMPRUEBA. Recalcularlo silenciaría el error de
  // captura, y lo que se paga es lo que dice el papel: si no cuadra, el que
  // está mal puede ser cualquiera de los tres y eso lo tiene que ver una
  // persona, no resolverlo el sistema por su cuenta.
  if (Math.abs(subtotal + taxTotal - total) > CENTAVO) {
    return {
      ok: false,
      reason:
        `Subtotal ${aDosDecimales(subtotal)} más impuestos ${aDosDecimales(taxTotal)} ` +
        `da ${aDosDecimales(subtotal + taxTotal)}, y la factura dice ${aDosDecimales(total)}. ` +
        `Revisa la captura contra el documento.`,
    };
  }

  const [supplier] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      active: suppliers.active,
      paymentTermsDays: suppliers.paymentTermsDays,
      currency: suppliers.currency,
    })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);

  if (!supplier) return { ok: false, reason: "El proveedor no existe." };

  /**
   * Duplicado por CFDI.
   *
   * Es el control más importante de todo este archivo: capturar dos veces la
   * misma factura termina en pagarla dos veces, y ese dinero no vuelve solo.
   * Hay un índice único que lo garantiza aunque dos capturas entren a la vez;
   * esta consulta existe para poder decir CUÁL es la factura repetida en vez de
   * devolver una violación de índice que no le dice nada a quien captura.
   */
  const cfdi = input.cfdiUuid?.trim() || null;
  if (cfdi) {
    const [repetida] = await tx
      .select({ reference: supplierInvoices.reference })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.cfdiUuid, cfdi))
      .limit(1);
    if (repetida) {
      return {
        ok: false,
        reason: `Ese CFDI ya está capturado en la factura ${repetida.reference}.`,
      };
    }
  }

  // Vencimiento: se calcula una vez y se guarda. Si mañana cambian los días de
  // crédito del proveedor, esta factura conserva el plazo que se pactó.
  const dueAt = input.dueAt?.trim() || sumarDias(input.issuedAt, supplier.paymentTermsDays);
  if (!dueAt) {
    return { ok: false, reason: "La fecha de emisión no es válida." };
  }
  if (dueAt < input.issuedAt) {
    return { ok: false, reason: "El vencimiento no puede ser anterior a la emisión." };
  }

  // Las órdenes deben ser de ESTE proveedor. Amparar con una factura de A una
  // orden que se le compró a B deja el estado de cuenta de los dos mal, y es un
  // error de captura fácil de cometer con dos proveedores de nombre parecido.
  const orderIds = [...new Set(input.orderIds ?? [])];
  if (orderIds.length) {
    const rows = await tx
      .select({ id: purchaseOrders.id, reference: purchaseOrders.reference, supplierId: purchaseOrders.supplierId, status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.id, orderIds));

    if (rows.length !== orderIds.length) {
      return { ok: false, reason: "Alguna de las órdenes seleccionadas no existe." };
    }
    const ajena = rows.find((r) => r.supplierId !== input.supplierId);
    if (ajena) {
      return {
        ok: false,
        reason: `La orden ${ajena.reference} es de otro proveedor: no la puede amparar esta factura.`,
      };
    }
    const cancelada = rows.find((r) => r.status === "cancelled");
    if (cancelada) {
      return {
        ok: false,
        reason: `La orden ${cancelada.reference} está cancelada.`,
      };
    }
  }

  const reference = await nextSupplierInvoiceReference(tx, input.folioPrefix);

  const [invoice] = await tx
    .insert(supplierInvoices)
    .values({
      reference,
      supplierId: input.supplierId,
      supplierFolio: input.supplierFolio?.trim() || null,
      cfdiUuid: cfdi,
      currency: input.currency || supplier.currency || "MXN",
      fxRate: input.fxRate ?? null,
      fxDate: input.fxDate ?? null,
      subtotal: aDosDecimales(subtotal),
      taxTotal: aDosDecimales(taxTotal),
      total: aDosDecimales(total),
      issuedAt: input.issuedAt,
      dueAt,
      status: "pending",
      notes: input.notes?.trim() || null,
      createdById: input.actorId ?? null,
    })
    .returning({ id: supplierInvoices.id });

  if (orderIds.length) {
    await tx
      .insert(supplierInvoiceOrders)
      .values(orderIds.map((orderId) => ({ invoiceId: invoice.id, orderId })));
  }

  await recordEvent(tx, {
    aggregateType: "supplier_invoice",
    aggregateId: invoice.id,
    eventType: "supplier_invoice.registered",
    actorId: input.actorId ?? null,
    payload: {
      reference,
      proveedor: supplier.name,
      folioProveedor: input.supplierFolio ?? null,
      cfdi,
      total: aDosDecimales(total),
      moneda: input.currency || supplier.currency || "MXN",
      emision: input.issuedAt,
      vencimiento: dueAt,
      ordenes: orderIds,
    },
  });

  return { ok: true, invoiceId: invoice.id, reference, dueAt };
}

export type PayInput = {
  invoiceId: string;
  amount: number;
  method?: PaymentMethod;
  /** Folio de la transferencia, número de cheque… */
  reference?: string | null;
  /** `YYYY-MM-DD`. Cuándo salió el dinero, no cuándo se capturó. */
  paidAt: string;
  note?: string | null;
  actorId?: string | null;
};

export type PayResult =
  | { ok: true; balanceAfter: number; status: SupplierInvoiceStatus }
  | { ok: false; reason: string };

/**
 * Aplica un pago y devuelve el saldo resultante.
 *
 * Toma el lock de la factura (`for update`) antes de leer el saldo: sin él, dos
 * pagos simultáneos leen el mismo saldo pendiente y los dos se creen válidos —
 * así se paga de más una factura sin que nada falle.
 */
export async function paySupplierInvoice(
  tx: DbOrTx,
  input: PayInput,
): Promise<PayResult> {
  const amount = dinero(input.amount);
  if (amount <= 0) {
    return { ok: false, reason: "El pago debe ser mayor que cero." };
  }

  const bloqueada = (await tx.execute(sql`
    select id, reference, total::text as total, status
      from supplier_invoices
     where id = ${input.invoiceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
  }>;

  const invoice = bloqueada[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };
  if (invoice.status === "cancelled") {
    return { ok: false, reason: "Esa factura está cancelada: no admite pagos." };
  }
  if (invoice.status === "paid") {
    return { ok: false, reason: `La factura ${invoice.reference} ya está saldada.` };
  }

  // Aplicado, no pagado: si la factura ya trae una nota de crédito encima, el
  // saldo que admite pago es menor. Usar `totalPagado` aquí dejaría cobrar de
  // más justo por la vía que este bloque intenta cerrar.
  const aplicado = await totalAplicado(tx, input.invoiceId);
  const total = dinero(invoice.total);
  const saldo = total - aplicado;

  // No se paga de más. El excedente no es un pago: es una nota de crédito, un
  // anticipo o un error de captura, y cada uno se registra en otro lado. Dejar
  // que entre aquí lo vuelve invisible.
  if (amount - saldo > CENTAVO) {
    return {
      ok: false,
      reason:
        `A la factura ${invoice.reference} le quedan ${aDosDecimales(saldo)} por pagar ` +
        `y estás registrando ${aDosDecimales(amount)}. Si hay un saldo a favor, ` +
        `no entra como pago.`,
    };
  }

  const balanceAfter = Math.max(0, saldo - amount);
  // Con la tolerancia de un centavo, un pago que cierra la factura puede dejar
  // un residuo minúsculo. Se considera saldada.
  const status: SupplierInvoiceStatus = balanceAfter <= CENTAVO ? "paid" : "partial";

  await tx.insert(supplierPayments).values({
    invoiceId: input.invoiceId,
    amount: aDosDecimales(amount),
    balanceAfter: aDosDecimales(balanceAfter),
    method: input.method ?? "transfer",
    reference: input.reference?.trim() || null,
    paidAt: input.paidAt,
    note: input.note?.trim() || null,
    actorId: input.actorId ?? null,
  });

  await tx
    .update(supplierInvoices)
    .set({ status, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, input.invoiceId));

  await recordEvent(tx, {
    aggregateType: "supplier_invoice",
    aggregateId: input.invoiceId,
    eventType: status === "paid" ? "supplier_invoice.settled" : "supplier_invoice.paid",
    actorId: input.actorId ?? null,
    payload: {
      reference: invoice.reference,
      importe: aDosDecimales(amount),
      saldo: aDosDecimales(balanceAfter),
      metodo: input.method ?? "transfer",
      referencia: input.reference ?? null,
      fecha: input.paidAt,
    },
  });

  return { ok: true, balanceAfter, status };
}

/**
 * Anula una factura capturada por error.
 *
 * Solo mientras no tenga pagos. Con dinero ya salido, anular la factura dejaría
 * al pago apuntando a un documento que dice no existir, y el saldo del
 * proveedor sin explicación. Ese caso se resuelve con una nota de crédito, que
 * es otro documento y no la desaparición de este.
 */
export async function cancelSupplierInvoice(
  tx: DbOrTx,
  input: { invoiceId: string; reason: string; actorId?: string | null },
): Promise<{ ok: boolean; reason?: string }> {
  const [invoice] = await tx
    .select({
      id: supplierInvoices.id,
      reference: supplierInvoices.reference,
      status: supplierInvoices.status,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, input.invoiceId))
    .limit(1);

  if (!invoice) return { ok: false, reason: "La factura no existe." };
  if (invoice.status === "cancelled") {
    return { ok: false, reason: "Esa factura ya está cancelada." };
  }

  const pagado = await totalPagado(tx, input.invoiceId);
  if (pagado > 0) {
    return {
      ok: false,
      reason:
        `La factura ${invoice.reference} ya tiene ${aDosDecimales(pagado)} pagados. ` +
        `Una factura con pagos no se anula: se corrige con una nota de crédito.`,
    };
  }

  // Con notas o anticipos imputados tampoco: cancelarla dejaría al documento
  // consumido contra una factura que dice no existir, y su saldo a favor
  // perdido sin rastro.
  const imputado = (await tx.execute(sql`
    select
      coalesce((select sum(amount) from supplier_credit_note_applications
                 where invoice_id = ${input.invoiceId}::uuid), 0)::text as notas,
      coalesce((select sum(amount) from supplier_advance_applications
                 where invoice_id = ${input.invoiceId}::uuid), 0)::text as anticipos
  `)) as unknown as Array<{ notas: string; anticipos: string }>;

  const conNotas = dinero(imputado[0]?.notas);
  const conAnticipos = dinero(imputado[0]?.anticipos);
  if (conNotas > 0 || conAnticipos > 0) {
    const partes = [
      conNotas > 0 ? `${aDosDecimales(conNotas)} de notas de crédito` : null,
      conAnticipos > 0 ? `${aDosDecimales(conAnticipos)} de anticipos` : null,
    ].filter(Boolean);
    return {
      ok: false,
      reason:
        `La factura ${invoice.reference} tiene ${partes.join(" y ")} aplicados. ` +
        `Quítalos desde la factura —cada uno tiene su botón— y vuelve a intentarlo.`,
    };
  }

  await tx
    .update(supplierInvoices)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(supplierInvoices.id, input.invoiceId));

  await recordEvent(tx, {
    aggregateType: "supplier_invoice",
    aggregateId: input.invoiceId,
    eventType: "supplier_invoice.cancelled",
    actorId: input.actorId ?? null,
    payload: { reference: invoice.reference, motivo: input.reason },
  });

  return { ok: true };
}

/**
 * Lo PAGADO de una factura: dinero que salió, y nada más.
 *
 * No es el saldo. Una factura puede estar saldada sin haberse pagado entera si
 * lleva una nota de crédito encima, y el reporte de salidas de caja tiene que
 * seguir diciendo lo que de verdad se desembolsó. Para el saldo, `totalAplicado`.
 */
export async function totalPagado(tx: DbOrTx, invoiceId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(amount), 0)::text as pagado
      from supplier_payments
     where invoice_id = ${invoiceId}::uuid`)) as unknown as Array<{ pagado: string }>;
  return dinero(rows[0]?.pagado);
}

/**
 * Lo APLICADO a una factura: pagos, notas de crédito y anticipos imputados. La
 * verdad del saldo sale de aquí, y es el único lugar donde se calcula.
 *
 * Que sea uno solo es lo que hace que añadir la nota de crédito no obligue a
 * revisar el listado, el resumen ni la pantalla de detalle: todos preguntan por
 * el saldo a través de esta función o de la misma expresión SQL.
 */
export async function totalAplicado(
  tx: DbOrTx,
  invoiceId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    select (
      coalesce((select sum(amount) from supplier_payments
                 where invoice_id = ${invoiceId}::uuid), 0)
      +
      coalesce((select sum(amount) from supplier_credit_note_applications
                 where invoice_id = ${invoiceId}::uuid), 0)
      +
      coalesce((select sum(amount) from supplier_advance_applications
                 where invoice_id = ${invoiceId}::uuid), 0)
    )::text as aplicado`)) as unknown as Array<{ aplicado: string }>;
  return dinero(rows[0]?.aplicado);
}

/** Lo ya consumido de una nota de crédito. El resto es saldo a favor. */
export async function totalAplicadoDeNota(
  tx: DbOrTx,
  creditNoteId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(amount), 0)::text as usado
      from supplier_credit_note_applications
     where credit_note_id = ${creditNoteId}::uuid`)) as unknown as Array<{
    usado: string;
  }>;
  return dinero(rows[0]?.usado);
}

export type RegisterCreditNoteInput = {
  supplierId: string;
  supplierFolio?: string | null;
  cfdiUuid?: string | null;
  currency?: string;
  subtotal: number;
  taxTotal?: number;
  total: number;
  issuedAt: string;
  notes?: string | null;
  actorId?: string | null;
  folioPrefix?: string;
};

export type RegisterCreditNoteResult =
  | { ok: true; creditNoteId: string; reference: string }
  | { ok: false; reason: string };

/**
 * Registra una nota de crédito del proveedor.
 *
 * Nace sin aplicar: es saldo a favor hasta que alguien decide contra qué
 * factura va. Separar el alta de la aplicación no es burocracia — el proveedor
 * emite la nota antes de que se sepa a qué factura conviene aplicarla, y
 * forzar la decisión en el alta hace que se aplique a la primera que aparezca.
 */
export async function registerCreditNote(
  tx: DbOrTx,
  input: RegisterCreditNoteInput,
): Promise<RegisterCreditNoteResult> {
  const subtotal = dinero(input.subtotal);
  const taxTotal = dinero(input.taxTotal ?? 0);
  const total = dinero(input.total);

  if (total <= 0) {
    return { ok: false, reason: "El total de la nota de crédito debe ser mayor que cero." };
  }
  if (subtotal < 0 || taxTotal < 0) {
    return { ok: false, reason: "Ni el subtotal ni los impuestos pueden ser negativos." };
  }
  // Se comprueba, no se recalcula: mismo criterio que en la factura.
  if (Math.abs(subtotal + taxTotal - total) > CENTAVO) {
    return {
      ok: false,
      reason:
        `Subtotal ${aDosDecimales(subtotal)} más impuestos ${aDosDecimales(taxTotal)} ` +
        `da ${aDosDecimales(subtotal + taxTotal)}, y la nota dice ${aDosDecimales(total)}.`,
    };
  }

  const [supplier] = await tx
    .select({ id: suppliers.id, active: suppliers.active, currency: suppliers.currency })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!supplier) return { ok: false, reason: "El proveedor no existe." };

  // Duplicado por CFDI. Aplicar dos veces la misma nota deja de deberle al
  // proveedor dinero que sí se le debe, y eso aflora tarde y con reclamo.
  const cfdi = input.cfdiUuid?.trim() || null;
  if (cfdi) {
    const repetida = (await tx.execute(sql`
      select reference from supplier_credit_notes
       where cfdi_uuid = ${cfdi} limit 1`)) as unknown as Array<{ reference: string }>;
    if (repetida[0]) {
      return {
        ok: false,
        reason: `Ese CFDI ya está capturado en la nota ${repetida[0].reference}.`,
      };
    }
  }

  const reference = await nextSupplierCreditNoteReference(tx, input.folioPrefix);

  const [row] = await tx
    .insert(supplierCreditNotes)
    .values({
      reference,
      supplierId: input.supplierId,
      supplierFolio: input.supplierFolio?.trim() || null,
      cfdiUuid: cfdi,
      currency: input.currency ?? supplier.currency ?? "MXN",
      subtotal: aDosDecimales(subtotal),
      taxTotal: aDosDecimales(taxTotal),
      total: aDosDecimales(total),
      issuedAt: input.issuedAt,
      notes: input.notes?.trim() || null,
      createdById: input.actorId ?? null,
    })
    .returning({ id: supplierCreditNotes.id });

  await recordEvent(tx, {
    aggregateType: "supplier_credit_note",
    aggregateId: row.id,
    eventType: "supplier_credit_note.registered",
    actorId: input.actorId ?? null,
    payload: {
      reference,
      proveedor: input.supplierId,
      total: aDosDecimales(total),
      moneda: input.currency ?? supplier.currency ?? "MXN",
      emision: input.issuedAt,
      cfdi,
    },
  });

  return { ok: true, creditNoteId: row.id, reference };
}

export type ApplyCreditNoteInput = {
  creditNoteId: string;
  invoiceId: string;
  amount: number;
  appliedAt: string;
  note?: string | null;
  actorId?: string | null;
};

export type ApplyCreditNoteResult =
  | { ok: true; balanceAfter: number; status: SupplierInvoiceStatus; noteRemaining: number }
  | { ok: false; reason: string };

/**
 * Aplica parte (o todo) de una nota de crédito a una factura.
 *
 * Toma las dos filas con `for update` en orden fijo —primero la factura, luego
 * la nota— porque dos aplicaciones simultáneas de la misma nota podrían pasarse
 * del saldo a favor. El orden fijo evita el abrazo mortal entre dos procesos
 * que trabajen sobre el mismo par en sentido contrario.
 */
export async function applyCreditNote(
  tx: DbOrTx,
  input: ApplyCreditNoteInput,
): Promise<ApplyCreditNoteResult> {
  const amount = dinero(input.amount);
  if (amount <= 0) return { ok: false, reason: "El importe debe ser mayor que cero." };

  const facturas = (await tx.execute(sql`
    select id, reference, total::text as total, status, currency
      from supplier_invoices
     where id = ${input.invoiceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
    currency: string;
  }>;
  const invoice = facturas[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };
  if (invoice.status === "cancelled") {
    return { ok: false, reason: "Esa factura está cancelada: no admite notas de crédito." };
  }
  if (invoice.status === "paid") {
    return { ok: false, reason: `La factura ${invoice.reference} ya está saldada.` };
  }

  const notas = (await tx.execute(sql`
    select id, reference, total::text as total, status, currency, supplier_id
      from supplier_credit_notes
     where id = ${input.creditNoteId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: string;
    currency: string;
    supplier_id: string;
  }>;
  const note = notas[0];
  if (!note) return { ok: false, reason: "La nota de crédito no existe." };
  if (note.status === "cancelled") {
    return { ok: false, reason: `La nota ${note.reference} está cancelada.` };
  }

  // Mismo proveedor. Aplicar la nota de A a una factura de B descuadra el estado
  // de cuenta de los dos, y con nombres parecidos es un error fácil de cometer.
  const [inv] = await tx
    .select({ supplierId: supplierInvoices.supplierId })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, input.invoiceId))
    .limit(1);
  if (inv?.supplierId !== note.supplier_id) {
    return {
      ok: false,
      reason: "La nota de crédito y la factura son de proveedores distintos.",
    };
  }

  // Misma moneda. Aplicar una nota en dólares a una factura en pesos implica una
  // conversión con su pérdida o ganancia cambiaria, que es un asiento propio y
  // no se resuelve escondiéndolo aquí.
  if (note.currency !== invoice.currency) {
    return {
      ok: false,
      reason: `La nota está en ${note.currency} y la factura en ${invoice.currency}.`,
    };
  }

  const usado = await totalAplicadoDeNota(tx, input.creditNoteId);
  const disponible = dinero(note.total) - usado;
  if (amount - disponible > CENTAVO) {
    return {
      ok: false,
      reason:
        `A la nota ${note.reference} le quedan ${aDosDecimales(disponible)} disponibles ` +
        `y estás aplicando ${aDosDecimales(amount)}.`,
    };
  }

  const aplicado = await totalAplicado(tx, input.invoiceId);
  const saldo = dinero(invoice.total) - aplicado;
  if (amount - saldo > CENTAVO) {
    return {
      ok: false,
      reason:
        `A la factura ${invoice.reference} le quedan ${aDosDecimales(saldo)} por saldar ` +
        `y estás aplicando ${aDosDecimales(amount)}.`,
    };
  }

  const balanceAfter = Math.max(0, saldo - amount);
  const status: SupplierInvoiceStatus = balanceAfter <= CENTAVO ? "paid" : "partial";
  const noteRemaining = Math.max(0, disponible - amount);

  await tx.insert(supplierCreditNoteApplications).values({
    creditNoteId: input.creditNoteId,
    invoiceId: input.invoiceId,
    amount: aDosDecimales(amount),
    balanceAfter: aDosDecimales(balanceAfter),
    appliedAt: input.appliedAt,
    note: input.note?.trim() || null,
    actorId: input.actorId ?? null,
  });

  await tx
    .update(supplierInvoices)
    .set({ status, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, input.invoiceId));

  // La nota solo se cierra cuando se consume entera: mientras le quede saldo a
  // favor sigue sirviendo para la próxima factura.
  if (noteRemaining <= CENTAVO) {
    await tx
      .update(supplierCreditNotes)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(supplierCreditNotes.id, input.creditNoteId));
  }

  await recordEvent(tx, {
    aggregateType: "supplier_credit_note",
    aggregateId: input.creditNoteId,
    eventType: "supplier_credit_note.applied",
    actorId: input.actorId ?? null,
    payload: {
      nota: note.reference,
      factura: invoice.reference,
      importe: aDosDecimales(amount),
      saldoFactura: aDosDecimales(balanceAfter),
      saldoNota: aDosDecimales(noteRemaining),
      fecha: input.appliedAt,
    },
  });

  return { ok: true, balanceAfter, status, noteRemaining };
}

/**
 * Deshace UNA aplicación de nota de crédito.
 *
 * ── POR QUÉ TIENE QUE EXISTIR ─────────────────────────────────────────────
 *
 * Porque sin esto había tres caminos que terminaban en una instrucción
 * imposible. `cancelCreditNote`, `cancelAdvance` y `cancelSupplierInvoice`
 * responden «quita primero las aplicaciones» y no existía nada que las
 * quitara: ni una función, ni una acción, ni un botón. Una nota aplicada a la
 * factura equivocada bloqueaba para siempre la cancelación de la nota Y la de
 * la factura, y la única salida era editar la base a mano.
 *
 * Un error de imputación no es raro: dos facturas del mismo proveedor con
 * importes parecidos es exactamente el caso que la pantalla presenta junto.
 *
 * ── SE BORRA LA FILA, NO SE ESCRIBE UNA CONTRAPARTIDA ─────────────────────
 *
 * Un asiento en negativo habría sido la otra opción y aquí sale peor. `amount`
 * y `balance_after` de esta tabla se leen sumando —`totalAplicado`, el saldo de
 * la nota, media docena de consultas del listado y del estado de cuenta— y un
 * importe negativo obliga a que TODAS entiendan el signo. La que se olvide da
 * un saldo inventado, que es el error que ninguna de estas pantallas puede
 * cometer.
 *
 * El rastro no se pierde: `recordDeletion` deja el evento con la copia entera
 * de la fila, y `domain_events` es solo-anexado y viaja al lago. La pregunta
 * «¿quién quitó esta aplicación y qué decía?» se contesta ahí.
 *
 * ── LO QUE SE RECALCULA ───────────────────────────────────────────────────
 *
 * El estado de la factura y el de la nota, los dos desde los hechos y no
 * invirtiendo lo que hizo `applyCreditNote`. Una factura que estaba `paid`
 * vuelve a `partial` o a `pending` según lo que le quede aplicado, y una nota
 * que estaba `applied` vuelve a `open` en cuanto le sobra un centavo.
 *
 * No se toca una factura CANCELADA: quitarle una aplicación no la resucita, y
 * dejarla en `pending` la devolvería al listado de por pagar.
 */
export async function unapplyCreditNote(
  tx: DbOrTx,
  input: { applicationId: string; reason: string; actorId?: string | null },
): Promise<{ ok: true; invoiceId: string } | { ok: false; reason: string }> {
  const motivo = input.reason.trim();
  if (!motivo) {
    return { ok: false, reason: "Decí por qué se quita: es lo único que explica el movimiento después." };
  }

  // La aplicación primero, para saber qué factura bloquear. El orden de locks
  // que sigue —factura y luego nota— es el mismo de `applyCreditNote`, y por
  // eso dos operaciones simultáneas no se traban entre sí.
  const filas = (await tx.execute(sql`
    select id, credit_note_id, invoice_id, amount::text as amount,
           balance_after::text as balance_after, applied_at::text as applied_at,
           note, actor_id
      from supplier_credit_note_applications
     where id = ${input.applicationId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    credit_note_id: string;
    invoice_id: string;
    amount: string;
    balance_after: string;
    applied_at: string;
    note: string | null;
    actor_id: string | null;
  }>;
  const app = filas[0];
  if (!app) return { ok: false, reason: "Esa aplicación ya no existe." };

  const facturas = (await tx.execute(sql`
    select id, reference, total::text as total, status
      from supplier_invoices
     where id = ${app.invoice_id}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
  }>;
  const invoice = facturas[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };

  const notas = (await tx.execute(sql`
    select id, reference, total::text as total, status
      from supplier_credit_notes
     where id = ${app.credit_note_id}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: string;
  }>;
  const note = notas[0];
  if (!note) return { ok: false, reason: "La nota de crédito no existe." };

  await tx
    .delete(supplierCreditNoteApplications)
    .where(eq(supplierCreditNoteApplications.id, app.id));

  await recalcularFactura(tx, invoice.id, invoice.status, dinero(invoice.total));

  // La nota vuelve a tener saldo a favor. `cancelled` no se toca: una nota
  // anulada no se reabre porque se le quite una aplicación.
  if (note.status !== "cancelled") {
    const usado = await totalAplicadoDeNota(tx, note.id);
    const restante = dinero(note.total) - usado;
    await tx
      .update(supplierCreditNotes)
      .set({
        status: restante > CENTAVO ? "open" : "applied",
        updatedAt: new Date(),
      })
      .where(eq(supplierCreditNotes.id, note.id));
  }

  await recordDeletion(tx, {
    aggregateType: "supplier_credit_note",
    aggregateId: note.id,
    eventType: "supplier_credit_note.unapplied",
    snapshot: app,
    actorId: input.actorId ?? null,
    extra: { nota: note.reference, factura: invoice.reference, motivo },
  });

  return { ok: true, invoiceId: invoice.id };
}

/**
 * Deshace UNA imputación de anticipo. Gemela de `unapplyCreditNote`: mismo
 * motivo, mismo criterio de borrar la fila y dejar el evento, mismo orden de
 * locks.
 *
 * Una diferencia que no es de forma: quitar la imputación NO devuelve dinero.
 * El desembolso ocurrió el día del anticipo y sigue ocurrido; lo único que se
 * deshace es a qué factura se le imputó. Por eso el anticipo vuelve a `open`
 * —con saldo a favor del proveedor— y no a nada parecido a un reembolso.
 */
export async function unapplyAdvance(
  tx: DbOrTx,
  input: { applicationId: string; reason: string; actorId?: string | null },
): Promise<{ ok: true; invoiceId: string } | { ok: false; reason: string }> {
  const motivo = input.reason.trim();
  if (!motivo) {
    return { ok: false, reason: "Decí por qué se quita: es lo único que explica el movimiento después." };
  }

  const filas = (await tx.execute(sql`
    select id, advance_id, invoice_id, amount::text as amount,
           balance_after::text as balance_after, applied_at::text as applied_at,
           note, actor_id
      from supplier_advance_applications
     where id = ${input.applicationId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    advance_id: string;
    invoice_id: string;
    amount: string;
    balance_after: string;
    applied_at: string;
    note: string | null;
    actor_id: string | null;
  }>;
  const app = filas[0];
  if (!app) return { ok: false, reason: "Esa imputación ya no existe." };

  const facturas = (await tx.execute(sql`
    select id, reference, total::text as total, status
      from supplier_invoices
     where id = ${app.invoice_id}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
  }>;
  const invoice = facturas[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };

  const anticipos = (await tx.execute(sql`
    select id, reference, amount::text as amount, status
      from supplier_advances
     where id = ${app.advance_id}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    amount: string;
    status: string;
  }>;
  const adv = anticipos[0];
  if (!adv) return { ok: false, reason: "El anticipo no existe." };

  await tx
    .delete(supplierAdvanceApplications)
    .where(eq(supplierAdvanceApplications.id, app.id));

  await recalcularFactura(tx, invoice.id, invoice.status, dinero(invoice.total));

  if (adv.status !== "cancelled") {
    const usado = await totalAplicadoDeAnticipo(tx, adv.id);
    const restante = dinero(adv.amount) - usado;
    await tx
      .update(supplierAdvances)
      .set({
        status: restante > CENTAVO ? "open" : "applied",
        updatedAt: new Date(),
      })
      .where(eq(supplierAdvances.id, adv.id));
  }

  await recordDeletion(tx, {
    aggregateType: "supplier_advance",
    aggregateId: adv.id,
    eventType: "supplier_advance.unapplied",
    snapshot: app,
    actorId: input.actorId ?? null,
    extra: { anticipo: adv.reference, factura: invoice.reference, motivo },
  });

  return { ok: true, invoiceId: invoice.id };
}

/**
 * Recoloca el estado de una factura a partir de lo que le queda aplicado.
 *
 * Se llama después de quitar una aplicación, y calcula desde los hechos en vez
 * de invertir el paso que se deshizo: si la factura tenía encima un pago, una
 * nota y un anticipo, «lo contrario de aplicar la nota» no es un estado, es una
 * resta que hay que hacer contra los otros dos.
 *
 * `cancelled` es intocable, y `paid` sigue siendo posible: quitar una nota de
 * una factura que además estaba pagada entera la deja saldada, que es correcto.
 */
async function recalcularFactura(
  tx: DbOrTx,
  invoiceId: string,
  estadoActual: SupplierInvoiceStatus,
  total: number,
): Promise<void> {
  if (estadoActual === "cancelled") return;

  const aplicado = await totalAplicado(tx, invoiceId);
  const saldo = total - aplicado;
  const status: SupplierInvoiceStatus =
    saldo <= CENTAVO ? "paid" : aplicado > CENTAVO ? "partial" : "pending";

  await tx
    .update(supplierInvoices)
    .set({ status, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, invoiceId));
}

/**
 * Cancela una nota de crédito capturada por error.
 *
 * Solo mientras no se haya aplicado. Con la nota ya aplicada, cancelarla dejaría
 * facturas con saldo rebajado por un documento que dice no existir — el mismo
 * criterio que impide cancelar una factura con pagos.
 */
export async function cancelCreditNote(
  tx: DbOrTx,
  input: { creditNoteId: string; reason: string; actorId?: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const notas = (await tx.execute(sql`
    select id, reference, status from supplier_credit_notes
     where id = ${input.creditNoteId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    status: string;
  }>;
  const note = notas[0];
  if (!note) return { ok: false, reason: "La nota de crédito no existe." };
  if (note.status === "cancelled") {
    return { ok: false, reason: "Esa nota ya está cancelada." };
  }

  const usado = await totalAplicadoDeNota(tx, input.creditNoteId);
  if (usado > CENTAVO) {
    return {
      ok: false,
      reason:
        `La nota ${note.reference} ya se aplicó ${aDosDecimales(usado)} a facturas. ` +
        `Quita la aplicación desde la factura que la tiene encima y vuelve a intentarlo.`,
    };
  }

  await tx
    .update(supplierCreditNotes)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: input.reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(supplierCreditNotes.id, input.creditNoteId));

  await recordEvent(tx, {
    aggregateType: "supplier_credit_note",
    aggregateId: input.creditNoteId,
    eventType: "supplier_credit_note.cancelled",
    actorId: input.actorId ?? null,
    payload: { reference: note.reference, motivo: input.reason.trim() },
  });

  return { ok: true };
}

export const CREDIT_NOTE_STATUS_LABEL: Record<SupplierCreditNoteStatus, string> = {
  open: "Con saldo a favor",
  applied: "Aplicada",
  cancelled: "Cancelada",
};

/** Etiqueta legible del estado, para no repetir el switch en cada pantalla. */
export const INVOICE_STATUS_LABEL: Record<SupplierInvoiceStatus, string> = {
  pending: "Por pagar",
  partial: "Pago parcial",
  paid: "Pagada",
  cancelled: "Cancelada",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  check: "Cheque",
  card: "Tarjeta",
  other: "Otro",
};

/**
 * Suma días a una fecha `YYYY-MM-DD` y devuelve otra igual.
 *
 * Aritmética sobre la fecha civil, sin pasar por `Date` con hora: el
 * vencimiento es un día del calendario, y convertirlo a instante lo corre un
 * día para cualquiera que no esté en UTC.
 */
export function sumarDias(fecha: string, dias: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return null;
  const [, y, mes, d] = m;
  const base = new Date(Date.UTC(Number(y), Number(mes) - 1, Number(d)));
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/* ============================ Parcialidades ============================ */

export type SplitInput = {
  invoiceId: string;
  /** Cada parcialidad: cuánto y cuándo. El orden define la cascada de imputación. */
  parts: Array<{ amount: number; dueAt: string; note?: string | null }>;
  actorId?: string | null;
};

/**
 * Parte una factura en varios vencimientos.
 *
 * Reemplaza el plan anterior completo en vez de añadirle filas: repactar
 * significa acordar un calendario nuevo, y mezclar el viejo con el nuevo deja
 * un plan que no es ninguno de los dos.
 *
 * Solo mientras no se haya cubierto nada. Con dinero ya imputado, cambiar el
 * calendario recolocaría pagos que ya ocurrieron contra vencimientos que no
 * existían cuando se hicieron, y el historial de mora del proveedor cambiaría
 * hacia atrás. Repactar una factura con pagos es un acuerdo nuevo, y se refleja
 * con una nota de crédito y una factura nueva, no reescribiendo esta.
 */
export async function splitInvoice(
  tx: DbOrTx,
  input: SplitInput,
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  if (input.parts.length < 2) {
    return { ok: false, reason: "Una división necesita al menos dos parcialidades." };
  }
  if (input.parts.length > 60) {
    return { ok: false, reason: "Son demasiadas parcialidades (máximo 60)." };
  }

  const facturas = (await tx.execute(sql`
    select id, reference, total::text as total, status, issued_at::text as issued_at
      from supplier_invoices
     where id = ${input.invoiceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
    issued_at: string;
  }>;
  const invoice = facturas[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };
  if (invoice.status === "cancelled") {
    return { ok: false, reason: "Esa factura está cancelada." };
  }

  const aplicado = await totalAplicado(tx, input.invoiceId);
  if (aplicado > CENTAVO) {
    return {
      ok: false,
      reason:
        `La factura ${invoice.reference} ya tiene ${aDosDecimales(aplicado)} cubiertos. ` +
        `Dividirla ahora recolocaría pagos que ya ocurrieron.`,
    };
  }

  // La suma tiene que dar el total exacto. Se comprueba y no se ajusta el
  // último renglón por su cuenta: un centavo que aparece solo es la clase de
  // diferencia que nadie encuentra después en la conciliación.
  const suma = input.parts.reduce((a, p) => a + dinero(p.amount), 0);
  const total = dinero(invoice.total);
  if (Math.abs(suma - total) > CENTAVO) {
    return {
      ok: false,
      reason:
        `Las parcialidades suman ${aDosDecimales(suma)} y la factura es de ` +
        `${aDosDecimales(total)}. La diferencia es ${aDosDecimales(Math.abs(suma - total))}.`,
    };
  }

  for (const [i, p] of input.parts.entries()) {
    if (dinero(p.amount) <= 0) {
      return { ok: false, reason: `La parcialidad ${i + 1} no es mayor que cero.` };
    }
    if (p.dueAt < invoice.issued_at) {
      return {
        ok: false,
        reason: `La parcialidad ${i + 1} vence antes de que se emitiera la factura.`,
      };
    }
  }

  // Las fechas deben ir en orden: la cascada imputa por `seq`, y un calendario
  // desordenado haría que un pago cubriera un vencimiento posterior antes que
  // uno anterior sin que nadie lo pidiera.
  for (let i = 1; i < input.parts.length; i++) {
    if (input.parts[i].dueAt < input.parts[i - 1].dueAt) {
      return {
        ok: false,
        reason: "Las parcialidades tienen que ir de la más próxima a la más lejana.",
      };
    }
  }

  await tx
    .delete(supplierInvoiceInstallments)
    .where(eq(supplierInvoiceInstallments.invoiceId, input.invoiceId));

  await tx.insert(supplierInvoiceInstallments).values(
    input.parts.map((p, i) => ({
      invoiceId: input.invoiceId,
      seq: i + 1,
      amount: aDosDecimales(dinero(p.amount)),
      dueAt: p.dueAt,
      note: p.note?.trim() || null,
    })),
  );

  // `due_at` de la factura pasa a ser el ÚLTIMO vencimiento: es la fecha en que
  // deja de deberse del todo. Los intermedios viven en las parcialidades, y la
  // antigüedad los lee de ahí.
  const ultima = input.parts[input.parts.length - 1].dueAt;
  await tx
    .update(supplierInvoices)
    .set({ dueAt: ultima, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, input.invoiceId));

  await recordEvent(tx, {
    aggregateType: "supplier_invoice",
    aggregateId: input.invoiceId,
    eventType: "supplier_invoice.split",
    actorId: input.actorId ?? null,
    payload: {
      reference: invoice.reference,
      parcialidades: input.parts.map((p, i) => ({
        n: i + 1,
        importe: aDosDecimales(dinero(p.amount)),
        vence: p.dueAt,
      })),
    },
  });

  return { ok: true, count: input.parts.length };
}

/**
 * Reparte un total en N parcialidades iguales, mensuales.
 *
 * El redondeo sobrante va a la ÚLTIMA: repartirlo a ojo entre todas deja
 * importes irregulares y la suma sin cuadrar. Con esto, tres parcialidades de
 * 78 880 dan 26 293.33, 26 293.33 y 26 293.34.
 */
export function repartirEnParcialidades(
  total: number,
  n: number,
  primerVencimiento: string,
): Array<{ amount: number; dueAt: string }> {
  const centavos = Math.round(dinero(total) * 100);
  const base = Math.floor(centavos / n);
  const partes: Array<{ amount: number; dueAt: string }> = [];

  for (let i = 0; i < n; i++) {
    const c = i === n - 1 ? centavos - base * (n - 1) : base;
    partes.push({
      amount: c / 100,
      dueAt: sumarMeses(primerVencimiento, i) ?? primerVencimiento,
    });
  }
  return partes;
}

/**
 * Suma meses a una fecha civil, recortando al último día del mes cuando hace
 * falta: el 31 de enero más un mes es el 28 de febrero, no el 3 de marzo.
 */
export function sumarMeses(fecha: string, meses: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return null;
  const [, y, mes, d] = m;
  const año = Number(y);
  const mesIdx = Number(mes) - 1 + meses;
  const dia = Number(d);

  const añoDestino = año + Math.floor(mesIdx / 12);
  const mesDestino = ((mesIdx % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(añoDestino, mesDestino + 1, 0)).getUTCDate();

  const t = new Date(Date.UTC(añoDestino, mesDestino, Math.min(dia, ultimoDia)));
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

/* ============================== Anticipos ============================== */

export type RegisterAdvanceInput = {
  supplierId: string;
  amount: number;
  currency?: string;
  method?: PaymentMethod;
  paymentReference?: string | null;
  paidAt: string;
  cfdiUuid?: string | null;
  notes?: string | null;
  actorId?: string | null;
  folioPrefix?: string;
};

export type RegisterAdvanceResult =
  | { ok: true; advanceId: string; reference: string }
  | { ok: false; reason: string };

/**
 * Registra un anticipo: dinero que sale antes de que exista la factura.
 *
 * A diferencia del pago, no apunta a nada — todavía no hay a qué. Queda como
 * saldo a favor del proveedor hasta que llegue la factura y alguien lo impute.
 */
export async function registerAdvance(
  tx: DbOrTx,
  input: RegisterAdvanceInput,
): Promise<RegisterAdvanceResult> {
  const amount = dinero(input.amount);
  if (amount <= 0) {
    return { ok: false, reason: "El anticipo debe ser mayor que cero." };
  }

  const [supplier] = await tx
    .select({
      id: suppliers.id,
      currency: suppliers.currency,
      suspendedAt: suppliers.suspendedAt,
    })
    .from(suppliers)
    .where(eq(suppliers.id, input.supplierId))
    .limit(1);
  if (!supplier) return { ok: false, reason: "El proveedor no existe." };

  // Anticipar dinero a un proveedor suspendido es justo lo que la suspensión
  // trata de impedir: comprometerse más con quien está en revisión.
  if (supplier.suspendedAt) {
    return {
      ok: false,
      reason: "El proveedor está suspendido: no se le pueden dar anticipos.",
    };
  }

  const cfdi = input.cfdiUuid?.trim() || null;
  if (cfdi) {
    const repetido = (await tx.execute(sql`
      select reference from supplier_advances
       where cfdi_uuid = ${cfdi} limit 1`)) as unknown as Array<{ reference: string }>;
    if (repetido[0]) {
      return {
        ok: false,
        reason: `Ese CFDI ya está capturado en el anticipo ${repetido[0].reference}.`,
      };
    }
  }

  const reference = await nextSupplierAdvanceReference(tx, input.folioPrefix);

  const [row] = await tx
    .insert(supplierAdvances)
    .values({
      reference,
      supplierId: input.supplierId,
      amount: aDosDecimales(amount),
      currency: input.currency ?? supplier.currency ?? "MXN",
      method: input.method ?? "transfer",
      reference_: input.paymentReference?.trim() || null,
      paidAt: input.paidAt,
      cfdiUuid: cfdi,
      notes: input.notes?.trim() || null,
      createdById: input.actorId ?? null,
    })
    .returning({ id: supplierAdvances.id });

  await recordEvent(tx, {
    aggregateType: "supplier_advance",
    aggregateId: row.id,
    eventType: "supplier_advance.paid",
    actorId: input.actorId ?? null,
    payload: {
      reference,
      proveedor: input.supplierId,
      importe: aDosDecimales(amount),
      metodo: input.method ?? "transfer",
      fecha: input.paidAt,
    },
  });

  return { ok: true, advanceId: row.id, reference };
}

/** Lo ya imputado de un anticipo. El resto sigue a favor. */
export async function totalAplicadoDeAnticipo(
  tx: DbOrTx,
  advanceId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(amount), 0)::text as usado
      from supplier_advance_applications
     where advance_id = ${advanceId}::uuid`)) as unknown as Array<{ usado: string }>;
  return dinero(rows[0]?.usado);
}

export type ApplyAdvanceResult =
  | {
      ok: true;
      balanceAfter: number;
      status: SupplierInvoiceStatus;
      advanceRemaining: number;
    }
  | { ok: false; reason: string };

/**
 * Imputa un anticipo a una factura.
 *
 * NO mueve dinero: el dinero salió el día del anticipo. Esto solo dice contra
 * qué deuda se aplica lo que ya se pagó, y por eso no genera un renglón en
 * `supplier_payments` — contarlo ahí inflaría la salida de caja del mes en que
 * se imputa con dinero que salió meses antes.
 */
export async function applyAdvance(
  tx: DbOrTx,
  input: {
    advanceId: string;
    invoiceId: string;
    amount: number;
    appliedAt: string;
    note?: string | null;
    actorId?: string | null;
  },
): Promise<ApplyAdvanceResult> {
  const amount = dinero(input.amount);
  if (amount <= 0) return { ok: false, reason: "El importe debe ser mayor que cero." };

  const facturas = (await tx.execute(sql`
    select id, reference, total::text as total, status, currency, supplier_id
      from supplier_invoices
     where id = ${input.invoiceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    total: string;
    status: SupplierInvoiceStatus;
    currency: string;
    supplier_id: string;
  }>;
  const invoice = facturas[0];
  if (!invoice) return { ok: false, reason: "La factura no existe." };
  if (invoice.status === "cancelled") {
    return { ok: false, reason: "Esa factura está cancelada." };
  }
  if (invoice.status === "paid") {
    return { ok: false, reason: `La factura ${invoice.reference} ya está saldada.` };
  }

  const anticipos = (await tx.execute(sql`
    select id, reference, amount::text as amount, status, currency, supplier_id
      from supplier_advances
     where id = ${input.advanceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    amount: string;
    status: string;
    currency: string;
    supplier_id: string;
  }>;
  const adv = anticipos[0];
  if (!adv) return { ok: false, reason: "El anticipo no existe." };
  if (adv.status === "cancelled") {
    return { ok: false, reason: `El anticipo ${adv.reference} está cancelado.` };
  }
  if (adv.supplier_id !== invoice.supplier_id) {
    return { ok: false, reason: "El anticipo y la factura son de proveedores distintos." };
  }
  if (adv.currency !== invoice.currency) {
    return {
      ok: false,
      reason: `El anticipo está en ${adv.currency} y la factura en ${invoice.currency}.`,
    };
  }

  const usado = await totalAplicadoDeAnticipo(tx, input.advanceId);
  const disponible = dinero(adv.amount) - usado;
  if (amount - disponible > CENTAVO) {
    return {
      ok: false,
      reason:
        `Al anticipo ${adv.reference} le quedan ${aDosDecimales(disponible)} disponibles ` +
        `y estás aplicando ${aDosDecimales(amount)}.`,
    };
  }

  const aplicado = await totalAplicado(tx, input.invoiceId);
  const saldo = dinero(invoice.total) - aplicado;
  if (amount - saldo > CENTAVO) {
    return {
      ok: false,
      reason:
        `A la factura ${invoice.reference} le quedan ${aDosDecimales(saldo)} por saldar ` +
        `y estás aplicando ${aDosDecimales(amount)}.`,
    };
  }

  const balanceAfter = Math.max(0, saldo - amount);
  const status: SupplierInvoiceStatus = balanceAfter <= CENTAVO ? "paid" : "partial";
  const advanceRemaining = Math.max(0, disponible - amount);

  await tx.insert(supplierAdvanceApplications).values({
    advanceId: input.advanceId,
    invoiceId: input.invoiceId,
    amount: aDosDecimales(amount),
    balanceAfter: aDosDecimales(balanceAfter),
    appliedAt: input.appliedAt,
    note: input.note?.trim() || null,
    actorId: input.actorId ?? null,
  });

  await tx
    .update(supplierInvoices)
    .set({ status, updatedAt: new Date() })
    .where(eq(supplierInvoices.id, input.invoiceId));

  if (advanceRemaining <= CENTAVO) {
    await tx
      .update(supplierAdvances)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(supplierAdvances.id, input.advanceId));
  }

  await recordEvent(tx, {
    aggregateType: "supplier_advance",
    aggregateId: input.advanceId,
    eventType: "supplier_advance.applied",
    actorId: input.actorId ?? null,
    payload: {
      anticipo: adv.reference,
      factura: invoice.reference,
      importe: aDosDecimales(amount),
      saldoFactura: aDosDecimales(balanceAfter),
      saldoAnticipo: aDosDecimales(advanceRemaining),
      fecha: input.appliedAt,
    },
  });

  return { ok: true, balanceAfter, status, advanceRemaining };
}

/**
 * Cancela un anticipo capturado por error.
 *
 * Solo si no se ha imputado nada. Ojo: cancelarlo NO devuelve el dinero — si el
 * dinero de verdad salió, lo que corresponde es que el proveedor lo reintegre,
 * y eso es un movimiento propio. Esto sirve para el anticipo que se capturó mal,
 * no para el que se arrepintieron de dar.
 */
export async function cancelAdvance(
  tx: DbOrTx,
  input: { advanceId: string; reason: string; actorId?: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = (await tx.execute(sql`
    select id, reference, status from supplier_advances
     where id = ${input.advanceId}::uuid
       for update`)) as unknown as Array<{
    id: string;
    reference: string;
    status: string;
  }>;
  const adv = rows[0];
  if (!adv) return { ok: false, reason: "El anticipo no existe." };
  if (adv.status === "cancelled") return { ok: false, reason: "Ya está cancelado." };

  const usado = await totalAplicadoDeAnticipo(tx, input.advanceId);
  if (usado > CENTAVO) {
    return {
      ok: false,
      reason:
        `El anticipo ${adv.reference} ya se imputó ${aDosDecimales(usado)} a facturas. ` +
        `Quita la imputación desde la factura que la tiene encima y vuelve a intentarlo.`,
    };
  }

  await tx
    .update(supplierAdvances)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: input.reason.trim(),
      updatedAt: new Date(),
    })
    .where(eq(supplierAdvances.id, input.advanceId));

  await recordEvent(tx, {
    aggregateType: "supplier_advance",
    aggregateId: input.advanceId,
    eventType: "supplier_advance.cancelled",
    actorId: input.actorId ?? null,
    payload: { reference: adv.reference, motivo: input.reason.trim() },
  });

  return { ok: true };
}

export const ADVANCE_STATUS_LABEL: Record<SupplierAdvanceStatus, string> = {
  open: "Con saldo a favor",
  applied: "Aplicado",
  cancelled: "Cancelado",
};
