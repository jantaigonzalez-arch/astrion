/**
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-borrar.ts
 *
 * El `tsconfig.probe.json` es la parte que importa: sustituye
 * `@/lib/tenancy/context` por un stub que fija la empresa con `PROBE_SCHEMA`.
 * Sin él, `tenantDb()` busca las cookies de una petición que aquí no existe y
 * el probe muere antes de comprobar nada.
 */
/* eslint-disable @typescript-eslint/no-explicit-any --
   Se comprueba el estado de tablas sueltas por su forma cruda; tipar cada
   consulta aquí sería copiar el esquema, que es lo que se desincroniza. */
import "./_env";

/** Que borrar un tablero no deje nada suelto y quede auditado. */
async function main() {
  const { createDashboard, deleteDashboard, dashboardFor, setDashboardModules } =
    await import("@/lib/ml/dashboards");
  const { tenantDb } = await import("@/lib/tenancy/context");
  const { analysisPlacements, dashboards } = await import("@/lib/db/schema");
  const { domainEvents } = await import("@/lib/db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const db = (await tenantDb()) as any;

  // Uno con contenido de verdad: bloques sembrados y dos módulos.
  const r = await createDashboard("Para borrar", "rentabilidad");
  if (!r.ok) {
    console.log("✗", r.reason);
    return;
  }
  await setDashboardModules(r.slug, ["rentabilidad", "ventas"]);

  const screen = `dashboard:${r.slug}`;
  const antes = await dashboardFor(r.slug);
  const filas = async () => ({
    tablero: (await db.select().from(dashboards).where(eq(dashboards.slug, r.slug))).length,
    colocaciones: (
      await db.select().from(analysisPlacements).where(eq(analysisPlacements.screen, screen))
    ).length,
  });

  console.log(
    `\n  ANTES:   «${antes!.title}» ${antes!.bloques.length} bloques · módulos: ${antes!.modules.join(", ")}`,
  );
  const a = await filas();
  console.log(`           filas → tablero=${a.tablero}  colocaciones=${a.colocaciones}`);

  console.log(`\n  borrado: ${JSON.stringify(await deleteDashboard(r.slug, null))}`);

  const b = await filas();
  console.log(`\n  DESPUÉS: tablero=${b.tablero}  colocaciones=${b.colocaciones}`);
  console.log(
    `  dashboardFor devuelve: ${(await dashboardFor(r.slug)) === null ? "null ✓" : "algo ✗"}`,
  );

  const ev = await db
    .select()
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.aggregateType, "dashboard"),
        eq(domainEvents.eventType, "dashboard.deleted"),
      ),
    );
  const ult = ev[ev.length - 1];
  const p = ult?.payload as { snapshot?: { title?: string }; placements?: unknown[] };
  console.log(
    `\n  auditoría: ${ev.length} evento(s); el último guardó "${p?.snapshot?.title}" con ${p?.placements?.length ?? 0} colocación(es)`,
  );

  // La foránea debería haberse llevado los módulos.
  const h = await db.execute(sql`select count(*)::int n from dashboard_modules m
    where not exists (select 1 from dashboards d where d.id = m.dashboard_id)`);
  const n = (Array.isArray(h) ? h[0] : h.rows?.[0])?.n;
  console.log(`  módulos huérfanos: ${n} ${n === 0 ? "✓" : "✗"}`);
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
