/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-huerfanos.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";

/** Qué análisis se quedarían sin ningún sitio si desaparecen los tableros de fábrica. */
async function main() {
  const { analysesAll } = await import("@/lib/ml/analyses");
  const todos = await analysesAll();

  const soloTablero: string[] = [];
  const tambienTrabajo: string[] = [];
  for (const a of todos) {
    if (a.defaultOn.length === 0) continue;
    const trabajo = a.defaultOn.filter((d) => !d.screen.startsWith("dashboard:"));
    const tablero = a.defaultOn.filter((d) => d.screen.startsWith("dashboard:"));
    if (tablero.length === 0) continue;
    (trabajo.length === 0 ? soloTablero : tambienTrabajo).push(a.label);
  }
  console.log(`\n  SOLO viven en un tablero de fábrica (${soloTablero.length}):`);
  soloTablero.forEach((x) => console.log(`     · ${x}`));
  console.log(`\n  También en su pantalla de trabajo (${tambienTrabajo.length}): siguen saliendo igual`);
  tambienTrabajo.forEach((x) => console.log(`     · ${x}`));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
