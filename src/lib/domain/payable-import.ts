import "server-only";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { payableImports, type PayableImportKind } from "@/lib/db/schema";
import { recordEvent } from "@/lib/domain/events";
import { nextPayableImportReference } from "@/lib/domain/references";
import {
  applyCreditNote,
  paySupplierInvoice,
  registerCreditNote,
  registerSupplierInvoice,
} from "@/lib/domain/payables";
import { normName } from "@/lib/import/csv";

/**
 * Motor de importación de cuentas por pagar.
 *
 * Dos decisiones sostienen todo este archivo:
 *
 * 1. NO valida por su cuenta. Cada fila se ejecuta contra las mismas funciones
 *    de dominio que usa la captura de una en una —`registerSupplierInvoice`,
 *    `paySupplierInvoice`, `registerCreditNote`—. Un importador con su propia
 *    copia de las reglas se desincroniza en el primer cambio y empieza a
 *    aceptar lo que la pantalla rechaza.
 *
 * 2. La PREVISUALIZACIÓN ejecuta de verdad. Se corre el lote entero dentro de
 *    una transacción que siempre se revierte, y lo que se enseña es literalmente
 *    lo que va a pasar al confirmar. La alternativa —simular— vuelve a caer en
 *    el problema uno.
 *
 * Cada fila va en su propio savepoint. Sin eso, una fila que provoque un error
 * de base de datos —y no un rechazo controlado— aborta la transacción entera y
 * las cien filas siguientes fallan por arrastre, con un motivo que no es el suyo.
 */

/** Un cargo: la factura del proveedor, que crea la deuda. */
export type ChargeRow = {
  supplierRfc?: string | null;
  supplierName?: string | null;
  supplierFolio?: string | null;
  cfdiUuid?: string | null;
  currency?: string;
  subtotal: number | null;
  taxTotal: number | null;
  total: number | null;
  issuedAt: string | null;
  dueAt?: string | null;
  notes?: string | null;
};

/**
 * Un abono: baja la deuda. De dos clases, y la diferencia importa —el pago sacó
 * dinero de la caja y la nota de crédito no—.
 */
export type CreditRow = {
  kind: "payment" | "credit_note";
  supplierRfc?: string | null;
  supplierName?: string | null;
  /** Folio interno (EVO-P-000123) o UUID del CFDI de la factura destino. */
  invoiceRef?: string | null;
  amount: number | null;
  date: string | null;
  /** Solo pago. */
  method?: string | null;
  reference?: string | null;
  /** Solo nota de crédito. */
  supplierFolio?: string | null;
  cfdiUuid?: string | null;
  subtotal?: number | null;
  taxTotal?: number | null;
  note?: string | null;
};

export type RowResult = {
  /** 1-based sobre el archivo, contando la cabecera: el número que ve el usuario. */
  line: number;
  ok: boolean;
  /** Folio del documento creado, cuando salió bien. */
  reference?: string;
  /** Por qué se rechazó. Se enseña tal cual: es lo que hay que ir a corregir. */
  reason?: string;
  /** Resumen legible de la fila, para localizarla en el archivo. */
  label: string;
};

export type ImportOutcome = {
  results: RowResult[];
  okCount: number;
  errorCount: number;
  /** Solo al confirmar. En previsualización no hay lote guardado. */
  batchReference?: string;
};

/** Se lanza para revertir la transacción de una previsualización. */
export class PreviewRollback extends Error {
  constructor() {
    super("previsualización: se revierte a propósito");
    this.name = "PreviewRollback";
  }
}

/**
 * Corre `fn` en un savepoint y traduce el rechazo controlado a un resultado.
 *
 * El casting existe porque `DbOrTx` es la unión de la conexión y la
 * transacción, y TypeScript no ve `.transaction` en común aunque ambas la
 * tengan — en Drizzle, sobre una transacción abre un SAVEPOINT, que es
 * justo lo que hace falta aquí.
 */
async function enSavepoint(
  tx: DbOrTx,
  label: string,
  fn: (sp: DbOrTx) => Promise<Omit<RowResult, "line">>,
): Promise<Omit<RowResult, "line">> {
  const conTx = tx as {
    transaction: <T>(f: (t: DbOrTx) => Promise<T>) => Promise<T>;
  };
  try {
    return await conTx.transaction(fn);
  } catch (e) {
    if (e instanceof RowRejected) return { ok: false, reason: e.message, label };
    throw e;
  }
}

/* ------------------------- resolución de proveedor ------------------------- */

type SupplierHit = { id: string; name: string };

/**
 * Encuentra al proveedor por RFC y, si no, por nombre normalizado.
 *
 * NUNCA lo crea. Un proveedor nacido de un typo en un archivo de cien filas
 * ensucia el estado de cuenta de forma que cuesta mucho más deshacer que
 * rechazar la fila y pedir que se dé de alta a mano.
 */
async function resolveSupplier(
  tx: DbOrTx,
  cache: Map<string, SupplierHit | null>,
  rfc?: string | null,
  name?: string | null,
): Promise<SupplierHit | { error: string }> {
  const rfcKey = rfc?.trim().toUpperCase() || "";
  const nameKey = normName(name ?? "");

  const cacheKey = rfcKey ? `rfc:${rfcKey}` : `name:${nameKey}`;
  if (cache.has(cacheKey)) {
    const hit = cache.get(cacheKey)!;
    return hit ?? { error: descripcionFaltante(rfcKey, name) };
  }

  if (rfcKey) {
    const rows = (await tx.execute(sql`
      select id, name from suppliers
       where upper(rfc) = ${rfcKey} limit 2`)) as unknown as SupplierHit[];
    if (rows.length === 1) {
      cache.set(cacheKey, rows[0]);
      return rows[0];
    }
    if (rows.length > 1) {
      return { error: `Hay más de un proveedor con el RFC ${rfcKey}.` };
    }
  }

  if (nameKey) {
    // Misma normalización que `normName`, hecha del lado de Postgres para que
    // «S.A. de C.V.» y «SA DE CV» caigan en la misma llave. Se usa `translate`
    // y no `unaccent()` para no depender de una extensión que el esquema del
    // inquilino no tiene por qué tener instalada.
    const rows = (await tx.execute(sql`
      select id, name from suppliers
       where btrim(regexp_replace(
               regexp_replace(
                 translate(upper(name),
                   'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                   'AAAAAEEEEIIIIOOOOOUUUUNC'),
                 '[^A-Z0-9 ]', ' ', 'g'),
               '\\s+', ' ', 'g')) = ${nameKey}
       limit 2`)) as unknown as SupplierHit[];
    if (rows.length === 1) {
      cache.set(cacheKey, rows[0]);
      return rows[0];
    }
    if (rows.length > 1) {
      return { error: `Hay más de un proveedor llamado «${name}».` };
    }
  }

  cache.set(cacheKey, null);
  return { error: descripcionFaltante(rfcKey, name) };
}

function descripcionFaltante(rfc: string, name?: string | null): string {
  const quien = rfc || name?.trim() || "(sin RFC ni nombre)";
  return `No existe el proveedor ${quien}. Dalo de alta antes de importar.`;
}

/** Busca la factura destino de un abono, por folio interno o por UUID. */
async function resolveInvoice(
  tx: DbOrTx,
  ref: string,
): Promise<{ id: string; reference: string } | { error: string }> {
  const v = ref.trim();
  const rows = (await tx.execute(sql`
    select id, reference from supplier_invoices
     where reference = ${v} or cfdi_uuid = ${v.toUpperCase()}
     limit 2`)) as unknown as Array<{ id: string; reference: string }>;
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { error: `«${v}» apunta a más de una factura.` };
  return { error: `No se encontró la factura «${v}».` };
}

const METODOS: Record<string, "transfer" | "cash" | "check" | "card" | "other"> = {
  transferencia: "transfer",
  transfer: "transfer",
  efectivo: "cash",
  cash: "cash",
  cheque: "check",
  check: "check",
  tarjeta: "card",
  card: "card",
  otro: "other",
  other: "other",
};

/* ------------------------------- el motor ------------------------------- */

export type ImportInput =
  | { kind: "charges_csv" | "charges_cfdi"; rows: ChargeRow[] }
  | { kind: "credits_csv"; rows: CreditRow[] };

/**
 * Corre el lote. El llamador decide si confirma o revierte.
 *
 * Devuelve una fila de resultado por fila de entrada, en el mismo orden: la
 * pantalla las enseña junto al archivo y quien corrige necesita el número de
 * línea, no un total.
 */
export async function runImportBatch(
  tx: DbOrTx,
  input: ImportInput & {
    fileName: string;
    actorId?: string | null;
    persist: boolean;
    /**
     * Prefijo de folio explícito. Sin él se deduce del inquilino de la
     * petición, y entonces el motor solo funciona dentro de una: ni desde un
     * script, ni desde un proceso programado que lea un buzón de CFDI.
     */
    folioPrefix?: string;
  },
): Promise<ImportOutcome> {
  const cache = new Map<string, SupplierHit | null>();
  const results: RowResult[] = [];

  for (let i = 0; i < input.rows.length; i++) {
    // +2: la cabecera ocupa la línea 1 y el índice arranca en 0.
    const line = i + 2;
    const row = input.rows[i];
    try {
      const r =
        input.kind === "credits_csv"
          ? await procesarAbono(tx, cache, row as CreditRow, input.actorId, input.folioPrefix)
          : await procesarCargo(tx, cache, row as ChargeRow, input.actorId, input.folioPrefix);
      results.push({ line, ...r });
    } catch (e) {
      // Un error de base de datos en una fila no debe llevarse el lote. El
      // savepoint de `procesarX` ya revirtió lo suyo.
      console.error(`[importar] línea ${line}:`, e);
      results.push({
        line,
        ok: false,
        reason: "Error inesperado al procesar la fila.",
        label: etiquetaDe(row),
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const errorCount = results.length - okCount;

  let batchReference: string | undefined;
  if (input.persist) {
    batchReference = await nextPayableImportReference(tx, input.folioPrefix);
    const [batch] = await tx
      .insert(payableImports)
      .values({
        reference: batchReference,
        kind: input.kind as PayableImportKind,
        fileName: input.fileName.slice(0, 255),
        rowCount: results.length,
        okCount,
        errorCount,
        createdById: input.actorId ?? null,
      })
      .returning({ id: payableImports.id });

    await recordEvent(tx, {
      aggregateType: "payable_import",
      aggregateId: batch.id,
      eventType: "payable_import.committed",
      actorId: input.actorId ?? null,
      payload: {
        reference: batchReference,
        tipo: input.kind,
        archivo: input.fileName,
        filas: results.length,
        aceptadas: okCount,
        rechazadas: errorCount,
      },
    });
  }

  return { results, okCount, errorCount, batchReference };
}

function etiquetaDe(row: ChargeRow | CreditRow): string {
  const nombre = row.supplierName?.trim() || row.supplierRfc?.trim() || "—";
  if ("invoiceRef" in row) return `${nombre} · ${row.invoiceRef ?? "sin factura"}`;
  return `${nombre} · ${row.supplierFolio ?? "sin folio"}`;
}

/** Un cargo: alta de la factura del proveedor. */
async function procesarCargo(
  tx: DbOrTx,
  cache: Map<string, SupplierHit | null>,
  row: ChargeRow,
  actorId?: string | null,
  folioPrefix?: string,
): Promise<Omit<RowResult, "line">> {
  const label = etiquetaDe(row);

  if (row.total === null) return { ok: false, reason: "Falta el total.", label };
  if (!row.issuedAt) {
    return { ok: false, reason: "Falta la fecha de emisión o no se entiende.", label };
  }

  const supplier = await resolveSupplier(tx, cache, row.supplierRfc, row.supplierName);
  if ("error" in supplier) return { ok: false, reason: supplier.error, label };

  // Subtotal ausente: se asume que el total no lleva impuestos desglosados. No
  // se inventa un IVA — el dominio comprueba que subtotal + impuestos cuadre
  // con el total, y adivinarlo aquí haría pasar por buena una captura mala.
  const subtotal = row.subtotal ?? row.total - (row.taxTotal ?? 0);
  const taxTotal = row.taxTotal ?? 0;

  return enSavepoint(tx, label, async (sp) => {
    const res = await registerSupplierInvoice(sp, {
      supplierId: supplier.id,
      supplierFolio: row.supplierFolio ?? null,
      cfdiUuid: row.cfdiUuid ?? null,
      currency: row.currency ?? "MXN",
      subtotal,
      taxTotal,
      total: row.total!,
      issuedAt: row.issuedAt!,
      dueAt: row.dueAt ?? null,
      notes: row.notes ?? null,
      actorId,
      folioPrefix,
    });
    if (!res.ok) throw new RowRejected(res.reason);
    return { ok: true, reference: res.reference, label };
  });
}

/** Un abono: pago o nota de crédito. */
async function procesarAbono(
  tx: DbOrTx,
  cache: Map<string, SupplierHit | null>,
  row: CreditRow,
  actorId?: string | null,
  folioPrefix?: string,
): Promise<Omit<RowResult, "line">> {
  const label = etiquetaDe(row);

  if (row.amount === null || row.amount <= 0) {
    return { ok: false, reason: "Falta el importe o no es mayor que cero.", label };
  }
  if (!row.date) {
    return { ok: false, reason: "Falta la fecha o no se entiende.", label };
  }

  return enSavepoint(tx, label, async (sp) => {
    {
      if (row.kind === "payment") {
        if (!row.invoiceRef?.trim()) {
          throw new RowRejected("Un pago necesita la factura a la que se aplica.");
        }
        const inv = await resolveInvoice(sp, row.invoiceRef);
        if ("error" in inv) throw new RowRejected(inv.error);

        const metodo = METODOS[(row.method ?? "").trim().toLowerCase()] ?? "transfer";
        const res = await paySupplierInvoice(sp, {
          invoiceId: inv.id,
          amount: row.amount!,
          method: metodo,
          reference: row.reference ?? null,
          paidAt: row.date!,
          note: row.note ?? null,
          actorId,
        });
        if (!res.ok) throw new RowRejected(res.reason);
        return { ok: true, reference: inv.reference, label };
      }

      // Nota de crédito. Se da de alta y, si la fila dice a qué factura va, se
      // aplica en el mismo paso: quien importa un corte ya sabe contra qué va.
      // Sin factura queda como saldo a favor, que es un estado válido.
      const supplier = await resolveSupplier(sp, cache, row.supplierRfc, row.supplierName);
      if ("error" in supplier) throw new RowRejected(supplier.error);

      const subtotal = row.subtotal ?? row.amount! - (row.taxTotal ?? 0);
      const nota = await registerCreditNote(sp, {
        supplierId: supplier.id,
        supplierFolio: row.supplierFolio ?? null,
        cfdiUuid: row.cfdiUuid ?? null,
        subtotal,
        taxTotal: row.taxTotal ?? 0,
        total: row.amount!,
        issuedAt: row.date!,
        notes: row.note ?? null,
        actorId,
        folioPrefix,
      });
      if (!nota.ok) throw new RowRejected(nota.reason);

      if (row.invoiceRef?.trim()) {
        const inv = await resolveInvoice(sp, row.invoiceRef);
        if ("error" in inv) throw new RowRejected(inv.error);
        const aplic = await applyCreditNote(sp, {
          creditNoteId: nota.creditNoteId,
          invoiceId: inv.id,
          amount: row.amount!,
          appliedAt: row.date!,
          note: row.note ?? null,
          actorId,
        });
        if (!aplic.ok) throw new RowRejected(aplic.reason);
      }

      return { ok: true, reference: nota.reference, label };
    }
  });
}

/**
 * Rechazo controlado de una fila.
 *
 * Se lanza en vez de devolverse porque el savepoint tiene que revertirse: una
 * nota de crédito que se creó y cuya aplicación falló no puede quedarse
 * suelta, o el proveedor acaba con saldo a favor de un documento que nadie pidió.
 */
class RowRejected extends Error {}
