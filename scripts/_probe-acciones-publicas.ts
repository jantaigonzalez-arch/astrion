/**
 * LAS DOS ACCIONES QUE CORREN SIN SESIÓN: EL CONTACTO Y LA SOLICITUD DE ALTA.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-publicas.ts
 *
 * `submitLead` (el formulario de contacto del sitio) y `requestSignup` (la
 * solicitud de alta de una empresa) las llama un desconocido. No hay guardia
 * de permiso que probar: lo que las protege es la VALIDACIÓN, las defensas
 * contra abuso que cada una tenga, y DÓNDE escriben. Se prueban las tres cosas
 * y todo se ejercita sin sesión, que es como llegan en producción.
 *
 * ── LO QUE SE ATA DE CADA UNA ──────────────────────────────────────────────
 *
 * `requestSignup` escribe en el plano de control (`tenant_signups` y la
 * bitácora de plataforma) y NADA más: ni empresa, ni esquema, ni usuario. Tiene
 * dos frenos —la trampa para robots y una solicitud por correo cada 24 h— y
 * una promesa: al visitante le contesta lo mismo pase lo que pase, para que el
 * formulario no sirva de detector de quién es cliente.
 *
 * `submitLead` no tiene frenos: ni trampa, ni límite, ni duplicados. Se deja
 * dicho con una línea «·» —es una decisión de diseño, no un fallo que una
 * prueba pueda dar por roto— y se prueba lo que sí tiene: la validación y el
 * sitio donde cae.
 *
 * ── LIMPIEZA ────────────────────────────────────────────────────────────────
 *
 * Todo lleva `TAG` en el correo. Las solicitudes, sus eventos de plataforma
 * (`platform_events` no es de solo anexar, a diferencia de `domain_events`) y
 * los contactos se borran al final.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
  borrarAlFinal,
  como,
  conError,
  cuantos,
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

const TAG = marca("XTR");
/** Las acciones guardan el correo en minúsculas; la marca, para buscarlo, también. */
const tag = TAG.toLowerCase();
const correo = (quien: string) => `${tag}-${quien}@ejemplo.test`;

void probar("acciones públicas: validación, frenos y dónde escriben", async () => {
  alLimpiar(() =>
    sql.unsafe(
      `delete from public.platform_events
        where event_type = 'tenant.signup_requested' and payload->>'correo' like '${tag}%'`,
    ),
  );
  borrarAlFinal("tenant_signups", `email like '${tag}%'`, "public");
  borrarAlFinal("leads", `email like '${tag}%'`);
  borrarAlFinal("leads", `email like '${tag}%'`, AJENO);

  const { requestSignup } = await import("@/lib/actions/signup");
  const { submitLead } = await import("@/lib/actions/leads");

  /* Las dos las llama un desconocido: sin sesión de principio a fin. */
  como(null);

  /* ════════════════════════════ requestSignup ════════════════════════════ */
  const SOLICITUDES = `select count(*)::int n from public.tenant_signups where email like '${tag}%'`;
  const BITACORA = `select count(*)::int n from public.platform_events
                     where event_type = 'tenant.signup_requested' and payload->>'correo' like '${tag}%'`;
  const sinEstado = { ok: false } as const;
  const BUENA = {
    companyName: `${TAG} Ñandú Logística`,
    contactName: "Persona de Prueba",
    email: correo("feliz"),
    phone: "",
    size: "11-50",
    industry: "",
    note: "Solicitud de prueba",
    locale: "es-MX-extra",
  };
  const solicitar = (campos: Record<string, string> = {}) =>
    requestSignup(sinEstado, forma({ ...BUENA, ...campos }));

  seccion("requestSignup · la trampa para robots");
  /*
    El campo `website` va oculto: una persona no lo ve, un robot lo llena. La
    acción contesta que sí y no guarda nada. Que conteste que SÍ se comprueba
    abajo, contra la respuesta del camino feliz.
  */
  let trampa: Awaited<ReturnType<typeof requestSignup>> | undefined;
  await rechazaSinEscribir(
    "un robot que llena la trampa",
    async () => (trampa = await solicitar({ email: correo("robot"), website: "http://spam.example" })),
    [SOLICITUDES, BITACORA],
    (r) => r?.ok === true,
  );

  seccion("requestSignup · la captura inválida no entra, y dice qué campo");
  const enCampo = (campo: string) => (r: Awaited<ReturnType<typeof requestSignup>> | undefined) =>
    r?.ok === false && Boolean(r.fields?.[campo]);
  for (const [nombre, campos, campo] of [
    ["sin empresa", { companyName: "" }, "companyName"],
    ["empresa de puros espacios", { companyName: "    " }, "companyName"],
    ["contacto de una letra", { contactName: "A" }, "contactName"],
    ["correo que no es correo", { email: "no-es-un-correo" }, "email"],
    ["nota de más de 2000", { note: "x".repeat(2001) }, "note"],
  ] as const)
    await rechazaSinEscribir(nombre, () => solicitar(campos), [SOLICITUDES, BITACORA], enCampo(campo));

  seccion("requestSignup · la solicitud entra al plano de control, y nada más");
  /* El correo en mayúsculas: se tiene que guardar en minúsculas. */
  const feliz = await solicitar({ email: correo("feliz").toUpperCase() });
  ok("responde que se recibió", feliz.ok === true && feliz.message === "recibida", JSON.stringify(feliz));
  const [fila] = await filas<{
    id: string;
    company_name: string;
    desired_slug: string | null;
    email: string;
    phone: string | null;
    size: string | null;
    industry: string | null;
    locale: string;
    status: string;
    tenant_id: string | null;
    reviewed_by: string | null;
  }>(`select id, company_name, desired_slug, email, phone, size, industry, locale, status,
             tenant_id, reviewed_by
        from public.tenant_signups where email = '${correo("feliz")}'`);
  ok("la solicitud está, con el correo en minúsculas", Boolean(fila), correo("feliz"));
  ok(
    "PENDIENTE, sin empresa y sin revisor: la aprueba un superadministrador a mano",
    fila?.status === "pending" && fila?.tenant_id === null && fila?.reviewed_by === null,
    `${fila?.status} · ${fila?.tenant_id} · ${fila?.reviewed_by}`,
  );
  const slug = `${tag.replace(/-/g, "_")}_nandu_logistica`;
  ok("el identificador sugerido, sin acentos ni signos", fila?.desired_slug === slug, fila?.desired_slug ?? "null");
  ok(
    "lo vacío se guarda como vacío y el idioma, a cinco letras",
    fila?.phone === null && fila?.industry === null && fila?.size === "11-50" && fila?.locale === "es-MX",
    `${fila?.phone} · ${fila?.industry} · ${fila?.size} · ${fila?.locale}`,
  );
  const [ev] = await filas<{ tenant_id: string | null; actor_id: string | null; signup: string }>(
    `select tenant_id, actor_id, payload->>'signupId' signup from public.platform_events
      where event_type = 'tenant.signup_requested' and payload->>'correo' = '${correo("feliz")}'`,
  );
  ok(
    "y queda en la bitácora de plataforma, sin empresa ni actor",
    ev?.signup === fila?.id && ev?.tenant_id === null && ev?.actor_id === null,
    JSON.stringify(ev),
  );
  /* Lo que NO debe haber creado: es lo que haría de un formulario una puerta. */
  ok("no crea empresa", (await cuantos("tenants", `where slug = '${slug}'`, "public")) === 0);
  ok(
    "ni esquema",
    (await cuantos("schemata", `where schema_name = 'tenant_${slug}'`, "information_schema")) === 0,
  );
  ok("ni usuario", (await cuantos("users", `where lower(email) like '${tag}%'`, "public")) === 0);

  seccion("requestSignup · una solicitud por correo cada 24 h");
  await rechazaSinEscribir(
    "el mismo correo otra vez, con otras mayúsculas",
    () => solicitar({ email: correo("feliz").replace("feliz", "FeLiZ") }),
    [SOLICITUDES, BITACORA],
    (r) => JSON.stringify(r) === JSON.stringify(feliz),
  );
  /*
    El freno mira 24 h hacia atrás y no más. Una solicitud de ayer —puesta a
    mano con la fecha corrida— no impide la de hoy.
  */
  await sql.unsafe(
    `insert into public.tenant_signups (company_name, contact_name, email, created_at)
     values ('${TAG} Vieja', 'Persona de Prueba', '${correo("ayer")}', now() - interval '25 hours')`,
  );
  const deAyer = await solicitar({ email: correo("ayer") });
  ok(
    "pasadas 24 h, el mismo correo vuelve a entrar",
    deAyer.ok === true && (await cuantos("tenant_signups", `where email = '${correo("ayer")}'`, "public")) === 2,
  );

  seccion("requestSignup · al visitante se le contesta siempre lo mismo");
  /*
    La trampa contestaba «gracias» y el camino feliz «recibida». La pantalla no
    enseña el mensaje, pero la respuesta de la acción viaja entera al
    navegador: un robot que la leyera sabía que había caído en la trampa, que
    es justo lo que la trampa tiene que esconder. Lo encontró este probe.
  */
  ok(
    "la trampa contesta exactamente lo mismo que una solicitud que entra",
    JSON.stringify(trampa) === JSON.stringify(feliz),
    `${JSON.stringify(trampa)} vs ${JSON.stringify(feliz)}`,
  );

  /* ═════════════════════════════ submitLead ═════════════════════════════ */
  const LEADS = `select count(*)::int n from ${ESQUEMA}.leads where email like '${tag}%'`;
  const BUEN_LEAD = {
    name: "Persona de Prueba",
    email: correo("lead"),
    company: "",
    message: "Quiero una demostración, por favor.",
  };
  const contactar = (campos: Record<string, string> = {}) =>
    submitLead({ ok: false }, forma({ ...BUEN_LEAD, ...campos }));

  seccion("submitLead · la captura inválida no entra");
  for (const [nombre, campos] of [
    ["nombre de una letra", { name: "A" }],
    ["sin nombre", { name: "" }],
    ["correo que no es correo", { email: "no-es-un-correo" }],
    ["mensaje de cuatro letras", { message: "hola" }],
    ["empresa de más de 200", { company: "x".repeat(201) }],
    ["mensaje de más de 2000", { message: "x".repeat(2001) }],
  ] as const)
    await rechazaSinEscribir(nombre, () => contactar(campos), [LEADS], conError("invalid"));

  /*
    EL DESTINO ES EL DEL SITIO, NO EL DE LA SESIÓN.

    Se guardaba con `tenantDb()`: la empresa de la sesión, que un visitante no
    tiene. Ahora va a la de `LEADS_TENANT`. Para que se vea que la sesión ya
    no decide, se apunta a la empresa AJENA mientras la sesión sigue en ésta.
  */
  seccion("submitLead · el contacto cae en la empresa del sitio, no en la de la sesión");
  const antesLeads = process.env.LEADS_TENANT;
  alLimpiar(async () => {
    if (antesLeads === undefined) delete process.env.LEADS_TENANT;
    else process.env.LEADS_TENANT = antesLeads;
  });
  process.env.LEADS_TENANT = AJENO.replace(/^tenant_/, "");
  const r = await contactar({ email: correo("lead").toUpperCase() });
  ok("responde ok", r.ok === true, JSON.stringify(r));
  const [lead] = await filas<{ email: string; company: string | null; source: string; status: string }>(
    `select email, company, source, status from ${AJENO}.leads where email like '${tag}%'`,
  );
  ok(`el contacto está en ${AJENO}, con el correo en minúsculas`, lead?.email === correo("lead"), lead?.email);
  ok(
    "nuevo, de la web y sin empresa si no la dio",
    lead?.status === "new" && lead?.source === "web_contact" && lead?.company === null,
    `${lead?.status} · ${lead?.source} · ${lead?.company}`,
  );
  ok(`y NO en la empresa de la sesión (${ESQUEMA})`, (await cuantos("leads", `where email like '${tag}%'`)) === 0);

  process.env.LEADS_TENANT = "no-existe-esta-empresa";
  await rechazaSinEscribir(
    "con un LEADS_TENANT que no existe",
    () => contactar(),
    [LEADS, `select count(*)::int n from ${AJENO}.leads where email like '${tag}%'`],
    conError("server"),
  );

  // Sin la variable, al sitio de siempre.
  delete process.env.LEADS_TENANT;
  await contactar({ email: correo("lead2") });
  ok(
    "sin LEADS_TENANT, va a evoelution",
    (await cuantos("leads", `where email = '${correo("lead2")}'`, "tenant_evoelution")) === 1,
  );
  process.env.LEADS_TENANT = AJENO.replace(/^tenant_/, "");

  await contactar({ email: correo("lead") });
  const repetidos = await cuantos("leads", `where email like '${tag}%'`, AJENO);
  console.log(
    `· sin trampa para robots ni freno por correo: el mismo envío dos veces deja ${repetidos} filas`,
  );

  seccion("submitLead · un visitante del sitio no tiene empresa");
  /*
    EL FORMULARIO DE CONTACTO NO FUNCIONABA PARA QUIEN NO HA ENTRADO.

    `submitLead` guardaba con `tenantDb()`, que exige una empresa activa, y la
    empresa activa sale de la SESIÓN (`getTenantContext` → `auth()`). Un
    visitante de `/contacto` no tiene sesión: `requireTenant()` lanza, el
    `catch` lo convierte en «server» y el contacto se pierde —solo queda un
    `console.error`—. Y a quien sí ha entrado, el contacto le cae en el CRM de
    SU empresa, no en el de quien opera el sitio.

    El probe no puede verlo llamando a la acción: el stub de inquilino da
    empresa a todo el mundo, con sesión o sin ella. Por eso se comprueba en dos
    partes: que el contexto REAL, sin sesión, no da empresa, y que la acción ya
    no cuelga de él. Este probe lo encontró; el destino ahora es fijo
    (`LEADS_TENANT`) y se comprueba arriba.
  */
  const real = await import("../src/lib/tenancy/context");
  const sinEmpresa = await intentar(() => real.requireTenant());
  ok(
    "sin sesión, el contexto REAL no da empresa",
    Boolean(sinEmpresa.error?.includes("No hay empresa activa")),
    sinEmpresa.error?.slice(0, 60) ?? "devolvió una empresa",
  );
  // Sin comentarios: el que explica el arreglo nombra `tenantDb()`, y eso no es usarlo.
  const fuente = readFileSync(path.resolve(__dirname, "../src/lib/actions/leads.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  ok(
    "y submitLead no la necesita para guardar el contacto",
    !/\btenantDb\s*\(/.test(fuente),
    "guarda con tenantDb(): en producción todo visitante recibe «server» y el contacto se pierde",
  );
});
