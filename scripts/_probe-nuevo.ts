/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-nuevo.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";

/**
 * Crea un tablero libre y lo publica en dos módulos, como lo haría la pantalla.
 *
 * ── Y LO BORRA AL SALIR, PASE LO QUE PASE ──────────────────────────────────
 *
 * Esto ESCRIBE en una copia de producción, y durante meses no deshizo nada. El
 * 7 de septiembre se corrió seis veces seguidas mientras se rescataban los
 * probes que parecían rotos, y dejó veinticuatro tableros basura en el menú —
 * cinco de ellos PUBLICADOS, así que le salían a todo el mundo y no solo a
 * quien corrió el probe.
 *
 * No fue un duplicado accidental: `dashboards.slug` es único, así que cada
 * corrida no chocaba, le pegaba un `-2`, `-3`, `-4`… y el probe seguía dando
 * verde mientras la barra lateral se llenaba.
 *
 * Lo correcto sería la transacción que revienta al final, como hace
 * `probe-viaticos.mts`; no se puede, porque `createDashboard()` y compañía
 * abren la suya por dentro y no aceptan una de fuera. Así que se borra a mano
 * en un `finally`: si el probe se cae a la mitad, el tablero se va igual.
 */
async function main() {
  const {
    createDashboard, setDashboardModules, reorderDashboard,
    publishDashboard, dashboardFor, dashboardStates, tablerosDelModulo,
    deleteDashboard,
  } = await import("@/lib/ml/dashboards");

  const r = await createDashboard("Cierre de mes");
  if (!r.ok) { console.log("✗", r.reason); return; }
  console.log(`✓ creado: slug «${r.slug}»`);

  try {

    // Igual que la pantalla: se manda la composición entera de una vez.
    const x = await reorderDashboard(
      r.slug,
      ["profit.trend", "sales.funnel", "payables.findings"].map((analysis) => ({
        analysis,
        caja: { x: 0, y: 0, w: 24, h: 8 },
        active: true,
        // Sin forma elegida: se recomienda. Es como nace todo.
        viz: null,
      })),
    );
    console.log(`  ${x.ok ? "✓ tres bloques" : "✗ " + x.reason}`);

    console.log("\n" + JSON.stringify(await setDashboardModules(r.slug, ["ventas", "rentabilidad"])));
    console.log(JSON.stringify(await publishDashboard(r.slug, null)));

    const d = await dashboardFor(r.slug);
    console.log(`\n«${d!.title}» → módulos: ${d!.modules.join(", ")}  ·  ${d!.bloques.length} bloques  ·  ${d!.publishedAt ? "publicado" : "borrador"}`);

    const menu = (await dashboardStates())
      .filter((s) => s.bloques > 0 || s.publishedAt)
      .map((s) => ({ slug: s.slug, title: s.title, modules: s.modules, homes: [], publicado: !!s.publishedAt, bloquesPublicos: s.bloquesPublicos }));

    console.log("\nQUÉ ABRE EL BOTÓN DE CADA MÓDULO AHORA");
    for (const m of ["ventas", "rentabilidad", "servicio"]) {
      const aqui = tablerosDelModulo(menu, m);
      const manda = aqui.find((t) => t.publicado) ?? aqui[0];
      console.log(`  ${m.padEnd(14)} → "${manda?.title ?? "(nada)"}"${aqui.length > 1 ? `   (+${aqui.length - 1} más)` : ""}`);
    }
  } finally {
    const borrado = await deleteDashboard(r.slug, null);
    console.log(`\n${borrado.ok ? "✓" : "✗"} limpiado «${r.slug}»${borrado.ok ? "" : ` — ${borrado.reason}`}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
