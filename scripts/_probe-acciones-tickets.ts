/**
 * LAS ACCIONES DE SERVICIO: TICKETS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-tickets.ts
 *
 * Siete acciones, y casi ninguna tiene la guardia de «con permiso sí, sin
 * permiso no». La mitad tiene DOS caminos legítimos según quién llama:
 *
 *   · `createTicket` no se rechaza sin permiso: sin `servicio:editar` es un
 *     CLIENTE y lo que nace es una solicitud pendiente de revisión; con él, un
 *     servicio ya abierto. Lo que se comprueba es que el escalón decida el
 *     estado, y que un cliente no pueda colgarle el ticket al equipo de otro
 *     laboratorio.
 *   · `addComment` tampoco pide permiso para comentar: pide que el ticket sea
 *     tuyo si no eres del equipo. Y lo que el cliente no puede es lo que tiene
 *     consecuencias: marcar una nota como interna, cargar horas o declarar
 *     refacciones que descuentan inventario.
 *
 * Las acciones que ACTUALIZAN —aprobar, rechazar, cambiar estado, asignar— se
 * comprueban con la fila entera antes y después (`updated_at` incluido): un
 * `update` no mueve ningún conteo, y contar daría verde con la fila cambiada.
 *
 * Lo que NO repite: el cálculo del SLA (`probe-sla`), el ledger de inventario y
 * el sobregiro (`probe-inventario`), los folios (`probe-folios`). Aquí solo lo
 * que añade la capa de acción.
 *
 * ── LO QUE NO SE PUEDE COMPROBAR AQUÍ: LOS AVISOS ─────────────────────────
 *
 * La campana y el correo arman el enlace del ticket con `headers()` de Next
 * (`tenantBase`), que fuera de una petición lanza, y el kit no trae stub de
 * `next/headers`. `avisar*` se traga el error —por diseño: un aviso no tumba la
 * acción—, así que en este probe no se escribe NINGUNA notificación, ni las que
 * tocan ni las que no. Comprobar «la nota interna no le avisa al cliente» daría
 * verde por esa razón y no por la buena, así que no se comprueba. El folio sale
 * como «undefined-000123» por lo mismo: el stub de inquilino no trae
 * `folioPrefix`.
 *
 * ── LOS DATOS ──────────────────────────────────────────────────────────────
 *
 * Todo lo que se crea lleva la marca de la corrida y se borra al final: dos
 * equipos con módulo (uno de cada cliente), dos refacciones PROPIAS —así el
 * stock que se descuenta es de piezas que desaparecen con la limpieza y no hay
 * nada que reponer en las del catálogo sembrado— y tres cuentas de relleno
 * para las asignaciones que deben rechazarse. Las cuentas nunca firman nada:
 * `domain_events` es de solo anexar y su `actor_id` es `on delete set null`,
 * así que una cuenta que firmara un evento ya no se podría borrar.
 *
 * Otros probes corren a la vez contra la misma base: cada foto y cada conteo
 * va acotado por id o por la marca, nunca a la tabla entera.
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
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
} from "./_acciones-kit";

const TAG = marca("TKT");
const SLUG = ESQUEMA.replace(/^tenant_/, "");
/** Un uuid bien formado que no es de nada: la validación no puede fiarse de la forma. */
const FANTASMA = "00000000-0000-4000-8000-000000000000";

/** La primera fila de una consulta, o `undefined`. */
async function una<T = Record<string, unknown>>(q: string): Promise<T | undefined> {
  return (await filas<T>(q))[0];
}

/** Lo que una acción que actualiza podría tocar de un ticket. */
const FILA = (id: string) =>
  `select status, type, reviewed_by_id, reviewed_at, rejection_reason, assigned_to_id,
          resolved_at, first_responded_at, updated_at
     from ${ESQUEMA}.tickets where id = '${id}'`;

type Fila = {
  status: string;
  type: string;
  reviewed_by_id: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  assigned_to_id: string | null;
  resolved_at: Date | null;
  first_responded_at: Date | null;
};

/** Los tickets de esta corrida. Un `select` y no un conteo de la tabla. */
const MIOS = `select count(*)::int as n from ${ESQUEMA}.tickets where subject like '${TAG}%'`;

/*
  Cada aviso que falla por `headers()` imprime su pila entera (ver la
  cabecera): decenas de líneas que tapan el veredicto. Se cuentan y se callan;
  cualquier otro error sale como siempre.
*/
let avisosSinPeticion = 0;
const errorOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (args.some((a) => a instanceof Error && /outside a request scope/.test(a.message))) {
    avisosSinPeticion++;
    return;
  }
  errorOriginal(...args);
};

void probar("tickets: guardia, validación y lo que se escribe", async () => {
  /* ── Quiénes ───────────────────────────────────────────────────────────── */
  const miembros = async (rol: string, n: number) =>
    (
      await filas<{ id: string }>(
        `select u.id from users u
           join memberships m on m.user_id = u.id
           join tenants t on t.id = m.tenant_id
          where t.slug = '${SLUG}' and m.role = '${rol}' and m.active and u.active
          order by u.created_at, u.id limit ${n}`,
      )
    ).map((r) => r.id);

  const [STAFF, OTRO_AGENTE] = await miembros("agent", 2);
  const [CLIENTE, OTRO_CLIENTE] = await miembros("client", 2);
  const [VENDEDOR] = await miembros("sales", 1);
  if (!STAFF || !OTRO_AGENTE || !CLIENTE || !OTRO_CLIENTE || !VENDEDOR)
    throw new Error("la base no trae dos agentes, dos clientes y un vendedor activos");

  const [empresa] = await filas<{ id: string }>(`select id from tenants where slug = '${SLUG}'`);
  if (!empresa) throw new Error(`no existe la empresa ${SLUG}`);

  /* ── Los datos de trabajo, en el orden en que se deshacen al revés ─────── */

  /*
    Tres cuentas para lo que `assignTicket` debe rechazar: un agente dado de
    baja en la empresa, uno con la cuenta desactivada, y alguien que no es
    miembro. Se crean y no se reusan las sembradas porque desactivar a un agente
    de verdad le cambiaría el mundo a los probes que corren a la vez.
  */
  const correo = (s: string) => `${TAG.toLowerCase()}-${s}@example.test`;
  alLimpiar(() => sql.unsafe(`delete from users where email like '${TAG.toLowerCase()}-%@example.test'`));
  const cuenta = async (s: string, activa: boolean) =>
    (
      await filas<{ id: string }>(
        `insert into users (email, name, active) values ('${correo(s)}', '${TAG} ${s}', ${activa}) returning id`,
      )
    )[0]!.id;
  const DE_BAJA = await cuenta("baja", true);
  const CUENTA_OFF = await cuenta("cuenta-off", false);
  const NO_MIEMBRO = await cuenta("no-miembro", true);
  await sql.unsafe(
    `insert into memberships (user_id, tenant_id, role, active) values
       ('${DE_BAJA}', '${empresa.id}', 'agent', false),
       ('${CUENTA_OFF}', '${empresa.id}', 'agent', true)`,
  );

  /* Un equipo con módulo y submódulo por cliente: el propio y el de otro laboratorio. */
  borrarAlFinal("equipment", `name like '${TAG}%'`);
  const equipo = async (dueno: string, s: string) => {
    const [e] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.equipment (owner_id, brand, name) values ('${dueno}', 'Waters', '${TAG} ${s}') returning id`,
    );
    const [m] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.equipment_modules (equipment_id, brand, name) values ('${e!.id}', 'Waters', '${TAG} mod ${s}') returning id`,
    );
    const [sm] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.equipment_submodules (module_id, name) values ('${m!.id}', '${TAG} sub ${s}') returning id`,
    );
    return { eq: e!.id, mod: m!.id, sub: sm!.id };
  };
  const PROPIO = await equipo(CLIENTE, "propio");
  const DEL_OTRO = await equipo(OTRO_CLIENTE, "ajeno");

  /*
    Dos refacciones propias. El ledger (`inventory_movements`) es `on delete
    restrict` sobre la pieza, así que sus movimientos se borran antes; el renglón
    de la bitácora (`ticket_comment_parts`) se va con el ticket.
  */
  alLimpiar(async () => {
    await sql.unsafe(
      `delete from ${ESQUEMA}.inventory_movements
        where part_id in (select id from ${ESQUEMA}.spare_parts where part_number like '${TAG}%')`,
    );
    await sql.unsafe(`delete from ${ESQUEMA}.spare_parts where part_number like '${TAG}%'`);
  });
  const pieza = async (s: string, stock: number) =>
    (
      await filas<{ id: string }>(
        `insert into ${ESQUEMA}.spare_parts
           (part_number, description, cost_mxn, cost_usd, price_mxn, price_usd, stock)
         values ('${TAG}-${s}', '${TAG} refacción ${s}', 100, 5.50, 150, 8.25, ${stock}) returning id`,
      )
    )[0]!.id;
  const P1 = await pieza("P1", 10);
  const P2 = await pieza("P2", 5);
  const STOCK = `select part_number, stock from ${ESQUEMA}.spare_parts
                  where part_number like '${TAG}%' order by part_number`;
  const MOVS = `select count(*)::int as n from ${ESQUEMA}.inventory_movements
                 where part_id in ('${P1}', '${P2}')`;

  /* Los tickets, al final de la lista: son lo PRIMERO que se borra. */
  borrarAlFinal("tickets", `subject like '${TAG}%'`);
  borrarAlFinal("tickets", `subject like '${TAG}%'`, AJENO);
  let serie = 0;
  /** Un ticket de trabajo escrito a mano, para las acciones que lo actualizan. */
  const ticket = async (status: string, creador = CLIENTE) =>
    (
      await filas<{ id: string }>(
        `insert into ${ESQUEMA}.tickets (reference, subject, description, status, type, created_by_id)
         values ('${TAG}-${++serie}', '${TAG} fijo ${serie}', 'ticket de trabajo del probe', '${status}',
                 '${status === "pending_review" ? "request" : "service"}', '${creador}')
         returning id`,
      )
    )[0]!.id;

  const t = await import("@/lib/actions/tickets");
  const inicial = { ok: false };
  const alta = (extra: Record<string, string | undefined> = {}) =>
    forma({
      subject: `${TAG} falla en bomba`,
      description: "La bomba no sostiene la presión desde ayer.",
      category: "maintenance",
      priority: "high",
      ...extra,
    });
  const idPorFolio = async (ref: string | undefined) =>
    (await una<{ id: string }>(`select id from ${ESQUEMA}.tickets where reference = '${ref ?? ""}'`))?.id;
  const eventos = (id: string, tipo: string) =>
    filas<{ actor_id: string | null; payload: Record<string, unknown> }>(
      `select actor_id, payload from ${ESQUEMA}.domain_events
        where aggregate_id = '${id}' and event_type = '${tipo}'`,
    );

  /* ══ createTicket ═══════════════════════════════════════════════════════ */
  seccion("createTicket · sin sesión no hay alta");
  como(null);
  await rechazaSinEscribir("alta sin sesión", () => t.createTicket(inicial, alta()), [MIOS], conError("auth"));

  seccion("createTicket · la captura inválida no deja ticket");
  como(CLIENTE, false, { rol: "client" });
  for (const [nombre, extra] of [
    ["alta con asunto de tres letras", { subject: "abc" }],
    ["alta con descripción corta", { description: "no sirve" }],
    ["alta con categoría inventada", { category: "urgente-ya" }],
    ["alta sin prioridad", { priority: "" }],
    ["alta con un equipo que no es uuid", { equipmentId: "no-soy-un-uuid" }],
  ] as const)
    await rechazaSinEscribir(nombre, () => t.createTicket(inicial, alta(extra)), [MIOS], conError("invalid"));

  /*
    EL CASO QUE VALE ORO: un cliente no le cuelga un ticket al equipo de otro
    laboratorio. El `equipmentId` viaja en el formulario; la pantalla solo
    ofrece los equipos propios, pero la acción acepta lo que le manden.

    Antes el equipo ajeno se DESCARTABA en silencio y el ticket nacía sin
    equipo: quien lo levantó eligió uno y recibió otro, sin saberlo. Se exige
    que se rechace, igual que un módulo que no es de ese equipo.
  */
  seccion("createTicket · un cliente no puede usar el equipo de otro laboratorio");
  await rechazaSinEscribir(
    "alta sobre el equipo de otro cliente",
    () => t.createTicket(inicial, alta({ equipmentId: DEL_OTRO.eq })),
    [MIOS],
    conError("invalid"),
  );
  await rechazaSinEscribir(
    "alta con su equipo y el módulo del equipo de otro",
    () => t.createTicket(inicial, alta({ equipmentId: PROPIO.eq, moduleId: DEL_OTRO.mod })),
    [MIOS],
    conError("invalid"),
  );
  await rechazaSinEscribir(
    "alta sobre un equipo que no existe",
    () => t.createTicket(inicial, alta({ equipmentId: FANTASMA })),
    [MIOS],
    conError("invalid"),
  );

  seccion("createTicket · el cliente levanta una SOLICITUD, firmada por él");
  let r = await t.createTicket(inicial, alta({ equipmentId: PROPIO.eq, moduleId: PROPIO.mod }));
  ok("la solicitud se crea", r.ok === true, r.error);
  const DEL_CLIENTE = await idPorFolio(r.reference);
  ok("y el folio que devuelve es el que quedó en la base", Boolean(DEL_CLIENTE), r.reference);
  const fc = DEL_CLIENTE
    ? await una<Fila & { created_by_id: string; equipment_id: string; module_id: string; sla_due_at: Date }>(
        `select * from ${ESQUEMA}.tickets where id = '${DEL_CLIENTE}'`,
      )
    : undefined;
  ok(
    "nace pendiente de revisión, como solicitud",
    fc?.status === "pending_review" && fc?.type === "request",
    `${fc?.status}/${fc?.type}`,
  );
  ok("firmada por el cliente de la sesión", fc?.created_by_id === CLIENTE);
  ok(
    "ligada a SU equipo y a SU módulo",
    fc?.equipment_id === PROPIO.eq && fc?.module_id === PROPIO.mod,
  );
  ok("sin revisor todavía", fc?.reviewed_by_id === null && fc?.reviewed_at === null);
  ok("con el plazo de SLA congelado a futuro", Boolean(fc?.sla_due_at && fc.sla_due_at > new Date()));
  if (DEL_CLIENTE) {
    const ev = await eventos(DEL_CLIENTE, "ticket.created");
    ok("el evento de alta lo firma el cliente", ev.length === 1 && ev[0]?.actor_id === CLIENTE);
  }

  /*
    Un escalón menos del que hace falta para ser «del equipo». Quien solo ve
    Servicio —el rol General, por ejemplo— no levanta servicios abiertos: sus
    tickets entran por revisión como los de cualquier cliente.
  */
  seccion("createTicket · el escalón decide si nace abierto");
  como(STAFF, "servicio:ver");
  r = await t.createTicket(inicial, alta({ subject: `${TAG} con servicio:ver` }));
  let id = await idPorFolio(r.reference);
  let f = id ? await una<Fila>(FILA(id)) : undefined;
  ok(
    "con «ver», entra como solicitud por revisar",
    r.ok && f?.status === "pending_review" && f?.type === "request",
    `${f?.status}/${f?.type}`,
  );

  como(STAFF, "servicio:editar");
  r = await t.createTicket(inicial, alta({ subject: `${TAG} con servicio:editar` }));
  id = await idPorFolio(r.reference);
  f = id ? await una<Fila>(FILA(id)) : undefined;
  ok("con «editar», nace abierto como servicio", r.ok && f?.status === "open" && f?.type === "service", `${f?.status}/${f?.type}`);

  /* ══ createServiceTicket ════════════════════════════════════════════════ */
  const servicio = (extra: Record<string, string | undefined> = {}) =>
    alta({ subject: `${TAG} levantamiento`, clientId: CLIENTE, ...extra });

  seccion("createServiceTicket · la guardia");
  for (const [nombre, quien] of [
    ["sin sesión", () => como(null)],
    ["sin permiso", () => como(STAFF, false)],
    ["con «ver»", () => como(STAFF, "servicio:ver")],
    ["siendo cliente", () => como(CLIENTE, false, { rol: "client" })],
  ] as const) {
    quien();
    await rechazaSinEscribir(`levantamiento ${nombre}`, () => t.createServiceTicket(inicial, servicio()), [MIOS], conError("auth"));
  }

  seccion("createServiceTicket · la captura inválida");
  como(STAFF, "servicio:editar");
  for (const [nombre, extra] of [
    ["cliente que no es un uuid", { clientId: "no-soy-un-uuid" }],
    ["asunto vacío", { subject: "" }],
    ["categoría inventada", { category: "urgente-ya" }],
    // El equipo tiene que ser del laboratorio elegido, no de cualquiera.
    ["equipo de otro cliente", { equipmentId: DEL_OTRO.eq }],
    ["módulo de otro equipo", { equipmentId: PROPIO.eq, moduleId: DEL_OTRO.mod }],
    /*
      Un cliente que no es miembro de la empresa. El id viaja en el formulario
      y, sin comprobarlo, el ticket quedaba a nombre de una cuenta de fuera —y
      el acuse de recibo, con el asunto, le llegaba por correo—.
    */
    ["cliente que no es de la empresa", { clientId: NO_MIEMBRO }],
  ] as const)
    await rechazaSinEscribir(
      `levantamiento con ${nombre}`,
      () => t.createServiceTicket(inicial, servicio(extra)),
      [MIOS, `select count(*)::int from ${ESQUEMA}.notifications where user_id = '${NO_MIEMBRO}'`],
      conError("invalid"),
    );

  seccion("createServiceTicket · el staff levanta un servicio a nombre del laboratorio");
  r = await t.createServiceTicket(inicial, servicio({ equipmentId: PROPIO.eq, moduleId: PROPIO.mod }));
  ok("el levantamiento se crea", r.ok === true, r.error);
  const SERVICIO = await idPorFolio(r.reference);
  const fs = SERVICIO
    ? await una<Fila & { created_by_id: string; equipment_id: string; module_id: string }>(
        `select * from ${ESQUEMA}.tickets where id = '${SERVICIO}'`,
      )
    : undefined;
  ok("nace abierto, como servicio", fs?.status === "open" && fs?.type === "service", `${fs?.status}/${fs?.type}`);
  ok("es del laboratorio, no de quien lo tecleó", fs?.created_by_id === CLIENTE);
  ok("y queda revisado por el staff de la sesión", fs?.reviewed_by_id === STAFF && fs?.reviewed_at !== null);
  ok("con el equipo y el módulo del laboratorio", fs?.equipment_id === PROPIO.eq && fs?.module_id === PROPIO.mod);
  if (SERVICIO) {
    const ev = await eventos(SERVICIO, "ticket.created");
    ok("el evento lo firma el staff, no el cliente", ev.length === 1 && ev[0]?.actor_id === STAFF);
  }

  seccion("lo escrito no se sale de la empresa");
  ok(`${AJENO} no tiene tickets con la marca`, (await cuantos("tickets", `where subject like '${TAG}%'`, AJENO)) === 0);
  ok(
    `y ${ESQUEMA} tiene exactamente los cuatro que se crearon`,
    (await cuantos("tickets", `where subject like '${TAG}%'`)) === 4,
  );

  /* ══ approveTicket / rejectTicket ═══════════════════════════════════════ */
  const POR_APROBAR = await ticket("pending_review");
  const POR_RECHAZAR = await ticket("pending_review");
  const sinPermiso = [
    ["sin sesión", () => como(null)],
    ["sin permiso", () => como(STAFF, false)],
    ["con «ver»", () => como(STAFF, "servicio:ver")],
    ["siendo el cliente que la levantó", () => como(CLIENTE, false, { rol: "client" })],
  ] as const;

  seccion("approveTicket / rejectTicket · la guardia no toca la fila");
  for (const [nombre, quien] of sinPermiso) {
    quien();
    await rechazaSinEscribir(`aprobar ${nombre}`, () => t.approveTicket(forma({ ticketId: POR_APROBAR })), [FILA(POR_APROBAR)]);
    await rechazaSinEscribir(
      `rechazar ${nombre}`,
      () => t.rejectTicket(forma({ ticketId: POR_RECHAZAR, reason: "no" })),
      [FILA(POR_RECHAZAR)],
    );
  }

  /*
    Sin `ticketId`, o con basura. `String(formData.get("ticketId"))` convertía
    la ausencia en el texto "null" —verdadero para el `if (!ticketId)` de la
    guardia— y Postgres reventaba al compararlo con un uuid: un 500 en vez de no
    hacer nada.
  */
  seccion("approveTicket / rejectTicket · un id que no es de nada no revienta");
  como(STAFF, "servicio:editar");
  for (const [nombre, campos] of [
    ["sin ticketId", {}],
    ["con un ticketId que no es uuid", { ticketId: "no-soy-un-uuid" }],
  ] as const) {
    await rechazaSinEscribir(`aprobar ${nombre}`, () => t.approveTicket(forma(campos)), [FILA(POR_APROBAR)]);
    await rechazaSinEscribir(`rechazar ${nombre}`, () => t.rejectTicket(forma(campos)), [FILA(POR_RECHAZAR)]);
  }

  seccion("approveTicket / rejectTicket · el camino feliz, firmado");
  await t.approveTicket(forma({ ticketId: POR_APROBAR }));
  f = await una<Fila>(FILA(POR_APROBAR));
  ok("aprobar la pasa a la cola", f?.status === "open", f?.status);
  ok("firmada por quien aprobó", f?.reviewed_by_id === STAFF && f?.reviewed_at !== null);

  await t.rejectTicket(forma({ ticketId: POR_RECHAZAR, reason: `  ${TAG} fuera de contrato  ` }));
  f = await una<Fila>(FILA(POR_RECHAZAR));
  ok("rechazar la cierra", f?.status === "rejected", f?.status);
  ok("con el motivo, sin espacios sobrantes", f?.rejection_reason === `${TAG} fuera de contrato`, f?.rejection_reason ?? "null");
  ok("y firmada por quien rechazó", f?.reviewed_by_id === STAFF);

  // El `where` filtra por estado: lo ya decidido no se vuelve a decidir.
  await rechazaSinEscribir(
    "rechazar lo ya aprobado",
    () => t.rejectTicket(forma({ ticketId: POR_APROBAR, reason: "tarde" })),
    [FILA(POR_APROBAR)],
  );
  await rechazaSinEscribir("aprobar lo ya rechazado", () => t.approveTicket(forma({ ticketId: POR_RECHAZAR })), [FILA(POR_RECHAZAR)]);

  /* ══ updateTicketStatus ═════════════════════════════════════════════════ */
  const EN_COLA = await ticket("open");
  const PENDIENTE = await ticket("pending_review");

  seccion("updateTicketStatus · el cliente no cambia estados");
  for (const [nombre, quien] of sinPermiso) {
    quien();
    await rechazaSinEscribir(
      `resolver ${nombre}`,
      () => t.updateTicketStatus(forma({ ticketId: EN_COLA, status: "resolved" })),
      [FILA(EN_COLA)],
    );
  }

  seccion("updateTicketStatus · solo estados operativos, y sin saltarse la revisión");
  como(STAFF, "servicio:editar");
  for (const s of ["pending_review", "rejected", "basura", ""])
    await rechazaSinEscribir(
      `pasar a «${s}»`,
      () => t.updateTicketStatus(forma({ ticketId: EN_COLA, status: s })),
      [FILA(EN_COLA)],
    );
  await rechazaSinEscribir(
    "resolver una solicitud sin aprobar",
    () => t.updateTicketStatus(forma({ ticketId: PENDIENTE, status: "resolved" })),
    [FILA(PENDIENTE)],
  );
  await rechazaSinEscribir(
    "revivir un rechazado",
    () => t.updateTicketStatus(forma({ ticketId: POR_RECHAZAR, status: "open" })),
    [FILA(POR_RECHAZAR)],
  );
  await rechazaSinEscribir(
    "un ticketId que no es uuid",
    () => t.updateTicketStatus(forma({ ticketId: "no-soy-un-uuid", status: "resolved" })),
    [FILA(EN_COLA)],
  );

  seccion("updateTicketStatus · el camino feliz");
  await t.updateTicketStatus(forma({ ticketId: EN_COLA, status: "resolved" }));
  f = await una<Fila>(FILA(EN_COLA));
  ok("resolver fija el estado y la fecha", f?.status === "resolved" && f?.resolved_at !== null, f?.status);
  await t.updateTicketStatus(forma({ ticketId: EN_COLA, status: "in_progress" }));
  f = await una<Fila>(FILA(EN_COLA));
  ok("reabrir limpia la fecha de resolución", f?.status === "in_progress" && f?.resolved_at === null);

  /* ══ assignTicket ═══════════════════════════════════════════════════════ */
  seccion("assignTicket · la guardia");
  for (const [nombre, quien] of sinPermiso) {
    quien();
    await rechazaSinEscribir(
      `asignar ${nombre}`,
      () => t.assignTicket(forma({ ticketId: EN_COLA, assignedToId: OTRO_AGENTE })),
      [FILA(EN_COLA)],
    );
  }

  seccion("assignTicket · el camino feliz");
  como(STAFF, "servicio:editar");
  await t.assignTicket(forma({ ticketId: EN_COLA, assignedToId: OTRO_AGENTE }));
  f = await una<Fila>(FILA(EN_COLA));
  ok("queda asignado al agente elegido", f?.assigned_to_id === OTRO_AGENTE);

  /*
    Ya asignado, cada intento inválido tiene que dejarlo COMO ESTABA: ni
    reasignado ni suelto. Una guardia que desasignara al rechazar pasaría una
    prueba hecha sobre un ticket sin asignar.
  */
  seccion("assignTicket · solo a personal de soporte activo de ESTA empresa");
  for (const [nombre, candidato] of [
    ["un agente dado de baja en la empresa", DE_BAJA],
    ["un agente con la cuenta desactivada", CUENTA_OFF],
    ["un vendedor, que no es de soporte", VENDEDOR],
    ["un cliente", OTRO_CLIENTE],
    ["una cuenta que no es miembro", NO_MIEMBRO],
    ["un uuid que no es de nadie", FANTASMA],
    ["algo que no es un uuid", "no-soy-un-uuid"],
  ] as const)
    await rechazaSinEscribir(
      `asignar a ${nombre}`,
      () => t.assignTicket(forma({ ticketId: EN_COLA, assignedToId: candidato })),
      [FILA(EN_COLA)],
    );

  await t.assignTicket(forma({ ticketId: EN_COLA, assignedToId: "" }));
  f = await una<Fila>(FILA(EN_COLA));
  ok("vacío lo desasigna", f?.assigned_to_id === null);

  /* ══ addComment ═════════════════════════════════════════════════════════ */
  if (!DEL_CLIENTE) throw new Error("sin la solicitud del cliente no hay en qué comentar");
  const TC = DEL_CLIENTE;
  const COMENTARIOS = `select count(*)::int as n from ${ESQUEMA}.ticket_comments where ticket_id = '${TC}'`;
  const TODO = [COMENTARIOS, FILA(TC), STOCK, MOVS];
  const comentario = (extra: Record<string, string | string[] | undefined> = {}) =>
    forma({ ticketId: TC, body: `${TAG} la bomba sigue fallando`, ...extra });
  /** Lo que llevaría un comentario con consecuencias: horas y dos piezas. */
  const conCarga = {
    internal: "on",
    hours: "3",
    partIds: [P1, P2],
    partQtys: ["2", "1"],
  };

  seccion("addComment · quién puede escribir en el ticket");
  como(null);
  await rechazaSinEscribir("comentar sin sesión", () => t.addComment(comentario()), TODO);
  /*
    El ticket es de CLIENTE. OTRO_CLIENTE tiene sesión en la misma empresa y
    solo tiene que cambiar el `ticketId` del formulario.
  */
  como(OTRO_CLIENTE, false, { rol: "client" });
  await rechazaSinEscribir("comentar en el ticket de otro cliente", () => t.addComment(comentario(conCarga)), TODO);

  seccion("addComment · la captura inválida");
  como(CLIENTE, false, { rol: "client" });
  await rechazaSinEscribir("comentario vacío", () => t.addComment(comentario({ body: "   " })), TODO);
  await rechazaSinEscribir("en un ticket que no existe", () => t.addComment(comentario({ ticketId: FANTASMA })), TODO);
  await rechazaSinEscribir("con un ticketId que no es uuid", () => t.addComment(comentario({ ticketId: "no-soy-un-uuid" })), TODO);
  await rechazaSinEscribir("sin ticketId", () => t.addComment(forma({ body: "hola" })), TODO);

  seccion("addComment · el cliente comenta, pero sin nada de lo interno");
  const stockAntes = await filas(STOCK);
  const movsAntes = await filas(MOVS);
  await t.addComment(comentario({ ...conCarga, body: `${TAG} del cliente` }));
  const dc = await una<{ id: string; author_id: string; internal: boolean; hours: string | null }>(
    `select id, author_id, internal, hours from ${ESQUEMA}.ticket_comments
      where ticket_id = '${TC}' and body = '${TAG} del cliente'`,
  );
  ok("el comentario del cliente se guarda, firmado por él", dc?.author_id === CLIENTE);
  ok("aunque pida «interna», queda PÚBLICA", dc?.internal === false);
  ok("las horas que mandó no se cargan", dc?.hours === null, dc?.hours ?? "null");
  ok(
    "ni las refacciones: sin renglones de bitácora",
    dc ? (await cuantos("ticket_comment_parts", `where comment_id = '${dc.id}'`)) === 0 : false,
  );
  ok(
    "ni movimiento de inventario",
    JSON.stringify(await filas(STOCK)) === JSON.stringify(stockAntes) &&
      JSON.stringify(await filas(MOVS)) === JSON.stringify(movsAntes),
  );
  ok("y no para el reloj del SLA", (await una<Fila>(FILA(TC)))?.first_responded_at === null);

  /*
    Con «ver» se es cliente a efectos de la bitácora: un escalón menos no carga
    horas ni descuenta piezas, y en un ticket ajeno no escribe.
  */
  como(STAFF, "servicio:ver");
  await rechazaSinEscribir("con «ver», en un ticket que no es suyo", () => t.addComment(comentario(conCarga)), TODO);

  seccion("addComment · la nota interna: del equipo, con horas, sin parar el SLA");
  como(STAFF, "servicio:editar");
  await t.addComment(
    comentario({
      body: `${TAG} nota interna`,
      internal: "on",
      hours: "1,5",
      cEquipmentId: PROPIO.eq,
      // El módulo de OTRO equipo: la jerarquía no casa y no debe ligarse.
      cModuleId: DEL_OTRO.mod,
      // Y un submódulo con basura: se ignora, no tumba el comentario.
      cSubmoduleId: "no-soy-un-uuid",
    }),
  );
  const ni = await una<{ internal: boolean; hours: string | null; author_id: string; equipment_id: string; module_id: string | null }>(
    `select internal, hours, author_id, equipment_id, module_id from ${ESQUEMA}.ticket_comments
      where ticket_id = '${TC}' and body = '${TAG} nota interna'`,
  );
  ok("la nota queda interna y firmada por el staff", ni?.internal === true && ni?.author_id === STAFF);
  ok("las horas con coma decimal se leen", ni?.hours === "1.50", ni?.hours ?? "null");
  ok(
    "el equipo se liga; el módulo de otro equipo y la basura no",
    ni?.equipment_id === PROPIO.eq && ni?.module_id === null,
    ni ? "" : "no se guardó la nota",
  );
  ok("no para el reloj del SLA: el cliente no la ve", (await una<Fila>(FILA(TC)))?.first_responded_at === null);

  await t.addComment(comentario({ body: `${TAG} horas negativas`, internal: "on", hours: "-3" }));
  const hn = await una<{ hours: string | null }>(
    `select hours from ${ESQUEMA}.ticket_comments where ticket_id = '${TC}' and body = '${TAG} horas negativas'`,
  );
  ok(
    "unas horas negativas no se cargan",
    hn !== undefined && hn.hours === null,
    hn ? `horas ${hn.hours}` : "no se guardó el comentario",
  );

  /*
    EL OTRO CASO QUE VALE ORO: las refacciones de un comentario descuentan
    stock y dejan copia de lo que costaban ese día. La copia es lo que hace que
    la rentabilidad de un servicio de hace un año no cambie cuando sube el
    precio de la pieza.

    Y una cantidad negativa se lee como 1, no como -4: si pasara tal cual,
    «consumir» -4 piezas las DEVOLVERÍA al almacén. Entre medias va un id con
    basura y SU cantidad (50): si la pieza y la cantidad no viajaran juntas,
    las cantidades se correrían una casilla y la segunda pieza saldría por 50.
  */
  seccion("addComment · las refacciones descuentan stock y guardan la copia");
  await t.addComment(
    comentario({
      body: `${TAG} respuesta con refacciones`,
      hours: "2",
      partIds: [P1, "no-soy-un-uuid", P2, FANTASMA],
      partQtys: ["3", "50", "-4", "1"],
      cEquipmentId: PROPIO.eq,
      cModuleId: PROPIO.mod,
      cSubmoduleId: PROPIO.sub,
    }),
  );
  const rp = await una<{ id: string; internal: boolean; hours: string; equipment_id: string; module_id: string; submodule_id: string }>(
    `select id, internal, hours, equipment_id, module_id, submodule_id from ${ESQUEMA}.ticket_comments
      where ticket_id = '${TC}' and body = '${TAG} respuesta con refacciones'`,
  );
  ok("la respuesta se guarda pública, con sus horas", rp?.internal === false && rp?.hours === "2.00", rp?.hours);
  ok(
    "ligada a equipo, módulo y submódulo",
    rp?.equipment_id === PROPIO.eq && rp?.module_id === PROPIO.mod && rp?.submodule_id === PROPIO.sub,
  );
  const renglones = rp
    ? await filas<{
        part_id: string;
        part_number: string;
        description: string;
        quantity: number;
        unit_cost_mxn: string;
        unit_cost_usd: string;
        unit_price_mxn: string;
        unit_price_usd: string;
      }>(
        `select part_id, part_number, description, quantity, unit_cost_mxn, unit_cost_usd, unit_price_mxn, unit_price_usd
           from ${ESQUEMA}.ticket_comment_parts where comment_id = '${rp.id}' order by part_number`,
      )
    : [];
  ok("dos renglones: la basura y la pieza que no existe se ignoran", renglones.length === 2, String(renglones.length));
  const [r1, r2] = renglones;
  ok(
    "la copia lleva número de parte, descripción y cantidad",
    r1?.part_id === P1 && r1.part_number === `${TAG}-P1` && r1.description === `${TAG} refacción P1` && r1.quantity === 3,
  );
  ok(
    "y los costos y precios vigentes",
    r1?.unit_cost_mxn === "100.00" &&
      r1.unit_cost_usd === "5.50" &&
      r1.unit_price_mxn === "150.00" &&
      r1.unit_price_usd === "8.25",
    JSON.stringify(r1),
  );
  ok(
    "una cantidad negativa se lee como una pieza, y no hereda la de la basura",
    r2?.part_id === P2 && r2.quantity === 1,
    String(r2?.quantity),
  );
  const stock = await filas<{ part_number: string; stock: number }>(STOCK);
  ok(
    "el stock bajó lo consumido: 10 → 7 y 5 → 4",
    stock[0]?.stock === 7 && stock[1]?.stock === 4,
    stock.map((s) => s.stock).join(", "),
  );
  const movs = rp
    ? await filas<{ part_id: string; kind: string; quantity: number; balance_after: number; actor_id: string }>(
        `select part_id, kind, quantity, balance_after, actor_id from ${ESQUEMA}.inventory_movements
          where ticket_comment_id = '${rp.id}'`,
      )
    : [];
  const m1 = movs.find((m) => m.part_id === P1);
  ok(
    "cada salida queda en el ledger, firmada por el staff",
    movs.length === 2 && m1?.kind === "consumption" && m1.quantity === -3 && m1.balance_after === 7 && m1.actor_id === STAFF,
    JSON.stringify(m1),
  );

  // Después de la copia, la pieza sube de precio: la bitácora no se entera.
  await sql.unsafe(`update ${ESQUEMA}.spare_parts set cost_mxn = 999, price_mxn = 1999 where id = '${P1}'`);
  const copia = rp
    ? await una<{ unit_cost_mxn: string; unit_price_mxn: string }>(
        `select unit_cost_mxn, unit_price_mxn from ${ESQUEMA}.ticket_comment_parts
          where comment_id = '${rp.id}' and part_id = '${P1}'`,
      )
    : undefined;
  ok(
    "un cambio de precio posterior no toca la copia",
    copia?.unit_cost_mxn === "100.00" && copia.unit_price_mxn === "150.00",
    JSON.stringify(copia),
  );

  f = await una<Fila>(FILA(TC));
  ok("la respuesta pública del staff para el reloj del SLA", f?.first_responded_at !== null);

  seccion("lo escrito no se sale de la empresa");
  ok(
    `${AJENO} no tiene comentarios de esta corrida`,
    (await cuantos("ticket_comments", `where body like '${TAG}%'`, AJENO)) === 0,
  );

  if (avisosSinPeticion)
    console.log(`\n· ${avisosSinPeticion} avisos no se pudieron escribir sin petición (ver la cabecera)`);
});
