import { config } from "dotenv";
config({ path: ".env.local" });

const SCHEMA = "tenant_evoelution";

/**
 * Marca única de esta corrida.
 *
 * Los identificadores eran fijos (`PROBE-001`), así que una corrida que dejara
 * residuo hacía imposible la siguiente: chocaba contra el índice único de
 * `part_number` antes de empezar. Peor todavía, el residuo se puede volver
 * imborrable — basta que alguien levante una orden de compra contra esa
 * refacción de prueba desde la interfaz para que la FK `restrict` la ancle,
 * que es exactamente lo que debe hacer con el historial de compras.
 */
const TAG = `PROBE-${Date.now().toString(36).slice(-6).toUpperCase()}`;

const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { receivePurchaseOrder, sendPurchaseOrder, cancelPurchaseOrder, incomingByPart } =
  await import("./src/lib/domain/purchasing.ts");
const { spareParts, purchaseOrders, purchaseOrderLines, suppliers, inventoryMovements } =
  await import("./src/lib/db/schema.ts");
const { eq, sql } = await import("drizzle-orm");

const db = tenantDbFor(SCHEMA);

const ok = (label: string, cond: boolean, extra = "") =>
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);

// ---- montaje ----
const [sup] = await db.insert(suppliers).values({
  name: `${TAG} Proveedor`, currency: "MXN", paymentTermsDays: 30,
}).returning();

const [p1] = await db.insert(spareParts).values({
  partNumber: `${TAG}-001`, description: "Sello de prueba", stock: 0, costMxn: "100.00",
}).returning();
const [p2] = await db.insert(spareParts).values({
  partNumber: `${TAG}-002`, description: "Filtro de prueba", stock: -3, costMxn: "50.00",
}).returning();

const [order] = await db.insert(purchaseOrders).values({
  reference: `${TAG}-C`, supplierId: sup.id, currency: "MXN",
  expectedAt: "2026-01-01",
}).returning();

const [l1] = await db.insert(purchaseOrderLines).values({
  orderId: order.id, partId: p1.id, partNumber: p1.partNumber,
  description: p1.description, quantity: 10, unitCostMxn: "100.00",
}).returning();
const [l2] = await db.insert(purchaseOrderLines).values({
  orderId: order.id, partId: p2.id, partNumber: p2.partNumber,
  description: p2.description, quantity: 5, unitCostMxn: "50.00",
}).returning();

let fallo: Error | null = null;

try {
  // ---- 1. no se recibe un borrador ----
  let r = await db.transaction((tx) =>
    receivePurchaseOrder(tx, { orderId: order.id, lines: [{ lineId: l1.id, quantity: 1 }] }));
  ok("borrador rechaza recepción", !r.ok, r.ok ? "" : r.reason);

  // ---- 2. enviar ----
  const s = await db.transaction((tx) => sendPurchaseOrder(tx, { orderId: order.id }));
  ok("orden enviada", s.ok, s.reason ?? "");

  // ---- 3. recibir de más ----
  r = await db.transaction((tx) =>
    receivePurchaseOrder(tx, { orderId: order.id, lines: [{ lineId: l1.id, quantity: 11 }] }));
  ok("rechaza recibir más de lo pedido", !r.ok, r.ok ? "" : r.reason.slice(0, 60) + "…");

  // ---- 4. recepción parcial ----
  r = await db.transaction((tx) =>
    receivePurchaseOrder(tx, { orderId: order.id, lines: [{ lineId: l1.id, quantity: 4 }] }));
  ok("recepción parcial", r.ok && r.status === "partial", r.ok ? `estado=${r.status}` : r.reason);

  let [sp1] = await db.select().from(spareParts).where(eq(spareParts.id, p1.id));
  ok("stock subió a 4", sp1.stock === 4, `stock=${sp1.stock}`);

  const [mv] = await db.select().from(inventoryMovements)
    .where(eq(inventoryMovements.purchaseOrderLineId, l1.id));
  ok("el movimiento ES la recepción", !!mv && mv.kind === "purchase" && mv.quantity === 4,
     `kind=${mv?.kind} qty=${mv?.quantity} saldo=${mv?.balanceAfter} costo=${mv?.unitCostMxn}`);

  // ---- 5. pendientes cruzando con inventario ----
  const inc = await incomingByPart(db);
  ok("pendiente por refacción", inc.get(p1.id)?.quantity === 6 && inc.get(p2.id)?.quantity === 5,
     `p1=${inc.get(p1.id)?.quantity} p2=${inc.get(p2.id)?.quantity} llega=${inc.get(p1.id)?.expectedAt}`);

  // ---- 6. completar ----
  r = await db.transaction((tx) =>
    receivePurchaseOrder(tx, { orderId: order.id,
      lines: [{ lineId: l1.id, quantity: 6 }, { lineId: l2.id, quantity: 5 }] }));
  ok("recepción completa", r.ok && r.status === "received", r.ok ? `estado=${r.status}` : r.reason);

  [sp1] = await db.select().from(spareParts).where(eq(spareParts.id, p1.id));
  const [sp2] = await db.select().from(spareParts).where(eq(spareParts.id, p2.id));
  ok("stocks finales 10 y 2", sp1.stock === 10 && sp2.stock === 2,
     `p1=${sp1.stock} p2=${sp2.stock} (p2 arrancó en -3)`);

  // ---- 7. no se cancela lo ya recibido ----
  const c = await db.transaction((tx) =>
    cancelPurchaseOrder(tx, { orderId: order.id, reason: "prueba" }));
  ok("no cancela una orden recibida", !c.ok, c.reason ?? "");

  // ---- 8. eventos ----
  const ev = await db.execute(sql`
    select event_type from domain_events
     where aggregate_id = ${order.id}::uuid order by occurred_at`);
  const types = (ev as unknown as Array<{event_type: string}>).map((e) => e.event_type);
  ok("eventos registrados", types.length === 3, types.join(", "));
} catch (e) {
  // Sin esto el probe mentía: `process.exit(0)` en el `finally` corta el proceso
  // ANTES de que la excepción llegue a ningún lado, así que una comprobación
  // que reventaba simplemente no aparecía en la salida y el resto de los ✓
  // hacían parecer que todo estaba bien.
  fallo = e as Error;
} finally {
  // ---- limpieza ----
  //
  // La bitácora NO se toca. `domain_events` es append-only —un trigger rechaza
  // UPDATE y DELETE— y esa es justamente su razón de ser: los eventos de esta
  // corrida ocurrieron de verdad. Intentar borrarlos reventaba aquí y dejaba
  // sin ejecutar todo lo que venía después, así que cada corrida abandonaba su
  // proveedor, sus refacciones y su orden; la siguiente chocaba contra el
  // índice único de `part_number` y ni siquiera llegaba a empezar.
  //
  // Se borra por el patrón de ESTA corrida y no por los ids capturados: si el
  // montaje falla a la mitad, los ids de lo que sí alcanzó a crearse no están
  // en ninguna variable. Los renglones se van con la orden, por cascade.
  const mio = `${TAG}%`;
  await db.delete(inventoryMovements).where(
    sql`part_id in (select id from spare_parts where part_number like ${mio})`,
  );
  await db.delete(purchaseOrders).where(sql`reference like ${mio}`);
  await db.delete(spareParts).where(sql`part_number like ${mio}`);
  await db.delete(suppliers).where(sql`name like ${mio}`);
  console.log("— limpieza hecha");
  if (fallo) {
    console.error(`\n✗ el probe se interrumpió: ${fallo.message}`);
    console.error(fallo.stack);
    process.exit(1);
  }
  process.exit(0);
}
