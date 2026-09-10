/**
 * Los dos arreglos de esta tanda que tocan dinero:
 *
 *  1. Quitar una aplicación de nota de crédito o una imputación de anticipo.
 *     Antes no existía y tres mensajes de error mandaban a hacerlo.
 *  2. Recibir mercancía con el mismo renglón repetido no puede pasar del
 *     pendiente. Antes cada entrada se validaba por separado y entre las dos
 *     metían de más al inventario.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-unapply.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCHEMA = "tenant_evoelution";
const PREFIJO = "PRB";
const TAG = `PROBE-${Date.now().toString(36).slice(-6).toUpperCase()}`;

const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const {
  registerSupplierInvoice,
  registerCreditNote,
  applyCreditNote,
  unapplyCreditNote,
  registerAdvance,
  applyAdvance,
  unapplyAdvance,
  cancelCreditNote,
  totalAplicado,
} = await import("./src/lib/domain/payables.ts");
const { receivePurchaseOrder } = await import("./src/lib/domain/purchasing.ts");
const {
  suppliers, purchaseOrders, purchaseOrderLines, spareParts, supplierInvoices,
} = await import("./src/lib/db/schema.ts");
const { eq, sql } = await import("drizzle-orm");

const db = tenantDbFor(SCHEMA);
/*
  CUENTA los fallos, no solo los imprime.

  Durante meses esto solo hacía `console.log`, y el `process.exit(0)` del final
  corría igual hubiera cruces o no: una comprobación podía ponerse roja en la
  salida y el probe seguía saliendo con éxito, o sea que el CI la daba por
  buena. Se midió inyectando un fallo deliberado — salida 0.
*/
let fallos = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (!cond) fallos++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

const [prov] = await db.insert(suppliers)
  .values({ name: `${TAG} Proveedor`, currency: "MXN", paymentTermsDays: 30 })
  .returning();

let fallo: Error | null = null;
const base = { actorId: null, folioPrefix: PREFIJO };

try {
  /* ============ 1 · quitar una aplicación de nota de crédito ============ */

  const f = await db.transaction((tx) => registerSupplierInvoice(tx, {
    ...base, supplierId: prov.id, subtotal: 1000, taxTotal: 0, total: 1000,
    issuedAt: "2026-08-01", cfdiUuid: `${TAG}-F1`,
  }));
  if (!f.ok) throw new Error(`no se pudo capturar la factura: ${f.reason}`);

  const nc = await db.transaction((tx) => registerCreditNote(tx, {
    ...base, supplierId: prov.id, subtotal: 400, taxTotal: 0, total: 400,
    issuedAt: "2026-08-02", cfdiUuid: `${TAG}-NC1`,
  }));
  if (!nc.ok) throw new Error(`no se pudo capturar la nota: ${nc.reason}`);

  const ap = await db.transaction((tx) => applyCreditNote(tx, {
    creditNoteId: nc.creditNoteId, invoiceId: f.invoiceId,
    amount: 400, appliedAt: "2026-08-03", actorId: null,
  }));
  ok("la nota se aplica", ap.ok, ap.ok ? `saldo ${ap.balanceAfter}` : ap.reason);

  // Antes de arreglarlo, ESTE era el callejón sin salida.
  const noSePuede = await db.transaction((tx) => cancelCreditNote(tx, {
    creditNoteId: nc.creditNoteId, reason: "prueba", actorId: null,
  }));
  ok("con la nota aplicada no se deja cancelar", !noSePuede.ok);

  const [appNota] = (await db.execute(sql`
    select id from supplier_credit_note_applications
     where invoice_id = ${f.invoiceId}::uuid`)) as unknown as Array<{ id: string }>;

  const vacio = await db.transaction((tx) => unapplyCreditNote(tx, {
    applicationId: appNota.id, reason: "  ", actorId: null,
  }));
  ok("exige motivo", !vacio.ok);

  const quitada = await db.transaction((tx) => unapplyCreditNote(tx, {
    applicationId: appNota.id, reason: "iba a otra factura", actorId: null,
  }));
  ok("quita la aplicación", quitada.ok, quitada.ok ? "" : quitada.reason);

  const aplicadoTras = await db.transaction((tx) => totalAplicado(tx, f.invoiceId));
  ok("el saldo vuelve entero a la factura", aplicadoTras === 0, `aplicado ${aplicadoTras}`);

  const [inv] = (await db.execute(sql`
    select status from supplier_invoices where id = ${f.invoiceId}::uuid`)) as unknown as Array<{ status: string }>;
  ok("y la factura vuelve a «pending»", inv.status === "pending", inv.status);

  const [notaTras] = (await db.execute(sql`
    select status from supplier_credit_notes where id = ${nc.creditNoteId}::uuid`)) as unknown as Array<{ status: string }>;
  ok("la nota recupera su saldo a favor", notaTras.status === "open", notaTras.status);

  const ahoraSi = await db.transaction((tx) => cancelCreditNote(tx, {
    creditNoteId: nc.creditNoteId, reason: "capturada por error", actorId: null,
  }));
  ok("y ahora sí se deja cancelar", ahoraSi.ok, ahoraSi.ok ? "" : ahoraSi.reason);

  const [evento] = (await db.execute(sql`
    select payload from domain_events
     where event_type = 'supplier_credit_note.unapplied'
       and aggregate_id = ${nc.creditNoteId}::uuid`)) as unknown as Array<{ payload: Record<string, unknown> }>;
  ok(
    "y el rastro queda en la bitácora con la fila entera",
    Boolean(evento?.payload?.snapshot) && evento.payload.motivo === "iba a otra factura",
  );

  /* ============ 2 · quitar una imputación de anticipo ============ */

  const f2 = await db.transaction((tx) => registerSupplierInvoice(tx, {
    ...base, supplierId: prov.id, subtotal: 500, taxTotal: 0, total: 500,
    issuedAt: "2026-08-05", cfdiUuid: `${TAG}-F2`,
  }));
  if (!f2.ok) throw new Error(`factura 2: ${f2.reason}`);

  const ant = await db.transaction((tx) => registerAdvance(tx, {
    ...base, supplierId: prov.id, amount: 500, paidAt: "2026-08-04",
  }));
  if (!ant.ok) throw new Error(`anticipo: ${ant.reason}`);

  const imp = await db.transaction((tx) => applyAdvance(tx, {
    advanceId: ant.advanceId, invoiceId: f2.invoiceId,
    amount: 500, appliedAt: "2026-08-06", actorId: null,
  }));
  ok("el anticipo se imputa y salda la factura", imp.ok && imp.status === "paid");

  const [appAnt] = (await db.execute(sql`
    select id from supplier_advance_applications
     where invoice_id = ${f2.invoiceId}::uuid`)) as unknown as Array<{ id: string }>;

  const desimputada = await db.transaction((tx) => unapplyAdvance(tx, {
    applicationId: appAnt.id, reason: "iba a otra factura", actorId: null,
  }));
  ok("quita la imputación", desimputada.ok, desimputada.ok ? "" : desimputada.reason);

  const [inv2] = (await db.execute(sql`
    select status from supplier_invoices where id = ${f2.invoiceId}::uuid`)) as unknown as Array<{ status: string }>;
  ok("la factura saldada vuelve a «pending»", inv2.status === "pending", inv2.status);

  const [antTras] = (await db.execute(sql`
    select status from supplier_advances where id = ${ant.advanceId}::uuid`)) as unknown as Array<{ status: string }>;
  ok("y el anticipo vuelve a tener saldo a favor", antTras.status === "open", antTras.status);

  /* ============ 3 · recepción con el renglón repetido ============ */

  const [parte] = await db.insert(spareParts)
    .values({ partNumber: `${TAG}-P1`, description: `${TAG} Refacción`, stock: 0 })
    .returning();

  const [orden] = await db.insert(purchaseOrders)
    .values({ reference: `${TAG}-C1`, supplierId: prov.id, currency: "MXN", status: "sent" })
    .returning();

  const [renglon] = await db.insert(purchaseOrderLines)
    .values({
      orderId: orden.id, partId: parte.id, partNumber: parte.partNumber,
      description: "prueba", quantity: 8, receivedQuantity: 0,
    })
    .returning();

  // EL CASO: dos entradas de 5 para un renglón con 8 pendientes. Antes pasaban
  // las dos —5 ≤ 8, comprobado por separado— y entraban 10 piezas.
  const rec = await db.transaction((tx) => receivePurchaseOrder(tx, {
    orderId: orden.id, actorId: null,
    lines: [
      { lineId: renglon.id, quantity: 5 },
      { lineId: renglon.id, quantity: 5 },
    ],
  }));
  ok("un renglón repetido que suma de más se rechaza", !rec.ok, rec.ok ? "" : rec.reason.slice(0, 60) + "…");

  const [tras] = (await db.execute(sql`
    select stock from spare_parts where id = ${parte.id}::uuid`)) as unknown as Array<{ stock: number }>;
  ok("y el inventario no se movió", Number(tras.stock) === 0, `stock ${tras.stock}`);

  // Y repetido dentro del tope, se suma y entra una sola vez.
  const rec2 = await db.transaction((tx) => receivePurchaseOrder(tx, {
    orderId: orden.id, actorId: null,
    lines: [
      { lineId: renglon.id, quantity: 3 },
      { lineId: renglon.id, quantity: 4 },
    ],
  }));
  ok("repetido dentro del tope, se consolida", rec2.ok && rec2.received === 7,
     rec2.ok ? `${rec2.received} piezas` : rec2.reason);

  const [tras2] = (await db.execute(sql`
    select stock from spare_parts where id = ${parte.id}::uuid`)) as unknown as Array<{ stock: number }>;
  ok("el inventario sube exactamente 7", Number(tras2.stock) === 7, `stock ${tras2.stock}`);

  const [ren] = (await db.execute(sql`
    select received_quantity from purchase_order_lines where id = ${renglon.id}::uuid`)) as unknown as Array<{ received_quantity: number }>;
  ok("y el renglón registra 7 recibidas, no 14", Number(ren.received_quantity) === 7,
     `recibidas ${ren.received_quantity}`);

  void supplierInvoices; void eq;
} catch (e) {
  fallo = e as Error;
} finally {
  const mio = `${TAG}%`;
  await db.execute(sql`delete from supplier_credit_note_applications where credit_note_id in (select id from supplier_credit_notes where supplier_id in (select id from suppliers where name like ${mio}))`);
  await db.execute(sql`delete from supplier_advance_applications where advance_id in (select id from supplier_advances where supplier_id in (select id from suppliers where name like ${mio}))`);
  await db.execute(sql`delete from supplier_credit_notes where supplier_id in (select id from suppliers where name like ${mio})`);
  await db.execute(sql`delete from supplier_advances where supplier_id in (select id from suppliers where name like ${mio})`);
  await db.execute(sql`delete from supplier_invoices where supplier_id in (select id from suppliers where name like ${mio})`);
  await db.execute(sql`delete from inventory_movements where part_id in (select id from spare_parts where part_number like ${mio})`);
  await db.execute(sql`delete from purchase_order_lines where order_id in (select id from purchase_orders where reference like ${mio})`);
  await db.execute(sql`delete from purchase_orders where reference like ${mio}`);
  await db.execute(sql`delete from spare_parts where part_number like ${mio}`);
  await db.execute(sql`delete from suppliers where name like ${mio}`);
  console.log("— limpieza hecha");
  if (fallo) {
    console.error(`\n✗ el probe se interrumpió: ${fallo.message}`);
    console.error(fallo.stack);
    process.exit(1);
  }
  if (fallos) {
    console.error(`\n❌ ${fallos} comprobación(es) fallaron.`);
    process.exit(1);
  }
  process.exit(0);
}
