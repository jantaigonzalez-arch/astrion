/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-busqueda.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";

/**
 * Que buscar en la caja encuentre por lo que VIGILA, no solo por el nombre.
 *
 * Es la diferencia entre una búsqueda útil y una decorativa: quien escribe
 * «anticipos» no busca un análisis llamado así —se llama «Avisos de cuentas por
 * pagar»— sino el que los vigila.
 */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function main() {
  const { analysesAll } = await import("@/lib/ml/analyses");
  const todos = await analysesAll();

  const buscar = (q: string) => {
    const t = normalizar(q);
    return todos.filter((a) =>
      normalizar([a.label, ...a.watching].join(" ")).includes(t),
    );
  };

  console.log(`\n  catálogo: ${todos.length} análisis\n`);
  for (const q of ["MARGEN", "margen", "Refaccion", "refacción", "zzz"]) {
    const r = buscar(q);
    console.log(`  «${q}»`.padEnd(18) + `${r.length} resultado(s)`);
    for (const a of r.slice(0, 3)) {
      const porNombre = normalizar(a.label).includes(normalizar(q));
      console.log(`      · ${a.label}${porNombre ? "" : "   ← encontrado por lo que vigila"}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
