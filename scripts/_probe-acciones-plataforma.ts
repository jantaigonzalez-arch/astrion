/**
 * LA CONSOLA DE ASTRAION: ENTRAR, SALIR, DAR DE ALTA Y REVISAR SOLICITUDES.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server \
 *     scripts/_probe-acciones-plataforma.ts
 *
 * Seis acciones que no son de ninguna empresa: las opera el personal de la
 * plataforma, y lo que se protege es precisamente que NADIE MÁS pueda. La
 * guardia no mira el token: `requirePlatform()` lee el rol de `platform_users`
 * en cada llamada, así que aquí los operadores son filas de verdad, creadas por
 * este probe, y el token del stub se hace mentir a propósito —una cuenta de
 * empresa que dice ser superadmin, un soporte que dice lo mismo— para ver que
 * no alcanza.
 *
 *   · `enterTenant` y `exitTenant` exigen plataforma (cualquier rol) y sesión;
 *   · `createTenant`, `setMlContribution`, `approveSignup` y `rejectSignup`,
 *     superadministrador.
 *
 * ── LAS COOKIES: UNA PETICIÓN DE MENTIRA ───────────────────────────────────
 *
 * Entrar y salir escriben una cookie y terminan en `redirect()`. `redirect` ya
 * lo sustituye el stub de navegación; `cookies()` y `headers()` no, y fuera de
 * una petición lanzan «was called outside a request scope». Para ejercitarlas se
 * abre, en `enPeticion()`, el mismo almacén asíncrono que Next abre al atender
 * una server action, con un tarro de cookies que anota lo que se pone y lo que
 * se borra. Son piezas INTERNAS de Next (`next/dist/server/app-render/…`): si
 * una actualización las mueve, esto revienta con un mensaje que las nombra, y
 * lo que hay que hacer es mirar dónde quedaron, no quitar la prueba. Lo que no
 * se ve desde aquí es el registro del acceso: `logTenantAccess` lo sustituye
 * el stub de inquilino.
 *
 * ── DOS ALTAS DE VERDAD, EN LA BASE DE PRUEBAS ─────────────────────────────
 *
 * Aprobar una solicitud crea un esquema y le corre todas las migraciones. Se
 * hace de verdad —es lo único que prueba que el alta deja una empresa usable—
 * con identificadores `cfg_…` de esta corrida, y al final se tira el esquema
 * (`drop schema … cascade`) y se borran las filas de plataforma que colgaban de
 * él. Nada que no lleve la marca se toca.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import bcrypt from "bcryptjs";
import {
  alLimpiar,
  como,
  conError,
  filas,
  forma,
  intentar,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
} from "./_acciones-kit";

const M = marca("CFG");
const PREFIJO = M.toLowerCase();
/** Los identificadores de empresa no admiten guion: `cfg_abc123_…`. */
const SLUG = PREFIJO.replace(/-/g, "_");
const correo = (quien: string) => `${PREFIJO}-${quien}@example.invalid`;

const SLUG_CONSOLA = `${SLUG}_consola`; // la de createTenant
const SLUG_APROBADA = `${SLUG}_aprobada`; // la de approveSignup, dueña nueva
const SLUG_CONOCIDA = `${SLUG}_conocida`; // la de approveSignup, dueña que ya existía
const SLUG_ML = `${SLUG}_ml`; // una fila suelta para el consentimiento
const NUESTRAS = [SLUG_CONSOLA, SLUG_APROBADA, SLUG_CONOCIDA, SLUG_ML];

/** La última migración de empresa: es donde debe quedar un esquema recién dado de alta. */
const ULTIMA_MIGRACION = (
  JSON.parse(readFileSync(path.join(process.cwd(), "drizzle-tenant", "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  }
).entries.sort((a, b) => b.idx - a.idx)[0].tag;

/* ── La petición de mentira ──────────────────────────────────────────────── */

type Almacen = { run<R>(store: unknown, fn: () => R): R };
/*
  Next no importa `AsyncLocalStorage`: lo espera en `globalThis`, donde lo deja
  su servidor al arrancar, y si no está fabrica uno falso que lanza al usarse.
  Se pone aquí, en este proceso, ANTES de cargar nada de Next.
*/
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
const requerir = createRequire(__filename);
const { workAsyncStorage } = requerir("next/dist/server/app-render/work-async-storage.external") as {
  workAsyncStorage: Almacen;
};
const { workUnitAsyncStorage } = requerir("next/dist/server/app-render/work-unit-async-storage.external") as {
  workUnitAsyncStorage: Almacen;
};

type OpcionesDeGalleta = { httpOnly?: boolean; maxAge?: number; path?: string };
type Tarro = {
  puestas: Map<string, { valor: string; opciones?: OpcionesDeGalleta }>;
  borradas: string[];
};

/**
 * Corre `fn` como si fuera una server action dentro de una petición.
 *
 * `phase: "action"` es lo que hace a las cookies escribibles; el resto de los
 * campos son los que `cookies()` y `headers()` leen en su rama `request` —fuera
 * de desarrollo, que exige más maquinaria y aquí no hace falta—.
 */
async function enPeticion<T>(fn: () => Promise<T>) {
  const tarro: Tarro = { puestas: new Map(), borradas: [] };
  const galletas = {
    set: (nombre: string, valor: string, opciones?: OpcionesDeGalleta) => {
      tarro.puestas.set(nombre, { valor, opciones });
    },
    delete: (nombre: string) => {
      tarro.borradas.push(nombre);
    },
    get: () => undefined,
    getAll: () => [],
    has: () => false,
  };
  const trabajo = { route: "/probe", forceStatic: false, dynamicShouldError: false };
  const peticion = {
    type: "request",
    phase: "action",
    cookies: galletas,
    mutableCookies: galletas,
    userspaceMutableCookies: galletas,
    headers: new Headers({ host: "localhost:3000" }),
  };
  const r = await workAsyncStorage.run(trabajo, () => workUnitAsyncStorage.run(peticion, () => intentar(fn)));
  return { ...r, tarro };
}

/* ── Fotos ───────────────────────────────────────────────────────────────── */

const n = async (q: string) => Number((await filas<{ n: number }>(q))[0]?.n ?? 0);
/** Lo que deja un alta: la fila, su esquema registrado y el esquema físico. */
const ALTA = (slug: string) => [
  `select count(*)::int as n from tenants where slug = '${slug}'`,
  `select count(*)::int as n from tenant_schemas where schema_name = 'tenant_${slug}'`,
  `select count(*)::int as n from information_schema.schemata where schema_name = 'tenant_${slug}'`,
];
const SOLICITUD = (id: string) =>
  `select status, tenant_id, reviewed_by, reviewed_at, rejection_reason from tenant_signups where id = '${id}'`;
const ML = (slug: string) =>
  `select ml_contribution, ml_consent_at, ml_consent_by, updated_at from tenants where slug = '${slug}'`;

void probar("plataforma: la consola solo la opera quien debe, y lo que da de alta queda usable", async () => {
  /* ── Limpieza, registrada antes de crear nada ──────────────────────────── */
  /*
    Se ejecutan en orden INVERSO al registro. Lo último que corre es borrar a
    los operadores; antes, sus eventos (la foránea es `set null` y los dejaría
    huérfanos, sin forma de reconocerlos); antes, las cuentas y solicitudes; y
    lo PRIMERO, las empresas con su esquema.
  */
  alLimpiar(() => sql.unsafe(`delete from platform_users where email like '${PREFIJO}-%'`));
  alLimpiar(() =>
    sql.unsafe(
      `delete from platform_events where actor_id in (select id from platform_users where email like '${PREFIJO}-%')`,
    ),
  );
  alLimpiar(() => sql.unsafe(`delete from users where email like '${PREFIJO}-%'`));
  alLimpiar(() => sql.unsafe(`delete from tenant_signups where email like '${PREFIJO}-%'`));
  for (const slug of NUESTRAS)
    alLimpiar(async () => {
      if (!/^cfg_[a-z0-9_]+$/.test(slug)) throw new Error(`me niego a tirar «${slug}»: no es de este probe`);
      await sql.unsafe(`drop schema if exists "tenant_${slug}" cascade`);
      const ids = `(select id from tenants where slug = '${slug}')`;
      await sql.unsafe(`delete from platform_events where tenant_id in ${ids}`);
      await sql.unsafe(`delete from memberships where tenant_id in ${ids}`);
      await sql.unsafe(`delete from tenant_schemas where tenant_id in ${ids} or schema_name = 'tenant_${slug}'`);
      await sql.unsafe(`update tenant_signups set tenant_id = null where tenant_id in ${ids}`);
      await sql.unsafe(`delete from tenants where slug = '${slug}'`);
    });

  /* ── Quién es quién ────────────────────────────────────────────────────── */
  const operador = async (quien: string, rol: string, activo = true) =>
    (
      await sql<{ id: string }[]>`
        insert into platform_users (name, email, role, active)
        values (${`${M} ${quien}`}, ${correo(quien)}, ${rol}, ${activo}) returning id`
    )[0].id;
  const SUPER = await operador("super", "superadmin");
  const SOPORTE = await operador("soporte", "support");
  const SUPER_BAJA = await operador("super-baja", "superadmin", false);
  /** Una cuenta de EMPRESA, sin nada en `platform_users`. */
  const [empresa] = await sql<{ id: string }[]>`
    insert into users (name, email, active, password_hash)
    values (${`${M} de empresa`}, ${correo("empresa")}, true, ${bcrypt.hashSync("CFG-empresa-1", 4)}) returning id`;
  const DE_EMPRESA = empresa.id;

  /*
    Las cinco sesiones que NO deben pasar donde se exige superadministrador. Las
    del medio son las que importan: el rol se lee de la base y no del token, así
    que un token que DIGA «superadmin» no alcanza si la fila dice otra cosa —o
    si la fila no existe, o está desactivada—.
  */
  const INTRUSOS = [
    ["sin sesión", () => como(null)],
    ["con sesión de empresa", () => como(DE_EMPRESA, true)],
    ["con sesión de empresa que dice ser superadmin", () => como(DE_EMPRESA, true, { plataforma: "superadmin" })],
    ["con un superadmin desactivado", () => como(SUPER_BAJA, true, { plataforma: "superadmin" })],
    ["con soporte que dice ser superadmin", () => como(SOPORTE, true, { plataforma: "superadmin" })],
  ] as const;
  /** Para lo que admite cualquier rol de plataforma, soporte SÍ pasa. */
  const INTRUSOS_DE_CONSOLA = INTRUSOS.slice(0, 4);
  const comoSuper = () => como(SUPER, true, { plataforma: "superadmin" });

  const p = await import("@/lib/actions/platform");
  const inicial = { ok: false };

  /* ══════════════════════════ enterTenant ═════════════════════════════ */

  seccion("entrar: sin rol de plataforma no se pone la cookie ni se redirige");
  for (const [nombre, fijar] of INTRUSOS_DE_CONSOLA) {
    fijar();
    const r = await enPeticion(() => p.enterTenant(forma({ slug: "bajio", reason: "probe" })));
    ok(
      `entrar ${nombre}: se queda donde está, sin cookie`,
      !r.error && !r.redirige && r.tarro.puestas.size === 0,
      r.error ?? r.redirige ?? "",
    );
  }

  seccion("entrar: soporte entra, a la empresa que existe, y en sesión");
  como(SOPORTE, true, { plataforma: "support" });
  for (const [nombre, slug] of [
    ["vacía", "   "],
    ["que no existe", `${SLUG}_no_existe`],
  ] as const) {
    const r = await enPeticion(() => p.enterTenant(forma({ slug })));
    ok(`una empresa ${nombre} no pone cookie`, !r.error && !r.redirige && r.tarro.puestas.size === 0, r.error ?? r.redirige ?? "");
  }
  let e = await enPeticion(() => p.enterTenant(forma({ slug: "  bajio  ", reason: "probe", locale: "en" })));
  const galleta = e.tarro.puestas.get("evo_tenant");
  ok("entra: la cookie de empresa apunta a la que se pidió", galleta?.valor === "bajio", e.error ?? JSON.stringify(galleta));
  /*
    De sesión y no persistente: entrar a la empresa de un cliente debe ser un
    acto deliberado cada vez, no un estado que sobrevive semanas.
  */
  ok(
    "solo para el servidor, y de sesión",
    galleta?.opciones?.httpOnly === true && galleta.opciones.maxAge === undefined && galleta.opciones.path === "/",
    JSON.stringify(galleta?.opciones),
  );
  ok("y termina en el tablero de ESA empresa, en su idioma", /bajio/.test(e.redirige ?? "") && /\/en\/dashboard$|\/en\/bajio\/dashboard$/.test(e.redirige ?? ""), e.redirige ?? e.error);

  /* ══════════════════════════ exitTenant ══════════════════════════════ */

  seccion("salir: sin sesión no toca nada; con sesión borra la cookie y vuelve a la consola");
  /*
    `exitTenant` solo pide sesión, no rol de plataforma, y está bien: borrar la
    cookie de empresa activa no le da a nadie nada que no tuviera.
  */
  como(null);
  e = await enPeticion(() => p.exitTenant(forma({})));
  ok("salir sin sesión: ni borra ni redirige", !e.error && !e.redirige && e.tarro.borradas.length === 0, e.error ?? e.redirige ?? "");
  como(SOPORTE, true, { plataforma: "support" });
  e = await enPeticion(() => p.exitTenant(forma({})));
  ok("salir: borra la cookie de empresa", e.tarro.borradas.includes("evo_tenant"), e.error);
  ok("y vuelve a la consola", /\/platform$/.test(e.redirige ?? "") && !/\/en\//.test(e.redirige ?? ""), e.redirige ?? e.error);

  /* ══════════════════════════ createTenant ════════════════════════════ */

  seccion("alta desde la consola: solo un superadministrador");
  const soloSuperAlta = conError("Solo un superadministrador da de alta empresas.");
  const DUENO_CONSOLA = { ownerName: `${M} Dueña de consola`, ownerEmail: correo("duena-consola") };
  const ALTA_BUENA = () =>
    p.createTenant(inicial, forma({ slug: SLUG_CONSOLA, name: `${M} Consola`, ...DUENO_CONSOLA }));
  const USUARIO = (email: string) => `select count(*)::int as n from users where email = '${email}'`;
  for (const [nombre, fijar] of INTRUSOS) {
    fijar();
    await rechazaSinEscribir(`alta ${nombre}`, ALTA_BUENA, ALTA(SLUG_CONSOLA), soloSuperAlta);
  }

  seccion("alta desde la consola: identificadores que no se aceptan");
  comoSuper();
  for (const [nombre, slug, name, empieza] of [
    ["sin identificador", "", `${M} X`, "Faltan el identificador o el nombre."],
    ["sin nombre", SLUG_CONSOLA, "  ", "Faltan el identificador o el nombre."],
    ["reservado", "admin", `${M} X`, 'El identificador "admin" está reservado'],
    ["con guiones", `${PREFIJO}-malo`, `${M} X`, "Slug de inquilino inválido"],
    ["de otra empresa", "bajio", `${M} X`, 'El identificador "bajio" ya lo usa otra empresa'],
  ] as const)
    await rechazaSinEscribir(
      `alta ${nombre}`,
      () => p.createTenant(inicial, forma({ slug, name, ...DUENO_CONSOLA })),
      [
        ...ALTA(SLUG_CONSOLA),
        ...ALTA(slug.toLowerCase() || "vacio"),
        `select name, folio_prefix from tenants where slug = 'bajio'`,
        // Lo que se valida va ANTES de crear la cuenta: un alta que falla no
        // puede dejar el correo del dueño ocupado para siempre.
        USUARIO(DUENO_CONSOLA.ownerEmail),
      ],
      (r) => r?.ok === false && String(r.error).startsWith(empieza),
    );

  seccion("alta desde la consola: el dueño se pide");
  for (const [nombre, cambio] of [
    ["sin correo del dueño", { ownerEmail: "" }],
    ["con un correo que no es correo", { ownerEmail: "no-es-correo" }],
    ["sin nombre del dueño", { ownerName: " " }],
  ] as const)
    await rechazaSinEscribir(
      `alta ${nombre}`,
      () => p.createTenant(inicial, forma({ slug: SLUG_CONSOLA, name: `${M} Consola`, ...DUENO_CONSOLA, ...cambio })),
      [...ALTA(SLUG_CONSOLA), USUARIO(DUENO_CONSOLA.ownerEmail)],
      conError("Falta el nombre o un correo válido del dueño."),
    );

  seccion("alta desde la consola: deja una empresa aprovisionada, con su dueña");
  /*
    Le pasaba a `provisionTenant` el id del OPERADOR como dueño, y la membresía
    de dueño apunta a `users`. Desde que el personal de Astraion vive en
    `platform_users` (migración 0023) ese id no está allí, así que el alta moría
    en la foránea. Este probe lo encontró; ahora el dueño se pide, como al
    aprobar una solicitud.
  */
  let r: { ok: boolean; error?: string; message?: string; credentials?: { email: string; password: string; nuevo: boolean } } =
    await ALTA_BUENA();
  ok("el alta responde ok", r.ok === true, r.error?.slice(0, 140));
  ok(
    "y deja la fila, su esquema registrado y el esquema físico",
    (await n(ALTA(SLUG_CONSOLA)[0])) === 1 && (await n(ALTA(SLUG_CONSOLA)[1])) === 1 && (await n(ALTA(SLUG_CONSOLA)[2])) === 1,
  );
  const [duenaConsola] = await filas<{ role: string; hash: string | null }>(
    `select m.role, u.password_hash as hash from memberships m
       join users u on u.id = m.user_id join tenants t on t.id = m.tenant_id
      where t.slug = '${SLUG_CONSOLA}' and u.email = '${DUENO_CONSOLA.ownerEmail}'`,
  );
  ok("la dueña es la del correo, con membresía de dueña", duenaConsola?.role === "owner", duenaConsola?.role ?? "sin membresía");
  ok(
    "y sus credenciales vuelven UNA vez, y abren",
    r.credentials?.nuevo === true &&
      r.credentials.email === DUENO_CONSOLA.ownerEmail &&
      bcrypt.compareSync(r.credentials.password, duenaConsola?.hash ?? ""),
  );
  ok(
    "el operador NO queda como miembro de nada",
    (await n(`select count(*)::int as n from memberships m join tenants t on t.id = m.tenant_id
               where t.slug = '${SLUG_CONSOLA}' and m.role = 'owner'`)) === 1,
  );

  /* ════════════════════════ setMlContribution ═════════════════════════ */

  seccion("aporte a modelos globales: solo un superadministrador");
  await sql`insert into tenants (slug, name, status, plan) values (${SLUG_ML}, ${`${M} Aporte`}, 'trial', 'poc')`;
  const otrasML = `select slug, ml_contribution, ml_consent_at, ml_consent_by from tenants where slug in ('evoelution', 'acme', 'bajio') order by slug`;
  const otrasAntes = JSON.stringify(await filas(otrasML));
  for (const [nombre, fijar] of INTRUSOS) {
    fijar();
    await rechazaSinEscribir(
      `otorgar ${nombre}`,
      () => p.setMlContribution(forma({ slug: SLUG_ML, grant: "1" })),
      [ML(SLUG_ML)],
    );
  }
  comoSuper();
  await rechazaSinEscribir("otorgar sin empresa", () => p.setMlContribution(forma({ grant: "1" })), [ML(SLUG_ML)]);

  seccion("aporte a modelos globales: se registra con responsable y fecha");
  type FilaML = { ml_contribution: boolean; ml_consent_at: Date | null; ml_consent_by: string | null };
  /*
    El responsable se guarda en `tenants.ml_consent_by`, cuya foránea seguía
    apuntando a `users`: la 0023 movió las de `platform_events` y
    `tenant_signups` a `platform_users` y ésta se le quedó atrás. Con un
    superadministrador creado después de la separación, otorgar reventaba en la
    foránea. Este probe lo encontró; la 0034 la mudó a `platform_users`.
  */
  const otorgar = await intentar(() => p.setMlContribution(forma({ slug: SLUG_ML, grant: "1" })));
  let [ml] = await filas<FilaML>(ML(SLUG_ML));
  ok(
    "otorgar lo deja activo, fechado y firmado por el operador",
    !otorgar.error && ml?.ml_contribution === true && ml.ml_consent_at !== null && ml.ml_consent_by === SUPER,
    otorgar.error?.slice(0, 140) ?? JSON.stringify(ml),
  );
  await sql`update tenants set ml_contribution = true, ml_consent_at = now() where slug = ${SLUG_ML}`;
  const revocar = await intentar(() => p.setMlContribution(forma({ slug: SLUG_ML, grant: "0" })));
  [ml] = await filas<FilaML>(ML(SLUG_ML));
  ok(
    "revocar lo apaga y borra fecha y responsable",
    !revocar.error && ml?.ml_contribution === false && ml.ml_consent_at === null && ml.ml_consent_by === null,
    revocar.error ?? JSON.stringify(ml),
  );
  ok("y ninguna otra empresa cambió", JSON.stringify(await filas(otrasML)) === otrasAntes);

  /* ══════════════════════════ approveSignup ═══════════════════════════ */

  const solicitud = async (quien: string, empresa: string, status = "pending") =>
    (
      await sql<{ id: string }[]>`
        insert into tenant_signups (company_name, desired_slug, contact_name, email, phone, status)
        values (${`${M} ${empresa}`}, ${SLUG_APROBADA}, ${`${M} ${quien}`}, ${correo(quien)}, '555-0199', ${status})
        returning id`
    )[0].id;
  const APROBAR = await solicitud("duena", "Aprobada");
  const PARA_VALIDAR = await solicitud("validar", "Validación");
  const YA_APROBADA = await solicitud("aprobada-antes", "Ya aprobada", "approved");
  const CUENTAS = (quien: string) => `select count(*)::int as n from users where email = '${correo(quien)}'`;

  seccion("aprobar: solo un superadministrador");
  const soloSuperAprueba = conError("Solo un superadministrador aprueba altas.");
  for (const [nombre, fijar] of INTRUSOS) {
    fijar();
    await rechazaSinEscribir(
      `aprobar ${nombre}`,
      () => p.approveSignup(inicial, forma({ id: APROBAR, slug: SLUG_APROBADA })),
      [SOLICITUD(APROBAR), CUENTAS("duena"), ...ALTA(SLUG_APROBADA)],
      soloSuperAprueba,
    );
  }

  seccion("aprobar: toda la validación va ANTES de crear la cuenta del dueño");
  /*
    El correo es único en toda la plataforma: una cuenta creada para un alta que
    después falla se queda ocupándolo para siempre, y el segundo intento ya no
    enseñaría las credenciales. Por eso cada rechazo mira también que NO haya
    nacido la cuenta.
  */
  comoSuper();
  const FOTO_VALIDAR = [SOLICITUD(PARA_VALIDAR), CUENTAS("validar"), ...ALTA(SLUG_APROBADA)];
  for (const [nombre, campos, empieza] of [
    ["sin solicitud", { id: "", slug: SLUG_APROBADA }, "Falta la solicitud o el identificador."],
    ["sin identificador", { id: PARA_VALIDAR, slug: "" }, "Falta la solicitud o el identificador."],
    ["de una solicitud que no existe", { id: "00000000-0000-0000-0000-00000000c0f9", slug: SLUG_APROBADA }, "La solicitud ya no existe."],
    /*
      Un id que no es uuid reventaba en Postgres con un 500 en vez de decir que
      la solicitud no existe. Ver el arreglo en `platform.ts`.
    */
    ["de una solicitud que no es uuid", { id: "no-soy-un-uuid", slug: SLUG_APROBADA }, "La solicitud ya no existe."],
    ["de una solicitud ya aprobada", { id: YA_APROBADA, slug: SLUG_APROBADA }, "Esta solicitud ya está aprobada."],
    ["con un identificador reservado", { id: PARA_VALIDAR, slug: "admin" }, 'El identificador "admin" está reservado'],
    ["con un identificador con guiones", { id: PARA_VALIDAR, slug: `${PREFIJO}-malo` }, "Slug de inquilino inválido"],
    ["con el identificador de otra empresa", { id: PARA_VALIDAR, slug: "bajio" }, 'El identificador "bajio" ya lo usa otra empresa'],
  ] as const)
    await rechazaSinEscribir(
      `aprobar ${nombre}`,
      () => p.approveSignup(inicial, forma(campos)),
      FOTO_VALIDAR,
      (x) => x?.ok === false && String(x.error).startsWith(empieza),
    );

  seccion("aprobar: nace la empresa, con su esquema migrado y su dueña");
  let ap = await p.approveSignup(inicial, forma({ id: APROBAR, slug: `  ${SLUG_APROBADA.toUpperCase()}  `, plan: "tierra" }));
  ok("la aprobación responde ok", ap.ok === true, ap.error?.slice(0, 140));
  const cred = ap.credentials;
  ok(
    "devuelve las credenciales de una cuenta NUEVA, una sola vez",
    cred?.email === correo("duena") && cred.nuevo === true && /^[a-hj-km-np-zA-HJ-NP-Z2-9]{12}$/.test(cred.password),
    JSON.stringify({ ...cred, password: cred?.password ? "…" : "" }),
  );
  const [duena] = await filas<{ id: string; name: string; company: string; password_hash: string }>(
    `select id, name, company, password_hash from users where email = '${correo("duena")}'`,
  );
  ok(
    "la cuenta de la dueña, con sus datos y la contraseña hasheada",
    duena?.name === `${M} duena` && duena.company === `${M} Aprobada` && bcrypt.compareSync(cred?.password ?? "-", duena.password_hash),
  );
  const [nacida] = await filas<{ id: string; name: string; plan: string; status: string }>(
    `select id, name, plan, status from tenants where slug = '${SLUG_APROBADA}'`,
  );
  ok(
    "la empresa, con el nombre de la solicitud y el plan elegido, en prueba",
    nacida?.name === `${M} Aprobada` && nacida.plan === "tierra" && nacida.status === "trial",
    JSON.stringify(nacida),
  );
  const [registro] = await filas<{ migrated_version: string | null }>(
    `select migrated_version from tenant_schemas where schema_name = 'tenant_${SLUG_APROBADA}'`,
  );
  ok("su esquema, registrado y migrado hasta la última", registro?.migrated_version === ULTIMA_MIGRACION, registro?.migrated_version ?? "sin registro");
  ok(
    "y con las tablas de negocio de verdad",
    (await n(`select count(*)::int as n from information_schema.tables
                where table_schema = 'tenant_${SLUG_APROBADA}' and table_name in ('tickets', 'settings', 'notifications')`)) === 3,
  );
  const suyas = await filas<{ tenant_id: string; role: string }>(
    `select tenant_id, role from memberships where user_id = '${duena?.id}'`,
  );
  ok(
    "la dueña es dueña de ESA empresa y de ninguna otra",
    suyas.length === 1 && suyas[0].tenant_id === nacida?.id && suyas[0].role === "owner",
    JSON.stringify(suyas.map((s) => s.role)),
  );
  const [resuelta] = await filas<{ status: string; tenant_id: string; reviewed_by: string; reviewed_at: Date | null }>(
    SOLICITUD(APROBAR),
  );
  ok(
    "la solicitud queda aprobada, enlazada y firmada",
    resuelta?.status === "approved" && resuelta.tenant_id === nacida?.id && resuelta.reviewed_by === SUPER && resuelta.reviewed_at !== null,
  );
  ok(
    "con su evento, firmado por el superadministrador",
    (await n(`select count(*)::int as n from platform_events
                where event_type = 'tenant.signup_approved' and actor_id = '${SUPER}'
                  and payload->>'slug' = '${SLUG_APROBADA}' and payload->>'signupId' = '${APROBAR}'`)) === 1,
  );
  await rechazaSinEscribir(
    "aprobarla otra vez",
    () => p.approveSignup(inicial, forma({ id: APROBAR, slug: `${SLUG}_otra_vez` })),
    [SOLICITUD(APROBAR), ...ALTA(`${SLUG}_otra_vez`)],
    conError("Esta solicitud ya está aprobada."),
  );

  seccion("aprobar a quien ya tenía cuenta: suma la membresía, NO le cambia la contraseña");
  /*
    El dueño puede existir: un consultor que ya atiende a otro cliente reusa su
    cuenta. Lo que no puede pasar es que aprobar un alta —que la llenó quien
    fuera, con el correo que quiso— le ponga una contraseña nueva a esa cuenta.
  */
  const [conocida] = await sql<{ id: string; password_hash: string }[]>`
    insert into users (name, email, active, password_hash)
    values (${`${M} conocida`}, ${correo("conocida")}, true, ${bcrypt.hashSync("CFG-la-suya-1", 4)})
    returning id, password_hash`;
  const CONOCIDA = await solicitud("conocida", "Conocida");
  ap = await p.approveSignup(inicial, forma({ id: CONOCIDA, slug: SLUG_CONOCIDA }));
  const [despues] = await filas<{ name: string; password_hash: string }>(
    `select name, password_hash from users where id = '${conocida.id}'`,
  );
  ok("responde ok, y dice que la cuenta NO es nueva", ap.ok === true && ap.credentials?.nuevo === false, ap.error?.slice(0, 140));
  ok("sin contraseña que entregar", ap.credentials?.password === "");
  ok("y su contraseña y su nombre siguen siendo los suyos", despues?.password_hash === conocida.password_hash && despues.name === `${M} conocida`);
  ok(
    "con UNA cuenta con ese correo, dueña de la empresa nueva",
    (await n(CUENTAS("conocida"))) === 1 &&
      (await n(`select count(*)::int as n from memberships m join tenants t on t.id = m.tenant_id
                  where m.user_id = '${conocida.id}' and t.slug = '${SLUG_CONOCIDA}' and m.role = 'owner'`)) === 1,
  );

  /* ══════════════════════════ rejectSignup ════════════════════════════ */

  seccion("rechazar: solo un superadministrador, con motivo, y una sola vez");
  const RECHAZAR = await solicitud("rechazada", "Rechazada");
  const soloSuperRechaza = conError("Solo un superadministrador rechaza altas.");
  for (const [nombre, fijar] of INTRUSOS) {
    fijar();
    await rechazaSinEscribir(
      `rechazar ${nombre}`,
      () => p.rejectSignup(inicial, forma({ id: RECHAZAR, reason: "No es cliente" })),
      [SOLICITUD(RECHAZAR)],
      soloSuperRechaza,
    );
  }
  comoSuper();
  for (const [nombre, campos, mensaje] of [
    ["sin solicitud", { reason: "No es cliente" }, "Falta la solicitud."],
    ["sin motivo", { id: RECHAZAR, reason: "   " }, "Escribe el motivo del rechazo."],
    ["una que no existe", { id: "00000000-0000-0000-0000-00000000c0f9", reason: "x" }, "La solicitud ya no existe."],
    ["una que no es uuid", { id: "no-soy-un-uuid", reason: "x" }, "La solicitud ya no existe."],
    ["una ya aprobada", { id: APROBAR, reason: "x" }, "Esta solicitud ya fue resuelta."],
  ] as const)
    await rechazaSinEscribir(
      `rechazar ${nombre}`,
      () => p.rejectSignup(inicial, forma(campos)),
      [SOLICITUD(RECHAZAR), SOLICITUD(APROBAR)],
      conError(mensaje),
    );

  const largo = `  ${"Motivo largo. ".repeat(200)}`;
  r = await p.rejectSignup(inicial, forma({ id: RECHAZAR, reason: largo }));
  const [rechazada] = await filas<{ status: string; reviewed_by: string; rejection_reason: string; tenant_id: string | null }>(
    SOLICITUD(RECHAZAR),
  );
  ok("el rechazo responde ok", r.ok === true, r.error);
  ok(
    "queda rechazada, firmada, sin empresa, y con el motivo recortado a 2000",
    rechazada?.status === "rejected" && rechazada.reviewed_by === SUPER && rechazada.tenant_id === null && rechazada.rejection_reason.length === 2000,
    `${rechazada?.status} ${rechazada?.rejection_reason?.length}`,
  );
  ok(
    "con su evento",
    (await n(`select count(*)::int as n from platform_events
                where event_type = 'tenant.signup_rejected' and actor_id = '${SUPER}' and payload->>'signupId' = '${RECHAZAR}'`)) === 1,
  );
  await rechazaSinEscribir(
    "rechazarla otra vez",
    () => p.rejectSignup(inicial, forma({ id: RECHAZAR, reason: "Otra vez" })),
    [SOLICITUD(RECHAZAR)],
    conError("Esta solicitud ya fue resuelta."),
  );
});
