import { parseCsv, parseCsvDate, parseCsvMoney, normName } from "@/lib/import/csv";
import type { ChargeRow, CreditRow } from "@/lib/domain/payable-import";

/**
 * De un CSV a las filas que entiende el motor de importación.
 *
 * Las cabeceras se buscan sin acentos, sin mayúsculas y aceptando varios
 * nombres para lo mismo. No es cortesía: el archivo lo exporta el ERP del
 * proveedor o lo arma un contador en Excel, y rechazar un lote de cien filas
 * porque la columna dice «Emisión» en vez de «emision» es la clase de fricción
 * que hace que la gente vuelva a capturar a mano.
 *
 * Lo que NO se es flexible es con el contenido: un importe que no se entiende
 * llega como `null` y el motor rechaza la fila diciendo cuál es. Adivinar ahí
 * sería inventar deuda.
 */

/** Busca una columna por cualquiera de sus nombres aceptados. */
function col(rec: Record<string, string>, ...names: string[]): string | null {
  for (const n of names) {
    const objetivo = normName(n);
    for (const [k, v] of Object.entries(rec)) {
      if (normName(k) === objetivo) return v.trim() || null;
    }
  }
  return null;
}

/* --------------------------------- cargos --------------------------------- */

export const PLANTILLA_CARGOS = [
  "rfc,proveedor,folio,uuid,moneda,subtotal,impuestos,total,emision,vencimiento,notas",
  'AAA010101AAA,Refacciones del Norte SA de CV,A-4471,,MXN,10000.00,1600.00,11600.00,2026-03-14,2026-04-13,',
  'BBB020202BB2,Instrumentos Analíticos SA,F-902,,USD,1200.00,0.00,1200.00,2026-03-20,,factura en dólares',
].join("\n");

export function leerCargosCsv(text: string): { rows: ChargeRow[]; error?: string } {
  const recs = parseCsv(text);
  if (!recs.length) return { rows: [], error: "El archivo no tiene filas." };

  const rows = recs.map((r): ChargeRow => {
    const total = parseCsvMoney(col(r, "total") ?? "");
    const subtotal = parseCsvMoney(col(r, "subtotal") ?? "");
    const impuestos = parseCsvMoney(col(r, "impuestos", "iva", "traslados") ?? "");
    return {
      supplierRfc: col(r, "rfc", "rfc proveedor", "rfc emisor"),
      supplierName: col(r, "proveedor", "nombre", "razon social", "emisor"),
      supplierFolio: col(r, "folio", "folio proveedor", "serie folio"),
      cfdiUuid: col(r, "uuid", "uuid cfdi", "folio fiscal")?.toUpperCase() ?? null,
      currency: col(r, "moneda", "divisa") ?? "MXN",
      subtotal,
      taxTotal: impuestos,
      total,
      issuedAt: parseCsvDate(col(r, "emision", "fecha emision", "fecha") ?? ""),
      dueAt: parseCsvDate(col(r, "vencimiento", "fecha vencimiento") ?? ""),
      notes: col(r, "notas", "observaciones", "concepto"),
    };
  });

  return { rows };
}

/* --------------------------------- abonos --------------------------------- */

export const PLANTILLA_ABONOS = [
  "tipo,rfc,proveedor,factura,importe,fecha,metodo,referencia,folio,uuid,subtotal,impuestos,nota",
  "pago,AAA010101AAA,Refacciones del Norte SA de CV,EVO-P-000123,5000.00,2026-04-02,transferencia,SPEI 8842,,,,,",
  "nota_credito,AAA010101AAA,Refacciones del Norte SA de CV,EVO-P-000123,1500.00,2026-04-05,,,NC-77,,1293.10,206.90,devolución de dos sellos",
].join("\n");

/**
 * `tipo` decide si el abono es dinero o bonificación, y es la única columna sin
 * la que no se puede seguir: registrar una nota de crédito como pago infla el
 * reporte de salidas de caja, y al revés esconde una salida real.
 */
function leerTipo(v: string | null): "payment" | "credit_note" | null {
  const t = normName(v ?? "");
  if (!t) return null;
  if (["PAGO", "PAYMENT", "ABONO"].includes(t)) return "payment";
  if (
    ["NOTA CREDITO", "NOTA DE CREDITO", "NOTA_CREDITO", "NC", "CREDIT NOTE"].includes(t)
  ) {
    return "credit_note";
  }
  return null;
}

export function leerAbonosCsv(text: string): { rows: CreditRow[]; error?: string } {
  const recs = parseCsv(text);
  if (!recs.length) return { rows: [], error: "El archivo no tiene filas." };

  const rows = recs.map((r): CreditRow => {
    const tipo = leerTipo(col(r, "tipo", "clase", "documento"));
    return {
      // Un tipo ilegible entra como pago SIN factura, y el motor lo rechaza
      // pidiendo la factura. Es preferible a adivinar: nunca crea una nota de
      // crédito que nadie pidió.
      kind: tipo ?? "payment",
      supplierRfc: col(r, "rfc", "rfc proveedor"),
      supplierName: col(r, "proveedor", "nombre", "razon social"),
      invoiceRef: col(r, "factura", "folio factura", "referencia factura"),
      amount: parseCsvMoney(col(r, "importe", "monto", "total") ?? ""),
      date: parseCsvDate(col(r, "fecha", "fecha pago", "fecha aplicacion") ?? ""),
      method: col(r, "metodo", "forma de pago", "forma pago"),
      reference: col(r, "referencia", "referencia bancaria"),
      supplierFolio: col(r, "folio", "folio proveedor"),
      cfdiUuid: col(r, "uuid", "uuid cfdi", "folio fiscal")?.toUpperCase() ?? null,
      subtotal: parseCsvMoney(col(r, "subtotal") ?? ""),
      taxTotal: parseCsvMoney(col(r, "impuestos", "iva") ?? ""),
      note: col(r, "nota", "notas", "concepto", "observaciones"),
    };
  });

  return { rows };
}
