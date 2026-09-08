/**
 * Ciclo de vida de una factura de proveedor.
 *
 * Lo que se comprueba es dinero: que el saldo salga del ledger y no de un campo
 * que alguien pueda dejar mal, que no se pague de más, que un CFDI no entre dos
 * veces y que una factura con pagos no se pueda hacer desaparecer.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-payables.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCHEMA = "tenant_evoelution";
const PREFIJO = "PRB";
const TAG = `PROBE-${Date.now().toString(36).slice(-6).toUpperCase()}`;

const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const {
  registerSupplierInvoice,
  paySupplierInvoice,
  cancelSupplierInvoice,
  totalPagado,
  sumarDias,
} = await import("./src/lib/domain/payables.ts");
const { payablesSummaryFrom } = await import("./src/lib/data/payables.ts");
const { suppliers, purchaseOrders, supplierInvoices, supplierPayments } =
  await import("./src/lib/db/schema.ts");
const { eq, sql } = await import("drizzle-orm");

const db = tenantDbFor(SCHEMA);

const ok = (label: string, cond: boolean, extra = "") =>
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);

// ---- montaje: un proveedor a 30 días y dos órdenes suyas ----
const [prov] = await db
  .insert(suppliers)
  .values({ name: `${TAG} Proveedor`, currency: "MXN", paymentTermsDays: 30 })
  .returning();

const [otro] = await db
  .insert(suppliers)
  .values({ name: `${TAG} Otro`, currency: "MXN", paymentTermsDays: 15 })
  .returning();

const [orden] = await db
  .insert(purchaseOrders)
  .values({ reference: `${TAG}-C1`, supplierId: prov.id, currency: "MXN", status: "received" })
  .returning();

const [ordenAjena] = await db
  .insert(purchaseOrders)
  .values({ reference: `${TAG}-C2`, supplierId: otro.id, currency: "MXN", status: "received" })
  .returning();

let fallo: Error | null = null;
const base = { actorId: null, folioPrefix: PREFIJO };

try {
  // ---- 1. el total tiene que cuadrar con subtotal + impuestos ----
  let r = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, subtotal: 1000, taxTotal: 160, total: 1500,
      issuedAt: "2026-08-01",
    }));
  ok("rechaza una factura que no cuadra", !r.ok, r.ok ? "" : r.reason.slice(0, 58) + "…");

  // ---- 2. no ampara órdenes de otro proveedor ----
  r = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, subtotal: 1000, taxTotal: 160, total: 1160,
      issuedAt: "2026-08-01", orderIds: [ordenAjena.id],
    }));
  ok("rechaza amparar la orden de otro proveedor", !r.ok, r.ok ? "" : r.reason.slice(0, 52) + "…");

  // ---- 3. captura buena: el vencimiento sale de los días de crédito ----
  r = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, supplierFolio: "A-4471",
      cfdiUuid: `${TAG}-CFDI`, subtotal: 1000, taxTotal: 160, total: 1160,
      issuedAt: "2026-08-01", orderIds: [orden.id],
    }));
  ok("factura capturada", r.ok, r.ok ? `${r.reference}, vence ${r.dueAt}` : r.reason);
  if (!r.ok) throw new Error("sin factura no hay nada que probar");
  const facturaId = r.invoiceId;

  ok(
    "el vencimiento son los 30 días del proveedor",
    r.dueAt === sumarDias("2026-08-01", 30),
    `emitida 2026-08-01 → vence ${r.dueAt}`,
  );

  // ---- 4. el mismo CFDI no entra dos veces ----
  const dup = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, cfdiUuid: `${TAG}-CFDI`,
      subtotal: 1000, taxTotal: 160, total: 1160, issuedAt: "2026-08-01",
    }));
  ok("el mismo CFDI no se captura dos veces", !dup.ok, dup.ok ? "" : dup.reason);

  // ---- 5. no se paga de más ----
  let p = await db.transaction((tx) =>
    paySupplierInvoice(tx, { invoiceId: facturaId, amount: 2000, paidAt: "2026-08-10" }));
  ok("rechaza pagar más que el saldo", !p.ok, p.ok ? "" : p.reason.slice(0, 58) + "…");

  // ---- 6. pago parcial ----
  p = await db.transaction((tx) =>
    paySupplierInvoice(tx, {
      invoiceId: facturaId, amount: 700, paidAt: "2026-08-10",
      method: "transfer", reference: "SPEI-99",
    }));
  ok("pago parcial", p.ok && p.status === "partial",
     p.ok ? `saldo ${p.balanceAfter.toFixed(2)}` : p.reason);

  // ---- 7. una factura con pagos no se cancela ----
  const c = await db.transaction((tx) =>
    cancelSupplierInvoice(tx, { invoiceId: facturaId, reason: "prueba" }));
  ok("no cancela una factura con pagos", !c.ok, c.ok ? "" : c.reason.slice(0, 58) + "…");

  // ---- 8. saldar ----
  p = await db.transaction((tx) =>
    paySupplierInvoice(tx, { invoiceId: facturaId, amount: 460, paidAt: "2026-08-25" }));
  ok("saldada con el segundo pago", p.ok && p.status === "paid",
     p.ok ? `saldo ${p.balanceAfter.toFixed(2)}` : p.reason);

  // ---- 9. saldada no admite más pagos ----
  p = await db.transaction((tx) =>
    paySupplierInvoice(tx, { invoiceId: facturaId, amount: 1, paidAt: "2026-08-26" }));
  ok("una factura saldada no admite más pagos", !p.ok, p.ok ? "" : p.reason);

  // ---- 10. el ledger cuadra con la factura ----
  const pagado = await totalPagado(db, facturaId);
  const [f] = await db
    .select({ total: supplierInvoices.total, status: supplierInvoices.status })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, facturaId));
  ok(
    "lo pagado suma exactamente el total",
    Math.abs(pagado - Number(f.total)) < 0.01 && f.status === "paid",
    `pagado ${pagado.toFixed(2)} de ${Number(f.total).toFixed(2)}, estado ${f.status}`,
  );

  // ---- 11. el saldo de cada fila del ledger es el que quedaba ----
  const pagos = await db
    .select({ amount: supplierPayments.amount, balanceAfter: supplierPayments.balanceAfter })
    .from(supplierPayments)
    .where(eq(supplierPayments.invoiceId, facturaId))
    .orderBy(supplierPayments.occurredAt);
  let restante = Number(f.total);
  const coherente = pagos.every((pg) => {
    restante -= Number(pg.amount);
    return Math.abs(restante - Number(pg.balanceAfter)) < 0.01;
  });
  ok("cada pago dejó registrado el saldo correcto", coherente,
     pagos.map((pg) => `${Number(pg.amount)}→${Number(pg.balanceAfter)}`).join("  "));

  // ---- 12. una factura sin pagos sí se cancela ----
  const limpia = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, subtotal: 100, taxTotal: 16, total: 116,
      issuedAt: "2026-08-05",
    }));
  const c2 = limpia.ok
    ? await db.transaction((tx) =>
        cancelSupplierInvoice(tx, { invoiceId: limpia.invoiceId, reason: "capturada por error" }))
    : { ok: false, reason: "no se pudo crear" };
  ok("una factura sin pagos sí se cancela", c2.ok, c2.ok ? "" : c2.reason ?? "");

  // ---- 13. cancelada no admite pagos ----
  const p2 = limpia.ok
    ? await db.transaction((tx) =>
        paySupplierInvoice(tx, { invoiceId: limpia.invoiceId, amount: 10, paidAt: "2026-08-26" }))
    : { ok: false as const, reason: "" };
  ok("una factura cancelada no admite pagos", !p2.ok, p2.ok ? "" : p2.reason);

  // ---- 14. el resumen de vencimientos ----
  //
  // Es SQL crudo, así que nada más lo revisa. Se monta una factura vencida y
  // otra que vence dentro de la semana, y se comprueba que caigan en el balde
  // que les toca — es lo que decide qué se ve como problema en la pantalla.
  const hoy = new Date().toISOString().slice(0, 10);
  // El resumen viene SEPARADO POR MONEDA desde que existen facturas en USD, así
  // que la comprobación tiene que bajar al balde de la divisa en que se emiten
  // estas pruebas. Leer el objeto de arriba devolvía `undefined` en cada campo
  // y las tres restas daban NaN: tres asertos que ya no podían fallar nunca.
  const bucket = (r: Awaited<ReturnType<typeof payablesSummaryFrom>>) =>
    r.byCurrency.find((c) => c.currency === "MXN") ??
    { balance: 0, count: 0, overdue: 0, overdueCount: 0, dueSoon: 0, dueSoonCount: 0 };

  const antes = bucket(await db.transaction((tx) => payablesSummaryFrom(tx)));

  const vencida = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, subtotal: 500, taxTotal: 0, total: 500,
      issuedAt: "2026-01-01", dueAt: "2026-01-31",
    }));
  const proxima = await db.transaction((tx) =>
    registerSupplierInvoice(tx, {
      ...base, supplierId: prov.id, subtotal: 300, taxTotal: 0, total: 300,
      issuedAt: hoy, dueAt: sumarDias(hoy, 3)!,
    }));

  const despues = bucket(await db.transaction((tx) => payablesSummaryFrom(tx)));
  ok(
    "el resumen cuenta la vencida como vencida",
    despues.overdue - antes.overdue === 500 &&
      despues.overdueCount - antes.overdueCount === 1,
    `vencido +${(despues.overdue - antes.overdue).toFixed(2)}`,
  );
  ok(
    "y la que vence en 3 días como por vencer",
    despues.dueSoon - antes.dueSoon === 300 &&
      despues.dueSoonCount - antes.dueSoonCount === 1,
    `por vencer +${(despues.dueSoon - antes.dueSoon).toFixed(2)}`,
  );
  ok(
    "el saldo total suma las dos",
    despues.balance - antes.balance === 800,
    `saldo +${(despues.balance - antes.balance).toFixed(2)}`,
  );
  void vencida;
  void proxima;
} catch (e) {
  fallo = e as Error;
} finally {
  // La bitácora no se toca: es append-only y estos eventos ocurrieron.
  const mio = `${TAG}%`;
  await db.execute(sql`
    delete from supplier_payments where invoice_id in (
      select id from supplier_invoices where supplier_id in (
        select id from suppliers where name like ${mio}))`);
  await db.execute(sql`
    delete from supplier_invoices where supplier_id in (
      select id from suppliers where name like ${mio})`);
  await db.delete(purchaseOrders).where(sql`reference like ${mio}`);
  await db.delete(suppliers).where(sql`name like ${mio}`);
  console.log("— limpieza hecha");
  if (fallo) {
    console.error(`\n✗ el probe se interrumpió: ${fallo.message}`);
    console.error(fallo.stack);
    process.exit(1);
  }
  process.exit(0);
}
