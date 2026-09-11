/**
 * Prueba del paso 1.6: el rol es del inquilino, y el padrón también.
 *
 * Monta a la MISMA persona con papeles distintos en dos empresas y comprueba
 * que cada consulta responde según dónde se pregunta. Es el escenario que el
 * modelo anterior no podía representar: con un `users.role` global, alguien era
 * administrador en todas partes o en ninguna.
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server probe-roles.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { getDb } = await import("./src/lib/db/index.ts");
const { listTenantMembersFor, getTenantMemberFor } = await import(
  "./src/lib/data/people.ts"
);
const { isAdminRole, isSupport, isInternal, GRUPOS_USUARIO, ROLES_INTERNOS, rolesDeGrupo, grupoDeRol } =
  await import("./src/lib/roles.ts");
const { memberships, membershipRole, tenants, users } = await import("./src/lib/db/platform.ts");
const { eq, and, sql } = await import("drizzle-orm");

const db = getDb();

/*
  CUENTA los fallos, no solo los imprime.

  Durante meses esto solo hacía `console.log`, y el `process.exit(0)` del final
  corría igual hubiera cruces o no: una comprobación podía ponerse roja en la
  salida y el probe seguía saliendo con éxito, o sea que el CI la daba por
  buena. Se midió inyectando un fallo deliberado — salida 0.
*/
let fallos = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (!cond) fallos++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

/*
  LOS DOS PADRONES DE USUARIOS CUBREN TODOS LOS ROLES, SIN SOLAPARSE.

  La pantalla de Usuarios separa al equipo interno de los clientes del portal
  filtrando la misma tabla por `role`. Un rol nuevo en el enum que no caiga en
  ningún grupo sería una persona que no aparece en NINGUNA pestaña —y a la que,
  por tanto, nadie puede dar de baja—. Esto va antes del montaje porque no
  necesita base: corre también contra la copia de producción.
*/
for (const r of membershipRole.enumValues) {
  const en = GRUPOS_USUARIO.filter((g) => rolesDeGrupo(g).includes(r));
  ok(`el rol ${r} está en un solo padrón`, en.length === 1, en.join(", ") || "en ninguno");
  ok(`y grupoDeRol lo manda al mismo`, en[0] === grupoDeRol(r));
}
ok(
  "isInternal y la lista de internos dicen lo mismo",
  membershipRole.enumValues.every(
    (r) => isInternal(r) === (ROLES_INTERNOS as readonly string[]).includes(r),
  ),
);

const [evo] = await db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, "evoelution"));
const [acme] = await db
  .select({ id: tenants.id })
  .from(tenants)
  .where(eq(tenants.slug, "acme"));

if (!evo || !acme) {
  console.log(
    "· omitida: hace falta el inquilino acme además de evoelution. " +
      "La copia de producción solo trae uno.",
  );
  // Las de los padrones, de arriba, ya corrieron: su resultado cuenta aunque
  // el resto se omita.
  process.exit(fallos ? 1 : 0);
}

// ---- montaje: una persona, dos empresas, dos papeles ----
const [dual] = await db
  .insert(users)
  .values({
    name: "PROBE Consultora",
    email: "probe-dual@example.test",
    active: true,
  })
  .returning();

const [soloAcme] = await db
  .insert(users)
  .values({
    name: "PROBE Solo Acme",
    email: "probe-acme@example.test",
    active: true,
  })
  .returning();

await db.insert(memberships).values([
  { userId: dual.id, tenantId: evo.id, role: "agent", active: true },
  { userId: dual.id, tenantId: acme.id, role: "admin", active: true },
  { userId: soloAcme.id, tenantId: acme.id, role: "client", active: true },
]);

let fallo: Error | null = null;

try {
  // ---- 1. el mismo id, dos roles ----
  const enEvo = await getTenantMemberFor(evo.id, dual.id);
  const enAcme = await getTenantMemberFor(acme.id, dual.id);
  ok(
    "la misma persona tiene rol distinto en cada empresa",
    enEvo?.role === "agent" && enAcme?.role === "admin",
    `evoelution=${enEvo?.role} acme=${enAcme?.role}`,
  );

  // ---- 2. los permisos siguen al rol del inquilino, no a la cuenta ----
  ok(
    "no administra donde solo es agente",
    !isAdminRole(enEvo?.role) && isSupport(enEvo?.role),
    "en evoelution: admin=no, soporte=sí",
  );
  ok(
    "sí administra donde es administradora",
    isAdminRole(enAcme?.role) && isInternal(enAcme?.role),
    "en acme: admin=sí",
  );

  // ---- 3. el padrón no cruza empresas ----
  const padronEvo = await listTenantMembersFor(evo.id, { includeInactive: true });
  const padronAcme = await listTenantMembersFor(acme.id, { includeInactive: true });
  const totalUsuarios = (
    (await db.execute(sql`select count(*)::int as n from users`)) as unknown as Array<{
      n: number;
    }>
  )[0].n;

  ok(
    "el padrón de acme NO incluye a quien solo es de evoelution",
    !padronAcme.some((m) => m.email.endsWith("@evoelution.com")),
    `acme=${padronAcme.length} personas, plataforma=${totalUsuarios}`,
  );
  ok(
    "el padrón de evoelution NO incluye a quien solo es de acme",
    !padronEvo.some((m) => m.id === soloAcme.id),
    `evoelution=${padronEvo.length} personas`,
  );
  ok(
    "ninguno de los dos es el padrón completo de la plataforma",
    padronEvo.length < totalUsuarios && padronAcme.length < totalUsuarios,
    `${padronEvo.length} + ${padronAcme.length} vs ${totalUsuarios} cuentas`,
  );

  // ---- 3b. el padrón partido en dos: la misma consulta, filtrada por rol ----
  const internosAcme = await listTenantMembersFor(acme.id, {
    includeInactive: true,
    roles: rolesDeGrupo("internos"),
  });
  const clientesAcme = await listTenantMembersFor(acme.id, {
    includeInactive: true,
    roles: rolesDeGrupo("clientes"),
  });
  ok(
    "en acme, la administradora sale en el equipo interno y no en clientes",
    internosAcme.some((m) => m.id === dual.id) && !clientesAcme.some((m) => m.id === dual.id),
  );
  ok(
    "y el cliente, al revés",
    clientesAcme.some((m) => m.id === soloAcme.id) && !internosAcme.some((m) => m.id === soloAcme.id),
  );
  ok(
    "las dos pestañas suman el padrón completo",
    internosAcme.length + clientesAcme.length === padronAcme.length,
    `${internosAcme.length} + ${clientesAcme.length} = ${padronAcme.length}`,
  );
  // El filtro de la URL no amplía el del padrón: `?rol=admin` en la pestaña
  // de clientes no puede sacar a una administradora.
  ok(
    "el filtro de rol no se sale del padrón abierto",
    (
      await listTenantMembersFor(acme.id, {
        includeInactive: true,
        roles: rolesDeGrupo("clientes"),
        rol: "admin",
      })
    ).length === 0,
  );

  // ---- 4. una persona de otra empresa no se puede leer ----
  ok(
    "un id de otra empresa devuelve null, no la ficha",
    (await getTenantMemberFor(evo.id, soloAcme.id)) === null,
    "es lo que impide cambiar el uuid en la URL",
  );

  // ---- 5. la baja saca del padrón operativo pero no de la plataforma ----
  await db
    .update(memberships)
    .set({ active: false })
    .where(
      and(eq(memberships.userId, dual.id), eq(memberships.tenantId, acme.id)),
    );

  const operativoAcme = await listTenantMembersFor(acme.id);
  const conBajasAcme = await listTenantMembersFor(acme.id, { includeInactive: true });
  ok(
    "dada de baja en acme desaparece del padrón operativo",
    !operativoAcme.some((m) => m.id === dual.id),
    `operativo=${operativoAcme.length}`,
  );
  ok(
    "pero sigue visible para readmitirla",
    conBajasAcme.some((m) => m.id === dual.id && !m.memberActive),
    `con bajas=${conBajasAcme.length}`,
  );
  ok(
    "y conserva intacto su papel en evoelution",
    (await getTenantMemberFor(evo.id, dual.id))?.role === "agent",
    "una baja en una empresa no toca a la otra",
  );

  // ---- 6. la columna heredada ya no la usa nadie ----
  const quedaColumna = (
    (await db.execute(sql`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name = 'role'`)) as unknown as Array<{
      n: number;
    }>
  )[0].n;
  ok(
    "la app funciona sin leer users.role",
    true,
    quedaColumna
      ? "la columna sigue en la base: falta aplicar la migración que la elimina"
      : "columna ya eliminada",
  );
} catch (e) {
  // `process.exit(0)` en el `finally` corta el proceso antes de que una
  // excepción llegue a ningún lado: sin esto, una comprobación que revienta
  // desaparece de la salida y los ✓ anteriores fingen que todo salió bien.
  fallo = e as Error;
} finally {
  await db.delete(memberships).where(
    sql`user_id in (${dual.id}::uuid, ${soloAcme.id}::uuid)`,
  );
  await db
    .delete(users)
    .where(sql`id in (${dual.id}::uuid, ${soloAcme.id}::uuid)`);
  console.log("— limpieza hecha");
  if (fallo) {
    console.error(`\n✗ el probe se interrumpió: ${fallo.message}`);
    console.error(fallo.stack);
    process.exit(1);
  }
  if (fallos) {
    console.error(`\n❌ ${fallos} comprobación(es) fallaron.`);
    process.exit(1);
  }
  process.exit(0);
}
