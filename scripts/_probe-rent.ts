/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-rent.ts
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
  for (const a of ANALYSES.filter((x) => /^(profit|clients)\./.test(x.id))) {
    try {
      const bs = await resolveAnalysis(a, { db });
      console.log(`  ${a.id.padEnd(24)} ${a.kind.padEnd(11)} ${bs.length === 0 ? "— VACÍO" : bs.map((b) => b.kind === "finding" || b.kind === "forecast" ? b.kind : `${b.bars.length} barras`).join(", ")}`);
    } catch (e) { console.log(`  ${a.id.padEnd(24)} ✗ ${(e as Error).message.slice(0, 60)}`); }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
