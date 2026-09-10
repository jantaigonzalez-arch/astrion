/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-listas.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";
import { consultas } from "./_stub-tenancy";

/**
 * Que paginar no haya cambiado ninguna cifra del encabezado.
 *
 * Los tres listados enseñan un recuento junto a la lista, y ése es el punto
 * donde paginar rompe callado: la lista se acorta a propósito y el recuento se
 * acorta sin que nadie lo pida. Se compara el recuento nuevo —sobre el conjunto
 * entero— contra el que salía de contar las filas traídas.
 */
async function main() {
  const { getSalesOrders, getSalesOrdersSummary } = await import("@/lib/data/crm");
  const { getContracts, countContracts } = await import("@/lib/data/contracts");
  const { getPurchaseOrders } = await import("@/lib/data/purchasing");

  // Pedidos ---------------------------------------------------------------
  const todos = await getSalesOrders();
  const viejoPendientes = todos.filter((p) => p.porComprar > 0).length;
  const resumen = await getSalesOrdersSummary();

  consultas.cero();
  const pag = await getSalesOrders({ limit: 25, offset: 0 });
  const qPag = consultas.n;

  console.log("\nPEDIDOS");
  console.log(`  total          antes ${todos.length}  ahora ${resumen.total}   ${todos.length === resumen.total ? "✓" : "✗"}`);
  console.log(`  pendientes     antes ${viejoPendientes}  ahora ${resumen.pendientes}   ${viejoPendientes === resumen.pendientes ? "✓" : "✗"}`);
  console.log(`  filas traídas  antes ${todos.length}  ahora ${pag.length}  (${qPag} consulta)`);

  // Contratos -------------------------------------------------------------
  const cTodos = await getContracts();
  const cTotal = await countContracts();
  const cPag = await getContracts(undefined, undefined, { limit: 25, offset: 0 });
  console.log("\nCONTRATOS");
  console.log(`  total          antes ${cTodos.length}  ahora ${cTotal}   ${cTodos.length === cTotal ? "✓" : "✗"}`);
  console.log(`  filas traídas  antes ${cTodos.length}  ahora ${cPag.length}`);
  // El orden no puede cambiar: la primera página tiene que ser el principio.
  const mismoOrden = cPag.every((c, i) => c.id === cTodos[i].id);
  console.log(`  primera página = principio de la lista completa   ${mismoOrden ? "✓" : "✗"}`);

  // Órdenes de compra -----------------------------------------------------
  const o1 = await getPurchaseOrders({ limit: 25, offset: 0 });
  const o2 = await getPurchaseOrders({ limit: 25, offset: 25 });
  console.log("\nÓRDENES DE COMPRA");
  console.log(`  total          ${o1.total}`);
  console.log(`  página 1       ${o1.rows.length} filas`);
  console.log(`  página 2       ${o2.rows.length} filas   total coherente ${o1.total === o2.total ? "✓" : "✗"}`);
  const solapan = o1.rows.some((a) => o2.rows.some((b) => b.id === a.id));
  console.log(`  sin solapamiento entre páginas   ${solapan ? "✗ SE REPITEN" : "✓"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
