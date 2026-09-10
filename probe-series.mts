/**
 * Las series de tiempo no pueden tener huecos.
 *
 * `axis: "time"` promete periodos consecutivos y equiespaciados. Se comprueba
 * contra los datos REALES de la copia local: meses consecutivos, sin saltos, y
 * la media dividida entre los meses transcurridos y no entre los que tuvieron
 * actividad.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-series.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SCHEMA = "tenant_evoelution";
const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { ticketsVolume } = await import("./src/lib/ml/service-insights.ts");
const { getMonthlyClosed } = await import("./src/lib/data/crm-insights.ts");
const { sql } = await import("drizzle-orm");

const db = tenantDbFor(SCHEMA);
/*
  CUENTA los fallos. Antes solo los imprimía, y el `process.exit(0)` del final
  corría igual hubiera cruces o no: una comprobación roja salía con éxito y el
  CI la daba por buena. Se midió inyectando un fallo deliberado — salida 0.
*/
let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

/** ¿La lista de `YYYY-MM` es consecutiva, sin saltos? */
function consecutivos(meses: string[]): boolean {
  for (let i = 1; i < meses.length; i++) {
    const [ya, ma] = meses[i - 1].split("-").map(Number);
    const [yb, mb] = meses[i].split("-").map(Number);
    if ((yb - ya) * 12 + (mb - ma) !== 1) return false;
  }
  return true;
}

const bloques = await ticketsVolume(db);
if (bloques.length === 0) {
  console.log("· sin servicios en la copia local, no hay serie que comprobar");
} else {
  const b = bloques[0] as { bars: Array<{ key: string; value: number }>; note: string; axis: string };
  const meses = b.bars.map((x) => x.key);
  ok("servicios: la serie es consecutiva", consecutivos(meses), `${meses[0]} → ${meses[meses.length - 1]} (${meses.length})`);
  ok("y declara eje de tiempo", b.axis === "time");

  const conCero = b.bars.filter((x) => x.value === 0).length;
  console.log(`  · ${conCero} de ${meses.length} meses en cero (antes desaparecían)`);

  // La media de la nota tiene que ser total / meses transcurridos.
  const total = b.bars.reduce((a, x) => a + x.value, 0);
  const esperada = Math.round(total / meses.length);
  ok("la media divide entre los meses transcurridos", b.note.includes(`${esperada.toLocaleString("es-MX")} al mes`),
     `esperada ${esperada} — nota: «${b.note.slice(0, 70)}…»`);
}

const [pipe] = (await db.execute(sql`select id from crm_pipelines limit 1`)) as unknown as Array<{ id: string }>;
if (!pipe) {
  console.log("· sin pipeline en la copia local");
} else {
  const filas = await getMonthlyClosed(pipe.id, undefined, db);
  if (filas.length === 0) {
    console.log("· sin negocios cerrados, la serie sale vacía (correcto)");
  } else {
    const meses = filas.map((f) => f.month);
    ok("negocios: la serie es consecutiva", consecutivos(meses), `${meses[0]} → ${meses[meses.length - 1]} (${meses.length})`);
    ok("no pasa de doce meses", meses.length <= 12, `${meses.length}`);
    const vacios = filas.filter((f) => f.wonCount === 0 && f.lostCount === 0).length;
    console.log(`  · ${vacios} de ${meses.length} meses sin cierres (antes desaparecían)`);
    ok("los meses vacíos traen cero y no nulo",
       filas.every((f) => Number(f.wonValue) >= 0 && Number.isInteger(f.wonCount)));
  }
}
console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron\n` : "");
process.exit(fallos ? 1 : 0);
