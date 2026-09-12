/**
 * LAS PERSONAS DE UNA EMPRESA: ALTA, EDICIÓN Y CONTRASEÑA.
 *
 *   PROBE_SCHEMA=tenant_bajio npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-acciones-usuarios.ts
 *
 * Tres acciones que escriben en tablas de PLATAFORMA —`users` y `memberships`—,
 * no en el esquema de la empresa. Eso cambia qué se protege: una fila de
 * `users` vale en TODAS las empresas de esa persona, así que un descuido aquí
 * no se queda en casa. Lo que se ata:
 *
 *   · que nadie se asigne `owner` ni un rol que no existe;
 *   · que el administrador no pueda quitarse a sí mismo el acceso;
 *   · que el `id` del formulario no alcance a alguien de OTRA empresa, ni a su
 *     membresía allí, ni a su contraseña.
 *
 * ── POR QUÉ CORRE SOBRE `tenant_bajio` ─────────────────────────────────────
 *
 * Porque da de alta administradores y dueños de mentira, y en `evoelution` eso
 * se nota fuera de este proceso: `probe-avisos` cuenta a los agentes,
 * administradores y dueños de esa empresa y compara, y un dueño de este probe
 * que coincida en el tiempo le descuadra la cuenta. Bajío no la mira nadie más.
 *
 * Todas las personas son de este probe, con correo `cfg-…@example.invalid`: no
 * se edita ni se desactiva a nadie de la base sembrada.
 */
import bcrypt from "bcryptjs";
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
  como,
  conError,
  filas,
  forma,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
} from "./_acciones-kit";

const M = marca("CFG");
/** Prefijo de los correos: todo lo que empiece así es de esta corrida. */
const PREFIJO = M.toLowerCase();
const correo = (quien: string) => `${PREFIJO}-${quien}@example.invalid`;
const CLAVE_ORIGINAL = "CFG-original-1";

async function idEmpresa(esquema: string): Promise<string> {
  const [t] = await sql<{ id: string }[]>`
    select id from tenants where slug = ${esquema.replace(/^tenant_/, "")}`;
  if (!t) throw new Error(`la base no trae la empresa ${esquema}`);
  return t.id;
}

/** Una persona de este probe, con sus membresías ya puestas. */
async function persona(quien: string, membresias: Array<[string, string]>): Promise<string> {
  const [u] = await sql<{ id: string }[]>`
    insert into users (name, email, active, password_hash)
    values (${`${M} ${quien}`}, ${correo(quien)}, true, ${bcrypt.hashSync(CLAVE_ORIGINAL, 4)})
    returning id`;
  for (const [tenantId, rol] of membresias)
    await sql`insert into memberships (user_id, tenant_id, role, active, accepted_at)
              values (${u.id}, ${tenantId}, ${rol}, true, now())`;
  return u.id;
}

const filaUsuario = (id: string) =>
  `select name, email, company, phone, active, password_hash from users where id = '${id}'`;
const membresiasDe = (id: string) =>
  `select tenant_id, role, active, permissions from memberships where user_id = '${id}' order by tenant_id`;
/** Lo que un alta movería: personas y membresías de esta corrida. */
const DE_ESTA_CORRIDA = [
  `select count(*)::int as n from users where email like '${PREFIJO}-%'`,
  `select count(*)::int as n from memberships m join users u on u.id = m.user_id
    where u.email like '${PREFIJO}-%'`,
];

type Membresia = { tenant_id: string; role: string; active: boolean; permissions: unknown };
type Usuario = {
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  active: boolean;
  password_hash: string | null;
};

void probar("usuarios: alta, edición y contraseña sin salirse de la empresa", async () => {
  const EMP = await idEmpresa(ESQUEMA);
  const OTRA = await idEmpresa(AJENO);

  /*
    La limpieza se registra ANTES de crear nada y por el prefijo del correo, no
    por ids: así se lleva también a quien haya dado de alta una acción a mitad
    de un fallo. Borrar la persona arrastra sus membresías (`on delete
    cascade`) y suelta el vínculo con la organización (`set null`).
  */
  alLimpiar(() => sql.unsafe(`delete from users where email like '${PREFIJO}-%'`));
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.crm_organizations where name like '${M}%'`));
  alLimpiar(() => sql.unsafe(`delete from ${AJENO}.crm_organizations where name like '${M}%'`));

  const ACTOR = await persona("actor", [[EMP, "admin"]]);
  const OBJ = await persona("objetivo", [[EMP, "agent"]]);
  const DUENA = await persona("duena", [[EMP, "owner"]]);
  /** Solo de la otra empresa: el `id` que un administrador de aquí no debe alcanzar. */
  const AJENA = await persona("ajena", [[OTRA, "agent"]]);
  /** De la otra empresa también, para el alta de alguien que ya tenía cuenta. */
  const CONSULTORA = await persona("consultora", [[OTRA, "agent"]]);
  /** Agente aquí y DUEÑA en la otra: la misma cuenta abre las dos. */
  const MIXTA = await persona("mixta", [[EMP, "agent"], [OTRA, "owner"]]);
  // Agente aquí y agente allá: sin más rango, la clave igual le abre la otra.
  const DOBLE = await persona("doble", [[EMP, "agent"], [OTRA, "agent"]]);

  const [org] = await sql<{ id: string }[]>`
    insert into ${sql(ESQUEMA)}.crm_organizations (name) values (${`${M} Organización`}) returning id`;
  const [orgAjena] = await sql<{ id: string }[]>`
    insert into ${sql(AJENO)}.crm_organizations (name) values (${`${M} Organización ajena`}) returning id`;
  const ORG = org.id;
  const ORG_AJENA = orgAjena.id;

  const u = await import("@/lib/actions/users");
  const inicial = { ok: false };

  /* ══════════════════════════ createUser ══════════════════════════════ */

  const ALTA = {
    name: `${M} Nueva`,
    email: correo("nueva"),
    role: "agent",
    password: "CFG-clave-123",
  };

  seccion("alta: sin permiso, o con «editar», no entra nadie");
  /*
    `createUser` no llama a `auth()`: su única guardia es `puedeEn()`, que en la
    aplicación ya dice que no cuando no hay sesión —sin sesión no hay empresa,
    y sin empresa el nivel es «ninguno»—. El stub no deduce eso solo, así que
    «sin sesión» se escribe con el permiso denegado, que es lo que vería.
  */
  como(null, false);
  await rechazaSinEscribir("alta sin sesión", () => u.createUser(inicial, forma(ALTA)), DE_ESTA_CORRIDA, conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("alta sin permiso", () => u.createUser(inicial, forma(ALTA)), DE_ESTA_CORRIDA, conError("auth"));
  /*
    «editar» en Configuración no alcanza: dar de alta a alguien es repartir
    llaves, no el trabajo del día.
  */
  como(ACTOR, "configuracion:editar");
  await rechazaSinEscribir("alta con «editar»", () => u.createUser(inicial, forma(ALTA)), DE_ESTA_CORRIDA, conError("auth"));

  seccion("alta: ni dueño, ni un rol inventado, ni una captura rota");
  como(ACTOR, "configuracion:administrar");
  /*
    `owner` no se asigna desde aquí: es la titularidad de la cuenta y se da al
    aprovisionar. Si el formulario lo acepta, cualquier administrador se
    nombra dueño en dos clics.
  */
  for (const [nombre, cambio] of [
    ["rol «owner»", { role: "owner" }],
    ["rol «superadmin»", { role: "superadmin" }],
    ["correo que no es correo", { email: "no-es-un-correo" }],
    ["contraseña de 5", { password: "corta" }],
    ["nombre de una letra", { name: "X" }],
  ] as const)
    await rechazaSinEscribir(
      `alta con ${nombre}`,
      () => u.createUser(inicial, forma({ ...ALTA, ...cambio })),
      DE_ESTA_CORRIDA,
      conError("invalid"),
    );

  seccion("alta: se crea la cuenta y la membresía, en ESTA empresa");
  /* Las tres acciones devuelven formas parecidas; ésta las abarca a todas. */
  let r: { ok: boolean; error?: string; createdId?: string; linkedExisting?: boolean } = await u.createUser(
    inicial,
    forma({ ...ALTA, email: ALTA.email.toUpperCase(), company: `${M} SA`, phone: "555-0100" }),
  );
  ok("el alta responde ok", r.ok === true, r.error);
  ok("y es una cuenta nueva, no un vínculo", r.linkedExisting === false);
  // Si el alta no devolvió id, uno de ceros: las comprobaciones de abajo salen
  // rojas en vez de reventar la consulta con un uuid vacío.
  const NUEVA = r.createdId ?? "00000000-0000-0000-0000-000000000000";
  const [nueva] = await filas<Usuario>(filaUsuario(NUEVA));
  ok("el correo se guarda en minúsculas", nueva?.email === ALTA.email, nueva?.email);
  ok("con el nombre, la compañía y el teléfono", nueva?.name === ALTA.name && nueva?.company === `${M} SA` && nueva?.phone === "555-0100");
  ok("y la contraseña hasheada, no en claro", !!nueva?.password_hash && nueva.password_hash !== ALTA.password && bcrypt.compareSync(ALTA.password, nueva.password_hash));
  const deLaNueva = await filas<Membresia & { accepted_at: Date | null }>(
    `select tenant_id, role, active, permissions, accepted_at from memberships where user_id = '${NUEVA}'`,
  );
  ok(
    "con UNA membresía, en esta empresa, activa y con el rol pedido",
    deLaNueva.length === 1 &&
      deLaNueva[0].tenant_id === EMP &&
      deLaNueva[0].role === "agent" &&
      deLaNueva[0].active &&
      deLaNueva[0].accepted_at !== null,
    JSON.stringify(deLaNueva.map((m) => [m.tenant_id === EMP ? "esta" : "otra", m.role, m.active])),
  );

  await rechazaSinEscribir(
    "el mismo correo otra vez",
    () => u.createUser(inicial, forma(ALTA)),
    DE_ESTA_CORRIDA,
    conError("duplicate"),
  );

  seccion("alta de alguien que ya tenía cuenta en otra empresa: se vincula, no se apodera");
  /*
    Una identidad, muchas membresías. Lo que NO puede pasar es que el alta pise
    su nombre o su contraseña: sería apoderarse de una cuenta que también abre
    otra empresa, con solo saber su correo.
  */
  const [consultoraAntes] = await filas<Usuario>(filaUsuario(CONSULTORA));
  r = await u.createUser(
    inicial,
    forma({ name: `${M} Me Apodero`, email: correo("consultora").toUpperCase(), role: "sales", password: "CFG-me-apodero-1" }),
  );
  const [consultoraDespues] = await filas<Usuario>(filaUsuario(CONSULTORA));
  ok("responde ok como vínculo", r.ok === true && r.linkedExisting === true && r.createdId === CONSULTORA, JSON.stringify(r));
  ok(
    "su nombre y su contraseña quedan intactos",
    JSON.stringify(consultoraAntes) === JSON.stringify(consultoraDespues),
  );
  ok("la contraseña del formulario NO abre su cuenta", !bcrypt.compareSync("CFG-me-apodero-1", consultoraDespues?.password_hash ?? ""));
  let ms = await filas<Membresia>(membresiasDe(CONSULTORA));
  ok(
    "gana la membresía aquí con el rol pedido, y la de la otra empresa no cambia",
    ms.length === 2 &&
      ms.some((m) => m.tenant_id === EMP && m.role === "sales" && m.active) &&
      ms.some((m) => m.tenant_id === OTRA && m.role === "agent" && m.active),
    JSON.stringify(ms.map((m) => [m.tenant_id === EMP ? "esta" : "otra", m.role])),
  );

  /* Reactivar una baja es dar de alta otra vez: revive la fila con el rol nuevo. */
  const BAJA = await persona("baja", [[EMP, "agent"]]);
  await sql`update memberships set active = false where user_id = ${BAJA}`;
  r = await u.createUser(inicial, forma({ ...ALTA, email: correo("baja"), role: "general" }));
  ms = await filas<Membresia>(membresiasDe(BAJA));
  ok(
    "una baja se readmite con el rol nuevo, sin otra fila",
    r.ok === true && ms.length === 1 && ms[0].role === "general" && ms[0].active,
    JSON.stringify(ms.map((m) => [m.role, m.active])),
  );

  /* ══════════════════════════ updateUser ══════════════════════════════ */

  const EDITAR = (id: string, extra: Record<string, string | undefined> = {}) =>
    forma({ id, name: `${M} Editada`, role: "agent", active: "on", ...extra });
  const FOTO_OBJ = [filaUsuario(OBJ), membresiasDe(OBJ)];

  seccion("edición: la guardia, y el nivel");
  /*
    Ésta sí pregunta por la sesión además del permiso, así que se prueba con el
    permiso CONCEDIDO: si rechaza, es la comprobación de sesión la que lo hizo.
  */
  como(null, true);
  await rechazaSinEscribir("editar sin sesión", () => u.updateUser(inicial, EDITAR(OBJ)), FOTO_OBJ, conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("editar sin permiso", () => u.updateUser(inicial, EDITAR(OBJ)), FOTO_OBJ, conError("auth"));
  como(ACTOR, "configuracion:editar");
  await rechazaSinEscribir("editar con «editar»", () => u.updateUser(inicial, EDITAR(OBJ)), FOTO_OBJ, conError("auth"));

  seccion("edición: ni dueño, ni rol inventado, ni captura rota");
  como(ACTOR, "configuracion:administrar");
  for (const [nombre, forma_] of [
    ["ascenderlo a «owner»", EDITAR(OBJ, { role: "owner" })],
    ["un rol de plataforma", EDITAR(OBJ, { role: "superadmin" })],
    ["un id que no es uuid", EDITAR("no-soy-un-uuid")],
    ["nombre de una letra", EDITAR(OBJ, { name: "X" })],
    ["organización que no es uuid", EDITAR(OBJ, { crmOrganizationId: "abc" })],
  ] as const)
    await rechazaSinEscribir(`editar con ${nombre}`, () => u.updateUser(inicial, forma_), FOTO_OBJ, conError("invalid"));

  await rechazaSinEscribir(
    "editar a la dueña de la cuenta",
    () => u.updateUser(inicial, EDITAR(DUENA, { role: "admin" })),
    [filaUsuario(DUENA), membresiasDe(DUENA)],
    conError("owner"),
  );

  seccion("edición: el id de alguien de OTRA empresa no alcanza");
  await rechazaSinEscribir(
    "editar a una persona de otra empresa",
    () => u.updateUser(inicial, EDITAR(AJENA, { role: "admin", name: `${M} Secuestrada` })),
    [filaUsuario(AJENA), membresiasDe(AJENA)],
    conError("invalid"),
  );

  seccion("edición: el administrador no se quita a sí mismo el acceso");
  const FOTO_ACTOR = [filaUsuario(ACTOR), membresiasDe(ACTOR)];
  await rechazaSinEscribir(
    "bajarse a agente",
    () => u.updateUser(inicial, EDITAR(ACTOR, { role: "agent" })),
    FOTO_ACTOR,
    conError("self"),
  );
  await rechazaSinEscribir(
    "darse de baja",
    () => u.updateUser(inicial, EDITAR(ACTOR, { role: "admin", active: undefined })),
    FOTO_ACTOR,
    conError("self"),
  );
  /*
    El ajuste por persona REEMPLAZA al rol en ese módulo (`nivelEfectivo`): un
    administrador con `configuracion: ninguno` es un administrador que ya no
    entra a Usuarios, que es justo donde se deshace. Mirar solo el rol dejaba
    pasar las dos.
  */
  for (const nivel of ["ninguno", "ver", "editar"])
    await rechazaSinEscribir(
      `quitarse Configuración (${nivel}) sin tocar el rol`,
      () => u.updateUser(inicial, EDITAR(ACTOR, { role: "admin", "permiso.configuracion": nivel })),
      FOTO_ACTOR,
      conError("self"),
    );
  r = await u.updateUser(inicial, EDITAR(ACTOR, { role: "admin", "permiso.compras": "ninguno" }));
  ms = await filas<Membresia>(membresiasDe(ACTOR));
  ok(
    "pero sí puede ajustarse OTRO módulo a sí mismo",
    r.ok === true && JSON.stringify(ms[0]?.permissions) === JSON.stringify({ compras: "ninguno" }),
    r.error ?? JSON.stringify(ms[0]?.permissions),
  );

  seccion("edición: se guarda el perfil, el rol, los ajustes y el vínculo");
  r = await u.updateUser(
    inicial,
    EDITAR(OBJ, {
      name: `${M} Objetivo editado`,
      company: "Compañía CFG",
      phone: "555-0101",
      role: "sales",
      "permiso.compras": "ver",
      // Un nivel que no existe y un módulo que no existe se DESCARTAN.
      "permiso.ventas": "superpoder",
      "permiso.inventado": "administrar",
      crmOrganizationId: ORG,
    }),
  );
  ok("la edición responde ok", r.ok === true, r.error);
  const [objeto] = await filas<Usuario>(filaUsuario(OBJ));
  ok(
    "el perfil se guarda",
    objeto?.name === `${M} Objetivo editado` && objeto.company === "Compañía CFG" && objeto.phone === "555-0101",
  );
  ms = await filas<Membresia>(membresiasDe(OBJ));
  ok("el rol y la pertenencia, en esta empresa", ms.length === 1 && ms[0].role === "sales" && ms[0].active);
  ok(
    "y de los ajustes solo entra lo que se reconoce",
    JSON.stringify(ms[0]?.permissions) === JSON.stringify({ compras: "ver" }),
    JSON.stringify(ms[0]?.permissions),
  );
  const cliente = async (esquema: string, id: string) =>
    (await filas<{ client_id: string | null }>(`select client_id from ${esquema}.crm_organizations where id = '${id}'`))[0]?.client_id ?? null;
  ok("queda vinculada a la organización", (await cliente(ESQUEMA, ORG)) === OBJ);

  /*
    Una organización de OTRA empresa no se puede vincular: el `update` corre en
    el esquema de la sesión, así que ese id no encuentra fila. Se comprueba que
    la de allá sigue sin cliente y que la de aquí se soltó —pedir otra suelta
    la anterior—.
  */
  r = await u.updateUser(inicial, EDITAR(OBJ, { role: "sales", crmOrganizationId: ORG_AJENA }));
  ok("la organización de otra empresa no queda vinculada", (await cliente(AJENO, ORG_AJENA)) === null);
  ok("y la de aquí se suelta", (await cliente(ESQUEMA, ORG)) === null);

  r = await u.updateUser(inicial, EDITAR(OBJ, { role: "sales", active: undefined }));
  ms = await filas<Membresia>(membresiasDe(OBJ));
  const [objetoBaja] = await filas<Usuario>(filaUsuario(OBJ));
  ok(
    "la baja apaga la MEMBRESÍA y no la cuenta",
    r.ok === true && ms[0]?.active === false && objetoBaja?.active === true,
    "una cuenta global apagada dejaría fuera de las otras empresas",
  );

  seccion("edición: cambiarle el papel aquí no toca el que tiene en otra empresa");
  r = await u.updateUser(inicial, EDITAR(MIXTA, { role: "general", "permiso.pagar": "ver" }));
  ms = await filas<Membresia>(membresiasDe(MIXTA));
  ok(
    "aquí queda como general, con su ajuste",
    r.ok === true && ms.some((m) => m.tenant_id === EMP && m.role === "general" && JSON.stringify(m.permissions) === '{"pagar":"ver"}'),
  );
  ok(
    "y en la otra empresa sigue siendo dueña, sin ajustes",
    ms.some((m) => m.tenant_id === OTRA && m.role === "owner" && m.active && JSON.stringify(m.permissions) === "{}"),
    JSON.stringify(ms.map((m) => [m.tenant_id === EMP ? "esta" : "otra", m.role, m.permissions])),
  );

  /* ═══════════════════════ resetUserPassword ══════════════════════════ */

  const CLAVE = "CFG-nueva-clave-9";
  const RESET = (id: string, password = CLAVE) => forma({ id, password });
  const hashDe = (id: string) => `select password_hash from users where id = '${id}'`;

  seccion("contraseña: la guardia, y el nivel");
  como(null, true);
  await rechazaSinEscribir("restablecer sin sesión", () => u.resetUserPassword(inicial, RESET(OBJ)), [hashDe(OBJ)], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("restablecer sin permiso", () => u.resetUserPassword(inicial, RESET(OBJ)), [hashDe(OBJ)], conError("auth"));
  como(ACTOR, "configuracion:editar");
  await rechazaSinEscribir("restablecer con «editar»", () => u.resetUserPassword(inicial, RESET(OBJ)), [hashDe(OBJ)], conError("auth"));

  seccion("contraseña: captura inválida, la dueña y alguien de fuera");
  como(ACTOR, "configuracion:administrar");
  await rechazaSinEscribir("una contraseña de 5", () => u.resetUserPassword(inicial, RESET(OBJ, "corta")), [hashDe(OBJ)], conError("invalid"));
  await rechazaSinEscribir("sin id", () => u.resetUserPassword(inicial, RESET("")), [hashDe(OBJ)], conError("invalid"));
  /*
    Un id que no es uuid llega tal cual del formulario. Reventaba en Postgres
    («invalid input syntax for type uuid») con un 500 en vez de decir «inválido».
  */
  await rechazaSinEscribir("un id que no es uuid", () => u.resetUserPassword(inicial, RESET("no-soy-un-uuid")), [hashDe(OBJ)], conError("invalid"));
  await rechazaSinEscribir("a la dueña de la cuenta", () => u.resetUserPassword(inicial, RESET(DUENA)), [hashDe(DUENA)], conError("owner"));
  await rechazaSinEscribir(
    "a alguien de otra empresa",
    () => u.resetUserPassword(inicial, RESET(AJENA)),
    [hashDe(AJENA)],
    conError("invalid"),
  );

  seccion("contraseña: se cambia, hasheada");
  r = await u.resetUserPassword(inicial, RESET(OBJ));
  const [h] = await filas<{ password_hash: string }>(hashDe(OBJ));
  ok("responde ok", r.ok === true, r.error);
  ok("la nueva abre y la vieja ya no", bcrypt.compareSync(CLAVE, h?.password_hash ?? "") && !bcrypt.compareSync(CLAVE_ORIGINAL, h?.password_hash ?? ""));

  seccion("contraseña: la de quien manda en OTRA empresa no se cambia desde ésta");
  /*
    La contraseña abre la sesión en TODAS las empresas de la persona —lo dice la
    propia acción—. La comprobación de pertenencia impide tocar a un
    desconocido, pero no a alguien que es agente aquí y DUEÑA en otra: el
    administrador de aquí le pone una clave que conoce y entra allá como dueño.
    Este probe lo encontró. La regla que se eligió es la estricta: con
    CUALQUIER otra membresía activa se rechaza, tenga o no más rango allá,
    porque aun de agente a agente la clave abre una empresa ajena.
  */
  await rechazaSinEscribir(
    "restablecer a quien es dueña en otra empresa",
    () => u.resetUserPassword(inicial, RESET(MIXTA)),
    [hashDe(MIXTA)],
    conError("compartida"),
  );
  await rechazaSinEscribir(
    "restablecer a quien es agente aquí y agente en otra",
    () => u.resetUserPassword(inicial, RESET(DOBLE)),
    [hashDe(DOBLE)],
    conError("compartida"),
  );
});
