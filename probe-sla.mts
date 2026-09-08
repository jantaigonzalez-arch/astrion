/**
 * El SLA por cliente: opcional, en horas, y congelado al crear el ticket.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-sla.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { slaDueFrom, slaHorasValidas, SLA_HOURS, SLA_HORAS_MIN, SLA_HORAS_MAX } =
  await import("./src/lib/tickets.ts");
const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { slaHorasDelCliente } = await import("./src/lib/data/crm.ts");
const { getDb } = await import("./src/lib/db/index.ts");
const { sql } = await import("drizzle-orm");

const db = tenantDbFor("tenant_evoelution");
const control = getDb();
let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };

const AHORA = new Date("2026-09-05T09:00:00Z");
const horasEntre = (d: Date) => (d.getTime() - AHORA.getTime()) / 3_600_000;

console.log("── el plazo sale del cliente, o del general ──");
check(`sin plazo propio rigen las ${SLA_HOURS} h de siempre`,
  horasEntre(slaDueFrom(AHORA, null)) === SLA_HOURS);
check("sin argumento, lo mismo", horasEntre(slaDueFrom(AHORA)) === SLA_HOURS);
check("con 8 h pactadas, vence a las 8", horasEntre(slaDueFrom(AHORA, 8)) === 8);
check("con 24 h pactadas, al día siguiente", horasEntre(slaDueFrom(AHORA, 24)) === 24);

console.log("\n── un valor imposible NO apaga el compromiso ──");
for (const [v, nombre] of [[0, "cero"], [-5, "negativo"], [1.5, "con decimales"], [10000, "absurdo"]] as const) {
  check(`${nombre} cae al plazo general en vez de dejar el ticket suelto`,
    horasEntre(slaDueFrom(AHORA, v as number)) === SLA_HOURS);
}
check("cero no se admite: nacería vencido siempre", !slaHorasValidas(0));
check(`${SLA_HORAS_MIN} h sí`, slaHorasValidas(SLA_HORAS_MIN));
check(`${SLA_HORAS_MAX} h sí`, slaHorasValidas(SLA_HORAS_MAX));
check(`${SLA_HORAS_MAX + 1} h no`, !slaHorasValidas(SLA_HORAS_MAX + 1));

console.log("\n── contra la base: el plazo se busca por la cuenta que abre el ticket ──");
const [u] = (await control.execute(sql`
  insert into users (email, name, active) values ('probe-sla@example.invalid','Probe SLA',true)
  on conflict (email) do update set active = true returning id`)) as unknown as Array<{ id: string }>;
const [org] = (await db.execute(sql`
  insert into crm_organizations (name, client_id) values ('PRB Laboratorio SLA', ${u.id}::uuid)
  returning id`)) as unknown as Array<{ id: string }>;
try {
  check("sin pactar nada, la ficha devuelve null",
    (await slaHorasDelCliente(u.id, db)) === null);

  await db.execute(sql`update crm_organizations set sla_hours = 6 where id = ${org.id}::uuid`);
  check("con 6 h pactadas, la ficha las devuelve",
    (await slaHorasDelCliente(u.id, db)) === 6);
  check("y el vencimiento del ticket sería a las 6 h",
    horasEntre(slaDueFrom(AHORA, await slaHorasDelCliente(u.id, db))) === 6);

  check("una cuenta sin organización vinculada devuelve null",
    (await slaHorasDelCliente("00000000-0000-0000-0000-000000000000", db)) === null);

  // Cambiar el plazo NO puede mover lo ya creado: por eso se congela en la fila.
  const congelado = slaDueFrom(AHORA, 6);
  await db.execute(sql`update crm_organizations set sla_hours = 48 where id = ${org.id}::uuid`);
  check("subirlo a 48 h no mueve el vencimiento ya guardado",
    horasEntre(congelado) === 6);
} finally {
  await db.execute(sql`delete from crm_organizations where id = ${org.id}::uuid`);
  await control.execute(sql`delete from users where email = 'probe-sla@example.invalid'`);
  console.log("— limpieza hecha");
}

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
