/**
 * CUÁNTO TARDA CADA COSA, CONTRA VOLUMEN DE VERDAD.
 *
 * No comprueba nada: MIDE. Es un informe, y por eso vive en `SOLO_LOCAL` — un
 * umbral de rendimiento en un ejecutor compartido de CI es una prueba que falla
 * los martes, que es lo mismo que ya dice el registro de `_probe-perf`.
 *
 * Su compañero `_probe-perf` cuenta CONSULTAS por pantalla; este cuenta
 * MILISEGUNDOS por consulta. Las dos preguntas se contestan distinto: una
 * pantalla puede hacer dos consultas y tardar 400 ms, o cuarenta y tardar 12.
 *
 * ── CONTRA QUÉ BASE ────────────────────────────────────────────────────────
 *
 * Contra `evoelution_ci`, que `pruebas:base` siembra con diez años de historia
 * —14 151 tickets, 19 073 comentarios— y no contra la copia de producción, que
 * hoy tiene 634 tickets. Medir sobre lo pequeño da siempre verde y esconde
 * justo lo que crece.
 *
 *   DATABASE_URL=…/evoelution_ci PROBE_SCHEMA=tenant_evoelution \
 *     npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
 *     scripts/_probe-rendimiento.ts
 *
 * El orden de las banderas importa: con `--conditions` ANTES de `--tsconfig`,
 * tsx le pasa el segundo a node y node contesta «bad option» sin decir de quién
 * es la culpa. Costó encontrarlo dos veces.
 *
 * ── LA MEDIANA DE TRES, Y NO LA PRIMERA ────────────────────────────────────
 *
 * La primera corrida paga el plan de la consulta y la caché fría del disco, así
 * que mide otra cosa. Tres pasadas y la de en medio es lo más barato que
 * distingue una consulta lenta de una máquina ocupada.
 */
import "./_env";

/** Mide de verdad: 3 corridas, se queda con la mediana. */
async function medir(nombre: string, fn: () => Promise<unknown>) {
  let filas = 0;
  const t: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = performance.now();
    const r = await fn();
    t.push(performance.now() - a);
    filas = Array.isArray(r) ? r.length : r instanceof Map ? r.size : 1;
  }
  t.sort((x, y) => x - y);
  console.log(`  ${nombre.padEnd(46)} ${t[1].toFixed(1).padStart(8)} ms   ${String(filas).padStart(6)} filas`);
  return t[1];
}

/*
  Todo dentro de `main()` y no en el nivel superior: los probes de esta
  carpeta se compilan como CJS, donde un `await` suelto no existe. Es el
  mismo motivo por el que lo hacen los demás `scripts/_probe-*`.
*/
async function main() {
  const { getQueuePage, countQueue, conteosCola, getDashboardStats } = await import("../src/lib/data/tickets");
  const { listViaticos } = await import("../src/lib/data/viaticos");
  const { ticketsDelContrato, contratosParaViatico, modulosPorContrato } = await import("../src/lib/data/viaticos");
  const { getOrganizations } = await import("../src/lib/data/crm");
  const { listTenantMembers } = await import("../src/lib/data/people");
  const { getProfitInputsForTickets } = await import("../src/lib/data/contracts");
  const { tenantDbFor } = await import("../src/lib/tenancy/context");

  const db = tenantDbFor("tenant_evoelution");

  console.log("\nLISTADOS PRINCIPALES");
  await medir("tickets · cola paginada", () => getQueuePage({ limit: 25, offset: 0 } as never));
  await medir("tickets · conteo de la cola", () => countQueue({} as never));
  await medir("tickets · conteos por estado", () => conteosCola({} as never));
  await medir("viáticos · abiertos", () => listViaticos(null, { abiertos: true }));
  await medir("viáticos · archivo paginado", () => listViaticos(null, { cerrados: true }, { limit: 25, offset: 0 }));
  await medir("organizaciones (CRM)", () => getOrganizations());
  await medir("miembros del inquilino", () => listTenantMembers());

  console.log("\nLO QUE ALIMENTA FORMULARIOS Y UTILIDAD");
  const contratos = await contratosParaViatico();
  await medir("contratos para viático", () => contratosParaViatico());
  await medir("módulos de TODOS los contratos", () => modulosPorContrato(contratos.map((c) => c.id)));
  if (contratos[0]) {
    await medir("tickets de un contrato", () => ticketsDelContrato(contratos[0].id));
  }
  const ids = (await db.execute(
    (await import("drizzle-orm")).sql`select id::text as id from tickets limit 200`,
  )) as unknown as Array<{ id: string }>;
  await medir("insumos de utilidad · 200 tickets", () => getProfitInputsForTickets(ids.map((r) => r.id)));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
