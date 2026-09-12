/**
 * LAS ACCIONES DE NEGOCIOS DEL CRM: ALTA, EDICIÓN, TABLERO, CIERRE, BORRADO Y
 * CONVERSIÓN DE UN LEAD.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-crm-negocios.ts
 *
 * Seis de las veintidós acciones de `lib/actions/crm.ts`. Las demás están en
 * `_probe-acciones-crm-fichas` (organizaciones y contactos),
 * `_probe-acciones-crm-seguimiento` (actividades y notas) y
 * `_probe-acciones-crm-etapas` (el embudo).
 *
 * ── LO QUE SE ATA AQUÍ ─────────────────────────────────────────────────────
 *
 * Lo que solo aporta la capa de acción, como en el resto de `_probe-acciones-*`:
 * que la guardia diga que no sin escribir, que pida el nivel correcto —borrar un
 * negocio es de «administrar», y con «editar» tiene que decir que no—, que la
 * basura no entre, que el camino feliz escriba lo que debe FIRMADO por la
 * sesión, y que no se salga de la empresa.
 *
 * Y tres cosas que viven solo en estas acciones y que nadie más prueba:
 *
 *   · el responsable: vacío es «yo mismo» también al EDITAR, y un uuid de
 *     alguien que no es vendedor de esta empresa se rechaza en vez de guardarse
 *     (ver `resolveOwner`);
 *   · la etapa manda sobre el embudo: un negocio con la etapa de un embudo y el
 *     `pipeline_id` de otro desaparece del tablero sin dejar de contar;
 *   · convertir un lead dos veces no crea dos negocios.
 *
 * ── LO QUE NO ──────────────────────────────────────────────────────────────
 *
 * La conversión a dólares (`stampFx`) depende de la fila de configuración, que
 * `_probe-acciones-settings` reescribe mientras corre, y en automático llamaría
 * a Banxico. Aquí solo se comprueba el caso que no depende de ella: con importe
 * en pesos, el negocio queda en MXN y sin tipo de cambio.
 *
 * ── AISLAMIENTO FRENTE A LAS OTRAS PRUEBAS ─────────────────────────────────
 *
 * Varias pruebas corren a la vez contra la misma base. Todo lo de aquí vive en
 * un embudo propio (`<marca> Embudo`) y cada foto se acota a lo marcado: contar
 * la tabla entera daría rojos por escrituras ajenas.
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

const TAG = marca("CRMN");
/** Un uuid bien formado que no es de nada: el caso «lo borró otro mientras miraba». */
const NADIE = "00000000-0000-4000-8000-000000000000";

/**
 * Para capturas que la interfaz NO puede producir —un id que no es uuid—: la
 * acción puede volver sin hacer nada o reventar con el error de Postgres, y las
 * dos cosas valen; lo único que no vale es escribir.
 *
 * `rechazaSinEscribir` cuenta el reventón como fallo, y es lo correcto para lo
 * que la interfaz SÍ puede mandar. Aplicado a un id inventado le exigiría a cada
 * acción `void` una validación que no protege nada: los ids los pone la página.
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

/**
 * ¿Terminó redirigiendo a `destino`? Devuelve la etiqueta y el veredicto.
 *
 * `redirectAfterAction` lee las cabeceras de la petición para saber el idioma y
 * el inquilino, y fuera de una petición `next/headers` lanza antes de llegar al
 * `redirect()` del stub. Así que hay dos finales buenos: el destino a la vista
 * (si algún día hay un stub de cabeceras) o ese error concreto. Del segundo se
 * sabe que la acción LLEGÓ a redirigir —es su última línea, y solo se llega con
 * lo escrito ya confirmado—, pero no a dónde; la etiqueta lo dice para que nadie
 * lea en el verde más de lo que comprueba.
 */
function redirigio(r: { redirige?: string; error?: string }, destino: string): [string, boolean] {
  if (r.redirige !== undefined) return [`redirige a ${destino}`, r.redirige.endsWith(destino)];
  return [
    "llega a redirigir (sin petición no se ve el destino)",
    /`headers` was called outside a request scope/.test(r.error ?? ""),
  ];
}

void probar("negocios del CRM: guardia, nivel, validación, firma y aislamiento", async () => {
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
  const CLIENTE = await usuarioDeLaEmpresa("client");
  if (!CLIENTE) throw new Error("la base no trae clientes con membresía");

  /*
    Alguien de OTRA empresa. La base sembrada no trae a nadie fuera de la
    principal, así que se crea: un vendedor de la empresa ajena, con su uuid
    válido y su membresía, que es justamente lo que `resolveOwner` tiene que
    rechazar — `owner_id` apunta al padrón de TODA la plataforma.
  */
  const [ajeno] = await filas<{ id: string }>(
    `insert into users (name, email) values ('${TAG} Ajeno', '${TAG.toLowerCase()}@ejemplo.test')
     returning id`,
  );
  const EXTRANJERO = ajeno.id;
  alLimpiar(() => sql.unsafe(`delete from users where id = '${EXTRANJERO}'`));
  await sql.unsafe(
    `insert into memberships (user_id, tenant_id, role)
       select '${EXTRANJERO}', id, 'sales' from tenants where slug = '${AJENO.replace(/^tenant_/, "")}'`,
  );

  /* ── El terreno: dos embudos propios, uno vacío, y un lead ───────────── */
  const [p] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Embudo') returning id`,
  );
  const [p2] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Otro embudo') returning id`,
  );
  const [pVacio] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Embudo sin etapas') returning id`,
  );
  // Borrar el embudo arrastra por cascada etapas, negocios, sus eventos, sus
  // actividades y sus notas. Es lo último que se deshace.
  borrarAlFinal("crm_pipelines", `name like '${TAG}%'`);
  const P = p.id;
  const P2 = p2.id;
  const [s1, s2] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name, "order")
     values ('${P}', '${TAG} Uno', 0), ('${P}', '${TAG} Dos', 1) returning id`,
  );
  const S1 = s1.id;
  const S2 = s2.id;
  const [t1] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name, "order")
     values ('${P2}', '${TAG} Del otro', 0) returning id`,
  );
  const T1 = t1.id;

  // Lo que las acciones crean fuera del embudo: organizaciones y contactos de la
  // conversión, actividades de las automatizaciones.
  borrarAlFinal("crm_activities", `subject like '${TAG}%'`);
  borrarAlFinal("crm_contacts", `name like '${TAG}%'`);
  borrarAlFinal("crm_organizations", `name like '${TAG}%'`);
  borrarAlFinal("leads", `name like '${TAG}%'`);

  /** Un negocio de trabajo, puesto a mano: las pruebas de edición no dependen del alta. */
  let n = 0;
  async function negocio(extra: { owner?: string; stage?: string } = {}): Promise<string> {
    n += 1;
    const [d] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id, owner_id, position)
       values ('${TAG}-${n}', '${TAG} Fijo ${n}', '${P}', '${extra.stage ?? S1}',
               ${extra.owner ? `'${extra.owner}'` : "null"}, ${n})
       returning id`,
    );
    return d.id;
  }

  const c = await import("@/lib/actions/crm");
  const inicial = { ok: false };

  /* Las fotos de siempre, acotadas a lo marcado. */
  const NEGOCIOS = `select count(*)::int as n from ${ESQUEMA}.crm_deals where title like '${TAG}%'`;
  const EVENTOS = `select count(*)::int as n from ${ESQUEMA}.crm_deal_events e
                     join ${ESQUEMA}.crm_deals d on d.id = e.deal_id where d.title like '${TAG}%'`;
  const TABLERO = `select id, stage_id, pipeline_id, position, status from ${ESQUEMA}.crm_deals
                    where title like '${TAG}%' order by id`;

  /** Un alta de negocio buena, sobre la que cada caso cambia UNA cosa. */
  const alta = (cambio: Record<string, string> = {}) =>
    forma({
      title: `${TAG} Alta`,
      pipelineId: P,
      stageId: S1,
      valueMxn: "1000",
      ...cambio,
    });

  /* ════════════════════════ createDeal ════════════════════════ */
  seccion("createDeal · la guardia");
  como(null);
  await rechazaSinEscribir("alta sin sesión", () => c.createDeal(inicial, alta()), [NEGOCIOS, EVENTOS], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("alta sin permiso", () => c.createDeal(inicial, alta()), [NEGOCIOS, EVENTOS], conError("auth"));
  // Quien solo CONSULTA ventas no da de alta.
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("alta con «ver»", () => c.createDeal(inicial, alta()), [NEGOCIOS, EVENTOS], conError("auth"));

  seccion("createDeal · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraAlta: Array<[string, Record<string, string>]> = [
    ["sin título", { title: "" }],
    ["título de una letra", { title: "x" }],
    ["embudo que no es uuid", { pipelineId: "no-soy-un-uuid" }],
    ["etapa que no existe", { stageId: NADIE }],
    // La etapa es de OTRO embudo: el negocio nacería invisible en el tablero.
    ["etapa de otro embudo", { stageId: T1 }],
    ["importe «mil pesos»", { valueMxn: "mil pesos" }],
    ["importe «-500»", { valueMxn: "-500" }],
    ["dólares «-500»", { valueMxn: "", valueUsd: "-500" }],
    ["organización que no es uuid", { organizationId: "no-soy-un-uuid" }],
    ["lead que no es uuid", { leadId: "no-soy-un-uuid" }],
    // `owner_id` apunta al padrón de la plataforma: con un uuid válido bastaba.
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
    ["responsable que es un cliente", { ownerId: CLIENTE }],
  ];
  for (const [nombre, cambio] of basuraAlta)
    await rechazaSinEscribir(`alta con ${nombre}`, () => c.createDeal(inicial, alta(cambio)), [NEGOCIOS, EVENTOS], conError("invalid"));

  seccion("createDeal · el camino feliz");
  const ajenoAntes = await cuantos("crm_deals", "", AJENO);
  let r = await c.createDeal(inicial, alta({ title: `  ${TAG} Alta feliz  `, valueMxn: "$1,250.50", source: "referido" }));
  ok("el alta responde ok con id y folio", r.ok === true && Boolean(r.id) && Boolean(r.reference), r.error);
  const [nuevo] = await filas<{
    title: string; owner_id: string; value_mxn: string; currency: string | null;
    fx_rate: string | null; pipeline_id: string; stage_id: string; reference: string; source: string;
  }>(`select title, owner_id, value_mxn, currency, fx_rate, pipeline_id, stage_id, reference, source
        from ${ESQUEMA}.crm_deals where id = '${r.id ?? NADIE}'`);
  ok("el título se guarda sin los espacios de sobra", nuevo?.title === `${TAG} Alta feliz`, nuevo?.title);
  ok("el importe, limpio de símbolo y comas", nuevo?.value_mxn === "1250.50", nuevo?.value_mxn);
  ok("en pesos: moneda MXN y sin tipo de cambio", nuevo?.currency === "MXN" && nuevo?.fx_rate === null);
  ok("en su embudo y su etapa", nuevo?.pipeline_id === P && nuevo?.stage_id === S1);
  ok("el folio que devolvió es el que se guardó", nuevo?.reference === r.reference);
  // «— Yo mismo —» es la opción vacía del formulario.
  ok("sin responsable, queda a nombre de quien lo crea", nuevo?.owner_id === ACTOR);
  const [evAlta] = await filas<{ author_id: string; status: string; to_stage_id: string }>(
    `select author_id, status, to_stage_id from ${ESQUEMA}.crm_deal_events where deal_id = '${r.id ?? NADIE}'`,
  );
  ok("su evento de alta, firmado por la sesión", evAlta?.author_id === ACTOR && evAlta?.status === "open" && evAlta?.to_stage_id === S1);
  ok(
    "y la bitácora de dominio con el mismo actor",
    (await cuantos("domain_events", `where aggregate_id = '${r.id ?? NADIE}' and event_type = 'deal.created' and actor_id = '${ACTOR}'`)) === 1,
  );

  r = await c.createDeal(inicial, alta({ title: `${TAG} Alta de otro`, ownerId: OTRO }));
  const [deOtro] = await filas<{ owner_id: string }>(`select owner_id from ${ESQUEMA}.crm_deals where id = '${r.id ?? NADIE}'`);
  ok("a nombre de otro vendedor de la casa, se respeta", r.ok && deOtro?.owner_id === OTRO, r.error);

  // Un lead que se vuelve negocio desde el formulario queda calificado.
  const [leadAlta] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.leads (name, email, message) values ('${TAG} Lead del alta', 'lead@ejemplo.test', 'hola') returning id`,
  );
  r = await c.createDeal(inicial, alta({ title: `${TAG} Alta con lead`, leadId: leadAlta.id }));
  const [leadTras] = await filas<{ status: string }>(`select status from ${ESQUEMA}.leads where id = '${leadAlta.id}'`);
  ok("con lead de origen, el lead queda calificado", r.ok && leadTras?.status === "qualified", r.error);

  seccion("createDeal · no se sale de la empresa");
  ok(`${AJENO} no ganó negocios`, (await cuantos("crm_deals", "", AJENO)) === ajenoAntes);
  ok(`ni tiene nada con la marca`, (await cuantos("crm_deals", `where title like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ updateDeal ════════════════════════ */
  const D = await negocio({ owner: OTRO });
  const FILA_D = `select title, stage_id, pipeline_id, owner_id, value_mxn, value_usd, currency
                    from ${ESQUEMA}.crm_deals where id = '${D}'`;
  const edicion = (cambio: Record<string, string> = {}) =>
    forma({ id: D, title: `${TAG} Editado`, pipelineId: P, stageId: S2, valueMxn: "2000", ...cambio });

  seccion("updateDeal · la guardia");
  como(null);
  await rechazaSinEscribir("edición sin sesión", () => c.updateDeal(inicial, edicion()), [FILA_D, EVENTOS], conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("edición sin permiso", () => c.updateDeal(inicial, edicion()), [FILA_D, EVENTOS], conError("auth"));
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("edición con «ver»", () => c.updateDeal(inicial, edicion()), [FILA_D, EVENTOS], conError("auth"));

  seccion("updateDeal · la captura inválida");
  como(ACTOR, "ventas:editar");
  const basuraEdicion: Array<[string, Record<string, string>]> = [
    ["id que no es uuid", { id: "no-soy-un-uuid" }],
    ["id de un negocio que no existe", { id: NADIE }],
    ["etapa que no existe", { stageId: NADIE }],
    ["importe «-500»", { valueMxn: "-500" }],
    ["importe «mil pesos»", { valueMxn: "mil pesos" }],
    ["título vacío", { title: "" }],
    ["responsable de otra empresa", { ownerId: EXTRANJERO }],
  ];
  for (const [nombre, cambio] of basuraEdicion)
    await rechazaSinEscribir(`edición con ${nombre}`, () => c.updateDeal(inicial, edicion(cambio)), [FILA_D, EVENTOS], conError("invalid"));

  seccion("updateDeal · el camino feliz");
  r = await c.updateDeal(inicial, edicion({ valueUsd: "300" }));
  const [editado] = await filas<{
    title: string; stage_id: string; pipeline_id: string; owner_id: string;
    value_mxn: string; value_usd: string; currency: string;
  }>(FILA_D);
  ok("la edición responde ok", r.ok === true && r.id === D, r.error);
  ok("guarda título, etapa e importes", editado?.title === `${TAG} Editado` && editado?.stage_id === S2 && editado?.value_mxn === "2000.00" && editado?.value_usd === "300.00");
  ok("con pesos capturados a mano, la moneda es MXN", editado?.currency === "MXN", editado?.currency);
  /*
    El arreglo de `resolveOwner`: editar y dejar «— Yo mismo —» dejaba la ficha
    SIN responsable, y como la vista comercial filtra por `ownerId = yo`, el
    negocio desaparecía de la cartera de todos.
  */
  ok("dejar el responsable vacío al editar lo pone a MI nombre, no a nadie", editado?.owner_id === ACTOR, editado?.owner_id ?? "null");
  const [mov] = await filas<{ from_stage_id: string; to_stage_id: string; author_id: string }>(
    `select from_stage_id, to_stage_id, author_id from ${ESQUEMA}.crm_deal_events where deal_id = '${D}'`,
  );
  ok("el cambio de etapa deja su evento, firmado por la sesión", mov?.from_stage_id === S1 && mov?.to_stage_id === S2 && mov?.author_id === ACTOR);

  // La etapa de otro embudo: el embudo se DERIVA de ella, no se toma del form.
  r = await c.updateDeal(inicial, edicion({ stageId: T1, pipelineId: P }));
  const [derivado] = await filas<{ pipeline_id: string }>(FILA_D);
  ok("con la etapa de otro embudo, el embudo sigue a la etapa", r.ok && derivado?.pipeline_id === P2, derivado?.pipeline_id);

  /* ════════════════════════ moveDeal ════════════════════════ */
  const M1 = await negocio({ owner: OTRO });
  const M2 = await negocio({ stage: S2 });
  const mover = (cambio: Record<string, string> = {}) =>
    forma({ dealId: M1, stageId: S2, index: "0", ...cambio });

  seccion("moveDeal · la guardia");
  for (const [quien, puede] of [["sin sesión", null], ["sin permiso", false], ["con «ver»", "ventas:ver"]] as const) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`arrastre ${quien}`, () => c.moveDeal(mover()), [TABLERO, EVENTOS]);
  }

  seccion("moveDeal · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("arrastre sin negocio", () => c.moveDeal(mover({ dealId: "" })), [TABLERO, EVENTOS]);
  await rechazaSinEscribir("arrastre de un negocio que ya no existe", () => c.moveDeal(mover({ dealId: NADIE })), [TABLERO, EVENTOS]);
  // Una etapa que no existe no puede dejar el negocio sin columna.
  await rechazaSinEscribir("arrastre a una etapa que no existe", () => c.moveDeal(mover({ stageId: NADIE })), [TABLERO, EVENTOS]);
  await noEscribe("arrastre con un id que no es uuid", () => c.moveDeal(mover({ dealId: "no-soy-un-uuid" })), [TABLERO, EVENTOS]);

  seccion("moveDeal · el camino feliz");
  /*
    Una automatización en la etapa de destino: agenda el siguiente paso. Lo que
    toca a la acción es con qué firma lo hace — la actividad es del responsable
    del negocio, pero la CREA quien arrastró.
  */
  await sql.unsafe(
    `insert into ${ESQUEMA}.crm_automations (name, trigger_stage_id, activity_type, activity_subject, due_in_days)
     values ('${TAG} Regla', '${S2}', 'task', '${TAG} Seguimiento', 2)`,
  );
  await intentar(() => c.moveDeal(mover()));
  const col = await filas<{ id: string; stage_id: string; pipeline_id: string; position: number }>(
    `select id, stage_id, pipeline_id, position from ${ESQUEMA}.crm_deals
      where stage_id = '${S2}' and status = 'open' order by position`,
  );
  ok("el negocio cae en la etapa destino y en su embudo", col.some((x) => x.id === M1 && x.pipeline_id === P));
  ok("en el índice pedido, arriba de la columna", col[0]?.id === M1 && col[0]?.position === 0, col.map((x) => x.position).join(","));
  ok("y el resto de la columna queda renumerado 0..n", col.every((x, i) => x.position === i) && col.some((x) => x.id === M2));
  const [evMov] = await filas<{ author_id: string; from_stage_id: string }>(
    `select author_id, from_stage_id from ${ESQUEMA}.crm_deal_events where deal_id = '${M1}'`,
  );
  ok("el cambio de columna queda firmado por la sesión", evMov?.author_id === ACTOR && evMov?.from_stage_id === S1);
  const [auto] = await filas<{ owner_id: string; created_by_id: string }>(
    `select owner_id, created_by_id from ${ESQUEMA}.crm_activities where deal_id = '${M1}' and subject = '${TAG} Seguimiento'`,
  );
  ok("la automatización agenda el seguimiento", Boolean(auto));
  ok("a nombre del responsable del negocio, creado por quien arrastró", auto?.owner_id === OTRO && auto?.created_by_id === ACTOR);

  /* ════════════════════════ setDealStatus ════════════════════════ */
  const E = await negocio();
  const FILA_E = `select status, lost_reason, closed_at is not null as cerrado from ${ESQUEMA}.crm_deals where id = '${E}'`;
  const EVENTOS_E = `select count(*)::int as n from ${ESQUEMA}.crm_deal_events where deal_id = '${E}'`;

  seccion("setDealStatus · la guardia");
  for (const [quien, puede] of [["sin sesión", null], ["sin permiso", false], ["con «ver»", "ventas:ver"]] as const) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(
      `ganar ${quien}`,
      () => c.setDealStatus(forma({ dealId: E, status: "won" })),
      [FILA_E, EVENTOS_E],
    );
  }

  seccion("setDealStatus · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("un estado fuera de la lista", () => c.setDealStatus(forma({ dealId: E, status: "ganado" })), [FILA_E, EVENTOS_E]);
  await rechazaSinEscribir("sin negocio", () => c.setDealStatus(forma({ status: "won" })), [FILA_E, EVENTOS_E]);
  /*
    Un negocio que ya no existe —lo borró un administrador con la ficha abierta
    en otra pestaña—. El `update` no tocaba nada y el `insert` del evento
    reventaba contra la llave foránea: un 500 en la cara de quien solo quería
    marcarlo como ganado. Lo encontró este probe.
  */
  await rechazaSinEscribir(
    "un negocio que ya no existe",
    () => c.setDealStatus(forma({ dealId: NADIE, status: "won" })),
    [FILA_E, EVENTOS_E, EVENTOS],
  );

  seccion("setDealStatus · el camino feliz");
  await c.setDealStatus(forma({ dealId: E, status: "lost", lostReason: "Precio" }));
  type Estado = { status: string; lost_reason: string | null; cerrado: boolean };
  let [est] = await filas<Estado>(FILA_E);
  ok("perdido, con su motivo y su fecha de cierre", est?.status === "lost" && est?.lost_reason === "Precio" && est?.cerrado === true);
  const [evEst] = await filas<{ status: string; author_id: string }>(
    `select status, author_id from ${ESQUEMA}.crm_deal_events where deal_id = '${E}' order by created_at desc limit 1`,
  );
  ok("el cierre queda firmado por la sesión", evEst?.status === "lost" && evEst?.author_id === ACTOR);
  await c.setDealStatus(forma({ dealId: E, status: "won", lostReason: "no aplica" }));
  [est] = await filas<Estado>(FILA_E);
  ok("ganado: el motivo de pérdida NO se guarda", est?.status === "won" && est?.lost_reason === null);
  await c.setDealStatus(forma({ dealId: E, status: "open" }));
  [est] = await filas<Estado>(FILA_E);
  ok("reabierto: sin fecha de cierre", est?.status === "open" && est?.cerrado === false);

  /* ════════════════════════ deleteDeal ════════════════════════ */
  const B = await negocio();
  const FILA_B = [
    `select count(*)::int as n from ${ESQUEMA}.crm_deals where id = '${B}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${B}'`,
  ];

  seccion("deleteDeal · la guardia y el nivel");
  como(null);
  await rechazaSinEscribir("borrar sin sesión", () => c.deleteDeal(forma({ id: B })), FILA_B);
  como(ACTOR, false);
  await rechazaSinEscribir("borrar sin permiso", () => c.deleteDeal(forma({ id: B })), FILA_B);
  // El borrado es duro y arrastra actividades y notas: no es trabajo del día.
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("borrar con «editar»", () => c.deleteDeal(forma({ id: B })), FILA_B);

  seccion("deleteDeal · el camino feliz");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteDeal(forma({ id: "" })), FILA_B);
  const rb = await intentar(() => c.deleteDeal(forma({ id: B })));
  const borrado = (await cuantos("crm_deals", `where id = '${B}'`)) === 0;
  ok("con «administrar», el negocio desaparece", borrado, borrado ? "" : rb.error?.slice(0, 80));
  const [finB, alTablero] = redirigio(rb, "/admin/crm");
  ok(`y al terminar ${finB}`, alTablero, alTablero ? "" : (rb.redirige ?? rb.error?.slice(0, 80)));
  const [snap] = await filas<{ actor_id: string; titulo: string }>(
    `select actor_id, payload->'snapshot'->>'title' as titulo from ${ESQUEMA}.domain_events
      where aggregate_id = '${B}' and event_type = 'deal.deleted'`,
  );
  ok("la baja queda en la bitácora, con la foto y el actor", snap?.actor_id === ACTOR && snap?.titulo?.startsWith(TAG) === true);

  /* ════════════════════════ convertLeadToDeal ════════════════════════ */
  const [lead] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.leads (name, email, company, message, source)
     values ('${TAG} Ana Prueba', 'ana@ejemplo.test', '${TAG} Laboratorio', 'Quiero una cotización', 'web_contact')
     returning id`,
  );
  const L = lead.id;
  const CONVERSION = [
    `select status from ${ESQUEMA}.leads where id = '${L}'`,
    NEGOCIOS,
    `select count(*)::int as n from ${ESQUEMA}.crm_contacts where name like '${TAG}%'`,
    `select count(*)::int as n from ${ESQUEMA}.crm_organizations where name like '${TAG}%'`,
  ];

  seccion("convertLeadToDeal · la guardia");
  for (const [quien, puede] of [["sin sesión", null], ["sin permiso", false], ["con «ver»", "ventas:ver"]] as const) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`convertir ${quien}`, () => c.convertLeadToDeal(forma({ leadId: L, pipelineId: P })), CONVERSION);
  }

  seccion("convertLeadToDeal · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("convertir sin embudo", () => c.convertLeadToDeal(forma({ leadId: L })), CONVERSION);
  await rechazaSinEscribir("convertir un lead que no existe", () => c.convertLeadToDeal(forma({ leadId: NADIE, pipelineId: P })), CONVERSION);
  // Sin etapas no hay dónde ponerlo, y el lead no puede quedar calificado a medias.
  await rechazaSinEscribir(
    "convertir hacia un embudo sin etapas",
    () => c.convertLeadToDeal(forma({ leadId: L, pipelineId: pVacio.id })),
    CONVERSION,
  );

  seccion("convertLeadToDeal · el camino feliz");
  const rc = await intentar(() => c.convertLeadToDeal(forma({ leadId: L, pipelineId: P })));
  const [conv] = await filas<{
    id: string; stage_id: string; owner_id: string; organization_id: string; contact_id: string; title: string;
  }>(`select id, stage_id, owner_id, organization_id, contact_id, title from ${ESQUEMA}.crm_deals where lead_id = '${L}'`);
  const uno = (await cuantos("crm_deals", `where lead_id = '${L}'`)) === 1;
  ok("sale UN negocio del lead", uno, uno ? "" : rc.error?.slice(0, 80));
  ok("en la primera etapa del embudo, a nombre de quien convierte", conv?.stage_id === S1 && conv?.owner_id === ACTOR);
  const [finC, aLaFicha] = redirigio(rc, `/admin/crm/negocios/${conv?.id}`);
  ok(`y al terminar ${finC}`, aLaFicha, aLaFicha ? "" : (rc.redirige ?? rc.error?.slice(0, 80)));
  const [org] = await filas<{ name: string; owner_id: string }>(
    `select name, owner_id from ${ESQUEMA}.crm_organizations where id = '${conv?.organization_id ?? NADIE}'`,
  );
  ok("la organización se crea con el nombre de la empresa del lead", org?.name === `${TAG} Laboratorio` && org?.owner_id === ACTOR);
  const [contacto] = await filas<{ name: string; owner_id: string; organization_id: string }>(
    `select name, owner_id, organization_id from ${ESQUEMA}.crm_contacts where id = '${conv?.contact_id ?? NADIE}'`,
  );
  ok("el contacto, colgado de ella y a nombre de quien convierte", contacto?.owner_id === ACTOR && contacto?.organization_id === conv?.organization_id);
  const [leadConv] = await filas<{ status: string }>(`select status from ${ESQUEMA}.leads where id = '${L}'`);
  ok("el lead queda calificado", leadConv?.status === "qualified");
  ok(
    "el alta queda firmada en los eventos del negocio y en la bitácora",
    (await cuantos("crm_deal_events", `where deal_id = '${conv?.id ?? NADIE}' and author_id = '${ACTOR}'`)) === 1 &&
      (await cuantos("domain_events", `where aggregate_id = '${conv?.id ?? NADIE}' and event_type = 'deal.created_from_lead' and actor_id = '${ACTOR}'`)) === 1,
  );

  /*
    El doble clic. Sin el bloqueo del lead, dos peticiones creaban dos negocios
    que sumaban los dos al pronóstico. La segunda tiene que llevar al que ya
    existe, no a otro.
  */
  const antesDoble = await foto(...CONVERSION);
  const rc2 = await intentar(() => c.convertLeadToDeal(forma({ leadId: L, pipelineId: P })));
  ok("convertirlo otra vez no crea nada", (await foto(...CONVERSION)) === antesDoble);
  // Si no encontrara el negocio de la primera vez volvería sin redirigir, que
  // se lee como «el botón no funciona»: llegar a redirigir ya dice que lo halló.
  const [finC2, alMismo] = redirigio(rc2, `/admin/crm/negocios/${conv?.id}`);
  ok(`y en vez de no hacer nada ${finC2}`, alMismo, alMismo ? "" : (rc2.redirige ?? rc2.error?.slice(0, 80)));

  // Otra variante del mismo nombre no abre una segunda ficha de la empresa.
  const [lead2] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.leads (name, email, company, message)
     values ('${TAG} Otro contacto', 'otro@ejemplo.test', '  ${TAG.toLowerCase()} LABORATORIO ', 'Hola') returning id`,
  );
  await intentar(() => c.convertLeadToDeal(forma({ leadId: lead2.id, pipelineId: P })));
  const [conv2] = await filas<{ organization_id: string }>(
    `select organization_id from ${ESQUEMA}.crm_deals where lead_id = '${lead2.id}'`,
  );
  ok("el mismo nombre con otras mayúsculas reutiliza la organización", conv2?.organization_id === conv?.organization_id);

  seccion("convertLeadToDeal · no se sale de la empresa");
  ok(
    `${AJENO} no tiene negocios, contactos ni organizaciones con la marca`,
    (await cuantos("crm_deals", `where title like '${TAG}%'`, AJENO)) === 0 &&
      (await cuantos("crm_contacts", `where name like '${TAG}%'`, AJENO)) === 0 &&
      (await cuantos("crm_organizations", `where name like '${TAG}%'`, AJENO)) === 0,
  );
});
