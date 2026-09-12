/**
 * LO QUE LA EMPRESA CONFIGURA DE SÍ MISMA, Y LO QUE ASTRAION LE CONFIGURA.
 *
 *   PROBE_SCHEMA=tenant_bajio npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-acciones-empresa.ts
 *
 * Cuatro archivos de acciones que escriben en la fila de la empresa en
 * `public.tenants` o cerca de ella:
 *
 *   · marca y membrete (`brand.ts`) y buzón de correo (`correo.ts`): los
 *     configura la EMPRESA, filtrando por `ctx.tenantId`. Lo que se ata es que
 *     un campo del formulario no pueda apuntar a la fila de otra, y que la
 *     contraseña del buzón NO quede en claro en la base;
 *   · avisos (`avisos.ts`): sin guardia de módulo a propósito, así que lo que
 *     importa es que solo alcance los avisos de quien pregunta;
 *   · suscripción (`suscripcion.ts`): la mueve ASTRAION, no la empresa. Exige un
 *     superadministrador leído de la BASE, no del token.
 *
 * ── POR QUÉ CORRE SOBRE `tenant_bajio` ─────────────────────────────────────
 *
 * Porque cambia el prefijo de folio y conecta un buzón SMTP, y en `evoelution`
 * las dos cosas se ven desde fuera: otros probes emiten folios con su prefijo, y
 * `probe-avisos` exige que esa empresa NO tenga buzón propio. Aquí la fila se
 * guarda al empezar y se repone al terminar. La suscripción ni siquiera toca
 * Bajío: se ensaya sobre una empresa creada por este probe.
 *
 * ── EL BUZÓN ES DE MENTIRA, Y NO SALE NADA DE LA MÁQUINA ───────────────────
 *
 * El host es `smtp.invalid`, que no resuelve nunca. Para el camino feliz —que
 * exige que la conexión se COMPRUEBE antes de guardar— se sustituye el
 * transporte de nodemailer en este proceso por uno que anota lo que recibe y no
 * abre ni un socket. Así se ve además QUÉ contraseña se comprobó y A QUIÉN se
 * mandó la prueba.
 */
import { createRequire } from "node:module";
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
  como,
  conError,
  filas,
  forma,
  foto,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
} from "./_acciones-kit";

const M = marca("CFG");
const PREFIJO = M.toLowerCase();
const correo = (quien: string) => `${PREFIJO}-${quien}@example.invalid`;
const slugDe = (esquema: string) => esquema.replace(/^tenant_/, "");

/* ── El transporte SMTP de mentira ───────────────────────────────────────── */

type Transporte = {
  verify(): Promise<unknown>;
  sendMail(m: Record<string, unknown>): Promise<{ messageId: string }>;
};
/*
  Se parchea `createTransport` en el MISMO objeto que carga `lib/mail`, y antes
  de que nadie lo importe: si la importación dinámica de allá construye su
  espacio de nombres copiando las funciones, copia ya la envoltura. Por eso es
  un interruptor y no un reemplazo que se pone y se quita: apagado, delega en el
  nodemailer de verdad —que con `smtp.invalid` falla sin salir de la máquina—.
*/
const buzon = {
  activo: false,
  comprobados: [] as Array<{ host?: unknown; port?: unknown; auth?: { user?: string; pass?: string } }>,
  enviados: [] as Array<Record<string, unknown>>,
};
const nodemailer = createRequire(__filename)("nodemailer") as {
  createTransport: (cfg: Record<string, unknown>) => Transporte;
};
const transporteReal = nodemailer.createTransport;
nodemailer.createTransport = (cfg) => {
  if (!buzon.activo) return transporteReal(cfg);
  return {
    verify: async () => {
      buzon.comprobados.push(cfg as (typeof buzon.comprobados)[number]);
      return true;
    },
    sendMail: async (m) => {
      buzon.enviados.push(m);
      return { messageId: "probe" };
    },
  };
};

/* ── Fotos ───────────────────────────────────────────────────────────────── */

const MARCA = (esquema: string) =>
  `select brand_name, folio_prefix, logo_url, tagline, contact_address, contact_phone,
          contact_email, document_logo_url
     from tenants where slug = '${slugDe(esquema)}'`;
const BUZON = (esquema: string) =>
  `select smtp_host, smtp_port, smtp_user, smtp_password, smtp_checked_at, mail_from,
          mail_from_name, mail_reply_to
     from tenants where slug = '${slugDe(esquema)}'`;
const SUSCRIPCION = (esquema: string) =>
  `select status, trial_ends_at, updated_at from tenants where slug = '${slugDe(esquema)}'`;

/** Las columnas de `tenants` que tocan marca, membrete y correo: se reponen al final. */
const COLUMNAS = [
  "brand_name",
  "folio_prefix",
  "logo_url",
  "tagline",
  "contact_address",
  "contact_phone",
  "contact_email",
  "document_logo_url",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_password",
  "smtp_checked_at",
  "mail_from",
  "mail_from_name",
  "mail_reply_to",
  "updated_at",
];

type Marca = {
  brand_name: string | null;
  folio_prefix: string | null;
  logo_url: string | null;
  tagline: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  document_logo_url: string | null;
};
type Buzon = {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_checked_at: Date | null;
  mail_from: string | null;
  mail_from_name: string | null;
  mail_reply_to: string | null;
};
type Estado = { ok: boolean; error?: string; message?: string };

/** Un `<input type=file>` con lo que se le ponga. */
function conArchivo(campos: Record<string, string>, campo: string, archivo: File): FormData {
  const fd = forma(campos);
  fd.set(campo, archivo);
  return fd;
}

void probar("empresa: marca, correo, avisos y suscripción", async () => {
  const [emp] = await sql<{ id: string }[]>`select id from tenants where slug = ${slugDe(ESQUEMA)}`;
  const [otra] = await sql<{ id: string }[]>`select id from tenants where slug = ${slugDe(AJENO)}`;
  if (!emp || !otra) throw new Error(`la base no trae ${ESQUEMA} y ${AJENO}`);
  const EMP = emp.id;
  const OTRA = otra.id;

  /*
    La fila de la empresa, tal cual estaba, se repone al final. Se guarda entera
    en las columnas que estas acciones tocan —`updated_at` incluida—, porque un
    `update` de marca que dejara el prefijo de folio de este probe haría nacer
    folios `CFGX-…` en la siguiente prueba que emita uno.
  */
  const [original] = await filas<Record<string, unknown>>(
    `select ${COLUMNAS.join(", ")} from tenants where id = '${EMP}'`,
  );
  alLimpiar(() =>
    sql.unsafe(
      `update tenants set ${COLUMNAS.map((c, i) => `${c} = $${i + 1}`).join(", ")} where id = '${EMP}'`,
      COLUMNAS.map((c) => original[c] ?? null) as never[],
    ),
  );
  alLimpiar(() => sql.unsafe(`delete from users where email like '${PREFIJO}-%'`));

  const [actor] = await sql<{ id: string }[]>`
    insert into users (name, email, active) values (${`${M} actor`}, ${correo("actor")}, true) returning id`;
  const [otro] = await sql<{ id: string }[]>`
    insert into users (name, email, active) values (${`${M} otro`}, ${correo("otro")}, true) returning id`;
  const ACTOR = actor.id;
  const OTRO = otro.id;
  await sql`insert into memberships (user_id, tenant_id, role, active)
            values (${ACTOR}, ${EMP}, 'admin', true), (${OTRO}, ${EMP}, 'agent', true)`;

  const inicial = { ok: false };
  const marcaAjenaAntes = await foto(MARCA(AJENO), BUZON(AJENO));

  /* ══════════════════════════ brand.ts ════════════════════════════════ */

  const b = await import("@/lib/actions/brand");

  seccion("marca: sin permiso, o con «editar», la fila no se mueve");
  const soloAdminMarca = conError("Solo un administrador cambia la marca.");
  const soloAdminMembrete = conError("Solo un administrador cambia el membrete.");
  const MARCA_BUENA = forma({ brandName: `${M} Marca`, folioPrefix: "CFGX" });
  const MEMBRETE_BUENO = forma({ tagline: `${M} lema`, contactPhone: "555-0100" });
  /*
    Estas dos no llaman a `auth()`: su guardia es `puedeEn()`, que en la
    aplicación dice que no cuando no hay sesión. «Sin sesión» es, para el stub,
    el permiso denegado.
  */
  for (const [quien, puede] of [
    [null, false],
    [ACTOR, false],
    [ACTOR, "configuracion:editar"],
  ] as const) {
    como(quien, puede);
    const etiqueta = quien ? `con «${puede}»` : "sin sesión";
    await rechazaSinEscribir(`marca ${etiqueta}`, () => b.updateTenantBrand(inicial, MARCA_BUENA), [MARCA(ESQUEMA)], soloAdminMarca);
    await rechazaSinEscribir(
      `membrete ${etiqueta}`,
      () => b.updateDocumentBranding(inicial, MEMBRETE_BUENO),
      [MARCA(ESQUEMA)],
      soloAdminMembrete,
    );
  }

  seccion("marca: un prefijo de folio mal formado o un logo que no es imagen no se guardan");
  como(ACTOR, "configuracion:administrar");
  for (const p of ["1AB", "A", "ABCDEFGHI", "A-B"])
    await rechazaSinEscribir(
      `prefijo «${p}»`,
      () => b.updateTenantBrand(inicial, forma({ brandName: `${M} Marca`, folioPrefix: p })),
      [MARCA(ESQUEMA)],
      (r) => r?.ok === false && String(r.error).startsWith("El prefijo de folio"),
    );
  const noEsImagen = new File(["hola"], "logo.txt", { type: "text/plain" });
  await rechazaSinEscribir(
    "logo de texto",
    () => b.updateTenantBrand(inicial, conArchivo({ brandName: `${M} Marca` }, "logo", noEsImagen)),
    [MARCA(ESQUEMA)],
    (r) => r?.ok === false && String(r.error).startsWith("Formato de imagen no permitido"),
  );
  await rechazaSinEscribir(
    "logo del membrete de texto",
    () => b.updateDocumentBranding(inicial, conArchivo({ tagline: "x" }, "documentLogo", noEsImagen)),
    [MARCA(ESQUEMA)],
    (r) => r?.ok === false && String(r.error).startsWith("Formato de imagen no permitido"),
  );

  seccion("marca: se guarda en ESTA empresa aunque el formulario nombre otra");
  // Un logo ya puesto, para ver que guardar solo el nombre no lo borra.
  await sql`update tenants set logo_url = '/uploads/probe/marca.png',
                               document_logo_url = '/uploads/probe/membrete.png'
             where id = ${EMP}`;
  /*
    `tenantId` y `slug` no son campos del formulario de marca. Se mandan igual:
    es lo que haría quien quisiera cambiar el logo de otra empresa con una
    petición a mano, y la acción tiene que ignorarlos.
  */
  let r: Estado = await b.updateTenantBrand(
    inicial,
    forma({ brandName: `  ${M} Marca  `, folioPrefix: "cfgx", tenantId: OTRA, slug: slugDe(AJENO) }),
  );
  let [m] = await filas<Marca>(MARCA(ESQUEMA));
  ok("la marca responde ok", r.ok === true, r.error);
  ok("el nombre, sin espacios", m?.brand_name === `${M} Marca`, m?.brand_name ?? "null");
  ok("el prefijo, en mayúsculas", m?.folio_prefix === "CFGX", m?.folio_prefix ?? "null");
  ok("y sin archivo, el logo que había se conserva", m?.logo_url === "/uploads/probe/marca.png");

  r = await b.updateTenantBrand(inicial, forma({ brandName: `${M} ${"x".repeat(80)}`, folioPrefix: "" }));
  [m] = await filas<Marca>(MARCA(ESQUEMA));
  ok("un nombre largo se recorta a 60", r.ok && m?.brand_name?.length === 60, String(m?.brand_name?.length));
  ok("y un prefijo vacío NO borra el que había", m?.folio_prefix === "CFGX", m?.folio_prefix ?? "null");

  r = await b.updateTenantBrand(inicial, forma({ brandName: `${M} Marca`, removeLogo: "1" }));
  [m] = await filas<Marca>(MARCA(ESQUEMA));
  ok("quitar el logo lo deja en NULL", r.ok && r.message === "Logo quitado." && m?.logo_url === null);

  r = await b.updateDocumentBranding(
    inicial,
    forma({
      tagline: `  ${M} ${"lema ".repeat(40)}`,
      contactAddress: "  Calle Falsa 123  ",
      contactPhone: "555-0100",
      contactEmail: correo("contacto"),
      tenantId: OTRA,
    }),
  );
  [m] = await filas<Marca>(MARCA(ESQUEMA));
  ok("el membrete responde ok", r.ok === true, r.error);
  ok(
    "con los datos limpios y el lema recortado a 120",
    m?.contact_address === "Calle Falsa 123" &&
      m.contact_phone === "555-0100" &&
      m.contact_email === correo("contacto") &&
      m.tagline?.length === 120 &&
      m.tagline.startsWith(M),
    JSON.stringify(m),
  );
  ok("y el logo del membrete, sin archivo, se conserva", m?.document_logo_url === "/uploads/probe/membrete.png");

  r = await b.updateDocumentBranding(inicial, forma({ tagline: "", contactAddress: "   ", removeDocumentLogo: "1" }));
  [m] = await filas<Marca>(MARCA(ESQUEMA));
  ok(
    "vacío es NULL, no cadena vacía, y el logo del membrete se quita",
    r.ok &&
      m?.tagline === null &&
      m.contact_address === null &&
      m.contact_phone === null &&
      m.contact_email === null &&
      m.document_logo_url === null,
    JSON.stringify(m),
  );

  /* ══════════════════════════ correo.ts ═══════════════════════════════ */

  const c = await import("@/lib/actions/correo");
  const { abrir } = await import("@/lib/secretos");
  const soloAdminCorreo = conError("Solo un administrador configura el correo de la empresa.");
  const CLAVE = `${M}-clave-del-buzon`;
  const BUZON_BUENO = {
    host: "smtp.invalid",
    port: "587",
    user: correo("buzon"),
    password: CLAVE,
    fromName: `${M} Avisos`,
  };
  /* Arranca sin buzón: es lo que la base sembrada trae, y lo que se repone. */
  await sql`update tenants set smtp_host = null, smtp_port = null, smtp_user = null,
                               smtp_password = null, smtp_checked_at = null
             where id = ${EMP}`;

  seccion("correo: sin permiso, o con «editar», no se conecta ni se prueba nada");
  for (const [quien, puede] of [
    [null, false],
    [ACTOR, false],
    [ACTOR, "configuracion:editar"],
  ] as const) {
    como(quien, puede);
    const etiqueta = quien ? `con «${puede}»` : "sin sesión";
    await rechazaSinEscribir(`guardar el buzón ${etiqueta}`, () => c.guardarCorreoAction(inicial, forma(BUZON_BUENO)), [BUZON(ESQUEMA)], soloAdminCorreo);
    await rechazaSinEscribir(`probar el correo ${etiqueta}`, () => c.probarCorreoAction(inicial, forma({})), [BUZON(ESQUEMA)], soloAdminCorreo);
  }

  seccion("correo: una captura incompleta, o un servidor que no conecta, no se guardan");
  como(ACTOR, "configuracion:administrar");
  for (const [nombre, cambio, empieza] of [
    ["sin cuenta", { user: "" }, "Falta la cuenta"],
    ["puerto 0", { port: "0" }, "El puerto no es válido"],
    ["puerto 70000", { port: "70000" }, "El puerto no es válido"],
    ["puerto que no es número", { port: "abc" }, "El puerto no es válido"],
    ["sin contraseña, y sin una guardada", { password: "" }, "Falta la contraseña"],
  ] as const)
    await rechazaSinEscribir(
      `buzón ${nombre}`,
      () => c.guardarCorreoAction(inicial, forma({ ...BUZON_BUENO, ...cambio })),
      [BUZON(ESQUEMA)],
      (x) => x?.ok === false && String(x.error).startsWith(empieza),
    );
  /*
    Con el nodemailer de verdad: `smtp.invalid` no resuelve, la comprobación
    falla y NO se guarda. Es la promesa de la pantalla —«se comprueba antes de
    darla por buena»—, y de paso que el motivo que se enseña no lleve la clave.
  */
  let motivo = "";
  await rechazaSinEscribir(
    "un servidor que no conecta",
    () => c.guardarCorreoAction(inicial, forma(BUZON_BUENO)),
    [BUZON(ESQUEMA)],
    (x) => {
      motivo = String(x?.error ?? "");
      return x?.ok === false && motivo.startsWith("El servidor rechazó la conexión");
    },
  );
  ok("y el motivo no enseña la contraseña", motivo !== "" && !motivo.includes(CLAVE), motivo.slice(0, 80));

  seccion("correo: se guarda comprobado, y la contraseña CIFRADA");
  buzon.activo = true;
  r = await c.guardarCorreoAction(inicial, forma({ ...BUZON_BUENO, tenantId: OTRA }));
  let [bz] = await filas<Buzon>(BUZON(ESQUEMA));
  ok("el buzón responde ok", r.ok === true, r.error);
  ok(
    "se comprobó con lo que se tecleó antes de guardarlo",
    buzon.comprobados.length === 1 &&
      buzon.comprobados[0].host === "smtp.invalid" &&
      buzon.comprobados[0].auth?.pass === CLAVE,
  );
  ok(
    "host, puerto, cuenta y fecha de comprobación",
    bz?.smtp_host === "smtp.invalid" && bz.smtp_port === 587 && bz.smtp_user === correo("buzon") && bz.smtp_checked_at !== null,
  );
  ok("sin remitente, sale desde la cuenta", bz?.mail_from === correo("buzon") && bz.mail_from_name === `${M} Avisos`);
  ok(
    "la contraseña NO queda en claro en la base",
    !!bz?.smtp_password && bz.smtp_password !== CLAVE && !bz.smtp_password.includes(CLAVE),
  );
  ok("queda sellada (v1, AES-GCM) y se abre con la clave del servidor", bz?.smtp_password?.startsWith("v1.") === true && abrir(bz.smtp_password) === CLAVE);
  const selladaAntes = bz?.smtp_password;

  /*
    Sin contraseña nueva se reusa la guardada: es lo que deja corregir el puerto
    sin volver a teclearla. Se comprueba que lo que se verificó fue la VIEJA —
    descifrada— y que se volvió a sellar con otro IV.
  */
  r = await c.guardarCorreoAction(inicial, forma({ ...BUZON_BUENO, port: "465", password: "" }));
  [bz] = await filas<Buzon>(BUZON(ESQUEMA));
  ok("cambiar solo el puerto responde ok", r.ok === true, r.error);
  ok(
    "y comprueba con la contraseña guardada",
    buzon.comprobados.length === 2 && buzon.comprobados[1].auth?.pass === CLAVE && buzon.comprobados[1].port === 465,
  );
  ok(
    "que sigue cifrada y abre igual",
    bz?.smtp_port === 465 && bz.smtp_password !== selladaAntes && abrir(bz.smtp_password) === CLAVE,
  );
  ok("la otra empresa no ganó buzón", (await foto(MARCA(AJENO), BUZON(AJENO))) === marcaAjenaAntes);

  seccion("correo: la prueba va a quien la pide, y no a donde diga el formulario");
  /*
    A la dirección de la SESIÓN: una pantalla que manda correo a donde le digan
    es un relay abierto. `para` y `destino` se mandan igual, como los mandaría
    quien lo intentara.
  */
  process.env.PROBE_USER_EMAIL = correo("sesion");
  r = await c.probarCorreoAction(inicial, forma({ para: correo("intruso"), destino: correo("intruso") }));
  ok("con buzón propio, la prueba sale", r.ok === true && String(r.message).includes("desde tu buzón"), r.error ?? r.message);
  ok(
    "y va a quien tiene la sesión, solo a él",
    buzon.enviados.length === 1 && buzon.enviados[0].to === correo("sesion"),
    JSON.stringify(buzon.enviados.map((e) => e.to)),
  );
  process.env.PROBE_USER_EMAIL = "";
  r = await c.probarCorreoAction(inicial, forma({ para: correo("intruso") }));
  ok("una sesión sin correo no manda nada", r.ok === false && r.error === "Tu cuenta no tiene correo." && buzon.enviados.length === 1);
  delete process.env.PROBE_USER_EMAIL;
  buzon.activo = false;

  seccion("correo: vaciar el servidor desconecta el buzón, contraseña incluida");
  r = await c.guardarCorreoAction(inicial, forma({ host: "" }));
  [bz] = await filas<Buzon>(BUZON(ESQUEMA));
  ok(
    "todo lo del SMTP queda en NULL",
    r.ok === true && bz?.smtp_host === null && bz.smtp_port === null && bz.smtp_user === null && bz.smtp_password === null,
  );
  /*
    Y sin buzón, con el transporte de consola, el botón de probar tiene que
    decir que NO salió nada: decir «enviado» con la consola puesta es como se
    creyó en producción que los avisos funcionaban.
  */
  r = await c.probarCorreoAction(inicial, forma({}));
  ok("sin buzón, «probar» dice que no se envió nada", r.ok === false && String(r.error).startsWith("NO se envió nada"), r.error);
  ok("la otra empresa sigue igual", (await foto(MARCA(AJENO), BUZON(AJENO))) === marcaAjenaAntes);

  /* ══════════════════════════ avisos.ts ═══════════════════════════════ */

  seccion("avisos: cada quien marca los suyos, y solo en esta empresa");
  /*
    Un ticket en cada empresa —el aviso tiene que colgar de algo— y avisos sin
    leer: dos de quien tiene la sesión y uno de otra persona aquí, más uno de
    quien tiene la sesión en la OTRA empresa. Borrar a las personas al final
    arrastra tickets y avisos (`on delete cascade`).
  */
  const [ticket] = await sql<{ id: string }[]>`
    insert into ${sql(ESQUEMA)}.tickets (reference, subject, description, created_by_id)
    values (${`${M}-T`}, ${`${M} ticket`}, 'probe', ${ACTOR}) returning id`;
  const [ticketAjeno] = await sql<{ id: string }[]>`
    insert into ${sql(AJENO)}.tickets (reference, subject, description, created_by_id)
    values (${`${M}-T`}, ${`${M} ticket`}, 'probe', ${ACTOR}) returning id`;
  const aviso = async (esquema: string, usuario: string, ticketId: string) =>
    (
      await sql<{ id: string }[]>`
        insert into ${sql(esquema)}.notifications (user_id, ticket_id, kind, title)
        values (${usuario}, ${ticketId}, 'probe', ${`${M} aviso`}) returning id`
    )[0].id;
  const MIO_1 = await aviso(ESQUEMA, ACTOR, ticket.id);
  const MIO_2 = await aviso(ESQUEMA, ACTOR, ticket.id);
  const AJENO_AQUI = await aviso(ESQUEMA, OTRO, ticket.id);
  const MIO_ALLA = await aviso(AJENO, ACTOR, ticketAjeno.id);
  const leido = async (esquema: string, id: string) =>
    (await filas<{ read_at: Date | null }>(`select read_at from ${esquema}.notifications where id = '${id}'`))[0]?.read_at !== null;
  const AVISOS = [
    `select id, read_at from ${ESQUEMA}.notifications where title = '${M} aviso' order by id`,
    `select id, read_at from ${AJENO}.notifications where title = '${M} aviso' order by id`,
  ];

  const { marcarAvisosLeidos } = await import("@/lib/actions/avisos");
  como(null);
  await rechazaSinEscribir("marcar sin sesión", () => marcarAvisosLeidos(forma({})), AVISOS);

  /*
    Sin ningún permiso de módulo, marca igual lo suyo: la acción no tiene
    guardia de módulo A PROPÓSITO —una persona sin Servicio tendría la campana
    llena y sin forma de vaciarla— y lo que la hace segura es que el `where`
    lleva siempre el id de quien pregunta.
  */
  como(ACTOR, false);
  await rechazaSinEscribir("marcar el aviso de OTRA persona por su id", () => marcarAvisosLeidos(forma({ id: AJENO_AQUI })), AVISOS);
  await marcarAvisosLeidos(forma({ id: MIO_1 }));
  ok("con su id, se marca ese aviso y solo ése", (await leido(ESQUEMA, MIO_1)) && !(await leido(ESQUEMA, MIO_2)));
  await marcarAvisosLeidos(forma({}));
  ok("sin id, se marcan todos los suyos", await leido(ESQUEMA, MIO_2));
  ok("y los de otra persona no", !(await leido(ESQUEMA, AJENO_AQUI)));
  ok("ni los suyos en otra empresa", !(await leido(AJENO, MIO_ALLA)));

  /* ═════════════════════════ suscripcion.ts ═══════════════════════════ */

  seccion("suscripción: solo un superadministrador, leído de la base");
  /*
    Operadores de plataforma de este probe. La empresa sobre la que se ensaya es
    también de este probe: suspender Bajío, aunque sea un segundo, cerraría la
    puerta a cualquier otra prueba que corra ahí.
  */
  const operador = async (quien: string, rol: string, activo = true) =>
    (
      await sql<{ id: string }[]>`
        insert into platform_users (name, email, role, active)
        values (${`${M} ${quien}`}, ${correo(quien)}, ${rol}, ${activo}) returning id`
    )[0].id;
  const SUPER = await operador("super", "superadmin");
  const SOPORTE = await operador("soporte", "support");
  const SUPER_BAJA = await operador("super-baja", "superadmin", false);
  const SLUG_T = `${PREFIJO.replace(/-/g, "_")}_suscripcion`;
  const [t] = await sql<{ id: string }[]>`
    insert into tenants (slug, name, status, plan) values (${SLUG_T}, ${`${M} Suscripción`}, 'trial', 'poc') returning id`;
  const T = t.id;
  /*
    Orden inverso: primero los eventos (su foránea a la empresa y al operador
    es `set null` y dejaría filas huérfanas de esta corrida), luego la empresa,
    luego los operadores.
  */
  alLimpiar(() => sql.unsafe(`delete from platform_users where email like '${PREFIJO}-%'`));
  alLimpiar(() => sql.unsafe(`delete from tenants where id = '${T}'`));
  alLimpiar(() =>
    sql.unsafe(
      `delete from platform_events where tenant_id = '${T}'
          or actor_id in ('${SUPER}', '${SOPORTE}', '${SUPER_BAJA}')`,
    ),
  );

  const FILA_T = `select status, trial_ends_at, updated_at from tenants where id = '${T}'`;
  const EVENTOS_T = `select count(*)::int as n from platform_events where tenant_id = '${T}'`;
  const FOTO_T = [FILA_T, EVENTOS_T];
  const otrasAntes = await foto(SUSCRIPCION(ESQUEMA), SUSCRIPCION(AJENO));

  const s = await import("@/lib/actions/suscripcion");
  const soloSuper = conError("Solo un superadministrador.");
  const acciones = [
    ["iniciar prueba", () => s.iniciarPrueba(inicial, forma({ tenantId: T, dias: "10" }))],
    ["activar", () => s.activarSuscripcion(inicial, forma({ tenantId: T }))],
    ["suspender", () => s.suspenderSuscripcion(inicial, forma({ tenantId: T, motivo: "Falta de pago" }))],
  ] as const;
  /*
    Cuatro sesiones que NO deben pasar. Las dos del medio son las que importan:
    una cuenta de empresa cuyo token dijera «superadmin», y un operador de
    soporte con el mismo token. El rol sale de `platform_users` y no del token
    —con JWT, degradar a alguien tardaba treinta días en surtir efecto—.
  */
  for (const [nombre, fijar] of [
    ["sin sesión", () => como(null)],
    ["con sesión de empresa", () => como(ACTOR, true)],
    ["con sesión de empresa que dice ser superadmin", () => como(ACTOR, true, { plataforma: "superadmin" })],
    ["con soporte que dice ser superadmin", () => como(SOPORTE, true, { plataforma: "superadmin" })],
    ["con un superadmin desactivado", () => como(SUPER_BAJA, true, { plataforma: "superadmin" })],
  ] as const) {
    fijar();
    for (const [accion, fn] of acciones) await rechazaSinEscribir(`${accion} ${nombre}`, fn, FOTO_T, soloSuper);
  }

  seccion("suscripción: captura inválida");
  como(SUPER, true, { plataforma: "superadmin" });
  for (const d of ["0", "366", "1.5", "abc"])
    await rechazaSinEscribir(
      `prueba de «${d}» días`,
      () => s.iniciarPrueba(inicial, forma({ tenantId: T, dias: d })),
      FOTO_T,
      conError("Los días tienen que ser un entero entre 1 y 365."),
    );
  for (const [accion, fn] of [
    ["iniciar prueba", () => s.iniciarPrueba(inicial, forma({ dias: "10" }))],
    ["activar", () => s.activarSuscripcion(inicial, forma({}))],
    ["suspender", () => s.suspenderSuscripcion(inicial, forma({ motivo: "Falta de pago" }))],
  ] as const)
    await rechazaSinEscribir(`${accion} sin empresa`, fn, FOTO_T, conError("Falta la empresa."));
  await rechazaSinEscribir(
    "suspender sin motivo",
    () => s.suspenderSuscripcion(inicial, forma({ tenantId: T, motivo: " x " })),
    FOTO_T,
    conError("Escribe el motivo: es lo que explica el corte después."),
  );
  /*
    El `tenantId` viaja en un campo oculto. Uno que no es uuid, o que no es de
    ninguna empresa, reventaba —en Postgres el primero, en la foránea del
    evento el segundo— en vez de responder con un error que la consola pueda
    enseñar.
  */
  for (const [nombre, id] of [
    ["que no es uuid", "no-soy-un-uuid"],
    ["que no existe", "00000000-0000-0000-0000-00000000c0f9"],
  ] as const)
    for (const [accion, fn] of [
      ["iniciar prueba", () => s.iniciarPrueba(inicial, forma({ tenantId: id, dias: "10" }))],
      ["activar", () => s.activarSuscripcion(inicial, forma({ tenantId: id }))],
      ["suspender", () => s.suspenderSuscripcion(inicial, forma({ tenantId: id, motivo: "Falta de pago" }))],
    ] as const)
      await rechazaSinEscribir(`${accion} con una empresa ${nombre}`, fn, FOTO_T, conError("Esa empresa no existe."));

  seccion("suscripción: cada cambio se guarda y deja rastro con su responsable");
  type Evento = { payload: Record<string, unknown>; actor_id: string | null; event_type: string };
  const ultimoEvento = async () =>
    (
      await filas<Evento>(
        `select payload, actor_id, event_type from platform_events where tenant_id = '${T}' order by id desc limit 1`,
      )
    )[0];
  const eventos = async () => (await filas<{ n: number }>(EVENTOS_T))[0].n;
  type FilaT = { status: string; trial_ends_at: Date | null };

  let n = await eventos();
  const antes = Date.now();
  r = await s.iniciarPrueba(inicial, forma({ tenantId: T, dias: "10" }));
  let [ft] = await filas<FilaT>(FILA_T);
  let ev = await ultimoEvento();
  const desvio = Math.abs((ft?.trial_ends_at?.getTime() ?? 0) - (antes + 10 * 86_400_000));
  ok("la prueba arranca", r.ok === true && ft?.status === "trial", r.error);
  ok("con diez días contados desde HOY", desvio < 120_000, `desvío ${Math.round(desvio / 1000)} s`);
  ok(
    "y un evento firmado por el superadministrador",
    (await eventos()) === n + 1 && ev?.event_type === "tenant.subscription_changed" && ev.actor_id === SUPER && ev.payload.accion === "prueba_iniciada" && ev.payload.dias === 10,
    JSON.stringify(ev?.payload),
  );

  n = await eventos();
  r = await s.activarSuscripcion(inicial, forma({ tenantId: T }));
  [ft] = await filas<FilaT>(FILA_T);
  ev = await ultimoEvento();
  ok("activar la deja activa y SIN fecha de corte", r.ok === true && ft?.status === "active" && ft.trial_ends_at === null);
  ok("con su evento", (await eventos()) === n + 1 && ev?.payload.accion === "activada" && ev.actor_id === SUPER);

  n = await eventos();
  r = await s.suspenderSuscripcion(inicial, forma({ tenantId: T, motivo: "  Falta de pago  " }));
  [ft] = await filas<FilaT>(FILA_T);
  ev = await ultimoEvento();
  ok("suspender la deja suspendida", r.ok === true && ft?.status === "suspended");
  ok("con el motivo en el evento", (await eventos()) === n + 1 && ev?.payload.accion === "suspendida" && ev.payload.motivo === "Falta de pago");

  ok(
    `y ni ${slugDe(ESQUEMA)} ni ${slugDe(AJENO)} cambiaron de estado`,
    (await foto(SUSCRIPCION(ESQUEMA), SUSCRIPCION(AJENO))) === otrasAntes,
  );
});
