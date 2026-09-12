/**
 * LAS ACCIONES DE VIÁTICOS: QUIÉN MUEVE QUÉ, CON QUÉ NIVEL Y SOBRE QUÉ VIÁTICO.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-viaticos.ts
 *
 * Doce acciones sobre un documento que pasa de mano en mano: quien viaja PIDE,
 * ENVÍA, CARGA sus gastos y los MANDA a revisar; el aprobador nombrado
 * AUTORIZA, RECHAZA, RECLASIFICA, DEVUELVE y CIERRA. Lo que aporta la capa de
 * acción —y lo único que se prueba aquí— es el pegamento entre la sesión y el
 * dominio:
 *
 *   · que el actor que llega al dominio sea el de la SESIÓN y no un campo del
 *     formulario —un `requestedById` o un `actorId` inyectados no cuelan—;
 *   · que cada transición pida su nivel de módulo exacto (`editar` para lo de
 *     quien viaja, `administrar` para lo de quien firma) y, con un escalón
 *     menos, diga que no SIN escribir;
 *   · que la separación de funciones se sostenga llamando a la acción con DOS
 *     personas distintas: quien pide no firma aunque administre, otro
 *     administrador no firma lo que está a nombre de otro, y el aprobador no
 *     carga ni quita gastos en un viático que no es suyo.
 *
 * Las restricciones de la base, el tope por rubro y la regla de la nota ya las
 * cubre `probe-viaticos.mts` contra el dominio; no se repiten.
 *
 * ── LAS PERSONAS SE CREAN, NO SE BUSCAN ────────────────────────────────────
 *
 * El dominio no se fía del stub para decidir quién puede firmar: `vetoAprobador`
 * lee el nivel REAL del elegido en `memberships`. La base sembrada solo trae
 * agentes, vendedores y clientes —nadie administra viáticos—, así que las tres
 * personas de la prueba se dan de alta aquí con el rol General y se borran al
 * final. Llevan compras, pagar y servicio en «ninguno» a propósito: así no
 * entran en las listas de aprobadores ni en la cola de servicio de los probes
 * que corren a la vez contra la misma base, y no les cambian los avisos.
 *
 * El nivel que pide cada ACCIÓN se sigue simulando con `como(…)`: es la
 * pregunta de módulo que la acción le hace a `puedeEn`, y es la que hay que
 * poder contestar con un escalón menos.
 */
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
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

const MARCA = marca("VIA");
const SLUG = ESQUEMA.replace(/^tenant_/, "");
/** Un uuid bien formado que no es de nada: pasa Zod y tiene que fallar después. */
const FANTASMA = "00000000-0000-4000-8000-00000000dead";

/* ── Lo que se mira antes y después de cada acción ─────────────────────── */

/*
  Todas las transiciones ACTUALIZAN, así que la foto lleva la fila entera —con
  `updated_at`, que cualquier `update` mueve— y no un conteo. Y lleva también los
  gastos y los avisos del viático: una transición rechazada que aun así avisara
  al aprobador sería media escritura.
*/
const FILA = (id: string) =>
  `select status, requested_by_id, approver_id, approved_by_id, authorized_mxn, approval_note,
          submitted_at, reported_at, closed_by_id, closing_note, resolution_reason, updated_at
     from ${ESQUEMA}.viaticos where id = '${id}'`;
const GASTOS = (viaticoId: string) =>
  `select id, ticket_id, deal_id, rubro_id, amount_mxn, note, reclassified_by_id, reclassified_at
     from ${ESQUEMA}.viatico_expenses where viatico_id = '${viaticoId}' order by id`;
const AVISOS = (viaticoId: string) =>
  `select user_id, kind from ${ESQUEMA}.notifications where viatico_id = '${viaticoId}'
    order by user_id, kind`;
const TODO = (id: string) => [FILA(id), GASTOS(id), AVISOS(id)];
/** Las altas de esta corrida, por la marca que llevan en el destino. */
const ALTAS = `select count(*)::int as n from ${ESQUEMA}.viaticos where destination like '${MARCA}%'`;

type Fila = {
  status: string;
  requested_by_id: string;
  approver_id: string | null;
  approved_by_id: string | null;
  authorized_mxn: string | null;
  approval_note: string | null;
  submitted_at: Date | null;
  reported_at: Date | null;
  closed_by_id: string | null;
  closing_note: string | null;
  resolution_reason: string | null;
};
type Gasto = {
  id: string;
  ticket_id: string | null;
  deal_id: string | null;
  rubro_id: string;
  amount_mxn: string;
  note: string | null;
  receipt_path?: string | null;
  reclassified_by_id: string | null;
  reclassified_at: Date | null;
};

async function fila(id: string): Promise<Fila | undefined> {
  return (await filas<Fila>(FILA(id)))[0];
}
async function avisoPara(viaticoId: string, userId: string, kind: string): Promise<boolean> {
  const n = await cuantos(
    "notifications",
    `where viatico_id = '${viaticoId}' and user_id = '${userId}' and kind = '${kind}'`,
  );
  return n === 1;
}

type Estado = { ok: boolean; error?: string; message?: string; viaticoId?: string };

/**
 * Corre una acción del camino feliz sin dejar que un lanzamiento tumbe el
 * probe: lo que no vuelva como `{ ok }` se convierte en un error legible, y las
 * comprobaciones de después siguen corriendo.
 */
async function llamar(fn: () => Promise<Estado>): Promise<Estado> {
  const r = await intentar(fn);
  if (r.valor) return r.valor;
  return { ok: false, error: r.error ? `reventó: ${r.error}` : `redirigió a ${r.redirige}` };
}

void probar("viáticos: guardia, nivel, separación de funciones y lo que se escribe", async () => {
  /* ── 0 · el escenario ────────────────────────────────────────────────── */

  const [tenant] = await filas<{ id: string }>(
    `select id::text as id from public.tenants where slug = '${SLUG}'`,
  );
  if (!tenant) throw new Error(`la base no trae la empresa ${SLUG}`);

  /*
    Un contrato que atienda equipos con tickets, dos tickets suyos y uno que NO
    es de ese contrato. Se buscan en la siembra —no se crean— porque solo se
    LEEN: el viático cuelga de ellos y se borra al final; ellos no se tocan.
  */
  const [base] = await filas<{ c: string }>(
    `select ce.contract_id::text as c
       from ${ESQUEMA}.contract_equipment ce
       join ${ESQUEMA}.tickets t on t.equipment_id = ce.equipment_id
      group by ce.contract_id having count(distinct t.id) >= 2
      order by ce.contract_id limit 1`,
  );
  if (!base) throw new Error("la base no trae un contrato con dos tickets");
  const C = base.c;
  const tks = await filas<{ id: string }>(
    `select distinct t.id::text as id
       from ${ESQUEMA}.contract_equipment ce
       join ${ESQUEMA}.tickets t on t.equipment_id = ce.equipment_id
      where ce.contract_id = '${C}' order by 1 limit 2`,
  );
  const [T1, T2] = tks.map((t) => t.id);
  const [tx] = await filas<{ id: string }>(
    `select t.id::text as id from ${ESQUEMA}.tickets t
      where not exists (select 1 from ${ESQUEMA}.contract_equipment ce
                         where ce.contract_id = '${C}' and ce.equipment_id = t.equipment_id)
      order by t.id limit 1`,
  );
  const TX = tx?.id;
  const rubro = async (clave: string) =>
    (
      await filas<{ id: string }>(
        `select id::text as id from ${ESQUEMA}.viatico_rubros where key = '${clave}' and active`,
      )
    )[0]?.id;
  const HOTEL = await rubro("hotel");
  const OTROS = await rubro("otros");
  if (!T1 || !T2 || !TX || !HOTEL || !OTROS) {
    throw new Error("faltan tickets o los rubros de fábrica (hotel, otros) en la siembra");
  }

  /*
    Las tres personas. La limpieza de las personas se registra PRIMERO para que
    corra la ÚLTIMA: `requested_by_id` es `restrict`, así que antes tienen que
    haberse ido sus viáticos.
  */
  const creadas: string[] = [];
  alLimpiar(async () => {
    if (creadas.length === 0) return;
    await sql.unsafe(`delete from public.users where id = any($1::uuid[])`, [creadas]);
  });
  alLimpiar(async () => {
    if (creadas.length === 0) return;
    // Los gastos y los avisos se van en cascada con su viático.
    await sql.unsafe(
      `delete from ${ESQUEMA}.viaticos where requested_by_id = any($1::uuid[])`,
      [creadas],
    );
  });

  const SOLO_VIATICOS = JSON.stringify({ compras: "ninguno", pagar: "ninguno", servicio: "ninguno" });
  async function persona(papel: string): Promise<string> {
    const [u] = await filas<{ id: string }>(
      `insert into public.users (name, email)
       values ('${MARCA} ${papel}', '${MARCA.toLowerCase()}-${papel}@probe.invalid')
       returning id::text as id`,
    );
    creadas.push(u.id);
    await sql.unsafe(
      `insert into public.memberships (user_id, tenant_id, role, permissions)
       values ($1, $2, 'general', $3::jsonb)`,
      [u.id, tenant.id, SOLO_VIATICOS],
    );
    return u.id;
  }
  /*
    S pide y viaja. Es General a propósito: «el administrador que también viaja»
    es el caso que la cabecera del dominio dice que hay que sostener, y con un
    agente la regla se cumpliría por falta de permiso y no por la regla.
    A es el aprobador nombrado. O administra viáticos, pero no le toca firmar.
  */
  const S = await persona("solicitante");
  const A = await persona("aprobador");
  const O = await persona("otro-admin");

  let n = 0;
  /** Un viático sembrado a mano en el estado que haga falta, de S y a nombre de A. */
  async function viatico(estado: string): Promise<string> {
    n++;
    const autorizado = ["autorizado", "en_revision", "cerrado"].includes(estado) ? "5000" : "null";
    const [v] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.viaticos
         (reference, contract_id, requested_by_id, approver_id, destination, purpose,
          departs_on, returns_on, estimated_mxn, authorized_mxn, status)
       values ('${MARCA}-${n}', '${C}', '${S}', '${A}', '${MARCA} sembrado ${n}', 'probe',
               '2026-10-01', '2026-10-03', 5000, ${autorizado}, '${estado}')
       returning id::text as id`,
    );
    return v.id;
  }
  async function gastoSembrado(viaticoId: string): Promise<string> {
    const [g] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.viatico_expenses
         (viatico_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
       values ('${viaticoId}', '${T1}', '${HOTEL}', '${MARCA} sembrado', 100, '2026-10-02')
       returning id::text as id`,
    );
    return g.id;
  }

  const v = await import("@/lib/actions/viaticos");
  const ini = { ok: false };

  /**
   * Las tres puertas de toda acción con guardia de módulo: sin sesión, con
   * sesión y todo denegado, y con UN escalón menos del que pide. Las tres
   * comparan el mensaje de la guardia: si la guardia deja pasar, lo que vuelve
   * es otro error —el del dominio— y se ve.
   */
  async function guardia(
    nombre: string,
    actor: string,
    menor: string,
    mensaje: string,
    fn: () => Promise<unknown>,
    que: string[],
  ): Promise<void> {
    como(null);
    await rechazaSinEscribir(`${nombre}, sin sesión`, fn, que, conError("No hay sesión."));
    como(actor, false);
    await rechazaSinEscribir(`${nombre}, sin permiso`, fn, que, conError(mensaje));
    como(actor, menor);
    await rechazaSinEscribir(`${nombre}, con «${menor}»`, fn, que, conError(mensaje));
  }

  /* ── 1 · crear ───────────────────────────────────────────────────────── */
  seccion("crear: pide «editar», y el solicitante es quien tiene la sesión");

  const ALTA = {
    asunto: "contrato",
    contractId: C,
    approverId: A,
    destination: `${MARCA} Monterrey`,
    purpose: "Mantenimiento preventivo",
    departsOn: "2026-10-01",
    returnsOn: "2026-10-03",
    estimatedMxn: "$5,250.50",
  };
  const crear = (campos: Record<string, string>) => () =>
    v.crearViaticoAction(ini, forma({ ...ALTA, ...campos }));

  await guardia("crear", S, "viaticos:ver", "No tienes permiso para pedir viáticos.", crear({}), [ALTAS]);

  como(S, "viaticos:editar");
  const invalidas: Array<[string, Record<string, string>, string | null]> = [
    ["contrato que no es uuid", { contractId: "no-soy-un-uuid" }, "Elige un contrato."],
    ["sin aprobador", { approverId: "" }, "Elige a quién le mandas el viático a firmar."],
    ["destino en blanco", { destination: "   " }, "Falta el destino."],
    ["salida con otro formato", { departsOn: "01/10/2026" }, "Falta la fecha de salida."],
    /*
      Bien formada y aun así imposible. Llegaba a Postgres y volvía como «No se
      pudo crear el viático.»: no escribía, pero por el `catch` y no por la
      validación. Ahora la para Zod, y el mensaje lo dice.
    */
    [
      "salida el 30 de febrero",
      { departsOn: "2026-02-30", returnsOn: "2026-03-02" },
      "Falta la fecha de salida.",
    ],
    [
      "fechas al revés",
      { departsOn: "2026-10-05", returnsOn: "2026-10-01" },
      "El regreso no puede ser antes de la salida.",
    ],
    ["estimado que no es número", { estimatedMxn: "abc" }, "Pon un monto estimado mayor que cero."],
    ["estimado negativo", { estimatedMxn: "-500" }, "Pon un monto estimado mayor que cero."],
    ["estimado en cero", { estimatedMxn: "0" }, "Pon un monto estimado mayor que cero."],
    /*
      Quien pide no se elige a sí mismo para firmar. La regla es del dominio,
      pero el aprobador sale del FORMULARIO y el solicitante de la SESIÓN: esto
      comprueba que la acción no confunde los dos.
    */
    [
      "mandarse el viático a sí mismo",
      { approverId: "__S__" },
      "No puedes mandarte a firmar tu propio viático. Elige a otra persona.",
    ],
  ];
  for (const [nombre, campos, mensaje] of invalidas) {
    const c = Object.fromEntries(
      Object.entries(campos).map(([k, x]) => [k, x === "__S__" ? S : x]),
    );
    await rechazaSinEscribir(
      `crear, ${nombre}`,
      crear(c),
      [ALTAS],
      mensaje ? conError(mensaje) : undefined,
    );
  }

  /*
    El camino feliz con tres campos inyectados que la acción debe IGNORAR: un
    solicitante que no es la sesión, un estado adelantado y una firma. Si alguno
    llegara a la fila, cualquiera se autorizaría su propio viaje a mano.
  */
  const alta = await llamar(() =>
    v.crearViaticoAction(
      ini,
      forma({ ...ALTA, requestedById: O, status: "autorizado", approvedById: S, moduleIds: "basura" }),
    ),
  );
  ok("crear responde ok y devuelve el id", alta.ok === true && Boolean(alta.viaticoId), alta.error);
  const V1 = alta.viaticoId ?? FANTASMA;
  let f = await fila(V1);
  ok("el solicitante es el de la SESIÓN, no el del formulario", f?.requested_by_id === S);
  ok("a nombre del aprobador elegido", f?.approver_id === A);
  ok("nace en borrador y sin firma", f?.status === "borrador" && f?.approved_by_id === null, f?.status);
  const [monto] = await filas<{ estimated_mxn: string; contract_id: string }>(
    `select estimated_mxn, contract_id::text as contract_id from ${ESQUEMA}.viaticos where id = '${V1}'`,
  );
  ok("el estimado, sin símbolo ni comas", monto?.estimated_mxn === "5250.50", monto?.estimated_mxn);
  ok("colgado del contrato elegido", monto?.contract_id === C);

  /* ── 2 · enviar ──────────────────────────────────────────────────────── */
  seccion("enviar: solo quien lo pidió, y con «editar»");

  const enviar = (id: string) => () => v.enviarViaticoAction(ini, forma({ id }));
  /*
    Enviar es parte de PEDIR, que la cabecera de la acción reserva a
    `viaticos:editar`. No lo comprobaba: quien había perdido el módulo seguía
    pudiendo mover su borrador. Lo encontró este probe.
  */
  await guardia("enviar", S, "viaticos:ver", "No tienes permiso para enviar viáticos.", enviar(V1), TODO(V1));

  como(O);
  await rechazaSinEscribir(
    "enviar el borrador de OTRO, aunque administre",
    enviar(V1),
    TODO(V1),
    conError("Solo quien lo pidió puede enviarlo."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir("enviar, id que no es uuid", enviar("x"), TODO(V1), conError("Viático inválido."));
  await rechazaSinEscribir("enviar, viático que no existe", enviar(FANTASMA), TODO(V1), conError("El viático no existe."));

  let r = await llamar(enviar(V1));
  f = await fila(V1);
  ok("enviar responde ok", r.ok === true, r.error);
  ok("queda enviado y con fecha de envío", f?.status === "enviado" && f?.submitted_at !== null, f?.status);
  ok("y le llega el aviso al aprobador nombrado", await avisoPara(V1, A, "viatico.enviado"));
  ok(
    "y a nadie más: el otro administrador no se entera",
    (await cuantos("notifications", `where viatico_id = '${V1}' and user_id = '${O}'`)) === 0,
  );

  /* ── 3 · autorizar ───────────────────────────────────────────────────── */
  seccion("autorizar: «administrar», y además ser el aprobador y no el solicitante");

  const autorizar = (id: string, campos: Record<string, string> = {}) => () =>
    v.autorizarViaticoAction(ini, forma({ id, authorizedMxn: "4000", ...campos }));
  await guardia(
    "autorizar",
    A,
    "viaticos:editar",
    "No tienes permiso para autorizar viáticos.",
    autorizar(V1),
    TODO(V1),
  );

  /*
    LA SEPARACIÓN DE FUNCIONES, con la sesión en dos personas distintas.

    S tiene el módulo entero —es General— y aun así no firma lo suyo, ni
    colando un `actorId` con el id del aprobador. O también administra, pero el
    documento está a nombre de A.
  */
  const PEDISTE = "No puedes firmar un viático que pediste tú. Tiene que revisarlo otra persona.";
  const DE_OTRO =
    "Este viático está a nombre de otra persona para firmar. Reasignalo si tiene que resolverlo alguien más.";
  como(S);
  await rechazaSinEscribir("autorizar lo que uno mismo pidió", autorizar(V1), TODO(V1), conError(PEDISTE));
  await rechazaSinEscribir(
    "autorizar lo propio colando el actorId del aprobador",
    autorizar(V1, { actorId: A, userId: A }),
    TODO(V1),
    conError(PEDISTE),
  );
  como(O);
  await rechazaSinEscribir("autorizar lo que está a nombre de otro", autorizar(V1), TODO(V1), conError(DE_OTRO));

  como(A, "viaticos:administrar");
  for (const [nombre, monto, mensaje] of [
    ["monto que no es número", "abc", "Pon el monto que autorizas."],
    ["monto vacío", "", "Pon el monto que autorizas."],
    ["monto negativo", "-100", "Autorizar cero es rechazar. Usa «Rechazar» y di por qué."],
    ["monto en cero", "0", "Autorizar cero es rechazar. Usa «Rechazar» y di por qué."],
    // `Number("1e12")` es un número, y no cabe en `numeric(12,2)`: reventaba.
    ["monto que no cabe en la columna", "1e12", "No se pudo autorizar el viático."],
  ] as const) {
    await rechazaSinEscribir(
      `autorizar, ${nombre}`,
      autorizar(V1, { authorizedMxn: monto }),
      TODO(V1),
      conError(mensaje),
    );
  }
  await rechazaSinEscribir("autorizar, id que no es uuid", autorizar("x"), TODO(V1), conError("Viático inválido."));

  r = await llamar(autorizar(V1, { authorizedMxn: "$4,000.00", note: "  Solo lo del hotel  " }));
  f = await fila(V1);
  ok("autorizar responde ok", r.ok === true, r.error);
  ok("queda autorizado", f?.status === "autorizado", f?.status);
  ok("firmado por quien tiene la sesión", f?.approved_by_id === A);
  ok("con el monto autorizado, no el pedido", f?.authorized_mxn === "4000.00", f?.authorized_mxn ?? "null");
  ok("y la nota recortada", f?.approval_note === "Solo lo del hotel", f?.approval_note ?? "null");
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.autorizado"));

  /* ── 4 · rechazar ────────────────────────────────────────────────────── */
  seccion("rechazar: el mismo reparto que autorizar, y con motivo");

  const VR = await viatico("enviado");
  const rechazar = (id: string, reason = "El cliente movió la visita") => () =>
    v.rechazarViaticoAction(ini, forma({ id, reason }));
  await guardia(
    "rechazar",
    A,
    "viaticos:editar",
    "No tienes permiso para rechazar viáticos.",
    rechazar(VR),
    TODO(VR),
  );
  como(S);
  await rechazaSinEscribir("rechazar lo que uno mismo pidió", rechazar(VR), TODO(VR), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("rechazar lo que está a nombre de otro", rechazar(VR), TODO(VR), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "rechazar sin motivo",
    rechazar(VR, "   "),
    TODO(VR),
    conError("Hay que decir por qué se rechaza."),
  );
  r = await llamar(rechazar(VR));
  f = await fila(VR);
  ok("rechazar responde ok", r.ok === true, r.error);
  ok(
    "queda rechazado, firmado por el aprobador y con el motivo",
    f?.status === "rechazado" &&
      f?.approved_by_id === A &&
      f?.resolution_reason === "El cliente movió la visita",
    `${f?.status} · ${f?.resolution_reason}`,
  );
  ok("y el solicitante recibe el aviso", await avisoPara(VR, S, "viatico.rechazado"));

  /* ── 5 · agregar gasto ───────────────────────────────────────────────── */
  seccion("agregar gasto: «editar», solo el que viajó y solo en «autorizado»");

  const GASTO = {
    viaticoId: V1,
    destino: "ticket",
    ticketId: T1,
    rubroId: HOTEL,
    description: `${MARCA} hotel dos noches`,
    amountMxn: "$1,200.50",
    spentOn: "2026-10-02",
  };
  const agregar = (campos: Record<string, string> = {}) => () =>
    v.agregarGastoAction(ini, forma({ ...GASTO, ...campos }));

  await guardia(
    "agregar gasto",
    S,
    "viaticos:ver",
    "No tienes permiso para capturar gastos.",
    agregar(),
    TODO(V1),
  );

  // El aprobador tiene el módulo entero y el viático delante, y no es suyo.
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR carga un gasto en el viático que firma",
    agregar(),
    TODO(V1),
    conError("Solo quien viajó carga sus gastos."),
  );
  como(O);
  await rechazaSinEscribir(
    "otro administrador carga un gasto en un viático ajeno",
    agregar(),
    TODO(V1),
    conError("Solo quien viajó carga sus gastos."),
  );

  como(S, "viaticos:editar");
  const VB = await viatico("borrador");
  const VREV = await viatico("en_revision");
  const GREV = await gastoSembrado(VREV);
  await rechazaSinEscribir(
    "gasto en un borrador, que aún no se autoriza",
    agregar({ viaticoId: VB }),
    TODO(VB),
    conError("No se pueden cargar gastos: está en «borrador»."),
  );
  await rechazaSinEscribir(
    "gasto en un viático que ya está en revisión",
    agregar({ viaticoId: VREV }),
    TODO(VREV),
    conError("Ya está en revisión. Pide que te lo devuelvan para cambiar algo."),
  );
  await rechazaSinEscribir(
    "gasto en un viático RECHAZADO",
    agregar({ viaticoId: VR }),
    TODO(VR),
    conError("No se pueden cargar gastos: está en «rechazado»."),
  );

  const malos: Array<[string, Record<string, string>, string | null]> = [
    ["viático que no es uuid", { viaticoId: "x" }, "Viático inválido."],
    ["ticket que no es uuid", { ticketId: "no-soy-un-uuid" }, "Elige a qué ticket de servicio pertenece el gasto."],
    ["sin rubro", { rubroId: "" }, "Elige un rubro de gasto."],
    ["rubro que no existe", { rubroId: FANTASMA }, "Ese rubro de gasto no existe."],
    ["sin descripción", { description: "  " }, "Describe el gasto."],
    ["importe que no es número", { amountMxn: "abc" }, "Pon un importe mayor que cero."],
    ["importe con letras detrás", { amountMxn: "12abc" }, "Pon un importe mayor que cero."],
    ["importe negativo", { amountMxn: "-50" }, "Pon un importe mayor que cero."],
    ["importe en cero", { amountMxn: "0" }, "Pon un importe mayor que cero."],
    ["fecha con otro formato", { spentOn: "02/10/2026" }, "Falta la fecha del gasto."],
    /*
      Estos dos pasaban la validación y reventaban en Postgres —fecha fuera de
      rango, llave foránea—: la acción no tenía `catch` y la pantalla se caía
      con un error en vez de decir qué pasaba. Los encontró este probe.
    */
    ["fecha que no existe (30 de febrero)", { spentOn: "2026-02-30" }, "Falta la fecha del gasto."],
    // Reventaba contra la llave foránea. Desde que el dominio exige que el
    // ticket sea de un equipo del contrato, lo frena ANTES, con su motivo.
    [
      "ticket bien formado que no existe",
      { ticketId: FANTASMA },
      "Ese ticket no es de un equipo de este contrato.",
    ],
    ["importe que no cabe en la columna", { amountMxn: "99999999999" }, "No se pudo agregar el gasto."],
    // Un viático de contrato carga cada gasto a un ticket del servicio.
    [
      "gasto comercial suelto en un viático de contrato",
      { destino: "comercial" },
      "Este viático es de un contrato: cada gasto va a un ticket del servicio.",
    ],
  ];
  for (const [nombre, campos, mensaje] of malos) {
    await rechazaSinEscribir(
      `agregar gasto, ${nombre}`,
      agregar(campos),
      TODO(V1),
      mensaje ? conError(mensaje) : undefined,
    );
  }

  /*
    UN TICKET DE OTRO CONTRATO. El formulario solo ofrece los tickets del
    contrato (`ticketsDelContrato`), pero el dominio no lo comprueba: con el id
    cambiado a mano, la cena del viaje al contrato X queda cargada a un servicio
    del contrato Y y, al cerrar, entra en la utilidad del contrato equivocado.
    Era el mismo hueco que `destinoValido` ya tapaba para los negocios —«Ese
    negocio no es de la empresa a la que se viajó»—. Este probe lo encontró en
    rojo, y `domain/viaticos.ts` ahora exige que el ticket sea de un equipo que
    el contrato ampara.
  */
  const VTX = await viatico("autorizado");
  await rechazaSinEscribir(
    "agregar gasto a un ticket de OTRO contrato",
    agregar({ viaticoId: VTX, ticketId: TX }),
    TODO(VTX),
  );

  r = await llamar(agregar());
  ok("agregar gasto responde ok", r.ok === true, r.error);
  ok(
    "y avisa que va sin comprobante",
    r.message === "Gasto agregado, SIN comprobante.",
    r.message,
  );
  const [g1] = await filas<Gasto>(
    `select id::text as id, ticket_id::text as ticket_id, deal_id, rubro_id::text as rubro_id,
            amount_mxn, note, receipt_path, reclassified_by_id, reclassified_at
       from ${ESQUEMA}.viatico_expenses
      where viatico_id = '${V1}' and description = '${MARCA} hotel dos noches'`,
  );
  ok("el gasto está en la base, en su viático", Boolean(g1));
  ok("cargado al ticket elegido y a ningún negocio", g1?.ticket_id === T1 && g1?.deal_id === null);
  ok("con su rubro", g1?.rubro_id === HOTEL);
  ok("el importe, sin símbolo ni comas", g1?.amount_mxn === "1200.50", g1?.amount_mxn);
  ok("sin nota y sin comprobante", g1?.note === null && g1?.receipt_path === null);

  r = await llamar(
    agregar({ rubroId: OTROS, note: "  paquetería  ", amountMxn: "80", description: `${MARCA} envío` }),
  );
  ok("un gasto de «otros» con su nota entra", r.ok === true, r.error);
  const [g2] = await filas<{ id: string; note: string | null }>(
    `select id::text as id, note from ${ESQUEMA}.viatico_expenses
      where viatico_id = '${V1}' and description = '${MARCA} envío'`,
  );
  ok("y la nota se guarda recortada", g2?.note === "paquetería", g2?.note ?? "null");

  /* ── 6 · quitar gasto ────────────────────────────────────────────────── */
  seccion("quitar gasto: las mismas condiciones que ponerlo");

  const G2 = g2?.id ?? FANTASMA;
  const quitar = (gastoId: string) => () => v.quitarGastoAction(ini, forma({ gastoId }));
  /*
    Quitar tampoco miraba el módulo, al revés que agregar: con «ver» —o sin
    nada— el que viajó podía borrar renglones de su comprobación. Lo encontró
    este probe.
  */
  await guardia("quitar gasto", S, "viaticos:ver", "No tienes permiso para quitar gastos.", quitar(G2), TODO(V1));
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR quita un gasto del viático que firma",
    quitar(G2),
    TODO(V1),
    conError("Solo quien viajó puede quitar sus gastos."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir(
    "quitar un gasto de un viático en revisión",
    quitar(GREV),
    TODO(VREV),
    conError("No se pueden quitar gastos: está en «en_revision»."),
  );
  await rechazaSinEscribir("quitar, id que no es uuid", quitar("x"), TODO(V1), conError("Gasto inválido."));
  await rechazaSinEscribir("quitar, gasto que no existe", quitar(FANTASMA), TODO(V1), conError("El gasto no existe."));

  r = await llamar(quitar(G2));
  ok("quitar responde ok", r.ok === true, r.error);
  ok("el gasto se fue", (await cuantos("viatico_expenses", `where id = '${G2}'`)) === 0);
  ok("y el otro sigue ahí", (await cuantos("viatico_expenses", `where viatico_id = '${V1}'`)) === 1);

  /* ── 7 · mandar a revisión ───────────────────────────────────────────── */
  seccion("mandar a revisión: el que viajó, con «editar»");

  const mandar = (id: string) => () => v.mandarARevisionAction(ini, forma({ id }));
  await guardia(
    "mandar a revisión",
    S,
    "viaticos:ver",
    "No tienes permiso para mandar la comprobación.",
    mandar(V1),
    TODO(V1),
  );
  como(A);
  await rechazaSinEscribir(
    "el APROBADOR manda a revisión la comprobación de otro",
    mandar(V1),
    TODO(V1),
    conError("Solo quien viajó puede mandar su comprobación."),
  );
  como(S, "viaticos:editar");
  await rechazaSinEscribir("mandar, id que no es uuid", mandar("x"), TODO(V1), conError("Viático inválido."));

  r = await llamar(mandar(V1));
  f = await fila(V1);
  ok("mandar a revisión responde ok", r.ok === true, r.error);
  ok("queda en revisión, con fecha", f?.status === "en_revision" && f?.reported_at !== null, f?.status);
  ok("y el aprobador recibe el aviso", await avisoPara(V1, A, "viatico.comprobado"));

  /* ── 8 · reclasificar ────────────────────────────────────────────────── */
  seccion("reclasificar: «administrar», y solo el aprobador");

  const G1 = g1?.id ?? FANTASMA;
  const reclasificar = (campos: Record<string, string>) => () =>
    v.reclasificarGastoAction(ini, forma({ gastoId: G1, destino: "ticket", ticketId: T2, ...campos }));
  await guardia(
    "reclasificar",
    A,
    "viaticos:editar",
    "No tienes permiso para reclasificar gastos.",
    reclasificar({}),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("reclasificar lo que uno mismo pidió", reclasificar({}), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("reclasificar lo que está a nombre de otro", reclasificar({}), TODO(V1), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir("reclasificar, gasto que no es uuid", reclasificar({ gastoId: "x" }), TODO(V1), conError("Gasto inválido."));
  await rechazaSinEscribir(
    "reclasificar a un ticket que no es uuid",
    reclasificar({ ticketId: "x" }),
    TODO(V1),
    conError("Elige a qué ticket de servicio pertenece el gasto."),
  );
  await rechazaSinEscribir(
    "reclasificar a un negocio sin decir cuál",
    reclasificar({ destino: "negocio" }),
    TODO(V1),
    conError("Elige el negocio al que se carga el gasto."),
  );

  r = await llamar(reclasificar({}));
  const [g1b] = await filas<Gasto>(
    `select ticket_id::text as ticket_id, amount_mxn, reclassified_by_id::text as reclassified_by_id,
            reclassified_at
       from ${ESQUEMA}.viatico_expenses where id = '${G1}'`,
  );
  ok("reclasificar responde ok", r.ok === true, r.error);
  ok("el gasto pasó al otro ticket", g1b?.ticket_id === T2);
  ok(
    "y queda escrito quién lo movió y cuándo",
    g1b?.reclassified_by_id === A && g1b?.reclassified_at !== null,
  );
  ok("sin tocar el importe", g1b?.amount_mxn === "1200.50", g1b?.amount_mxn);

  /* ── 9 · devolver ────────────────────────────────────────────────────── */
  seccion("devolver: «administrar», el aprobador, y con motivo");

  const devolver = (id: string, reason = "Falta la factura del hotel") => () =>
    v.devolverViaticoAction(ini, forma({ id, reason }));
  await guardia(
    "devolver",
    A,
    "viaticos:editar",
    "No tienes permiso para devolver viáticos.",
    devolver(V1),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("devolver lo que uno mismo pidió", devolver(V1), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("devolver lo que está a nombre de otro", devolver(V1), TODO(V1), conError(DE_OTRO));
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "devolver sin decir qué falta",
    devolver(V1, ""),
    TODO(V1),
    conError("Hay que decir qué falta corregir."),
  );

  r = await llamar(devolver(V1));
  f = await fila(V1);
  ok("devolver responde ok", r.ok === true, r.error);
  ok(
    "vuelve a autorizado, sin fecha de comprobación y con el motivo",
    f?.status === "autorizado" &&
      f?.reported_at === null &&
      f?.resolution_reason === "Falta la factura del hotel",
    f?.status,
  );
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.devuelto"));

  como(S, "viaticos:editar");
  r = await llamar(mandar(V1));
  ok("el que viajó lo vuelve a mandar", r.ok === true && (await fila(V1))?.status === "en_revision", r.error);

  /* ── 10 · cerrar ─────────────────────────────────────────────────────── */
  seccion("cerrar: el visto bueno, «administrar» y del aprobador");

  const cerrar = (id: string) => () => v.cerrarViaticoAction(ini, forma({ id, note: "  Cuadra  " }));
  await guardia(
    "cerrar",
    A,
    "viaticos:editar",
    "No tienes permiso para dar el visto bueno viáticos.",
    cerrar(V1),
    TODO(V1),
  );
  como(S);
  await rechazaSinEscribir("cerrar lo que uno mismo pidió", cerrar(V1), TODO(V1), conError(PEDISTE));
  como(O);
  await rechazaSinEscribir("cerrar lo que está a nombre de otro", cerrar(V1), TODO(V1), conError(DE_OTRO));

  como(A, "viaticos:administrar");
  r = await llamar(cerrar(V1));
  f = await fila(V1);
  ok("cerrar responde ok", r.ok === true, r.error);
  ok("queda cerrado, firmado por el aprobador", f?.status === "cerrado" && f?.closed_by_id === A, f?.status);
  ok("con la nota recortada", f?.closing_note === "Cuadra", f?.closing_note ?? "null");
  ok("y el solicitante recibe el aviso", await avisoPara(V1, S, "viatico.cerrado"));

  como(S, "viaticos:editar");
  await rechazaSinEscribir(
    "ya cerrado, no se le cargan gastos",
    agregar(),
    TODO(V1),
    conError("No se pueden cargar gastos: está en «cerrado»."),
  );

  /* ── 11 · reasignar ──────────────────────────────────────────────────── */
  seccion("reasignar: «administrar», sin ser el aprobador, y nunca al solicitante");

  const VREAS = await viatico("enviado");
  const reasignar = (id: string, approverId: string) => () =>
    v.reasignarViaticoAction(ini, forma({ id, approverId }));
  // La guardia de módulo de reasignar vive en el dominio: la acción le pasa el
  // permiso ya resuelto. El mensaje es el suyo.
  await guardia(
    "reasignar",
    A,
    "viaticos:editar",
    "No tienes permiso para reasignar viáticos.",
    reasignar(VREAS, O),
    TODO(VREAS),
  );
  como(O, "viaticos:administrar");
  await rechazaSinEscribir("reasignar, id que no es uuid", reasignar("x", O), TODO(VREAS), conError("Viático inválido."));
  await rechazaSinEscribir(
    "reasignar a alguien que no es uuid",
    reasignar(VREAS, "x"),
    TODO(VREAS),
    conError("Elige a quién se lo pasas."),
  );
  await rechazaSinEscribir(
    "reasignarle la firma AL SOLICITANTE",
    reasignar(VREAS, S),
    TODO(VREAS),
    conError("No puedes mandarte a firmar tu propio viático. Elige a otra persona."),
  );

  r = await llamar(reasignar(VREAS, O));
  ok("reasignar responde ok, sin ser el aprobador actual", r.ok === true, r.error);
  ok("queda a nombre del nuevo", (await fila(VREAS))?.approver_id === O);
  ok("y el nuevo recibe el aviso", await avisoPara(VREAS, O, "viatico.reasignado"));
  // Y la consecuencia que justifica reasignar explícitamente: el de antes ya no firma.
  como(A, "viaticos:administrar");
  await rechazaSinEscribir(
    "el aprobador ANTERIOR ya no puede autorizar",
    autorizar(VREAS),
    TODO(VREAS),
    conError(DE_OTRO),
  );

  /* ── 12 · cancelar ───────────────────────────────────────────────────── */
  seccion("cancelar: el que pidió, o quien administra; nadie más");

  const cancelar = (id: string, reason = "Se canceló la visita") => () =>
    v.cancelarViaticoAction(ini, forma({ id, reason }));
  const NO_PUEDES = "No puedes cancelar este viático.";
  como(null);
  await rechazaSinEscribir("cancelar, sin sesión", cancelar(VB), TODO(VB), conError("No hay sesión."));
  como(O, false);
  await rechazaSinEscribir("cancelar lo ajeno sin permiso", cancelar(VB), TODO(VB), conError(NO_PUEDES));
  /*
    Un escalón menos: el aprobador con «editar» no es quien pidió, así que
    necesita «administrar». Que la acción no bloquee por módulo es deliberado
    —el que viaja cancela sin administrar—, y por eso lo que hay que comprobar
    es que el permiso que le pasa al dominio sea el de «administrar» y no otro.
  */
  como(A, "viaticos:editar");
  await rechazaSinEscribir("cancelar lo ajeno con «editar»", cancelar(VB), TODO(VB), conError(NO_PUEDES));
  como(S, "viaticos:editar");
  await rechazaSinEscribir("cancelar, id que no es uuid", cancelar("x"), TODO(VB), conError("Viático inválido."));
  await rechazaSinEscribir(
    "cancelar sin motivo",
    cancelar(VB, " "),
    TODO(VB),
    conError("Hay que decir por qué se cancela."),
  );

  r = await llamar(cancelar(VB));
  f = await fila(VB);
  ok("el que pidió cancela su borrador con «editar»", r.ok === true, r.error);
  ok(
    "queda cancelado y con el motivo",
    f?.status === "cancelado" && f?.resolution_reason === "Se canceló la visita",
    f?.status,
  );

  const VCANC = await viatico("autorizado");
  como(O, "viaticos:administrar");
  r = await llamar(cancelar(VCANC, "Viaje duplicado"));
  ok(
    "quien administra cancela un viático ajeno ya autorizado",
    r.ok === true && (await fila(VCANC))?.status === "cancelado",
    r.error,
  );

  /* ── 13 · aislamiento ────────────────────────────────────────────────── */
  seccion("lo escrito se queda en la empresa de la sesión");

  ok(
    `el viático creado está en ${ESQUEMA}`,
    (await cuantos("viaticos", `where id = '${V1}'`)) === 1,
  );
  ok(
    `y ${AJENO} no tiene nada con la marca`,
    (await cuantos("viaticos", `where destination like '${MARCA}%'`, AJENO)) === 0,
  );
  ok(
    `ni gastos con la marca en ${AJENO}`,
    (await cuantos("viatico_expenses", `where description like '${MARCA}%'`, AJENO)) === 0,
  );
  ok(
    `ni avisos de viáticos para las personas de la prueba en ${AJENO}`,
    (await cuantos(
      "notifications",
      `where user_id in ('${S}', '${A}', '${O}')`,
      AJENO,
    )) === 0,
  );
});
