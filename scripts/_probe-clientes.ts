import "./_env";
import { asc, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { consultas } from "./_stub-tenancy";
import {
  contracts,
  crmDeals,
  crmOrganizations,
  equipment,
  tickets,
} from "@/lib/db/schema";
import { VALOR_MXN } from "@/lib/data/crm-insights";

/**
 * Que agrupar los conteos de la cartera no haya cambiado ni una cifra.
 *
 * Se conserva aquí la consulta VIEJA —siete subconsultas correlacionadas— y se
 * compara fila a fila contra la nueva. Es la única comprobación que vale para
 * este cambio: la consulta nueva es más rápida por construcción, así que el
 * riesgo no es el reloj, es que un `left join` cuente de más al haber varias
 * filas del mismo lado, o que un cliente sin cuenta de portal pase de cero a
 * nulo sin que nadie lo mire.
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-clientes.ts
 */

// Copia literal de lo que había antes de agrupar. No se importa de ningún sitio
// a propósito: si mañana alguien cambia la de producción, ésta tiene que seguir
// diciendo lo de antes o la comparación no compara nada.
const ES_CLIENTE_COPIA = sql<boolean>`(
  ${crmOrganizations.clientId} is not null
  or exists (
    select 1 from ${crmDeals}
     where ${crmDeals}.organization_id = ${crmOrganizations}.id
       and ${crmDeals}.status = 'won'
  )
  or exists (
    select 1 from ${contracts}
      join ${crmDeals} on ${crmDeals}.id = ${contracts}.deal_id
     where ${crmDeals}.organization_id = ${crmOrganizations}.id
  )
)`;

async function vieja(db: Awaited<ReturnType<typeof tenantDb>>) {
  return db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      contracts: sql<number>`(
        select count(*)::int from ${contracts}
         where ${contracts}.client_id = ${crmOrganizations}.client_id
      )`,
      equipment: sql<number>`(
        select count(*)::int from ${equipment}
         where ${equipment}.owner_id = ${crmOrganizations}.client_id
      )`,
      openTickets: sql<number>`(
        select count(*)::int from ${tickets}
         where ${tickets}.created_by_id = ${crmOrganizations}.client_id
           and ${tickets}.status in ('pending_review','open','in_progress','waiting')
      )`,
      totalTickets: sql<number>`(
        select count(*)::int from ${tickets}
         where ${tickets}.created_by_id = ${crmOrganizations}.client_id
      )`,
      lastTicketAt: sql<string | null>`(
        select max(${tickets}.created_at) from ${tickets}
         where ${tickets}.created_by_id = ${crmOrganizations}.client_id
      )`,
      wonDeals: sql<number>`(
        select count(*)::int from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'won'
      )`,
      wonValue: sql<number>`(
        select coalesce(sum(${VALOR_MXN}), 0)::float8 from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'won'
      )`,
    })
    .from(crmOrganizations)
    .where(ES_CLIENTE_COPIA)
    .orderBy(asc(crmOrganizations.name));
}

const CAMPOS = [
  "contracts",
  "equipment",
  "openTickets",
  "totalTickets",
  "wonDeals",
  "wonValue",
  "lastTicketAt",
] as const;

function reloj(): { fin: () => number } {
  const t0 = process.hrtime.bigint();
  return { fin: () => Number(process.hrtime.bigint() - t0) / 1e6 };
}

async function main() {
  const { getClients } = await import("@/lib/data/crm");
  const db = await tenantDb();

  // Vuelta en frío que no cuenta: conexión y caché de Postgres.
  await vieja(db);
  await getClients();

  let t = reloj();
  const antes = await vieja(db);
  const msAntes = t.fin();

  consultas.cero();
  t = reloj();
  const ahora = await getClients();
  const msAhora = t.fin();
  const qAhora = consultas.n;

  console.log(`\nCARTERA DE CLIENTES — ${antes.length} filas\n`);
  console.log(`  antes  (7 subconsultas correlacionadas)   ${msAntes.toFixed(1).padStart(6)} ms`);
  console.log(`  ahora  (4 agrupaciones + left join)       ${msAhora.toFixed(1).padStart(6)} ms   ${qAhora} consulta(s) incl. el listado de personas`);

  if (antes.length !== ahora.length) {
    console.log(`\n  ✗ distinto número de filas: ${antes.length} vs ${ahora.length}\n`);
    process.exit(1);
  }

  const porId = new Map(ahora.map((r) => [r.id, r]));
  const fallos: string[] = [];

  for (const a of antes) {
    const b = porId.get(a.id);
    if (!b) {
      fallos.push(`${a.name}: ya no sale`);
      continue;
    }
    for (const c of CAMPOS) {
      const x = c === "lastTicketAt" ? fecha(a[c]) : a[c];
      const y = c === "lastTicketAt" ? fecha(b[c] as unknown as string | Date | null) : b[c];
      if (String(x) !== String(y)) fallos.push(`${a.name} · ${c}: ${x} → ${y}`);
    }
  }

  console.log(
    fallos.length === 0
      ? `\n  Las ${antes.length} filas coinciden en los 7 campos. ✓\n`
      : `\n  ✗ ${fallos.length} diferencia(s):\n     ${fallos.slice(0, 20).join("\n     ")}\n`,
  );
  if (fallos.length) process.exit(1);
}

/** Las dos consultas devuelven el instante con tipos distintos; se compara el valor. */
function fecha(v: string | Date | null): string {
  if (!v) return "—";
  return new Date(v).toISOString();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
