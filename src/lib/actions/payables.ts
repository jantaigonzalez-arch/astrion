"use server";

import { z } from "zod";
import { leerImporte } from "@/lib/importe";
import { auth } from "@/lib/auth";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { applyAdvance, applyCreditNote, cancelCreditNote, cancelSupplierInvoice, paySupplierInvoice, registerAdvance, registerCreditNote, registerSupplierInvoice, repartirEnParcialidades, splitInvoice, unapplyAdvance, unapplyCreditNote } from "@/lib/domain/payables";
import { PreviewRollback, runImportBatch, type ChargeRow, type ImportOutcome } from "@/lib/domain/payable-import";
import { leerAbonosCsv, leerCargosCsv } from "@/lib/import/payables-csv";
import { parseCfdi, tipoDeDocumento } from "@/lib/import/cfdi";

/**
 * Acciones de cuentas por pagar.
 *
 * Todas piden administrador, y es la diferencia con el resto de compras: un
 * agente levanta y recibe órdenes porque sabe qué refacción hace falta, pero
 * reconocer una deuda y sacar dinero de la empresa es otra cosa. Quien recibe
 * la mercancía no debería ser también quien autoriza su pago — es la separación
 * de funciones más básica que pide cualquier auditoría.
 */

export type PayableState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** Folio recién creado, para que la pantalla pueda navegar a la factura. */
  invoiceId?: string;
};

/**
 * Importe desde un campo de texto: quita el formato y deja el número.
 *
 * Vacío es cero, como siempre fue. Pero lo que no es un número ya no: con la
 * limpieza de antes (`[^0-9.-]`) «mil pesos» quedaba en "" y `Number("")` es 0,
 * así que pasaba la validación como un importe de cero. Ver `lib/importe.ts`.
 */
const importe = z
  .string()
  .transform((v) => leerImporte(String(v)) ?? 0)
  .refine((n) => Number.isFinite(n), { message: "importe inválido" });

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida");

const InvoiceSchema = z.object({
  supplierId: z.string().uuid(),
  supplierFolio: z.string().max(60).optional(),
  // 36 posiciones con guiones. No se valida la estructura completa: un
  // proveedor extranjero no emite CFDI y rechazar la captura por eso dejaría
  // la deuda fuera del sistema, que es peor que tenerla sin UUID.
  cfdiUuid: z.string().max(36).optional(),
  currency: z.enum(["MXN", "USD", "EUR"]).default("MXN"),
  subtotal: importe,
  taxTotal: importe.optional(),
  total: importe,
  issuedAt: fecha,
  dueAt: fecha.optional(),
  notes: z.string().max(2000).optional(),
});

export async function createSupplierInvoice(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador captura facturas de proveedor." };
  }

  const parsed = InvoiceSchema.safeParse({
    supplierId: formData.get("supplierId"),
    supplierFolio: (formData.get("supplierFolio") as string) || undefined,
    cfdiUuid: (formData.get("cfdiUuid") as string) || undefined,
    currency: (formData.get("currency") as string) || "MXN",
    subtotal: (formData.get("subtotal") as string) || "0",
    taxTotal: (formData.get("taxTotal") as string) || undefined,
    total: (formData.get("total") as string) || "0",
    issuedAt: formData.get("issuedAt"),
    dueAt: (formData.get("dueAt") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Revisa los datos de la factura." };
  }

  // Las órdenes amparadas llegan como casillas marcadas del mismo nombre.
  const orderIds = formData
    .getAll("orderIds")
    .map(String)
    .filter((v) => z.string().uuid().safeParse(v).success);

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      registerSupplierInvoice(tx, {
        ...parsed.data,
        orderIds,
        actorId: session.user.id,
      }),
    );

    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      invoiceId: result.invoiceId,
      message: `Factura ${result.reference} capturada. Vence el ${result.dueAt}.`,
    };
  } catch (e) {
    console.error("[pagar] createSupplierInvoice:", e);
    return { ok: false, error: "No se pudo capturar la factura." };
  }
}

const PaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: importe,
  method: z.enum(["transfer", "cash", "check", "card", "other"]).default("transfer"),
  reference: z.string().max(120).optional(),
  paidAt: fecha,
  note: z.string().max(1000).optional(),
});

export async function payInvoice(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador registra pagos." };
  }

  const parsed = PaymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: (formData.get("amount") as string) || "0",
    method: (formData.get("method") as string) || "transfer",
    reference: (formData.get("reference") as string) || undefined,
    paidAt: formData.get("paidAt"),
    note: (formData.get("note") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Revisa los datos del pago." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      paySupplierInvoice(tx, { ...parsed.data, actorId: session.user.id }),
    );

    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message:
        result.status === "paid"
          ? "Pago registrado. La factura queda saldada."
          : `Pago registrado. Quedan ${result.balanceAfter.toFixed(2)} por pagar.`,
    };
  } catch (e) {
    console.error("[pagar] payInvoice:", e);
    return { ok: false, error: "No se pudo registrar el pago." };
  }
}

export async function cancelInvoice(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador cancela facturas." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId) return { ok: false, error: "Falta la factura." };
  if (reason.length < 4) {
    return { ok: false, error: "Escribe el motivo: queda en la bitácora." };
  }

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      cancelSupplierInvoice(tx, { invoiceId, reason, actorId: session.user.id }),
    );

    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return { ok: true, message: "Factura cancelada." };
  } catch (e) {
    console.error("[pagar] cancelInvoice:", e);
    return { ok: false, error: "No se pudo cancelar la factura." };
  }
}

/* ======================= Notas de crédito ======================= */

const CreditNoteSchema = z.object({
  supplierId: z.string().uuid(),
  supplierFolio: z.string().max(60).optional(),
  cfdiUuid: z.string().max(36).optional(),
  currency: z.enum(["MXN", "USD", "EUR"]).default("MXN"),
  subtotal: importe,
  taxTotal: importe.optional(),
  total: importe,
  issuedAt: fecha,
  notes: z.string().max(2000).optional(),
});

export async function createCreditNote(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador captura notas de crédito." };
  }

  const parsed = CreditNoteSchema.safeParse({
    supplierId: formData.get("supplierId"),
    supplierFolio: (formData.get("supplierFolio") as string) || undefined,
    cfdiUuid: (formData.get("cfdiUuid") as string) || undefined,
    currency: (formData.get("currency") as string) || "MXN",
    subtotal: (formData.get("subtotal") as string) || "0",
    taxTotal: (formData.get("taxTotal") as string) || undefined,
    total: (formData.get("total") as string) || "0",
    issuedAt: formData.get("issuedAt"),
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Revisa los datos de la nota." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      registerCreditNote(tx, { ...parsed.data, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message: `Nota ${result.reference} capturada. Queda como saldo a favor hasta que la apliques.`,
    };
  } catch (e) {
    console.error("[pagar] createCreditNote:", e);
    return { ok: false, error: "No se pudo capturar la nota de crédito." };
  }
}

const ApplySchema = z.object({
  creditNoteId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: importe,
  appliedAt: fecha,
  note: z.string().max(1000).optional(),
});

export async function applyCreditNoteToInvoice(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador aplica notas de crédito." };
  }

  const parsed = ApplySchema.safeParse({
    creditNoteId: formData.get("creditNoteId"),
    invoiceId: formData.get("invoiceId"),
    amount: (formData.get("amount") as string) || "0",
    appliedAt: formData.get("appliedAt"),
    note: (formData.get("note") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Revisa los datos de la aplicación." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      applyCreditNote(tx, { ...parsed.data, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message:
        result.status === "paid"
          ? "Nota aplicada. La factura queda saldada."
          : `Nota aplicada. Quedan ${result.balanceAfter.toFixed(2)} por pagar.`,
    };
  } catch (e) {
    console.error("[pagar] applyCreditNoteToInvoice:", e);
    return { ok: false, error: "No se pudo aplicar la nota de crédito." };
  }
}

/**
 * Quita una aplicación de nota de crédito o una imputación de anticipo.
 *
 * Una sola acción para los dos porque desde la pantalla es el mismo gesto sobre
 * el mismo tipo de renglón, y separarlas obligaría a dos formularios idénticos.
 * `tipo` viene de un campo oculto del botón, así que se valida contra un par
 * cerrado antes de decidir a qué función del dominio se llama.
 *
 * Administrador y no soporte: es la operación que devuelve saldo a una factura
 * ya rebajada, o sea que MUEVE lo que se debe. El mismo criterio que cancelar.
 */
export async function unapplyCredit(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador quita una aplicación." };
  }

  const parsed = z
    .object({
      tipo: z.enum(["nota", "anticipo"]),
      applicationId: z.string().uuid(),
      reason: z.string().trim().min(3, "Falta el motivo."),
    })
    .safeParse({
      tipo: formData.get("tipo"),
      applicationId: formData.get("applicationId"),
      reason: formData.get("reason"),
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos." };
  }
  const { tipo, applicationId, reason } = parsed.data;

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      tipo === "nota"
        ? unapplyCreditNote(tx, { applicationId, reason, actorId: session.user.id })
        : unapplyAdvance(tx, { applicationId, reason, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message:
        tipo === "nota"
          ? "Aplicación quitada. La nota vuelve a tener saldo a favor."
          : "Imputación quitada. El anticipo vuelve a tener saldo a favor.",
    };
  } catch (e) {
    console.error("[pagar] unapplyCredit:", e);
    return { ok: false, error: "No se pudo quitar la aplicación." };
  }
}

export async function cancelCreditNoteAction(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador cancela notas de crédito." };
  }

  const creditNoteId = String(formData.get("creditNoteId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!creditNoteId) return { ok: false, error: "Falta la nota." };
  if (reason.length < 4) {
    return { ok: false, error: "Escribe el motivo: queda en la bitácora." };
  }

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      cancelCreditNote(tx, { creditNoteId, reason, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return { ok: true, message: "Nota de crédito cancelada." };
  } catch (e) {
    console.error("[pagar] cancelCreditNoteAction:", e);
    return { ok: false, error: "No se pudo cancelar la nota." };
  }
}

/* ======================= Importación masiva ======================= */

export type ImportState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Qué pasó con cada fila. Es lo que la pantalla enseña. */
  outcome?: ImportOutcome;
  /** `preview` no escribió nada; `commit` sí. */
  phase?: "preview" | "commit";
  /** Se devuelve para que el botón de confirmar reenvíe lo mismo que se vio. */
  kind?: "charges_csv" | "credits_csv" | "charges_cfdi";
  fileName?: string;
};

/** Convierte un CFDI ya leído en una fila de cargo. */
function cfdiAFilaDeCargo(xml: string): ChargeRow | { error: string } {
  const doc = parseCfdi(xml);
  const tipo = tipoDeDocumento(doc);
  if (tipo.kind === null) return { error: tipo.reason };
  if (tipo.kind === "credit") {
    return {
      error:
        "Es una nota de crédito (tipo E). Impórtala por el archivo de abonos: " +
        "aplicarla necesita saber contra qué factura va.",
    };
  }
  if (!doc.uuid) {
    return {
      error: "El comprobante no está timbrado: sin UUID no hay control de duplicados.",
    };
  }

  // El descuento del CFDI baja la base, así que el subtotal efectivo es
  // SubTotal - Descuento. Ignorarlo dejaría el cuadre fuera por ese importe y
  // la fila se rechazaría con un mensaje que no explica nada.
  const subtotal = (doc.subtotal ?? 0) - doc.descuento;

  return {
    supplierRfc: doc.emisorRfc,
    supplierName: doc.emisorNombre,
    supplierFolio: [doc.serie, doc.folio].filter(Boolean).join("-") || null,
    cfdiUuid: doc.uuid,
    currency: doc.moneda,
    subtotal,
    taxTotal: doc.impuestosTrasladados,
    total: doc.total,
    issuedAt: doc.fecha,
    dueAt: null,
    notes: null,
  };
}

/**
 * Lee los archivos del formulario y corre el lote.
 *
 * `persist` decide si se confirma o se revierte. La previsualización usa la
 * MISMA ruta: se ejecuta entero dentro de una transacción y se lanza
 * `PreviewRollback` al final para deshacerla. Así lo que se enseña no es una
 * simulación parecida, es el resultado real de haberlo hecho.
 */
async function correrImportacion(
  formData: FormData,
  persist: boolean,
): Promise<ImportState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador importa cuentas por pagar." };
  }

  const kind = String(formData.get("kind") ?? "");
  if (kind !== "charges_csv" && kind !== "credits_csv" && kind !== "charges_cfdi") {
    return { ok: false, error: "Tipo de importación no reconocido." };
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length || files.every((f) => f.size === 0)) {
    return { ok: false, error: "Elige al menos un archivo." };
  }

  const fileName =
    files.length === 1 ? files[0].name : `${files.length} archivos (${kind})`;

  try {
    let rows: ChargeRow[] = [];
    const rechazosPrevios: ImportOutcome["results"] = [];

    if (kind === "charges_cfdi") {
      // Un XML por archivo. Los que no son comprobante de ingreso se rechazan
      // aquí con su motivo y no llegan al motor: no hay fila que ejecutar.
      for (let i = 0; i < files.length; i++) {
        const xml = await files[i].text();
        const fila = cfdiAFilaDeCargo(xml);
        if ("error" in fila) {
          rechazosPrevios.push({
            line: i + 1,
            ok: false,
            reason: fila.error,
            label: files[i].name,
          });
        } else {
          rows.push(fila);
        }
      }
    } else {
      const text = await files[0].text();
      const leido = kind === "charges_csv" ? leerCargosCsv(text) : leerAbonosCsv(text);
      if (leido.error) return { ok: false, error: leido.error };
      rows = leido.rows as ChargeRow[];
    }

    if (!rows.length && !rechazosPrevios.length) {
      return { ok: false, error: "No se encontró ninguna fila que procesar." };
    }

    const db = await tenantDb();
    let outcome: ImportOutcome | undefined;

    try {
      await db.transaction(async (tx) => {
        outcome = await runImportBatch(tx, {
          kind,
          rows: rows as never,
          fileName,
          actorId: session.user.id,
          persist,
        });
        if (!persist) throw new PreviewRollback();
      });
    } catch (e) {
      // La reversión de la previsualización es el camino esperado, no un fallo.
      if (!(e instanceof PreviewRollback)) throw e;
    }

    if (!outcome) return { ok: false, error: "No se pudo procesar el archivo." };

    // Los rechazos del lector van primero: son de archivos que nunca llegaron a
    // ejecutarse y su numeración es la del archivo, no la de la fila.
    const results = [...rechazosPrevios, ...outcome.results];
    const okCount = outcome.okCount;
    const errorCount = results.length - okCount;
    const final: ImportOutcome = { ...outcome, results, okCount, errorCount };

    if (persist) revalidateTenant();

    return {
      ok: true,
      phase: persist ? "commit" : "preview",
      outcome: final,
      kind,
      fileName,
      message: persist
        ? `${okCount} de ${results.length} filas importadas` +
          (final.batchReference ? ` · lote ${final.batchReference}` : "")
        : `${okCount} de ${results.length} filas se importarían. Nada se ha guardado todavía.`,
    };
  } catch (e) {
    console.error("[pagar] importar:", e);
    return { ok: false, error: "No se pudo leer el archivo." };
  }
}

export async function previewPayableImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  return correrImportacion(formData, false);
}

export async function commitPayableImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  return correrImportacion(formData, true);
}

/* ======================= Parcialidades ======================= */

export async function splitInvoiceAction(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador divide una factura." };
  }

  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return { ok: false, error: "Falta la factura." };

  // Dos caminos: el reparto automático en N mensualidades, o el calendario
  // capturado renglón a renglón. El automático cubre el caso común sin obligar
  // a teclear doce fechas.
  const modo = String(formData.get("modo") ?? "auto");
  let parts: Array<{ amount: number; dueAt: string; note?: string | null }>;

  if (modo === "auto") {
    const n = Number(formData.get("count") ?? 0);
    const primero = String(formData.get("firstDueAt") ?? "");
    // Sin la limpieza de `[^0-9.]`, que convertía «-1000» en 1000.
    const total = leerImporte(formData.get("total")) ?? 0;
    if (!(total > 0)) return { ok: false, error: "El total a dividir tiene que ser mayor que cero." };
    if (!Number.isInteger(n) || n < 2 || n > 60) {
      return { ok: false, error: "El número de parcialidades va de 2 a 60." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(primero)) {
      return { ok: false, error: "Falta la fecha del primer vencimiento." };
    }
    parts = repartirEnParcialidades(total, n, primero);
  } else {
    const importes = formData.getAll("part-amount").map(String);
    const fechas = formData.getAll("part-due").map(String);
    parts = [];
    for (let i = 0; i < importes.length; i++) {
      const amount = leerImporte(importes[i]);
      const dueAt = fechas[i]?.trim();
      // Un renglón vacío se salta; uno con basura o negativo, no: saltarlo
      // repartiría la factura en menos parcialidades de las que se capturaron.
      //
      // La comprobación va ANTES del salto. Estaba detrás, y el salto también
      // miraba la fecha (`!dueAt`): un «-100» o un «mil» en un renglón SIN fecha
      // se saltaba en silencio, y si los demás renglones sumaban el total la
      // factura se dividía sin ese renglón y respondía «dividida». Lo encontró
      // `scripts/_probe-acciones-pagar.ts`.
      if (amount !== null && !(amount >= 0)) {
        return { ok: false, error: `La parcialidad ${i + 1} no tiene un importe válido.` };
      }
      if (amount === null || amount === 0 || !dueAt) continue;
      parts.push({ amount, dueAt });
    }
  }

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      splitInvoice(tx, { invoiceId, parts, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message: `Factura dividida en ${result.count} parcialidades.`,
    };
  } catch (e) {
    console.error("[pagar] splitInvoice:", e);
    return { ok: false, error: "No se pudo dividir la factura." };
  }
}

/* ========================== Anticipos ========================== */

const AdvanceSchema = z.object({
  supplierId: z.string().uuid(),
  amount: importe,
  currency: z.enum(["MXN", "USD", "EUR"]).default("MXN"),
  method: z.enum(["transfer", "cash", "check", "card", "other"]).default("transfer"),
  paymentReference: z.string().max(120).optional(),
  paidAt: fecha,
  cfdiUuid: z.string().max(36).optional(),
  notes: z.string().max(2000).optional(),
});

export async function createAdvance(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador registra anticipos." };
  }

  const parsed = AdvanceSchema.safeParse({
    supplierId: formData.get("supplierId"),
    amount: (formData.get("amount") as string) || "0",
    currency: (formData.get("currency") as string) || "MXN",
    method: (formData.get("method") as string) || "transfer",
    paymentReference: (formData.get("paymentReference") as string) || undefined,
    paidAt: formData.get("paidAt"),
    cfdiUuid: (formData.get("cfdiUuid") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Revisa los datos del anticipo." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      registerAdvance(tx, { ...parsed.data, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message: `Anticipo ${result.reference} registrado. Queda a favor hasta que lo imputes a una factura.`,
    };
  } catch (e) {
    console.error("[pagar] createAdvance:", e);
    return { ok: false, error: "No se pudo registrar el anticipo." };
  }
}

export async function applyAdvanceToInvoice(
  _prev: PayableState,
  formData: FormData,
): Promise<PayableState> {
  const session = await auth();
  if (!session?.user || !(await puedeEn("pagar", "administrar"))) {
    return { ok: false, error: "Solo un administrador imputa anticipos." };
  }

  const parsed = z
    .object({
      advanceId: z.string().uuid(),
      invoiceId: z.string().uuid(),
      amount: importe,
      appliedAt: fecha,
      note: z.string().max(1000).optional(),
    })
    .safeParse({
      advanceId: formData.get("advanceId"),
      invoiceId: formData.get("invoiceId"),
      amount: (formData.get("amount") as string) || "0",
      appliedAt: formData.get("appliedAt"),
      note: (formData.get("note") as string) || undefined,
    });
  if (!parsed.success) return { ok: false, error: "Revisa los datos de la imputación." };

  try {
    const db = await tenantDb();
    const result = await db.transaction((tx) =>
      applyAdvance(tx, { ...parsed.data, actorId: session.user.id }),
    );
    if (!result.ok) return { ok: false, error: result.reason };

    revalidateTenant();
    return {
      ok: true,
      message:
        result.status === "paid"
          ? "Anticipo imputado. La factura queda saldada."
          : `Anticipo imputado. Quedan ${result.balanceAfter.toFixed(2)} por pagar.`,
    };
  } catch (e) {
    console.error("[pagar] applyAdvanceToInvoice:", e);
    return { ok: false, error: "No se pudo imputar el anticipo." };
  }
}
