/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-siembra.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
import "./_env";

/**
 * Que crear un tablero desde un módulo lo siembre con sus análisis de fábrica.
 *
 * Es lo que sustituye a los siete tableros de fábrica que se borraron: sin
 * esto, los cuatro de rentabilidad y los tres de clientes se quedan sin ningún
 * sitio, porque sus módulos no tienen pantalla de trabajo que admita análisis.
 *
 * ── Y SE BORRAN AL SALIR, PASE LO QUE PASE ─────────────────────────────────
 *
 * Esto ESCRIBE en una copia de producción y durante meses no deshizo nada. El
 * 7 de septiembre se corrió seis veces seguidas mientras se rescataban los
 * probes que parecían rotos, y entre este y `_probe-nuevo.ts` dejaron
 * veinticuatro tableros basura en el menú de todo el mundo.
 *
 * No fue un duplicado accidental: `dashboards.slug` es único, así que cada
 * corrida no chocaba —le pegaba un `-2`, `-3`, `-4`…— y el probe seguía dando
 * verde mientras la barra lateral se llenaba. Un probe que no limpia no falla
 * nunca: ensucia, que es peor, porque nadie lo relaciona con él.
 *
 * Lo correcto sería la transacción que revienta al final, como hace
 * `probe-viaticos.mts`; no se puede, porque `createDashboard()` abre la suya
 * por dentro y no acepta una de fuera. Así que se anota lo creado y se borra en
 * un `finally`: si el probe se cae a la mitad, se va igual lo que alcanzó a
 * crear —por eso la lista se llena SOBRE LA MARCHA y no al final—.
 */
async function main() {
  const { createDashboard, dashboardFor, deleteDashboard } = await import(
    "@/lib/ml/dashboards"
  );

  const creados: string[] = [];
  try {
    for (const [modulo, nombre] of [
      ["rentabilidad", "Margen del mes"],
      ["clientes", "Cartera"],
      [null, "Uno en blanco"],
    ] as const) {
      const r = await createDashboard(nombre, modulo);
      if (!r.ok) { console.log(`  ✗ ${nombre}: ${r.reason}`); continue; }
      creados.push(r.slug);
      const d = await dashboardFor(r.slug);
      console.log(`\n  «${nombre}» desde ${modulo ?? "ningún módulo"} → ${d!.bloques.length} bloque(s)`);
      for (const b of d!.bloques)
        console.log(`     [${b.caja.w}x${b.caja.h}] pos ${b.position}  ${b.analysis.label.padEnd(40)} ${b.source}`);
      if (d!.bloques.length === 0) console.log("     (vacío, como debe)");
    }
  } finally {
    for (const slug of creados) {
      const borrado = await deleteDashboard(slug, null);
      console.log(`  ${borrado.ok ? "✓" : "✗"} limpiado «${slug}»${borrado.ok ? "" : ` — ${borrado.reason}`}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
