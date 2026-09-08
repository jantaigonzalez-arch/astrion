/**
 * El ajuste guardado en la base llega hasta la decisión.
 *
 * El otro probe comprueba el MODELO en memoria. Éste cierra el circuito: escribe
 * `memberships.permissions` de verdad, lo vuelve a leer por el mismo camino que
 * usa una petición —`ajustesGuardados`— y comprueba que el menú y los guardias
 * cambian. Sin esto, el modelo podría estar perfecto y la columna no llegar.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-permisos-db.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { getDb } = await import("./src/lib/db/index.ts");
const { navFor } = await import("./src/lib/portal/menu.ts");
const { ajustesGuardados, nivelEfectivo, puedeEntrar } = await import("./src/lib/permisos.ts");
const { sql } = await import("drizzle-orm");

const db = getDb();
let fallos = 0;
const check = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const [t] = (await db.execute(sql`select id from tenants where slug = 'evoelution' limit 1`)) as unknown as Array<{ id: string }>;
const [u] = (await db.execute(sql`
  insert into users (email, name, active) values ('probe-perm@example.invalid', 'Probe Perm', true)
  on conflict (email) do update set active = true returning id`)) as unknown as Array<{ id: string }>;
await db.execute(sql`
  insert into memberships (user_id, tenant_id, role, active)
  values (${u.id}::uuid, ${t.id}::uuid, 'agent', true)
  on conflict (user_id, tenant_id) do update set role = 'agent', active = true, permissions = '{}'::jsonb`);

const leer = async () => {
  const [m] = (await db.execute(sql`
    select role, permissions from memberships
     where user_id = ${u.id}::uuid and tenant_id = ${t.id}::uuid`)) as unknown as Array<{ role: string; permissions: unknown }>;
  return { role: m.role as never, ajustes: ajustesGuardados(m.permissions) };
};

try {
  console.log("── recién creado: un agente normal ──");
  let m = await leer();
  check("el mapa nace vacío", JSON.stringify(m.ajustes) === "{}");
  check("y tiene Compras, como cualquier agente",
    puedeEntrar(m.role, m.ajustes, "/admin/compras"));
  check("y NO tiene Cuentas por pagar",
    !puedeEntrar(m.role, m.ajustes, "/admin/compras/cuentas-por-pagar"));

  console.log("\n── se le DA Cuentas por pagar, sin tocarle el rol ──");
  await db.execute(sql`
    update memberships set permissions = ${JSON.stringify({ pagar: "administrar" })}::jsonb
     where user_id = ${u.id}::uuid and tenant_id = ${t.id}::uuid`);
  m = await leer();
  check("sigue siendo agente", m.role === "agent");
  check("y ahora entra a Cuentas por pagar",
    puedeEntrar(m.role, m.ajustes, "/admin/compras/cuentas-por-pagar"));
  check("le aparece en el menú",
    navFor(m.role, [], m.ajustes).some((g) =>
      g.items.some((i) => i.href === "/admin/compras/cuentas-por-pagar")));
  check("pero sigue sin Configuración",
    !puedeEntrar(m.role, m.ajustes, "/admin/configuracion/usuarios"));

  console.log("\n── se le QUITA Compras ──");
  await db.execute(sql`
    update memberships set permissions = ${JSON.stringify({ pagar: "administrar", compras: "ninguno" })}::jsonb
     where user_id = ${u.id}::uuid and tenant_id = ${t.id}::uuid`);
  m = await leer();
  check("ya no entra a Compras", !puedeEntrar(m.role, m.ajustes, "/admin/compras"));
  check("ni a una orden suelta", !puedeEntrar(m.role, m.ajustes, "/admin/compras/nueva"));
  check("la sección Compras se queda solo con Cuentas por pagar",
    JSON.stringify(navFor(m.role, [], m.ajustes).find((g) => g.section === "Compras")?.items.map((i) => i.href))
      === '["/admin/compras/cuentas-por-pagar"]');
  check("y Servicio sigue intacto, porque nadie lo tocó",
    nivelEfectivo(m.role, m.ajustes, "servicio") === "editar");

  console.log("\n── solo lectura en Servicio ──");
  await db.execute(sql`
    update memberships set permissions = ${JSON.stringify({ servicio: "ver" })}::jsonb
     where user_id = ${u.id}::uuid and tenant_id = ${t.id}::uuid`);
  m = await leer();
  check("entra a la cola de tickets", puedeEntrar(m.role, m.ajustes, "/admin/tickets"));
  check("y NO puede levantar uno nuevo",
    !puedeEntrar(m.role, m.ajustes, "/admin/tickets/new"));
  check("el menú enseña la cola sin el alta",
    JSON.stringify(navFor(m.role, [], m.ajustes).find((g) => g.section === "Servicio")?.items.map((i) => i.href))
      === '["/admin/tickets"]');

  console.log("\n── una fila corrupta no rompe nada ──");
  await db.execute(sql`
    update memberships set permissions = ${JSON.stringify({ modulo_viejo: "ver", compras: "nivel_raro" })}::jsonb
     where user_id = ${u.id}::uuid and tenant_id = ${t.id}::uuid`);
  m = await leer();
  check("se descarta entera y se cae al rol", JSON.stringify(m.ajustes) === "{}");
  check("y la persona conserva lo de su rol",
    puedeEntrar(m.role, m.ajustes, "/admin/compras"));
} finally {
  await db.execute(sql`delete from memberships where user_id in (select id from users where email = 'probe-perm@example.invalid')`);
  await db.execute(sql`delete from users where email = 'probe-perm@example.invalid'`);
  console.log("— limpieza hecha");
}
console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
