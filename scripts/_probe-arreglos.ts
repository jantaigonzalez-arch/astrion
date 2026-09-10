/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-arreglos.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";
async function main() {
  const { createDashboard, reorderDashboard, deleteDashboard, dashboardFor } =
    await import("@/lib/ml/dashboards");
  const { placementsFor } = await import("@/lib/ml/placements");
  const { dashboardScreen } = await import("@/lib/ml/analyses");

  console.log("── 1 · sembrar desde un módulo NO debe apilar en (0,0) ──");
  const r = await createDashboard("Prueba siembra", "servicio");
  if (!r.ok) { console.log("✗", r.reason); return; }
  const bs = await placementsFor(dashboardScreen(r.slug));
  for (const b of bs) console.log(`   ${b.analysis.id.padEnd(24)} ${b.caja.w}x${b.caja.h} @${b.caja.x},${b.caja.y}`);
  const enCero = bs.filter((b) => b.caja.x === 0 && b.caja.y === 0).length;
  console.log(`   → ${bs.length} bloques, ${enCero} en (0,0) ${enCero <= 1 ? "✓" : "✗ APILADOS"}`);

  console.log("\n── 2 · el orden de lectura sale del lienzo ──");
  // Se guardan al revés de como se leen: el primero de la lista abajo a la derecha.
  await reorderDashboard(r.slug, bs.map((b, i) => ({
    analysis: b.analysis.id, active: true, viz: null,
    caja: { x: i % 2 === 0 ? 12 : 0, y: (bs.length - i) * 8, w: 12, h: 8 },
  })));
  const d = await dashboardFor(r.slug);
  for (const b of d?.bloques ?? [])
    console.log(`   pos ${String(b.position).padStart(2)}  @${b.caja.x},${b.caja.y}  ${b.analysis.id}`);
  const ys = (d?.bloques ?? []).map((b) => b.caja.y);
  console.log(`   → ${ys.every((y, i) => i === 0 || y >= ys[i - 1]) ? "✓ ordenado por fila" : "✗ desordenado"}`);

  await deleteDashboard(r.slug, null);
  console.log("\n   (tablero de prueba borrado)");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
