/* eslint-disable @typescript-eslint/no-explicit-any -- se cronometra la capa de datos por su interfaz pública */
import "./_env";
import { consultas } from "./_stub-tenancy";

/**
 * Cascadas: lo que cuesta esperar en serie lo que no depende entre sí.
 *
 * No mide consultas sino VIAJES ENCADENADOS. En localhost cada viaje es casi
 * gratis, así que la diferencia se proyecta también a una base con red de por
 * medio — que es donde una cascada de seis se convierte en seis latencias.
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-arq.ts
 */
const t = async (fn: () => Promise<unknown>) => {
  consultas.cero();
  const t0 = process.hrtime.bigint();
  await fn();
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, q: consultas.n };
};

async function main() {
  const tickets = await import("@/lib/data/tickets");
  const parts = await import("@/lib/data/parts");
  const settings = await import("@/lib/data/settings");
  const equipment = await import("@/lib/data/equipment");
  const people = await import("@/lib/data/people");
  const platform = await import("@/lib/data/platform");
  const { dashboardStates } = await import("@/lib/ml/dashboards");

  const [uno] = await tickets.getQueuePage({ limit: 1, offset: 0 });
  const id = uno.id;
  const full: any = await tickets.getTicketById(id);
  const dueno = full.createdById;
  const autores = [...new Set((full.comments ?? []).map((c: any) => c.author.id))] as string[];

  // Calentar
  await Promise.all([
    tickets.getAgents(), parts.getSpareParts(true), settings.getSettings(),
    equipment.getEquipmentTree(dueno), people.rolesByUser(autores), dashboardStates(),
  ]);

  console.log("\n  DETALLE DE TICKET — cinco lecturas independientes entre sí\n");
  const serie = await t(async () => {
    await tickets.getAgents();
    await parts.getSpareParts(true);
    await settings.getSettings();
    await equipment.getEquipmentTree(dueno);
    await people.rolesByUser(autores);
  });
  const par = await t(async () => {
    await Promise.all([
      tickets.getAgents(), parts.getSpareParts(true), settings.getSettings(),
      equipment.getEquipmentTree(dueno), people.rolesByUser(autores),
    ]);
  });
  console.log(`  en cascada (como está)  ${serie.ms.toFixed(1).padStart(6)} ms   ${serie.q} consultas`);
  console.log(`  en paralelo             ${par.ms.toFixed(1).padStart(6)} ms   ${par.q} consultas`);
  console.log(`\n  con red de por medio (5 viajes en serie contra 1 tanda):`);
  for (const rtt of [1, 5]) {
    console.log(`    ${rtt} ms de latencia →  cascada ${(serie.ms + serie.q * rtt).toFixed(0)} ms   paralelo ${(par.ms + rtt).toFixed(0)} ms`);
  }

  console.log("\n\n  EL LAYOUT — lo que se paga en CADA navegación del portal\n");
  // La marca queda fuera: usa `unstable_cache`, que necesita la caché
  // incremental de una petición real. Entre peticiones está cacheada por
  // inquilino, así que su costo amortizado es ~cero — es la única lectura del
  // portal que sí tiene caché de datos.
  const soloTab = await t(() => dashboardStates());
  console.log(`  solo los tableros       ${soloTab.ms.toFixed(1).padStart(6)} ms   ${soloTab.q} consultas   ← se repite en las 68 pantallas`);

  console.log("\n\n  CONSOLA DE PLATAFORMA — un stats por inquilino\n");
  const ten = await t(() => platform.getTenants());
  console.log(`  getTenants()            ${ten.ms.toFixed(1).padStart(6)} ms   ${ten.q} consultas para ${(await platform.getTenants()).length} inquilinos`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
