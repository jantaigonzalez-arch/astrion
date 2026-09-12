/**
 * LAS ACCIONES DE FICHAS DEL CRM: ORGANIZACIONES Y CONTACTOS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-crm-fichas.ts
 *
 * Siete de las veintidós acciones de `lib/actions/crm.ts`: alta, edición, toma
 * y borrado de organizaciones; alta, edición y borrado de contactos. Las demás,
 * en `_probe-acciones-crm-negocios`, `-seguimiento` y `-etapas`.
 *
 * ── LO QUE SE ATA AQUÍ ─────────────────────────────────────────────────────
 *
 * Lo de todas las pruebas de acciones —guardia, nivel, validación, firma,
 * aislamiento— y lo que estas acciones hacen con lo tecleado antes de guardarlo,
 * que es lo que acaba en un Excel o en un CFDI:
 *
 *   · el teléfono se guarda legible, el estado en su forma canónica y el código
 *     postal con sus cinco dígitos —«4,650» es 04650, «465» se rechaza—;
 *   · el responsable vacío es «yo mismo» también al editar, y el de otra empresa
 *     o un cliente se rechaza (`resolveOwner`);
 *   · una cuenta de portal representa a UNA organización: vincularla a otra
 *     suelta el vínculo anterior;
 *   · tomar una organización sin dueño no le quita la suya a nadie.
 *
 * Las reglas del expediente fiscal no están aquí: son de
 * `_probe-clientes-accion` y `probe-clientes-fiscal`.
 *
 * ── AISLAMIENTO FRENTE A LAS OTRAS PRUEBAS ─────────────────────────────────
 *
 * Todo lleva la marca en el nombre y cada foto se acota a ella. La cuenta de
 * portal que se vincula es una creada aquí: vincular una sembrada la soltaría de
 * su organización de verdad, y eso es escribir sobre datos de otra prueba.
 */
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
  foto,
  intentar,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const TAG = marca("CRMF");
/** Un uuid bien formado que no es de nada: el caso «lo borró otro mientras miraba». */
const NADIE = "00000000-0000-4000-8000-000000000000";

/**
 * Para capturas que la interfaz NO puede producir —un id que no es uuid—: la
 * acción puede volver sin hacer nada o reventar con el error de Postgres, y las
 * dos valen; lo único que no vale es escribir. Ver `_probe-acciones-crm-negocios`.
 */
async function noEscribe(etiqueta: string, fn: () => Promise<unknown>, que: string[]) {
  const antes = await foto(...que);
  const r = await intentar(fn);
  const despues = await foto(...que);
  ok(
    `${etiqueta}: no escribió`,
    antes === despues && r.redirige === undefined,
    antes === despues ? (r.error ? "(reventó, sin rastro)" : "") : `${antes} → ${despues}`,
  );
}

void probar("organizaciones y contactos del CRM: guardia, nivel, validación, firma y aislamiento", async () => {
  /* ── Quién es quién ──────────────────────────────────────────────────── */
  const ACTOR = (await usuarioDeLaEmpresa("sales")) ?? (await usuarioDeLaEmpresa());
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");
  const [otro] = await filas<{ id: string }>(
    `select u.id from users u join memberships m on m.user_id = u.id
       join tenants t on t.id = m.tenant_id
      where t.slug = '${ESQUEMA.replace(/^tenant_/, "")}' and m.role in ('sales','admin','owner')
        and m.active and u.active and u.id <> '${ACTOR}'
      order by u.id limit 1`,
  );
  const OTRO = otro?.id;
  if (!OTRO) throw new Error("la base no trae un segundo vendedor");

  /*
    Dos personas creadas para la prueba: un vendedor de la empresa AJENA —uuid
    válido, membresía viva, pero no de aquí— y una cuenta de portal de ESTA
    empresa. La segunda sirve también de «responsable que es un cliente».
  */
  const slug = (s: string) => s.replace(/^tenant_/, "");
  const persona = async (sufijo: string, esquema: string, rol: string): Promise<string> => {
    const [u] = await filas<{ id: string }>(
      `insert into users (name, email) values ('${TAG} ${sufijo}', '${TAG.toLowerCase()}-${sufijo.toLowerCase()}@ejemplo.test')
       returning id`,
    );
    alLimpiar(() => sql.unsafe(`delete from users where id = '${u.id}'`));
    await sql.unsafe(
      `insert into memberships (user_id, tenant_id, role)
         select '${u.id}', id, '${rol}' from tenants where slug = '${slug(esquema)}'`,
    );
    return u.id;
  };
  const EXTRANJERO = await persona("Ajeno", AJENO, "sales");
  const CUENTA = await persona("Cuenta", ESQUEMA, "client");

  borrarAlFinal("crm_contacts", `name like '${TAG}%'`);
  borrarAlFinal("crm_organizations", `name like '${TAG}%'`);

  /** Una organización de trabajo, puesta a mano. */
  const organizacion = async (nombre: string, owner: string | null = OTRO): Promise<string> => {
    const [o] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_organizations (name, owner_id, sla_hours, phone)
       values ('${TAG} ${nombre}', ${owner ? `'${owner}'` : "null"}, 24, '55 1111 2222') returning id`,
    );
    return o.id;
  };
  const contacto = async (nombre: string, org: string | null): Promise<string> => {
    const [k] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_contacts (name, owner_id, organization_id, email)
       values ('${TAG} ${nombre}', '${OTRO}', ${org ? `'${org}'` : "null"}, 'fijo@ejemplo.test') returning id`,
    );
    return k.id;
  };

  const c = await import("@/lib/actions/crm");
  const inicial = { ok: false };

  const ORGS = `select count(*)::int as n from ${ESQUEMA}.crm_organizations where name like '${TAG}%'`;
  const VINCULOS = `select name, client_id from ${ESQUEMA}.crm_organizations where name like '${TAG}%' order by name`;
  const CONTACTOS = `select count(*)::int as n from ${ESQUEMA}.crm_contacts where name like '${TAG}%'`;

  /* ════════════════════════ createOrganization ════════════════════════ */
  const altaOrg = (cambio: Record<string, string> = {}) =>
    forma({ name: `${TAG} Alta`, postalCode: "64000", ...cambio });

  seccion("createOrganization · la guardia");
  como(null);
  await rechazaSinEscribir("alta sin sesión", () => c.createOrganization(inicial, altaOrg()), [ORGS], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("alta sin permiso", () => c.createOrganization(inicial, altaOrg()), [ORGS], conError("auth"));
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("alta con «ver»", () => c.createOrganization(inicial, altaOrg()), [ORGS], conError("auth"));

  seccion("createOrganization · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraOrg: Array<[string, Record<string, string>]> = [
    ["sin nombre", { name: "" }],
    ["nombre de una letra", { name: "x" }],
    ["código postal «S/N»", { postalCode: "S/N" }],
    ["código postal de seis dígitos", { postalCode: "123456" }],
    // Cero horas nace vencido: sería apagar el SLA en silencio.
    ["SLA de cero horas", { slaHours: "0" }],
    ["SLA «abc»", { slaHours: "abc" }],
    ["SLA de 5 000 horas", { slaHours: "5000" }],
    ["responsable que no es uuid", { ownerId: "no-soy-un-uuid" }],
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
    ["responsable que es un cliente", { ownerId: CUENTA }],
    ["cuenta de portal que no es uuid", { clientId: "no-soy-un-uuid" }],
  ];
  for (const [nombre, cambio] of basuraOrg)
    await rechazaSinEscribir(`alta con ${nombre}`, () => c.createOrganization(inicial, altaOrg(cambio)), [ORGS], conError("invalid"));
  /*
    «465» es un código postal a medias, y el comentario de `OrgSchema` lo dice
    con todas las letras: no se acepta, porque se descubre el día del timbrado.
    Entraba como «00465»: `normalizarCp` rellenaba con ceros CUALQUIER cosa de
    uno a cinco dígitos, cuando lo que justifica el relleno es solo el cero de
    la CDMX que se come la hoja de cálculo —cuatro dígitos—; ningún código
    postal mexicano empieza por «00». Este probe lo encontró y `domicilio.ts`
    ya exige cuatro o cinco.
  */
  await rechazaSinEscribir(
    "alta con código postal «465»",
    () => c.createOrganization(inicial, altaOrg({ name: `${TAG} Alta con CP a medias`, postalCode: "465" })),
    [ORGS],
    conError("invalid"),
  );
  /*
    La cuenta de portal de alguien de OTRA empresa. `client_id` apunta al padrón
    de toda la plataforma, igual que `owner_id`, y es la misma puerta que
    `resolveOwner` cerró para el responsable: la ficha enseñaría el nombre y el
    correo de alguien que no es de aquí, y `enforceSingleClientLink` actuaría
    sobre él. Se GUARDABA; este probe lo encontró y `cuentaDePortalValida`
    exige ahora un cliente vivo de esta empresa cuando el vínculo cambia.
  */
  await rechazaSinEscribir(
    "alta con la cuenta de portal de alguien de otra empresa",
    () => c.createOrganization(inicial, altaOrg({ name: `${TAG} Alta con cuenta ajena`, clientId: EXTRANJERO })),
    [ORGS],
    conError("invalid"),
  );

  seccion("createOrganization · el camino feliz");
  const ajenoAntes = await cuantos("crm_organizations", "", AJENO);
  let r = await c.createOrganization(
    inicial,
    forma({
      name: `  ${TAG} Organización feliz  `,
      phone: "5555902555",
      state: "Distrito Federal",
      postalCode: "4,650",
      slaHours: "48",
      website: "https://ejemplo.test",
      clientId: CUENTA,
    }),
  );
  ok("el alta responde ok con id", r.ok === true && Boolean(r.id), r.error);
  const ORG_A = r.id ?? NADIE;
  const [feliz] = await filas<{
    name: string; phone: string; state: string; postal_code: string; sla_hours: number;
    owner_id: string; client_id: string;
  }>(`select name, phone, state, postal_code, sla_hours, owner_id, client_id
        from ${ESQUEMA}.crm_organizations where id = '${ORG_A}'`);
  ok("el nombre, sin los espacios de sobra", feliz?.name === `${TAG} Organización feliz`, feliz?.name);
  ok("el teléfono se guarda legible", feliz?.phone === "55 5590 2555", feliz?.phone);
  ok("el estado, en su forma canónica", feliz?.state === "Ciudad de México", feliz?.state);
  ok("el código postal recupera el cero que se comió la hoja de cálculo", feliz?.postal_code === "04650", feliz?.postal_code);
  ok("el SLA pactado, en horas", feliz?.sla_hours === 48);
  ok("sin responsable, queda a nombre de quien la crea", feliz?.owner_id === ACTOR);
  ok("con su cuenta de portal", feliz?.client_id === CUENTA);

  r = await c.createOrganization(inicial, altaOrg({ name: `${TAG} Alta de otro`, ownerId: OTRO, slaHours: "" }));
  const [deOtro] = await filas<{ owner_id: string; sla_hours: number | null }>(
    `select owner_id, sla_hours from ${ESQUEMA}.crm_organizations where id = '${r.id ?? NADIE}'`,
  );
  ok("a nombre de otro vendedor de la casa, se respeta", r.ok && deOtro?.owner_id === OTRO, r.error);
  ok("y el SLA vacío es «el general» (nulo), no un rechazo", deOtro?.sla_hours === null);

  /*
    La misma cuenta de portal en una segunda organización: la primera la suelta.
    Dos fichas con la misma cuenta repartirían sus equipos y tickets entre las
    dos, según cuál mirara la pantalla.
  */
  r = await c.createOrganization(inicial, altaOrg({ name: `${TAG} Segunda con la cuenta`, clientId: CUENTA }));
  const [soltada] = await filas<{ client_id: string | null }>(
    `select client_id from ${ESQUEMA}.crm_organizations where id = '${ORG_A}'`,
  );
  ok("vincular la cuenta a otra ficha suelta el vínculo anterior", r.ok && soltada?.client_id === null);

  seccion("createOrganization · no se sale de la empresa");
  ok(`${AJENO} no ganó organizaciones`, (await cuantos("crm_organizations", "", AJENO)) === ajenoAntes);
  ok("ni tiene nada con la marca", (await cuantos("crm_organizations", `where name like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ updateOrganization ════════════════════════ */
  const O = await organizacion("Fija");
  const FILA_O = `select name, owner_id, client_id, sla_hours, phone, postal_code, state
                    from ${ESQUEMA}.crm_organizations where id = '${O}'`;
  const edicionOrg = (cambio: Record<string, string> = {}) =>
    forma({ id: O, name: `${TAG} Fija editada`, postalCode: "01000", slaHours: "12", ...cambio });

  seccion("updateOrganization · la guardia");
  como(null);
  await rechazaSinEscribir("edición sin sesión", () => c.updateOrganization(inicial, edicionOrg()), [FILA_O], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("edición sin permiso", () => c.updateOrganization(inicial, edicionOrg()), [FILA_O], conError("auth"));
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("edición con «ver»", () => c.updateOrganization(inicial, edicionOrg()), [FILA_O], conError("auth"));

  seccion("updateOrganization · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraEdOrg: Array<[string, Record<string, string>]> = [
    ["id que no es uuid", { id: "no-soy-un-uuid" }],
    ["nombre vacío", { name: "" }],
    ["código postal «S/N»", { postalCode: "S/N" }],
    ["SLA de cero horas", { slaHours: "0" }],
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
  ];
  for (const [nombre, cambio] of basuraEdOrg)
    await rechazaSinEscribir(`edición con ${nombre}`, () => c.updateOrganization(inicial, edicionOrg(cambio)), [FILA_O], conError("invalid"));
  /*
    Una organización que ya no existe. Respondía «guardado» sin guardar nada, y
    si el envío traía cuenta de portal, `enforceSingleClientLink` la soltaba de
    su ficha de verdad para no vincularla a ninguna: se perdía el vínculo y
    con él la vista de sus equipos y tickets. Lo encontró este probe.
  */
  await c.updateOrganization(inicial, forma({ id: O, name: `${TAG} Fija`, clientId: CUENTA }));
  await rechazaSinEscribir(
    "edición de una organización que ya no existe",
    () => c.updateOrganization(inicial, edicionOrg({ id: NADIE, clientId: CUENTA })),
    [FILA_O, VINCULOS],
    conError("invalid"),
  );
  // El mismo hueco que en el alta, por el otro camino.
  await rechazaSinEscribir(
    "edición con la cuenta de portal de alguien de otra empresa",
    () => c.updateOrganization(inicial, edicionOrg({ clientId: EXTRANJERO })),
    [FILA_O],
    conError("invalid"),
  );

  seccion("updateOrganization · el camino feliz");
  await sql.unsafe(`update ${ESQUEMA}.crm_organizations set owner_id = '${OTRO}' where id = '${O}'`);
  r = await c.updateOrganization(inicial, edicionOrg({ slaHours: "", state: "cdmx", phone: "" }));
  const [ed] = await filas<{
    name: string; owner_id: string; client_id: string | null; sla_hours: number | null;
    phone: string | null; postal_code: string; state: string;
  }>(FILA_O);
  ok("la edición responde ok", r.ok === true && r.id === O, r.error);
  ok("guarda nombre y código postal", ed?.name === `${TAG} Fija editada` && ed?.postal_code === "01000");
  ok("el SLA vacío vuelve al general", ed?.sla_hours === null);
  ok("el estado, canónico también al editar", ed?.state === "Ciudad de México", ed?.state);
  ok("sin cuenta de portal en el envío, se desvincula", ed?.client_id === null);
  ok("el teléfono vacío se borra", ed?.phone === null);
  /*
    El arreglo de `resolveOwner`: editar y dejar «— Yo mismo —» dejaba la ficha
    SIN responsable, y como la cartera comercial filtra por `ownerId = yo`, la
    organización desaparecía para todos los vendedores.
  */
  ok("dejar el responsable vacío al editar lo pone a MI nombre", ed?.owner_id === ACTOR, ed?.owner_id ?? "null");

  /* ════════════════════════ claimOrganization ════════════════════════ */
  const U = await organizacion("Sin dueño", null);
  const V = await organizacion("De otro");
  const DUENOS = `select id, owner_id from ${ESQUEMA}.crm_organizations where id in ('${U}', '${V}') order by id`;

  seccion("claimOrganization · la guardia");
  for (const [quien, puede] of [["sin sesión", null], ["sin permiso", false], ["con «ver»", "ventas:ver"]] as const) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`tomar ${quien}`, () => c.claimOrganization(forma({ id: U })), [DUENOS]);
  }

  seccion("claimOrganization · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("tomar sin id", () => c.claimOrganization(forma({ id: "" })), [DUENOS]);
  await rechazaSinEscribir("tomar una que no existe", () => c.claimOrganization(forma({ id: NADIE })), [DUENOS]);
  await noEscribe("tomar con un id que no es uuid", () => c.claimOrganization(forma({ id: "no-soy-un-uuid" })), [DUENOS]);

  seccion("claimOrganization · el camino feliz");
  await c.claimOrganization(forma({ id: U }));
  const [tomada] = await filas<{ owner_id: string }>(`select owner_id from ${ESQUEMA}.crm_organizations where id = '${U}'`);
  ok("la organización sin dueño queda a mi nombre", tomada?.owner_id === ACTOR);
  // La condición «sin dueño» viaja en el `update`: el segundo vendedor no pisa al primero.
  await c.claimOrganization(forma({ id: V }));
  const [intacta] = await filas<{ owner_id: string }>(`select owner_id from ${ESQUEMA}.crm_organizations where id = '${V}'`);
  ok("la que ya tiene dueño NO se la quita a nadie", intacta?.owner_id === OTRO);

  /* ════════════════════════ deleteOrganization ════════════════════════ */
  const X = await organizacion("Para borrar");
  const FILA_X = [
    `select count(*)::int as n from ${ESQUEMA}.crm_organizations where id = '${X}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${X}'`,
  ];

  seccion("deleteOrganization · la guardia y el nivel");
  como(null);
  await rechazaSinEscribir("borrar sin sesión", () => c.deleteOrganization(forma({ id: X })), FILA_X);
  como(ACTOR, false);
  await rechazaSinEscribir("borrar sin permiso", () => c.deleteOrganization(forma({ id: X })), FILA_X);
  // Arrastra por cascada notas, domicilios y el expediente fiscal.
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("borrar con «editar»", () => c.deleteOrganization(forma({ id: X })), FILA_X);

  seccion("deleteOrganization · el camino feliz");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteOrganization(forma({ id: "" })), FILA_X);
  const rx = await intentar(() => c.deleteOrganization(forma({ id: X })));
  const fuera = (await cuantos("crm_organizations", `where id = '${X}'`)) === 0;
  ok("con «administrar», la organización desaparece", fuera, fuera ? "" : rx.error?.slice(0, 80));
  // Sin petición, `next/headers` lanza antes del `redirect()`: se ve que llegó, no a dónde.
  const llego = rx.redirige
    ? rx.redirige.endsWith("/admin/organizaciones")
    : /`headers` was called outside a request scope/.test(rx.error ?? "");
  ok("y al terminar llega a redirigir al listado", llego, llego ? "" : (rx.redirige ?? rx.error?.slice(0, 80)));
  const [snapX] = await filas<{ actor_id: string; nombre: string }>(
    `select actor_id, payload->'snapshot'->>'name' as nombre from ${ESQUEMA}.domain_events
      where aggregate_id = '${X}' and event_type = 'organization.deleted'`,
  );
  ok("la baja queda en la bitácora, con la foto y el actor", snapX?.actor_id === ACTOR && snapX?.nombre === `${TAG} Para borrar`);

  /* ════════════════════════ createContact ════════════════════════ */
  const altaK = (cambio: Record<string, string> = {}) => forma({ name: `${TAG} Contacto`, ...cambio });

  seccion("createContact · la guardia");
  como(null);
  await rechazaSinEscribir("alta sin sesión", () => c.createContact(inicial, altaK()), [CONTACTOS], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("alta sin permiso", () => c.createContact(inicial, altaK()), [CONTACTOS], conError("auth"));
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("alta con «ver»", () => c.createContact(inicial, altaK()), [CONTACTOS], conError("auth"));

  seccion("createContact · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraK: Array<[string, Record<string, string>]> = [
    ["sin nombre", { name: "" }],
    ["nombre de una letra", { name: "x" }],
    ["correo «no-es-correo»", { email: "no-es-correo" }],
    ["organización que no es uuid", { organizationId: "no-soy-un-uuid" }],
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
    ["responsable que es un cliente", { ownerId: CUENTA }],
  ];
  for (const [nombre, cambio] of basuraK)
    await rechazaSinEscribir(`alta con ${nombre}`, () => c.createContact(inicial, altaK(cambio)), [CONTACTOS], conError("invalid"));

  seccion("createContact · el camino feliz");
  const ajenoK = await cuantos("crm_contacts", "", AJENO);
  r = await c.createContact(
    inicial,
    altaK({ name: `  ${TAG} Ana Prueba `, email: "  Ana.Prueba@Ejemplo.TEST ", phone: "5555902555", position: "Compras", organizationId: O }),
  );
  ok("el alta responde ok con id", r.ok === true && Boolean(r.id), r.error);
  const [k] = await filas<{ name: string; email: string; phone: string; organization_id: string; owner_id: string }>(
    `select name, email, phone, organization_id, owner_id from ${ESQUEMA}.crm_contacts where id = '${r.id ?? NADIE}'`,
  );
  ok("el nombre, sin espacios de sobra", k?.name === `${TAG} Ana Prueba`, k?.name);
  ok("el correo, recortado y en minúsculas", k?.email === "ana.prueba@ejemplo.test", k?.email);
  ok("el teléfono, legible", k?.phone === "55 5590 2555", k?.phone);
  ok("colgado de su organización, a nombre de quien lo crea", k?.organization_id === O && k?.owner_id === ACTOR);

  seccion("createContact · no se sale de la empresa");
  ok(`${AJENO} no ganó contactos`, (await cuantos("crm_contacts", "", AJENO)) === ajenoK);
  ok("ni tiene nada con la marca", (await cuantos("crm_contacts", `where name like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ updateContact ════════════════════════ */
  const K = await contacto("Fijo", O);
  const FILA_K = `select name, email, organization_id, owner_id from ${ESQUEMA}.crm_contacts where id = '${K}'`;
  const edicionK = (cambio: Record<string, string> = {}) =>
    forma({ id: K, name: `${TAG} Fijo editado`, email: "NUEVO@Ejemplo.test", ...cambio });

  seccion("updateContact · la guardia");
  como(null);
  await rechazaSinEscribir("edición sin sesión", () => c.updateContact(inicial, edicionK()), [FILA_K], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("edición sin permiso", () => c.updateContact(inicial, edicionK()), [FILA_K], conError("auth"));
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("edición con «ver»", () => c.updateContact(inicial, edicionK()), [FILA_K], conError("auth"));

  seccion("updateContact · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraEdK: Array<[string, Record<string, string>]> = [
    ["id que no es uuid", { id: "no-soy-un-uuid" }],
    // Respondía «guardado» sin guardar nada. Lo encontró este probe.
    ["id de un contacto que no existe", { id: NADIE }],
    ["correo «no-es-correo»", { email: "no-es-correo" }],
    ["nombre vacío", { name: "" }],
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
  ];
  for (const [nombre, cambio] of basuraEdK)
    await rechazaSinEscribir(`edición con ${nombre}`, () => c.updateContact(inicial, edicionK(cambio)), [FILA_K], conError("invalid"));

  seccion("updateContact · el camino feliz");
  r = await c.updateContact(inicial, edicionK());
  const [ek] = await filas<{ name: string; email: string; organization_id: string | null; owner_id: string }>(FILA_K);
  ok("la edición responde ok", r.ok === true && r.id === K, r.error);
  ok("guarda el nombre y el correo normalizado", ek?.name === `${TAG} Fijo editado` && ek?.email === "nuevo@ejemplo.test", ek?.email);
  ok("sin organización en el envío, se desvincula", ek?.organization_id === null);
  ok("dejar el responsable vacío lo pone a MI nombre", ek?.owner_id === ACTOR, ek?.owner_id ?? "null");

  /* ════════════════════════ deleteContact ════════════════════════ */
  const K2 = await contacto("Para borrar", null);
  const FILA_K2 = [
    `select count(*)::int as n from ${ESQUEMA}.crm_contacts where id = '${K2}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${K2}'`,
  ];

  seccion("deleteContact · la guardia y el nivel");
  como(null);
  await rechazaSinEscribir("borrar sin sesión", () => c.deleteContact(forma({ id: K2 })), FILA_K2);
  como(ACTOR, false);
  await rechazaSinEscribir("borrar sin permiso", () => c.deleteContact(forma({ id: K2 })), FILA_K2);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("borrar con «editar»", () => c.deleteContact(forma({ id: K2 })), FILA_K2);

  seccion("deleteContact · el camino feliz");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteContact(forma({ id: "" })), FILA_K2);
  const rk = await intentar(() => c.deleteContact(forma({ id: K2 })));
  ok("con «administrar», el contacto desaparece", rk.error === undefined && (await cuantos("crm_contacts", `where id = '${K2}'`)) === 0, rk.error?.slice(0, 80));
  ok(
    "y la baja queda en la bitácora con el actor",
    (await cuantos("domain_events", `where aggregate_id = '${K2}' and event_type = 'contact.deleted' and actor_id = '${ACTOR}'`)) === 1,
  );
});
