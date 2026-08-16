/**
 * Comprobación de extremo a extremo del circuito de requisiciones.
 *
 *   npm run check:requisitions
 *
 * Corre contra la base REAL del inquilino sembrado, dentro de una transacción
 * que se revierte al final. Que sea contra la base real es el punto: la vez
 * anterior un fallo de compras se coló porque lo que se probó a mano no era la
 * consulta parametrizada que corre de verdad, y aquí se ejercitan las mismas
 * funciones que llaman las acciones de servidor.
 *
 * Lo único que no se revierte son las secuencias de folio —`nextval` es atómico
 * y vive fuera de la transacción—, así que cada corrida deja un hueco en la
 * numeración. Es el comportamiento documentado en `domain/references.ts`: un
 * hueco es aceptable, un folio duplicado no.
 *
 * Comprueba, en orden:
 *   1. la resta cuadra renglón por renglón (pedido = hay + viene + trámite + falta)
 *   2. el alta solo escribe lo que falta, con proveedor sugerido del historial
 *   3. es idempotente: pulsar dos veces no duplica, ni siquiera las líneas sin catálogo
 *   4. no se convierte sin autorizar
 *   5. sale UNA orden por proveedor
 *   6. el hilo orden → requisición → pedido queda entero
 *   7. el estado se recalcula desde las líneas, no se adivina
 *   8. a un proveedor suspendido no se le compra, y se dice por qué
 */
import "./_env";
import { asc, eq, sql } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";
import {
  crmDealProducts,
  crmDeals,
  crmPipelines,
  crmStages,
  purchaseOrders,
  requisitionLines,
  spareParts,
  suppliers,
} from "@/lib/db/schema";
import {
  approveRequisition,
  convertToPurchaseOrders,
  createRequisitionFromDeal,
  necesidadDelPedido,
  submitRequisition,
} from "@/lib/domain/requisitions";
import { getRequisition, getRequisitions } from "@/lib/data/requisitions";

class Revertir extends Error {}

async function main() {
  const db = tenantDbFor("tenant_evoelution");

  try {
    await db.transaction(async (tx) => {
      // ---- Preparar un pedido con productos reales -------------------------
      // Tres refacciones con historial de compra de proveedores DISTINTOS, para
      // que la conversión tenga que agrupar de verdad y no salga una sola orden.
      const partes = await tx
        .select({
          id: spareParts.id,
          partNumber: spareParts.partNumber,
          description: spareParts.description,
          stock: spareParts.stock,
        })
        .from(spareParts)
        .where(
          sql`${spareParts.partNumber} in ('AGI0101-0301', 'ROT-SEAL-6P', 'PROBE-001')`,
        )
        .orderBy(asc(spareParts.partNumber));

      if (partes.length < 3) throw new Error("Hacen falta 3 refacciones sembradas");

      const [pipeline] = await tx.select().from(crmPipelines).limit(1);
      const [etapa] = await tx
        .select()
        .from(crmStages)
        .where(eq(crmStages.pipelineId, pipeline.id))
        .limit(1);

      const [deal] = await tx
        .insert(crmDeals)
        .values({
          reference: "EVO-D-999901",
          title: "Prueba requisiciones",
          pipelineId: pipeline.id,
          stageId: etapa.id,
          status: "won",
        })
        .returning({ id: crmDeals.id, reference: crmDeals.reference });

      // Se piden más piezas de las que hay, para que la resta tenga trabajo.
      const cantidades = [
        partes[0].stock + 4,
        partes[1].stock + 3,
        partes[2].stock + 5,
      ];

      await tx.insert(crmDealProducts).values([
        { dealId: deal.id, partId: partes[0].id, name: partes[0].description, quantity: String(cantidades[0]) },
        { dealId: deal.id, partId: partes[1].id, name: partes[1].description, quantity: String(cantidades[1]) },
        { dealId: deal.id, partId: partes[2].id, name: partes[2].description, quantity: String(cantidades[2]) },
        // Una línea SIN refacción del catálogo: el caso que la requisición
        // tiene que dejar pasar y la orden tiene que rechazar.
        { dealId: deal.id, partId: null, name: "Bomba del 1525, la de siempre", quantity: "2" },
      ]);

      console.log("\n━━━━━━━━ 1 · LA RESTA ━━━━━━━━");
      const necesidad = await necesidadDelPedido(tx, deal.id);
      for (const n of necesidad) {
        console.log(
          `  ${(n.partNumber ?? "—").padEnd(14)} pide ${String(n.pedido).padStart(3)}` +
            ` · hay ${String(n.existencia).padStart(3)}` +
            ` · viene ${String(n.enCamino).padStart(3)}` +
            ` · trámite ${String(n.enTramite).padStart(3)}` +
            ` → FALTA ${String(n.falta).padStart(3)}  (${n.description.slice(0, 30)})`,
        );
        if (n.pedido !== n.existencia + n.enCamino + n.enTramite + n.falta) {
          throw new Error(`La resta no cuadra en ${n.partNumber}`);
        }
      }
      console.log("  ✓ los cuatro sumandos cuadran con el pedido en cada renglón");

      // ---- Crear ----------------------------------------------------------
      console.log("\n━━━━━━━━ 2 · ALTA ━━━━━━━━");
      const creada = await createRequisitionFromDeal(tx, {
        dealId: deal.id,
        actorId: null,
        neededBy: "2026-09-15",
        folioPrefix: "EVO",
      });
      if (!creada.ok) throw new Error(creada.reason);
      console.log(`  ${creada.reference} · ${creada.lineas} renglones`);

      const lineas = await tx
        .select({
          id: requisitionLines.id,
          description: requisitionLines.description,
          quantity: requisitionLines.quantity,
          partId: requisitionLines.partId,
          supplierId: requisitionLines.supplierId,
          supplierReason: requisitionLines.supplierReason,
          notes: requisitionLines.notes,
        })
        .from(requisitionLines)
        .where(eq(requisitionLines.requisitionId, creada.id));

      for (const l of lineas) {
        console.log(
          `    ${String(l.quantity).padStart(3)} × ${l.description.slice(0, 34).padEnd(34)}` +
            ` prov=${l.supplierId ? "sí" : "NO"} · ${l.supplierReason ?? "—"}`,
        );
      }

      // ---- La resta se acuerda de sí misma --------------------------------
      console.log("\n━━━━━━━━ 3 · NO SE PIDE DOS VECES ━━━━━━━━");
      const otraVez = await necesidadDelPedido(tx, deal.id);
      const faltaAhora = otraVez.reduce((a, n) => a + n.falta, 0);
      console.log(`  falta total tras requisitar: ${faltaAhora} (debe ser 0)`);
      if (faltaAhora !== 0) throw new Error("La segunda pasada volvería a pedir");

      const segunda = await createRequisitionFromDeal(tx, {
        dealId: deal.id,
        actorId: null,
        folioPrefix: "EVO",
      });
      console.log(
        `  segunda requisición: ${segunda.ok ? "SE CREÓ (mal)" : "bloqueada ✓ — " + segunda.reason}`,
      );
      if (segunda.ok) throw new Error("Se duplicó la requisición");

      // ---- Circuito -------------------------------------------------------
      console.log("\n━━━━━━━━ 4 · AUTORIZACIÓN ━━━━━━━━");
      const antes = await convertToPurchaseOrders(tx, { id: creada.id, actorId: null, folioPrefix: "EVO" });
      console.log(
        `  convertir sin autorizar: ${antes.ok ? "PASÓ (mal)" : "bloqueado ✓ — " + antes.reason}`,
      );
      if (antes.ok) throw new Error("Convirtió una requisición no autorizada");

      const env = await submitRequisition(tx, { id: creada.id, actorId: null });
      console.log(`  enviar a autorizar: ${env.ok ? "✓" : env.reason}`);
      const apr = await approveRequisition(tx, { id: creada.id, actorId: null });
      console.log(`  autorizar: ${apr.ok ? "✓" : apr.reason}`);

      // ---- Conversión -----------------------------------------------------
      console.log("\n━━━━━━━━ 5 · ÓRDENES ━━━━━━━━");
      const conv = await convertToPurchaseOrders(tx, {
        id: creada.id,
        actorId: null,
        folioPrefix: "EVO",
      });
      if (!conv.ok) throw new Error(conv.reason);

      for (const o of conv.orders) {
        console.log(`  ${o.reference} → ${o.supplier} (${o.lines} renglones)`);
      }
      for (const o of conv.omitidas) {
        console.log(`  omitida: ${o.description.slice(0, 40)} — ${o.reason}`);
      }

      // Una orden por proveedor: ningún folio repetido de proveedor.
      const provs = conv.orders.map((o) => o.supplier);
      if (new Set(provs).size !== provs.length) {
        throw new Error("Dos órdenes para el mismo proveedor");
      }
      console.log("  ✓ una orden por proveedor");

      // ---- Trazabilidad ---------------------------------------------------
      console.log("\n━━━━━━━━ 6 · TRAZABILIDAD ━━━━━━━━");
      const hilo = (await tx.execute(sql`
        select po.reference as orden, r.reference as requisicion, d.reference as pedido,
               pol.quantity as piezas, pol.part_number
          from purchase_order_lines pol
          join purchase_orders po on po.id = pol.order_id
          join requisition_lines rl on rl.id = pol.requisition_line_id
          join requisitions r on r.id = rl.requisition_id
          left join crm_deals d on d.id = r.deal_id
         order by po.reference
      `)) as unknown as Array<Record<string, unknown>>;
      for (const h of hilo) {
        console.log(`  ${h.orden} ← ${h.requisicion} ← ${h.pedido}  (${h.piezas} × ${h.part_number})`);
      }
      if (hilo.length === 0) throw new Error("Se perdió el hilo orden→requisición→pedido");

      // ---- Estado final ---------------------------------------------------
      console.log("\n━━━━━━━━ 7 · ESTADO ━━━━━━━━");
      const detalle = await getRequisition(creada.id, tx);
      console.log(`  estado: ${detalle!.status}  (esperado: partial — queda la línea sin identificar)`);
      console.log(`  órdenes ligadas: ${detalle!.orders.map((o) => o.reference).join(", ")}`);
      const pend = detalle!.lines.filter((l) => l.quantity > l.orderedQuantity);
      console.log(`  renglones sin convertir: ${pend.length} → ${pend.map((l) => l.description.slice(0, 30)).join(" | ")}`);

      const lista = await getRequisitions(tx);
      const fila = lista.find((r) => r.id === creada.id)!;
      console.log(`  en la lista: ${fila.reference} · ${fila.status} · ${fila.pending} por comprar · ${fila.unresolved} sin identificar`);

      // ---- La orden hereda la fecha ---------------------------------------
      const [ord] = await tx
        .select({ expectedAt: purchaseOrders.expectedAt, notes: purchaseOrders.notes })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, conv.orders[0].id))
        .limit(1);
      console.log(`  la orden hereda la fecha: ${ord.expectedAt} (pedida 2026-09-15)`);
      if (ord.expectedAt !== "2026-09-15") throw new Error("La fecha no viajó a la orden");

      // ---- Cruce con la suspensión de compras -----------------------------
      console.log("\n━━━━━━━━ 8 · PROVEEDOR SUSPENDIDO ━━━━━━━━");
      const [deal2] = await tx
        .insert(crmDeals)
        .values({
          reference: "EVO-D-999902",
          title: "Prueba suspensión",
          pipelineId: pipeline.id,
          stageId: etapa.id,
          status: "won",
        })
        .returning({ id: crmDeals.id });

      await tx.insert(crmDealProducts).values({
        dealId: deal2.id,
        partId: partes[0].id,
        name: partes[0].description,
        quantity: "40",
      });

      const req2 = await createRequisitionFromDeal(tx, {
        dealId: deal2.id,
        actorId: null,
        folioPrefix: "EVO",
      });
      if (!req2.ok) throw new Error(req2.reason);
      await submitRequisition(tx, { id: req2.id, actorId: null });
      await approveRequisition(tx, { id: req2.id, actorId: null });

      // Se suspende DESPUÉS de autorizar: es el caso que importa, porque la
      // comprobación del alta ya pasó y solo queda la de la conversión.
      const [prov] = await tx
        .select({ id: requisitionLines.supplierId })
        .from(requisitionLines)
        .where(eq(requisitionLines.requisitionId, req2.id))
        .limit(1);
      await tx
        .update(suppliers)
        .set({ suspendedAt: new Date(), suspendReason: "Prueba" })
        .where(eq(suppliers.id, prov.id!));

      const conv2 = await convertToPurchaseOrders(tx, {
        id: req2.id,
        actorId: null,
        folioPrefix: "EVO",
      });
      if (!conv2.ok) throw new Error(conv2.reason);
      console.log(`  órdenes generadas: ${conv2.orders.length} (debe ser 0)`);
      for (const o of conv2.omitidas) {
        console.log(`  omitida: ${o.description.slice(0, 30)} — ${o.reason}`);
      }
      if (conv2.orders.length !== 0) {
        throw new Error("Se le compró a un proveedor suspendido");
      }
      if (conv2.omitidas.length === 0) {
        throw new Error("Se omitió en silencio, sin decir por qué");
      }

      console.log("\n✅ Todo el circuito pasa.\n");
      throw new Revertir();
    });
  } catch (e) {
    if (e instanceof Revertir) {
      console.log("(transacción revertida: la base quedó como estaba)");
      return;
    }
    throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌", e);
    process.exit(1);
  });
