/**
 * LAS ACCIONES DE SEGUIMIENTO DEL CRM: ACTIVIDADES Y NOTAS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-crm-seguimiento.ts
 *
 * Cinco de las veintidós acciones de `lib/actions/crm.ts`: alta, marcado y
 * borrado de actividades; alta y borrado de notas. Las demás, en
 * `_probe-acciones-crm-negocios`, `-fichas` y `-etapas`.
 *
 * ── LO QUE SE ATA AQUÍ ─────────────────────────────────────────────────────
 *
 * Estas cinco no tienen esquema de Zod: leen el `FormData` a mano y vuelven en
 * silencio si algo falta. Así que lo que vale la pena comprobar es qué dejan
 * pasar, y dos cosas en concreto:
 *
 *   · el RESPONSABLE de una actividad. Negocios, organizaciones y contactos lo
 *     pasan por `resolveOwner`; la actividad lo tomaba tal cual del formulario,
 *     y con un uuid válido de alguien de otra empresa quedaba a su nombre;
 *   · el NIVEL de los borrados. Borrar un negocio, una organización o un
 *     contacto pide «administrar»; borrar una nota o una actividad se conforma
 *     se conformaba con «editar», así que cualquier vendedor borraba lo que
 *     escribió otro. Ahora es «el autor, o quien administra».
 *
 * ── AISLAMIENTO FRENTE A LAS OTRAS PRUEBAS ─────────────────────────────────
 *
 * Todo cuelga de un embudo, una organización y un negocio propios, marcados;
 * las fotos cuentan solo lo que lleva la marca.
 */
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
  borrarAlFinal,
  como,
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

const TAG = marca("CRMS");
/** Un uuid bien formado que no es de nada: el caso «lo borró otro mientras miraba». */
const NADIE = "00000000-0000-4000-8000-000000000000";

/**
 * Para capturas que la interfaz NO puede producir —un id que no es uuid, un
 * tipo fuera de la lista, una fecha que no es fecha—: la acción puede volver sin
 * hacer nada o reventar con el error de Postgres, y las dos valen; lo único que
 * no vale es escribir. Ver `_probe-acciones-crm-negocios`.
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

void probar("actividades y notas del CRM: guardia, nivel, validación, firma y aislamiento", async () => {
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

  // Un vendedor de OTRA empresa: uuid válido, membresía viva, pero no de aquí.
  const [ajeno] = await filas<{ id: string }>(
    `insert into users (name, email) values ('${TAG} Ajeno', '${TAG.toLowerCase()}@ejemplo.test') returning id`,
  );
  const EXTRANJERO = ajeno.id;
  alLimpiar(() => sql.unsafe(`delete from users where id = '${EXTRANJERO}'`));
  await sql.unsafe(
    `insert into memberships (user_id, tenant_id, role)
       select '${EXTRANJERO}', id, 'sales' from tenants where slug = '${AJENO.replace(/^tenant_/, "")}'`,
  );

  /* ── El terreno: embudo, etapa, negocio y organización propios ───────── */
  const [p] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Embudo') returning id`,
  );
  borrarAlFinal("crm_pipelines", `name like '${TAG}%'`);
  const [s] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name) values ('${p.id}', '${TAG} Etapa') returning id`,
  );
  const [d] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id, owner_id)
     values ('${TAG}-1', '${TAG} Negocio', '${p.id}', '${s.id}', '${OTRO}') returning id`,
  );
  const D = d.id;
  const [o] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_organizations (name, owner_id) values ('${TAG} Organización', '${OTRO}') returning id`,
  );
  const O = o.id;
  // Las actividades y notas sueltas (sin negocio) no caen con el embudo.
  borrarAlFinal("crm_notes", `body like '${TAG}%'`);
  borrarAlFinal("crm_activities", `subject like '${TAG}%'`);
  borrarAlFinal("crm_organizations", `id = '${O}'`);

  /** Una actividad o una nota de trabajo, puestas a mano y ESCRITAS POR OTRO. */
  const actividadDeOtro = async (asunto: string): Promise<string> => {
    const [a] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_activities (subject, type, deal_id, owner_id, created_by_id)
       values ('${TAG} ${asunto}', 'call', '${D}', '${OTRO}', '${OTRO}') returning id`,
    );
    return a.id;
  };
  const notaDeOtro = async (texto: string): Promise<string> => {
    const [n] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.crm_notes (body, deal_id, author_id) values ('${TAG} ${texto}', '${D}', '${OTRO}') returning id`,
    );
    return n.id;
  };

  const c = await import("@/lib/actions/crm");

  const ACTIVIDADES = `select count(*)::int as n from ${ESQUEMA}.crm_activities where subject like '${TAG}%'`;
  const NOTAS = `select count(*)::int as n from ${ESQUEMA}.crm_notes where body like '${TAG}%'`;
  const GUARDIA = [["sin sesión", null], ["sin permiso", false], ["con «ver»", "ventas:ver"]] as const;

  /* ════════════════════════ createActivity ════════════════════════ */
  const altaA = (cambio: Record<string, string> = {}) =>
    forma({ subject: `${TAG} Llamada`, type: "call", dealId: D, ...cambio });

  seccion("createActivity · la guardia");
  for (const [quien, puede] of GUARDIA) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`agendar ${quien}`, () => c.createActivity(altaA()), [ACTIVIDADES]);
  }

  seccion("createActivity · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("agendar sin asunto", () => c.createActivity(altaA({ subject: "" })), [ACTIVIDADES]);
  await rechazaSinEscribir("agendar con un asunto de puros espacios", () => c.createActivity(altaA({ subject: "   " })), [ACTIVIDADES]);
  /*
    El responsable, que era la puerta abierta: se tomaba tal cual del
    formulario. Con el uuid de un vendedor de otra empresa la actividad quedaba
    a su nombre —`owner_id` apunta al padrón de toda la plataforma—, y con el de
    un cliente, en la agenda de alguien que no vende. Lo encontró este probe.
  */
  await rechazaSinEscribir("agendar a nombre de alguien de otra empresa", () => c.createActivity(altaA({ ownerId: EXTRANJERO })), [ACTIVIDADES]);
  await rechazaSinEscribir("agendar a nombre de un cliente", () => c.createActivity(altaA({ ownerId: CLIENTE })), [ACTIVIDADES]);
  await noEscribe("agendar con un responsable que no es uuid", () => c.createActivity(altaA({ ownerId: "no-soy-un-uuid" })), [ACTIVIDADES]);
  await noEscribe("agendar con un tipo fuera de la lista", () => c.createActivity(altaA({ type: "telepatía" })), [ACTIVIDADES]);
  await noEscribe("agendar con una fecha que no es fecha", () => c.createActivity(altaA({ dueAt: "mañana temprano" })), [ACTIVIDADES]);
  await noEscribe("agendar con un negocio que no es uuid", () => c.createActivity(altaA({ dealId: "no-soy-un-uuid" })), [ACTIVIDADES]);

  seccion("createActivity · el camino feliz");
  const ajenoAntes = await cuantos("crm_activities", "", AJENO);
  await c.createActivity(
    altaA({ subject: `  ${TAG} Reunión de arranque  `, type: "meeting", dueAt: "2026-10-01T10:00", organizationId: O, notes: "Llevar propuesta" }),
  );
  const [a] = await filas<{
    subject: string; type: string; hay_fecha: boolean; deal_id: string; organization_id: string;
    owner_id: string; created_by_id: string; done: boolean; notes: string;
  }>(`select subject, type, due_at is not null as hay_fecha, deal_id, organization_id, owner_id, created_by_id, done, notes
        from ${ESQUEMA}.crm_activities where subject = '${TAG} Reunión de arranque'`);
  ok("la actividad se agenda con el asunto recortado", Boolean(a));
  ok("con su tipo, su fecha y sus notas", a?.type === "meeting" && a?.hay_fecha === true && a?.notes === "Llevar propuesta");
  ok("colgada del negocio y de la organización", a?.deal_id === D && a?.organization_id === O);
  ok("pendiente, a nombre de quien la agenda y creada por la sesión", a?.done === false && a?.owner_id === ACTOR && a?.created_by_id === ACTOR);

  await c.createActivity(altaA({ subject: `${TAG} Para otro`, ownerId: OTRO }));
  const [paraOtro] = await filas<{ owner_id: string; created_by_id: string }>(
    `select owner_id, created_by_id from ${ESQUEMA}.crm_activities where subject = '${TAG} Para otro'`,
  );
  ok("a nombre de otro vendedor de la casa, se respeta; la firma sigue siendo mía", paraOtro?.owner_id === OTRO && paraOtro?.created_by_id === ACTOR);

  seccion("createActivity · no se sale de la empresa");
  ok(`${AJENO} no ganó actividades`, (await cuantos("crm_activities", "", AJENO)) === ajenoAntes);
  ok("ni tiene nada con la marca", (await cuantos("crm_activities", `where subject like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ toggleActivity ════════════════════════ */
  const A1 = await actividadDeOtro("Por marcar");
  const FILA_A1 = `select done, done_at is not null as con_fecha from ${ESQUEMA}.crm_activities where id = '${A1}'`;

  seccion("toggleActivity · la guardia");
  for (const [quien, puede] of GUARDIA) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`marcar ${quien}`, () => c.toggleActivity(forma({ id: A1, done: "1" })), [FILA_A1]);
  }

  seccion("toggleActivity · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("marcar sin id", () => c.toggleActivity(forma({ id: "", done: "1" })), [FILA_A1]);
  await rechazaSinEscribir("marcar una que no existe", () => c.toggleActivity(forma({ id: NADIE, done: "1" })), [FILA_A1]);
  await noEscribe("marcar con un id que no es uuid", () => c.toggleActivity(forma({ id: "no-soy-un-uuid", done: "1" })), [FILA_A1]);

  seccion("toggleActivity · el camino feliz");
  type Marca = { done: boolean; con_fecha: boolean };
  await c.toggleActivity(forma({ id: A1, done: "1" }));
  let [m] = await filas<Marca>(FILA_A1);
  ok("hecha, con la hora en que se hizo", m?.done === true && m?.con_fecha === true);
  await c.toggleActivity(forma({ id: A1 }));
  [m] = await filas<Marca>(FILA_A1);
  ok("desmarcada, sin hora", m?.done === false && m?.con_fecha === false);

  /* ════════════════════════ deleteActivity ════════════════════════ */
  const A2 = await actividadDeOtro("Para borrar con editar");
  const A3 = await actividadDeOtro("Para borrar con administrar");
  const filaDe = (id: string) => [
    `select count(*)::int as n from ${ESQUEMA}.crm_activities where id = '${id}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${id}'`,
  ];

  seccion("deleteActivity · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`borrar actividad ${quien}`, () => c.deleteActivity(forma({ id: A2 })), filaDe(A2));
  }
  /*
    Con «editar», borrar la actividad que agendó OTRO. Se borraba: la acción
    usaba `requireSales()` —«editar»— mientras que los borrados de negocio,
    organización y contacto piden «administrar», que es lo que `permisos.ts`
    dice que es borrar («lo que deja huella»). Este probe lo encontró; la regla
    ahora es «el autor, o quien administra».
  */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("borrar con «editar» la actividad de otro", () => c.deleteActivity(forma({ id: A2 })), filaDe(A2));
  // La otra mitad de la regla: lo PROPIO sí se borra con «editar».
  const [propia] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_activities (subject, type, deal_id, owner_id, created_by_id)
     values ('${TAG} Mía, para borrar con editar', 'call', '${D}', '${ACTOR}', '${ACTOR}') returning id`,
  );
  await c.deleteActivity(forma({ id: propia.id }));
  ok("con «editar», el autor borra su propia actividad", (await cuantos("crm_activities", `where id = '${propia.id}'`)) === 0);

  seccion("deleteActivity · el camino feliz");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteActivity(forma({ id: "" })), filaDe(A3));
  await c.deleteActivity(forma({ id: A3 }));
  ok("con «administrar», la actividad desaparece", (await cuantos("crm_activities", `where id = '${A3}'`)) === 0);
  const [snapA] = await filas<{ actor_id: string; asunto: string }>(
    `select actor_id, payload->'snapshot'->>'subject' as asunto from ${ESQUEMA}.domain_events
      where aggregate_id = '${A3}' and event_type = 'activity.deleted'`,
  );
  ok("y la baja queda en la bitácora, con la foto y el actor", snapA?.actor_id === ACTOR && snapA?.asunto === `${TAG} Para borrar con administrar`);

  /* ════════════════════════ createNote ════════════════════════ */
  seccion("createNote · la guardia");
  for (const [quien, puede] of GUARDIA) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`anotar ${quien}`, () => c.createNote(forma({ body: `${TAG} no debe quedar`, dealId: D })), [NOTAS]);
  }

  seccion("createNote · la captura inválida");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("anotar sin texto", () => c.createNote(forma({ body: "", dealId: D })), [NOTAS]);
  await rechazaSinEscribir("anotar puros espacios", () => c.createNote(forma({ body: "   \n ", dealId: D })), [NOTAS]);
  await noEscribe("anotar en un negocio que no es uuid", () => c.createNote(forma({ body: `${TAG} x`, dealId: "no-soy-un-uuid" })), [NOTAS]);
  await noEscribe("anotar en un negocio que no existe", () => c.createNote(forma({ body: `${TAG} x`, dealId: NADIE })), [NOTAS]);

  seccion("createNote · el camino feliz");
  const ajenoNotas = await cuantos("crm_notes", "", AJENO);
  await c.createNote(forma({ body: `  ${TAG} Pidió la propuesta por correo  `, dealId: D, organizationId: O }));
  const [nota] = await filas<{ deal_id: string; organization_id: string; author_id: string }>(
    `select deal_id, organization_id, author_id from ${ESQUEMA}.crm_notes where body = '${TAG} Pidió la propuesta por correo'`,
  );
  ok("la nota se guarda con el texto recortado, en su negocio y su organización", nota?.deal_id === D && nota?.organization_id === O);
  ok("firmada por la sesión", nota?.author_id === ACTOR);

  seccion("createNote · no se sale de la empresa");
  ok(`${AJENO} no ganó notas`, (await cuantos("crm_notes", "", AJENO)) === ajenoNotas);
  ok("ni tiene nada con la marca", (await cuantos("crm_notes", `where body like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ deleteNote ════════════════════════ */
  const N1 = await notaDeOtro("Nota para borrar con editar");
  const N2 = await notaDeOtro("Nota para borrar con administrar");
  const filaN = (id: string) => [
    `select count(*)::int as n from ${ESQUEMA}.crm_notes where id = '${id}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${id}'`,
  ];

  seccion("deleteNote · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    como(puede === null ? null : ACTOR, puede ?? true);
    await rechazaSinEscribir(`borrar nota ${quien}`, () => c.deleteNote(forma({ id: N1 })), filaN(N1));
  }
  // El mismo hueco que en las actividades: una nota de otro, borrada con «editar».
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("borrar con «editar» la nota de otro", () => c.deleteNote(forma({ id: N1 })), filaN(N1));
  const [mia] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_notes (body, deal_id, author_id) values ('${TAG} Mía, para borrar con editar', '${D}', '${ACTOR}') returning id`,
  );
  await c.deleteNote(forma({ id: mia.id }));
  ok("con «editar», el autor borra su propia nota", (await cuantos("crm_notes", `where id = '${mia.id}'`)) === 0);

  seccion("deleteNote · el camino feliz");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteNote(forma({ id: "" })), filaN(N2));
  await c.deleteNote(forma({ id: N2 }));
  ok("con «administrar», la nota desaparece", (await cuantos("crm_notes", `where id = '${N2}'`)) === 0);
  ok(
    "y la baja queda en la bitácora con el actor",
    (await cuantos("domain_events", `where aggregate_id = '${N2}' and event_type = 'note.deleted' and actor_id = '${ACTOR}'`)) === 1,
  );
});
