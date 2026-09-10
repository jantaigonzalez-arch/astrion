/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-contratos.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";
async function main() {
  const { ANALYSES, resolveAnalysis } = await import("@/lib/ml/analyses");
  const { tenantDb } = await import("@/lib/tenancy/context");
  const db = await tenantDb();
  for (const a of ANALYSES.filter((x) => x.id.startsWith("contracts."))) {
    const bs = await resolveAnalysis(a, { db });
    console.log(`\n══ ${a.id} → ${bs.length} bloque(s)`);
    for (const b of bs) {
      if (b.kind !== "projection") continue;
      console.log(`   ${b.title}`);
      console.log(`   ${b.note}`);
      console.log(`   total ${b.total?.toLocaleString("es-MX")} ${b.currency} · ${b.bars.length} barras · eje ${b.axis ?? "categórico"}`);
      for (const x of b.bars) console.log(`      ${x.label.padEnd(22)} ${String(x.value).padStart(12)}`);
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
