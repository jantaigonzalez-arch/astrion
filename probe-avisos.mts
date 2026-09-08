/**
 * Los avisos de ticket: a quién le llegan y si de verdad salen.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-avisos.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { getDb } = await import("./src/lib/db/index.ts");
const { transporteDe, saliODeVerdad } = await import("./src/lib/mail/index.ts");
const { _interno } = await import("./src/lib/mail/tickets.ts");
const { sql } = await import("drizzle-orm");

const db = getDb();
let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };

const [t] = (await db.execute(sql`select id, slug from tenants where slug='evoelution'`)) as unknown as Array<{ id: string; slug: string }>;

console.log("── el transporte se declara, ya no se supone ──");
const tr = await transporteDe(t.id);
check("sin buzón ni proveedor, el transporte es «consola»", tr === "consola", tr);
check("y «consola» NO cuenta como enviado",
  !saliODeVerdad({ ok: true, id: "consola", propio: false, transporte: "consola" }));
check("smtp sí cuenta",
  saliODeVerdad({ ok: true, id: "x", propio: true, transporte: "smtp" }));

console.log("\n── a quién le llega un ticket nuevo ──");
const equipo = await _interno.equipoQueAtiende(t.id);
const esperados = (await db.execute(sql`
  select count(*)::int as n from memberships m join users u on u.id = m.user_id
   where m.tenant_id = ${t.id}::uuid and m.active and u.active
     and m.role in ('agent','admin','owner')`)) as unknown as Array<{ n: number }>;
check("son los que atienden: agentes, administradores y dueño",
  equipo.length === esperados[0].n, `${equipo.length} personas`);
check("todos con correo", equipo.every((p) => p.email.includes("@")));

// Una baja no debe recibir avisos.
const [u] = (await db.execute(sql`
  insert into users (email, name, active) values ('probe-aviso@example.invalid','Probe Aviso',true)
  on conflict (email) do update set active = true returning id`)) as unknown as Array<{ id: string }>;
await db.execute(sql`
  insert into memberships (user_id, tenant_id, role, active)
  values (${u.id}::uuid, ${t.id}::uuid, 'agent', true)
  on conflict (user_id, tenant_id) do update set role='agent', active=true`);
const conNuevo = await _interno.equipoQueAtiende(t.id);
check("un agente nuevo entra en la lista", conNuevo.length === equipo.length + 1);

await db.execute(sql`update memberships set active = false where user_id = ${u.id}::uuid`);
const sinBaja = await _interno.equipoQueAtiende(t.id);
check("dado de baja de la empresa, se le deja de avisar", sinBaja.length === equipo.length);

await db.execute(sql`update memberships set active = true where user_id = ${u.id}::uuid`);
await db.execute(sql`update users set active = false where id = ${u.id}::uuid`);
const sinCuenta = await _interno.equipoQueAtiende(t.id);
check("cuenta desactivada, tampoco", sinCuenta.length === equipo.length);

await db.execute(sql`delete from memberships where user_id = ${u.id}::uuid`);
await db.execute(sql`delete from users where id = ${u.id}::uuid`);

console.log("\n── las dos plantillas del alta ──");
const acuse = _interno.plantilla({
  titulo: "EVO-000001 · recibimos tu solicitud",
  cuerpo: ["Registramos «Prueba» con el folio EVO-000001."],
  boton: { texto: "Seguir el ticket", href: "https://x/tickets/1" },
  pie: "Empresa · guarda el folio.",
});
check("el acuse lleva folio y enlace",
  acuse.texto.includes("EVO-000001") && acuse.html.includes("https://x/tickets/1"));
const peligro = _interno.plantilla({
  titulo: "x", cuerpo: ['<script>alert("x")</script>'],
  boton: { texto: "b", href: "https://x" }, pie: "p",
});
check("y lo que escribe la gente se escapa",
  !peligro.html.includes("<script>") && peligro.html.includes("&lt;script&gt;"));

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
