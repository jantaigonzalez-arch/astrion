/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-profit.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- se compara SQL cruda contra la función real */
import "./_env";

/**
 * Que recortar por periodo NO cambie ninguna cifra.
 *
 * Se corre la consulta VIEJA —CTE sobre el histórico entero— y la nueva para
 * cada periodo de la pantalla, y se comparan los totales uno por uno. Un cambio
 * de rendimiento que mueve un peso no es un cambio de rendimiento.
 */
const R = { laborRatePerHour: 650, laborCostPerHour: 280 };

const PERIODOS: Array<[string, Date | null]> = [
  ["Este mes", new Date(new Date().getFullYear(), new Date().getMonth(), 1)],
  ["3 meses", new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)],
  ["12 meses", new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1)],
  ["Todo", null],
];

async function main() {
  const { tenantDb } = await import("@/lib/tenancy/context");
  const { getProfitOverview } = await import("@/lib/data/profitability");
  const { sql } = await import("drizzle-orm");
  const db: any = await tenantDb();

  const viejo = async (since: Date | null) => {
    const filtro = since ? `where t.created_at >= '${since.toISOString()}'::timestamptz` : "";
    const res: any = await db.execute(sql.raw(`
      with horas as (select ticket_id, coalesce(sum(hours),0) h from ticket_comments group by ticket_id),
           refa as (select c.ticket_id,
                           coalesce(sum(p.quantity*coalesce(p.unit_price_mxn,0)),0) venta,
                           coalesce(sum(p.quantity*coalesce(p.unit_cost_mxn,0)),0) costo
                      from ticket_comment_parts p join ticket_comments c on c.id=p.comment_id
                     group by c.ticket_id),
           b as (select t.id,
                        coalesce(refa.venta,0) parts_revenue,
                        coalesce(refa.costo,0) parts_cost,
                        coalesce(horas.h,0)*${R.laborRatePerHour} labor_revenue,
                        coalesce(horas.h,0)*${R.laborCostPerHour} labor_cost,
                        coalesce(horas.h,0) hours,
                        coalesce(refa.venta,0)+coalesce(horas.h,0)*${R.laborRatePerHour} revenue,
                        coalesce(refa.costo,0)+coalesce(horas.h,0)*${R.laborCostPerHour} cost
                   from tickets t left join horas on horas.ticket_id=t.id
                                  left join refa on refa.ticket_id=t.id ${filtro}),
           fact as (select * from b where b.revenue>0 or b.cost>0)
      select coalesce(sum(revenue),0)::float8 revenue,
             coalesce(sum(cost),0)::float8 cost,
             coalesce(sum(hours),0)::float8 hours,
             count(*)::int services
        from fact`));
    return (Array.isArray(res) ? res[0] : res.rows?.[0]) as any;
  };

  /*
    Las dos formas del CTE, con el MISMO select encima.

    La comparación anterior medía la consulta vieja recortada contra la función
    entera —que además calcula la serie mensual, el reparto por cliente y los
    peores servicios— y por eso la nueva salía «más lenta». Aquí lo único que
    cambia entre las dos es de dónde salen `horas` y `refa`.
  */
  const CTE_VIEJO = (filtro: string) => `
    horas as (select ticket_id, coalesce(sum(hours),0) h from ticket_comments group by ticket_id),
    refa as (select c.ticket_id,
                    coalesce(sum(p.quantity*coalesce(p.unit_price_mxn,0)),0) venta,
                    coalesce(sum(p.quantity*coalesce(p.unit_cost_mxn,0)),0) costo
               from ticket_comment_parts p join ticket_comments c on c.id=p.comment_id
              group by c.ticket_id),
    b as (select t.id, coalesce(refa.venta,0)+coalesce(horas.h,0)*${R.laborRatePerHour} revenue,
                 coalesce(refa.costo,0)+coalesce(horas.h,0)*${R.laborCostPerHour} cost
            from tickets t left join horas on horas.ticket_id=t.id
                           left join refa on refa.ticket_id=t.id ${filtro})`;

  const CTE_NUEVO = (filtro: string) => (filtro === "" ? CTE_VIEJO(filtro) : `
    tix as (select t.id from tickets t ${filtro}),
    horas as (select tc.ticket_id, coalesce(sum(tc.hours),0) h
                from ticket_comments tc join tix on tix.id=tc.ticket_id group by tc.ticket_id),
    refa as (select c.ticket_id,
                    coalesce(sum(p.quantity*coalesce(p.unit_price_mxn,0)),0) venta,
                    coalesce(sum(p.quantity*coalesce(p.unit_cost_mxn,0)),0) costo
               from ticket_comment_parts p join ticket_comments c on c.id=p.comment_id
               join tix on tix.id=c.ticket_id group by c.ticket_id),
    b as (select t.id, coalesce(refa.venta,0)+coalesce(horas.h,0)*${R.laborRatePerHour} revenue,
                 coalesce(refa.costo,0)+coalesce(horas.h,0)*${R.laborCostPerHour} cost
            from tix t left join horas on horas.ticket_id=t.id
                       left join refa on refa.ticket_id=t.id)`);

  /** Tiempo y filas leídas de verdad, según el propio planificador. */
  const plan = async (cte: string) => {
    const q = `with ${cte} select count(*), sum(revenue), sum(cost) from b where b.revenue>0 or b.cost>0`;
    const r: any = await db.execute(sql.raw(`explain (analyze, format json) ${q}`));
    const fila = Array.isArray(r) ? r[0] : r.rows?.[0];
    const plan = fila["QUERY PLAN"][0];
    const acc: number[] = [];
    const rec = (nodo: any) => {
      if (/Scan/.test(nodo["Node Type"] ?? "")) acc.push((nodo["Actual Rows"] ?? 0) * (nodo["Actual Loops"] ?? 1));
      (nodo.Plans ?? []).forEach(rec);
    };
    rec(plan.Plan);
    return { ms: plan["Execution Time"] as number, filas: acc.reduce((a, b) => a + b, 0) };
  };

  console.log(`\n  ¿SE MOVIÓ ALGUNA CIFRA?\n`);
  console.log(`  ${"periodo".padEnd(10)} ${"servicios".padStart(10)} ${"ingresos".padStart(15)} ${"costos".padStart(15)}   igual`);
  console.log(`  ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(15)} ${"─".repeat(15)}   ─────`);
  let todasIguales = true;
  for (const [nombre, since] of PERIODOS) {
    const v = await viejo(since);
    const n = await getProfitOverview({ since }, R, { months: 6, top: 6 });
    const igual =
      Math.abs(Number(v.revenue) - n.totals.revenue) < 0.01 &&
      Math.abs(Number(v.cost) - n.totals.cost) < 0.01 &&
      Number(v.services) === n.totals.services;
    if (!igual) todasIguales = false;
    console.log(
      `  ${nombre.padEnd(10)} ${String(n.totals.services).padStart(10)} ${Math.round(n.totals.revenue).toLocaleString("es-MX").padStart(15)} ${Math.round(n.totals.cost).toLocaleString("es-MX").padStart(15)}   ${igual ? "✓" : "✗ DISTINTO"}`,
    );
  }
  console.log(`\n  ${todasIguales ? "✓ ninguna cifra cambió" : "✗ HAY CIFRAS DISTINTAS"}`);

  console.log(`\n  LO QUE CUESTA EL MISMO CÁLCULO, SOLO CAMBIANDO EL CTE\n`);
  console.log(`  ${"periodo".padEnd(10)} ${"filas leídas antes".padStart(19)} ${"ahora".padStart(9)} ${"ms antes".padStart(9)} ${"ms ahora".padStart(9)}`);
  console.log(`  ${"─".repeat(10)} ${"─".repeat(19)} ${"─".repeat(9)} ${"─".repeat(9)} ${"─".repeat(9)}`);
  for (const [nombre, since] of PERIODOS) {
    const filtro = since ? `where t.created_at >= '${since.toISOString()}'::timestamptz` : "";
    await plan(CTE_VIEJO(filtro)); await plan(CTE_NUEVO(filtro));
    const v = await plan(CTE_VIEJO(filtro));
    const n = await plan(CTE_NUEVO(filtro));
    console.log(
      `  ${nombre.padEnd(10)} ${v.filas.toLocaleString("es-MX").padStart(19)} ${n.filas.toLocaleString("es-MX").padStart(9)} ${v.ms.toFixed(1).padStart(9)} ${n.ms.toFixed(1).padStart(9)}`,
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
