/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-goals.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- comparación ad hoc de dos formas de la misma consulta */
import "./_env";
import { consultas } from "./_stub-tenancy";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Que la lateral diga EXACTAMENTE lo mismo que las 201 consultas.
 *
 * Un cambio de rendimiento que altera una cifra no es un cambio de rendimiento:
 * es un error nuevo con mejor tiempo. Se recalcula el avance por el camino
 * viejo y se compara objetivo por objetivo.
 */
async function main() {
  const { tenantDb } = await import("@/lib/tenancy/context");
  const { getGoalsWithProgress, VALOR_MXN } = await import("@/lib/data/crm-insights");
  const { crmDeals, crmGoals } = await import("@/lib/db/schema");
  const db: any = await tenantDb();

  consultas.cero();
  const t0 = process.hrtime.bigint();
  const nuevo = await getGoalsWithProgress();
  const msNuevo = Number(process.hrtime.bigint() - t0) / 1e6;
  const qNuevo = consultas.n;

  // El camino viejo, reconstruido tal cual estaba.
  consultas.cero();
  const t1 = process.hrtime.bigint();
  // CON las relaciones, como estaba en producción: si no, se le descuentan al
  // camino viejo dos consultas que sí hacía y la comparación miente a su favor.
  const goals = await db.query.crmGoals.findMany({
    orderBy: [desc(crmGoals.periodStart)],
    with: {
      owner: { columns: { id: true, name: true, email: true } },
      pipeline: { columns: { id: true, name: true } },
    },
  });
  const viejo = await Promise.all(
    goals.map(async (g: any) => {
      const [row] = await db
        .select({
          value: sql<string>`coalesce(sum(${VALOR_MXN}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.status, "won"),
            g.ownerId ? eq(crmDeals.ownerId, g.ownerId) : undefined,
            g.pipelineId ? eq(crmDeals.pipelineId, g.pipelineId) : undefined,
            sql`${crmDeals.closedAt} >= ${g.periodStart}::date`,
            sql`${crmDeals.closedAt} < (${g.periodEnd}::date + interval '1 day')`,
          ),
        );
      const achieved = g.metric === "count" ? (row?.count ?? 0) : Number(row?.value ?? 0);
      return { id: g.id, achieved };
    }),
  );
  const msViejo = Number(process.hrtime.bigint() - t1) / 1e6;
  const qViejo = consultas.n;

  const porId = new Map(nuevo.map((g: any) => [g.id, g.achieved]));
  let distintos = 0;
  let peor = 0;
  for (const v of viejo) {
    const n = porId.get(v.id) ?? 0;
    // Comparación con tolerancia de centavo: el viejo devolvía numeric como
    // texto y el nuevo float8, y un céntimo de diferencia de redondeo no es
    // una discrepancia de negocio.
    const d = Math.abs(Number(n) - Number(v.achieved));
    if (d > 0.01) { distintos++; peor = Math.max(peor, d); }
  }

  console.log(`\n  objetivos comparados : ${viejo.length}`);
  console.log(`  cifras distintas     : ${distintos}${distintos ? ` (peor desvío ${peor})` : "  ✓ idénticas"}`);
  console.log(`\n  ANTES   ${String(qViejo).padStart(4)} consultas   ${msViejo.toFixed(0).padStart(5)} ms  (medido en localhost)`);
  console.log(`  AHORA   ${String(qNuevo).padStart(4)} consultas   ${msNuevo.toFixed(0).padStart(5)} ms  (medido en localhost)`);

  /*
    Localhost esconde justamente lo que este cambio arregla: aquí un viaje a la
    base cuesta casi nada, así que doscientas consultas diminutas compiten de tú
    a tú con una grande. En cuanto la base está al otro lado de una red, cada
    viaje se paga entero y en serie.

    Se proyecta en vez de medirse porque no hay forma honesta de simular la
    latencia desde aquí; el número de viajes SÍ está medido, y es el que manda.
  */
  console.log("\n  LO MISMO CON LA BASE AL OTRO LADO DE UNA RED");
  console.log(`  ${"latencia".padEnd(10)} ${"antes".padStart(9)} ${"ahora".padStart(9)}`);
  for (const rtt of [0.5, 1, 5]) {
    const a = msViejo + qViejo * rtt;
    const n = msNuevo + qNuevo * rtt;
    console.log(`  ${(rtt + " ms").padEnd(10)} ${(a.toFixed(0) + " ms").padStart(9)} ${(n.toFixed(0) + " ms").padStart(9)}   ${(a / n).toFixed(1)}× más rápido`);
  }
  process.exit(distintos === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
