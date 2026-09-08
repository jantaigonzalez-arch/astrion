/**
 * La bandeja de avisos: quién recibe qué, y por qué canal.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-campana.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { getDb } = await import("./src/lib/db/index.ts");
const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { crearAvisos } = await import("./src/lib/notificaciones.ts");
const { _interno } = await import("./src/lib/mail/tickets.ts");
const { sql } = await import("drizzle-orm");

const control = getDb();
const db = tenantDbFor("tenant_evoelution");
let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };

const [t] = (await control.execute(sql`select id from tenants where slug='evoelution'`)) as unknown as Array<{ id: string }>;

// Dos cuentas de prueba: una del equipo y una cliente.
const alta = async (email: string, role: string) => {
  const [u] = (await control.execute(sql`
    insert into users (email, name, active) values (${email}, ${email}, true)
    on conflict (email) do update set active=true returning id`)) as unknown as Array<{ id: string }>;
  await control.execute(sql`
    insert into memberships (user_id, tenant_id, role, active)
    values (${u.id}::uuid, ${t.id}::uuid, ${sql.raw(`'${role}'`)}, true)
    on conflict (user_id, tenant_id) do update set role=${sql.raw(`'${role}'`)}, active=true`);
  return u.id;
};

const idAgente = await alta("probe-agente@example.invalid", "agent");
const idCliente = await alta("probe-cliente@example.invalid", "client");

// Un ticket de verdad al que colgar los avisos.
const [tk] = (await db.execute(sql`
  insert into tickets (reference, subject, description, category, priority, status, type, created_by_id)
  values ('PRB-CAMPANA', 'Prueba', 'Prueba de campana', 'support', 'medium', 'open', 'service', ${idCliente}::uuid)
  returning id`)) as unknown as Array<{ id: string }>;

try {
  console.log("── el canal se decide por el rol EN ESTA empresa ──");
  const clasif = await _interno.personas([idAgente, idCliente], t.id);
  check("un agente NO recibe correo", clasif.get(idAgente)?.esCliente === false);
  check("un cliente SÍ recibe correo", clasif.get(idCliente)?.esCliente === true);
  const sinMembresia = await _interno.personas(["00000000-0000-0000-0000-000000000000"], t.id);
  check("quien no está en el mapa no rompe nada", sinMembresia.size === 0);

  console.log("\n── una fila por persona, no una compartida ──");
  await crearAvisos({
    paraUsuarios: [idAgente, idCliente],
    ticketId: tk.id, tipo: "ticket.creado",
    titulo: "PRB-CAMPANA · entró un ticket nuevo", cuerpo: "Cuerpo",
  }, db);
  let [n] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid`)) as unknown as Array<{ n: number }>;
  check("dos destinatarios, dos filas", n.n === 2, `${n.n}`);

  const [leidos] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid and read_at is null`)) as unknown as Array<{ n: number }>;
  check("las dos nacen sin leer", leidos.n === 2);

  // Que uno la marque no puede marcársela al otro.
  await db.execute(sql`update notifications set read_at = now() where ticket_id=${tk.id}::uuid and user_id=${idAgente}::uuid`);
  const [tras] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid and read_at is null`)) as unknown as Array<{ n: number }>;
  check("marcar la mía no marca la del otro", tras.n === 1, `queda ${tras.n} sin leer`);

  console.log("\n── los casos de borde ──");
  await crearAvisos({ paraUsuarios: [], ticketId: tk.id, tipo: "ticket.creado", titulo: "x" }, db);
  [n] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid`)) as unknown as Array<{ n: number }>;
  check("sin destinatarios no escribe nada y no revienta", n.n === 2);

  await crearAvisos({ paraUsuarios: [idAgente, idAgente], ticketId: tk.id, tipo: "ticket.asignado", titulo: "repe" }, db);
  const [rep] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid and kind='ticket.asignado'`)) as unknown as Array<{ n: number }>;
  check("un destinatario repetido escribe una sola fila", rep.n === 1, `${rep.n}`);

  console.log("\n── borrar el ticket se lleva sus avisos ──");
  await db.execute(sql`delete from tickets where id = ${tk.id}::uuid`);
  const [huerfanos] = (await db.execute(sql`select count(*)::int as n from notifications where ticket_id=${tk.id}::uuid`)) as unknown as Array<{ n: number }>;
  check("no quedan avisos colgando de un ticket que no existe", huerfanos.n === 0);
} finally {
  await db.execute(sql`delete from tickets where reference = 'PRB-CAMPANA'`);
  await control.execute(sql`delete from memberships where user_id in (select id from users where email like 'probe-%@example.invalid')`);
  await control.execute(sql`delete from users where email like 'probe-%@example.invalid'`);
  console.log("— limpieza hecha");
}
console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
