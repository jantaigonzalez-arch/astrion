/**
 * LOS EXTRAS DEL CRM: PARTIDAS, ETIQUETAS, OBJETIVOS, PLANTILLAS,
 * AUTOMATIZACIONES Y DÍAS DE ESTANCAMIENTO.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-crm-extras.ts
 *
 * Trece acciones de `lib/actions/crm-extras.ts`. Todas son de `void`: no
 * devuelven un «auth» que se pueda comparar, vuelven sin hacer nada. Por eso
 * cada rechazo se ata a una FOTO de lo que la acción tocaría —el conteo acotado
 * a los fixtures de esta corrida, o la fila entera cuando la acción actualiza—
 * y no a lo que responde.
 *
 * ── LO QUE MÁS VALE AQUÍ ────────────────────────────────────────────────────
 *
 * Dos guardias conviven en el archivo: `requireSales` (ventas:editar) y
 * `requireAdmin` (ventas:administrar). Cada acción se llama con un escalón
 * menos del que pide, porque un borrado que se conforma con «editar» pasa
 * cualquier prueba de sí/no.
 *
 * Y el dinero de las partidas. `addDealItem` recalcula el valor del negocio con
 * la suma de sus líneas, así que lo que entre en una línea —una cantidad
 * negativa, un «NaN» que Postgres SÍ acepta en `numeric`— acaba en el embudo,
 * el pronóstico y los objetivos.
 *
 * ── FIXTURES Y CONCURRENCIA ─────────────────────────────────────────────────
 *
 * Un embudo, una etapa y dos negocios propios en `ESQUEMA`, y otro juego en
 * `AJENO` para medir el aislamiento. Todo lleva `TAG` y se borra al final: el
 * embudo arrastra en cascada etapas, negocios, líneas, etiquetas puestas y
 * automatizaciones. Las fotos se acotan a esos ids: otras pruebas escriben en
 * la misma base a la vez, y un conteo de tabla entera daría rojos ajenos.
 *
 * `domain_events` no se limpia: es de solo anexar por diseño, y los borrados
 * de esta corrida quedan ahí como quedaría cualquier otro.
 */
import { randomUUID } from "node:crypto";
import {
  AJENO,
  ESQUEMA,
  borrarAlFinal,
  como,
  cuantos,
  filas,
  forma,
  foto,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const TAG = marca("XTR");

/** El id de la primera fila de un `insert … returning id`. */
async function alta(q: string): Promise<string> {
  const [f] = await filas<{ id: string }>(q);
  if (!f) throw new Error(`no devolvió id: ${q.slice(0, 80)}`);
  return f.id;
}

/** El código SQLSTATE de un error de Postgres, venga envuelto o no por Drizzle. */
function codigoPg(e: unknown): string | undefined {
  for (let x = e as { code?: unknown; cause?: unknown } | undefined, i = 0; x && i < 5; i++) {
    if (typeof x.code === "string" && /^[0-9A-Z]{5}$/.test(x.code)) return x.code;
    x = x.cause as typeof x;
  }
  return undefined;
}

/**
 * Como `rechazaSinEscribir`, pero da por buena una segunda forma de rechazo:
 * que POSTGRES se niegue a la entrada y la acción reviente con ese error.
 *
 * Existe porque estas acciones no validan los ids: un «no-soy-un-uuid» llega a
 * la consulta y lo para el tipo de la columna (22P02); el id de otra empresa lo
 * para la llave foránea, que apunta a las tablas de ESTE esquema (23503). Es
 * una barrera real —no se puede saltar desde el formulario— y lo que importa
 * es que no escriba, que se comprueba igual. Solo se aceptan esos códigos: un
 * reventón por cualquier otra cosa sigue saliendo en rojo.
 *
 * No va al kit porque el kit no se toca desde aquí; si otras pruebas de
 * acciones la necesitan, ése es su sitio.
 */
async function frenaSinEscribir(
  etiqueta: string,
  fn: () => Promise<unknown>,
  que: string[],
  codigos: string[] = ["22P02", "23503"],
): Promise<void> {
  const antes = await foto(...que);
  let rechazada = false;
  let detalle = "";
  try {
    const v = await fn();
    rechazada = v === undefined;
    detalle = rechazada ? "volvió sin hacer nada" : `devolvió ${JSON.stringify(v)}`;
  } catch (e) {
    const codigo = codigoPg(e);
    rechazada = codigo !== undefined && codigos.includes(codigo);
    detalle = codigo
      ? `la base lo frenó (${codigo})`
      : `reventó: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
  const despues = await foto(...que);
  ok(`${etiqueta}: rechazada`, rechazada, detalle);
  ok(`${etiqueta}: y no escribió`, antes === despues, antes === despues ? "" : `${antes} → ${despues}`);
}

/** El evento de baja que dejó una acción, para ver quién lo firma. */
async function eventoDeBaja(tipo: string, agregado: string, extra = "") {
  const [e] = await filas<{ actor_id: string | null; payload: Record<string, unknown> }>(
    `select actor_id, payload from ${ESQUEMA}.domain_events
      where event_type = '${tipo}' and aggregate_id = '${agregado}' ${extra}
      order by id desc limit 1`,
  );
  return e;
}

void probar("extras del CRM: guardia, nivel, validación y lo que se escribe", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /* ── Fixtures ────────────────────────────────────────────────────────── */
  /*
    La limpieza del embudo se registra PRIMERO para que corra la ÚLTIMA (van en
    orden inverso): antes se borran las filas sueltas por marca, y al final el
    embudo se lleva en cascada lo que cuelga de él.
  */
  const P = await alta(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Embudo') returning id`,
  );
  borrarAlFinal("crm_pipelines", `id = '${P}'`);
  const S = await alta(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name, rotting_days)
     values ('${P}', '${TAG} Etapa', 7) returning id`,
  );
  const A = await alta(
    `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id)
     values ('${TAG}-A', '${TAG} Negocio A', '${P}', '${S}') returning id`,
  );
  /* B vale 5 000 capturados A MANO, sin una sola línea: es el importe que un
     recálculo indebido borraría. */
  const B = await alta(
    `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id, value_mxn)
     values ('${TAG}-B', '${TAG} Negocio B', '${P}', '${S}', 5000) returning id`,
  );

  /* El juego de la empresa ajena: un negocio con una línea y una etiqueta. */
  const AP = await alta(
    `insert into ${AJENO}.crm_pipelines (name) values ('${TAG} Embudo ajeno') returning id`,
  );
  borrarAlFinal("crm_pipelines", `id = '${AP}'`, AJENO);
  const AS = await alta(
    `insert into ${AJENO}.crm_stages (pipeline_id, name, rotting_days)
     values ('${AP}', '${TAG} Etapa ajena', 3) returning id`,
  );
  const AD = await alta(
    `insert into ${AJENO}.crm_deals (reference, title, pipeline_id, stage_id, value_mxn)
     values ('${TAG}-X', '${TAG} Negocio ajeno', '${AP}', '${AS}', 700) returning id`,
  );
  const AI = await alta(
    `insert into ${AJENO}.crm_deal_products (deal_id, name, quantity, unit_price_mxn)
     values ('${AD}', '${TAG} Línea ajena', 1, 700) returning id`,
  );
  const AL = await alta(
    `insert into ${AJENO}.crm_labels (name) values ('${TAG} Etiqueta ajena') returning id`,
  );
  borrarAlFinal("crm_labels", `name like '${TAG}%'`, AJENO);

  /* Lo que se crea por las acciones y no cuelga del embudo. */
  borrarAlFinal("crm_labels", `name like '${TAG}%'`);
  borrarAlFinal("crm_goals", `name like '${TAG}%'`);
  borrarAlFinal("crm_email_templates", `name like '${TAG}%'`);
  borrarAlFinal("crm_automations", `name like '${TAG}%'`);

  /* Fotos que se repiten. Acotadas a los fixtures, nunca a la tabla entera. */
  const LINEAS_A = `select id, quantity, unit_price_mxn, discount_pct
                      from ${ESQUEMA}.crm_deal_products where deal_id = '${A}' order by id`;
  const NEGOCIO = (id: string) =>
    `select value_mxn, updated_at from ${ESQUEMA}.crm_deals where id = '${id}'`;
  const AJENO_TODO = `select d.value_mxn, d.updated_at,
                             (select count(*)::int from ${AJENO}.crm_deal_products where deal_id = d.id) lineas,
                             (select count(*)::int from ${AJENO}.crm_deal_labels where deal_id = d.id) etiquetas,
                             (select rotting_days from ${AJENO}.crm_stages where id = '${AS}') rotting
                        from ${AJENO}.crm_deals d where d.id = '${AD}'`;

  const x = await import("@/lib/actions/crm-extras");

  /* ════════════════════════ Líneas de producto ════════════════════════ */
  seccion("addDealItem · pide ventas:editar");
  const linea = (campos: Record<string, string>) =>
    x.addDealItem(forma({ dealId: A, name: `${TAG} Línea`, quantity: "1", unitPriceMxn: "100", ...campos }));
  const quietoA = [LINEAS_A, NEGOCIO(A)];

  como(null);
  await rechazaSinEscribir("sin sesión", () => linea({}), quietoA);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => linea({}), quietoA);
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("con ventas:ver", () => linea({}), quietoA);
  /* Un permiso alto en OTRO módulo no cuenta: la guardia pregunta por ventas. */
  como(ACTOR, "servicio:administrar,configuracion:administrar");
  await rechazaSinEscribir("con administrar, pero de otro módulo", () => linea({}), quietoA);

  seccion("addDealItem · lo que no es un importe no entra");
  como(ACTOR, "ventas:editar");
  /*
    Precio y descuento pasan desde hace poco por `leerImporte`. Antes, la
    limpieza `[^0-9.]` convertía «-500» en 500 y lo sumaba al negocio.
  */
  for (const [nombre, campos] of [
    ["precio negativo", { unitPriceMxn: "-500" }],
    ["precio que no es número", { unitPriceMxn: "quinientos" }],
    ["descuento de más de 100", { discountPct: "150" }],
    ["descuento negativo", { discountPct: "-5" }],
    ["descuento que no es número", { discountPct: "diez" }],
    /*
      La CANTIDAD se quedó fuera de ese arreglo y entraba tal cual. «-3» por 100
      restaba 300 al negocio; «NaN» se guardaba —`numeric` de Postgres acepta
      NaN— y cualquier suma de la columna salía NaN. Lo encontró este probe.
    */
    ["cantidad negativa", { quantity: "-3" }],
    ["cantidad NaN", { quantity: "NaN" }],
    ["cantidad que no es número", { quantity: "tres" }],
    ["cantidad cero", { quantity: "0" }],
    ["sin concepto", { name: "   " }],
    ["sin negocio", { dealId: "" }],
  ] as const)
    await rechazaSinEscribir(nombre, () => linea(campos), quietoA);
  await frenaSinEscribir("negocio que no es un uuid", () => linea({ dealId: "no-soy-un-uuid" }), quietoA);

  /*
    El negocio de OTRA empresa. La llave foránea apunta a `crm_deals` de este
    esquema, así que el id ajeno no existe aquí: no se le cuelga una línea a un
    negocio de otro cliente aunque alguien conozca su id.
  */
  await frenaSinEscribir(
    "negocio de otra empresa",
    () => linea({ dealId: AD }),
    [...quietoA, AJENO_TODO],
  );

  seccion("addDealItem · con permiso, la línea se guarda y recalcula el negocio");
  await x.addDealItem(
    forma({
      dealId: A,
      name: `${TAG} Póliza`,
      quantity: "2",
      unitPriceMxn: "$1,250.50",
      discountPct: "10",
    }),
  );
  const [l1] = await filas<{ id: string; quantity: string; unit_price_mxn: string; discount_pct: string }>(
    `${LINEAS_A.replace("order by id", `and name = '${TAG} Póliza'`)}`,
  );
  ok("la línea está en la base", Boolean(l1));
  ok(
    "con el importe limpio de símbolos",
    l1?.quantity === "2.00" && l1?.unit_price_mxn === "1250.50" && l1?.discount_pct === "10.00",
    `${l1?.quantity} × ${l1?.unit_price_mxn} −${l1?.discount_pct}%`,
  );
  let [nA] = await filas<{ value_mxn: string | null }>(NEGOCIO(A));
  ok("y el negocio vale la suma de sus líneas (2 × 1250.50 − 10%)", nA?.value_mxn === "2250.90", nA?.value_mxn ?? "null");

  await x.addDealItem(forma({ dealId: A, name: `${TAG} Cortesía`, unitPriceMxn: "" }));
  const [l2] = await filas<{ id: string; unit_price_mxn: string; quantity: string }>(
    `${LINEAS_A.replace("order by id", `and name = '${TAG} Cortesía'`)}`,
  );
  ok(
    "precio vacío vale cero, y cantidad vacía vale uno",
    l2?.unit_price_mxn === "0.00" && l2?.quantity === "1.00",
    `${l2?.quantity} × ${l2?.unit_price_mxn}`,
  );
  [nA] = await filas<{ value_mxn: string | null }>(NEGOCIO(A));
  ok("y no mueve el valor", nA?.value_mxn === "2250.90", nA?.value_mxn ?? "null");
  ok(
    "nada de esto cayó en la empresa ajena",
    (await cuantos("crm_deal_products", `where name like '${TAG}%' and deal_id <> '${AD}'`, AJENO)) === 0,
  );

  if (!l1 || !l2) throw new Error("sin las líneas del camino feliz no se puede seguir");

  /* ─────────────────────────── deleteDealItem ─────────────────────────── */
  seccion("deleteDealItem · pide ventas:editar");
  const quitar = (id: string, dealId: string) => x.deleteDealItem(forma({ id, dealId }));
  como(null);
  await rechazaSinEscribir("sin sesión", () => quitar(l1.id, A), quietoA);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => quitar(l1.id, A), quietoA);
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("con ventas:ver", () => quitar(l1.id, A), quietoA);

  seccion("deleteDealItem · la línea y el negocio tienen que casar");
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("sin id", () => quitar("", A), quietoA);
  await frenaSinEscribir("id que no es un uuid", () => quitar("no-soy-un-uuid", A), quietoA);
  /*
    La línea de A con el negocio B. Borraba por `id` a secas y recalculaba B:
    A perdía la línea y se quedaba valiendo lo de antes —el importe fantasma que
    `recalcDealValue` dice haber matado— y el evento de auditoría apuntaba a B.
    Lo encontró este probe.
  */
  await rechazaSinEscribir(
    "la línea de un negocio con el id de otro",
    () => quitar(l1.id, B),
    [...quietoA, NEGOCIO(B)],
  );
  /*
    Una línea que no existe con un negocio de valor MANUAL. El recálculo corría
    aunque no se hubiera borrado nada, y un negocio sin líneas vale `null`: B
    perdía sus 5 000 capturados a mano. También lo encontró este probe.
  */
  await rechazaSinEscribir(
    "una línea que no existe no toca el valor manual del negocio",
    () => quitar(randomUUID(), B),
    [NEGOCIO(B)],
  );
  await rechazaSinEscribir(
    "la línea de otra empresa",
    () => quitar(AI, AD),
    [AJENO_TODO],
  );

  seccion("deleteDealItem · con permiso, borra, recalcula y firma");
  await quitar(l2.id, A);
  ok("la línea de cortesía se fue", (await cuantos("crm_deal_products", `where id = '${l2.id}'`)) === 0);
  [nA] = await filas<{ value_mxn: string | null }>(NEGOCIO(A));
  ok("el valor sigue siendo el de la otra línea", nA?.value_mxn === "2250.90", nA?.value_mxn ?? "null");
  await quitar(l1.id, A);
  [nA] = await filas<{ value_mxn: string | null }>(NEGOCIO(A));
  ok("sin líneas, el valor queda VACÍO y no en el de antes", nA?.value_mxn === null, nA?.value_mxn ?? "null");
  const ev = await eventoDeBaja("deal_product.deleted", l1.id);
  ok("la baja queda en la bitácora, firmada por la sesión", ev?.actor_id === ACTOR, String(ev?.actor_id));
  ok("con el negocio al que pertenecía", ev?.payload?.dealId === A, String(ev?.payload?.dealId));

  /* ═════════════════════════════ Etiquetas ═════════════════════════════ */
  seccion("createLabel · pide ventas:editar");
  const ETIQUETAS = `select count(*)::int n from ${ESQUEMA}.crm_labels where name like '${TAG}%'`;
  const etiqueta = (campos: Record<string, string> = {}) =>
    x.createLabel(forma({ name: `${TAG} Etiqueta`, color: "success", ...campos }));
  como(null);
  await rechazaSinEscribir("sin sesión", () => etiqueta(), [ETIQUETAS]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => etiqueta(), [ETIQUETAS]);
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("con ventas:ver", () => etiqueta(), [ETIQUETAS]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("sin nombre", () => etiqueta({ name: "   " }), [ETIQUETAS]);

  await etiqueta();
  const [lab] = await filas<{ id: string; color: string }>(
    `select id, color from ${ESQUEMA}.crm_labels where name = '${TAG} Etiqueta'`,
  );
  ok("con permiso, la etiqueta se crea con su color", lab?.color === "success", lab?.color);
  ok(
    "en esta empresa y no en la ajena",
    (await cuantos("crm_labels", `where name = '${TAG} Etiqueta'`, AJENO)) === 0,
  );
  if (!lab) throw new Error("sin etiqueta no se puede seguir");

  /* ─────────────────────────── toggleDealLabel ─────────────────────────── */
  seccion("toggleDealLabel · pide ventas:editar");
  const PUESTAS = `select count(*)::int n from ${ESQUEMA}.crm_deal_labels where deal_id = '${A}'`;
  const poner = (attach: "1" | "0", labelId = lab.id) =>
    x.toggleDealLabel(forma({ dealId: A, labelId, attach }));
  como(null);
  await rechazaSinEscribir("sin sesión", () => poner("1"), [PUESTAS]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => poner("1"), [PUESTAS]);
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("con ventas:ver", () => poner("1"), [PUESTAS]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("sin etiqueta", () => poner("1", ""), [PUESTAS]);
  await frenaSinEscribir("la etiqueta de otra empresa", () => poner("1", AL), [PUESTAS, AJENO_TODO]);

  await poner("1");
  ok("con permiso, la etiqueta queda puesta", (await cuantos("crm_deal_labels", `where deal_id = '${A}'`)) === 1);
  await poner("1");
  ok("ponerla otra vez no la duplica", (await cuantos("crm_deal_labels", `where deal_id = '${A}'`)) === 1);

  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("quitarla con ventas:ver", () => poner("0"), [PUESTAS]);
  como(ACTOR, "ventas:editar");
  await poner("0");
  ok("con permiso, se quita", (await cuantos("crm_deal_labels", `where deal_id = '${A}'`)) === 0);
  const evL = await eventoDeBaja("deal_label.removed", A, `and payload->>'labelId' = '${lab.id}'`);
  ok("y el retiro queda firmado por la sesión", evL?.actor_id === ACTOR, String(evL?.actor_id));

  /* ───────────────────────────── deleteLabel ───────────────────────────── */
  seccion("deleteLabel · pide ventas:administrar");
  const LA_ETIQUETA = `select id, name, color from ${ESQUEMA}.crm_labels where id = '${lab.id}'`;
  const borrarEtiqueta = () => x.deleteLabel(forma({ id: lab.id }));
  como(null);
  await rechazaSinEscribir("sin sesión", borrarEtiqueta, [LA_ETIQUETA]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", borrarEtiqueta, [LA_ETIQUETA]);
  /* Borrar una etiqueta la arranca de TODOS los negocios que la llevan. */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", borrarEtiqueta, [LA_ETIQUETA]);
  como(ACTOR, "ventas:administrar");
  await borrarEtiqueta();
  ok("con administrar, se borra", (await cuantos("crm_labels", `where id = '${lab.id}'`)) === 0);
  const evB = await eventoDeBaja("label.deleted", lab.id);
  ok("y la baja queda firmada por la sesión", evB?.actor_id === ACTOR, String(evB?.actor_id));

  /* ═════════════════════════════ Objetivos ═════════════════════════════ */
  seccion("createGoal · pide ventas:administrar");
  const OBJETIVOS = `select count(*)::int n from ${ESQUEMA}.crm_goals where name like '${TAG}%'`;
  const objetivo = (campos: Record<string, string> = {}) =>
    x.createGoal(
      forma({
        name: `${TAG} Objetivo`,
        target: "100000",
        metric: "revenue",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        ...campos,
      }),
    );
  como(null);
  await rechazaSinEscribir("sin sesión", () => objetivo(), [OBJETIVOS]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => objetivo(), [OBJETIVOS]);
  /* La meta es la vara con la que se mide a cada vendedor: no se la pone él. */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", () => objetivo(), [OBJETIVOS]);

  como(ACTOR, "ventas:administrar");
  for (const [nombre, campos] of [
    ["meta negativa", { target: "-100" }],
    ["meta que no es número", { target: "cien mil" }],
    ["meta cero", { target: "0" }],
    ["meta vacía", { target: "" }],
    ["sin nombre", { name: "" }],
    ["sin inicio de periodo", { periodStart: "" }],
    ["sin fin de periodo", { periodEnd: "" }],
  ] as const)
    await rechazaSinEscribir(nombre, () => objetivo(campos), [OBJETIVOS]);
  await frenaSinEscribir("dueño que no es un uuid", () => objetivo({ ownerId: "no-soy-un-uuid" }), [OBJETIVOS]);
  await frenaSinEscribir("embudo de otra empresa", () => objetivo({ pipelineId: AP }), [OBJETIVOS]);

  await objetivo({ target: "$150,000.50", metric: "count", pipelineId: P, ownerId: ACTOR });
  const [meta] = await filas<{
    id: string;
    target: string;
    metric: string;
    owner_id: string | null;
    pipeline_id: string | null;
    period_end: Date | string;
  }>(`select id, target, metric, owner_id, pipeline_id, period_end
        from ${ESQUEMA}.crm_goals where name = '${TAG} Objetivo'`);
  ok("con administrar, el objetivo se crea", Boolean(meta));
  ok("con la meta limpia de símbolos", meta?.target === "150000.50", meta?.target);
  ok(
    "con su métrica, su dueño y su embudo",
    meta?.metric === "count" && meta?.owner_id === ACTOR && meta?.pipeline_id === P,
    `${meta?.metric} · ${meta?.owner_id?.slice(0, 8)} · ${meta?.pipeline_id?.slice(0, 8)}`,
  );
  await objetivo({ name: `${TAG} Objetivo raro`, metric: "inventada" });
  const [raro] = await filas<{ metric: string }>(
    `select metric from ${ESQUEMA}.crm_goals where name = '${TAG} Objetivo raro'`,
  );
  ok("una métrica que no existe cae en ingresos", raro?.metric === "revenue", raro?.metric);
  ok(
    "y ninguno cayó en la empresa ajena",
    (await cuantos("crm_goals", `where name like '${TAG}%'`, AJENO)) === 0,
  );
  if (!meta) throw new Error("sin objetivo no se puede seguir");

  /* ───────────────────────────── deleteGoal ────────────────────────────── */
  seccion("deleteGoal · pide ventas:administrar");
  const EL_OBJETIVO = `select id, target from ${ESQUEMA}.crm_goals where id = '${meta.id}'`;
  const borrarObjetivo = () => x.deleteGoal(forma({ id: meta.id }));
  como(null);
  await rechazaSinEscribir("sin sesión", borrarObjetivo, [EL_OBJETIVO]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", borrarObjetivo, [EL_OBJETIVO]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", borrarObjetivo, [EL_OBJETIVO]);
  como(ACTOR, "ventas:administrar");
  await borrarObjetivo();
  ok("con administrar, se borra", (await cuantos("crm_goals", `where id = '${meta.id}'`)) === 0);
  const evG = await eventoDeBaja("goal.deleted", meta.id);
  ok("y la baja queda firmada por la sesión", evG?.actor_id === ACTOR, String(evG?.actor_id));

  /* ═══════════════════════ Plantillas de correo ═══════════════════════ */
  seccion("createEmailTemplate · pide ventas:editar");
  const PLANTILLAS = `select count(*)::int n from ${ESQUEMA}.crm_email_templates where name like '${TAG}%'`;
  const plantilla = (campos: Record<string, string> = {}) =>
    x.createEmailTemplate(
      forma({ name: `${TAG} Plantilla`, subject: "Seguimiento", body: "  Hola {{contacto}}  ", ...campos }),
    );
  como(null);
  await rechazaSinEscribir("sin sesión", () => plantilla(), [PLANTILLAS]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => plantilla(), [PLANTILLAS]);
  como(ACTOR, "ventas:ver");
  await rechazaSinEscribir("con ventas:ver", () => plantilla(), [PLANTILLAS]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("sin asunto", () => plantilla({ subject: "" }), [PLANTILLAS]);
  await rechazaSinEscribir("sin cuerpo", () => plantilla({ body: "   " }), [PLANTILLAS]);

  await plantilla();
  const [tpl] = await filas<{ id: string; body: string; created_by_id: string | null }>(
    `select id, body, created_by_id from ${ESQUEMA}.crm_email_templates where name = '${TAG} Plantilla'`,
  );
  ok("con permiso, la plantilla se crea", Boolean(tpl));
  ok("firmada por la sesión", tpl?.created_by_id === ACTOR, String(tpl?.created_by_id));
  ok("con el cuerpo sin espacios de sobra", tpl?.body === "Hola {{contacto}}", tpl?.body);
  if (!tpl) throw new Error("sin plantilla no se puede seguir");

  /* ───────────────────────── deleteEmailTemplate ───────────────────────── */
  seccion("deleteEmailTemplate · pide ventas:administrar");
  const LA_PLANTILLA = `select id, name, subject from ${ESQUEMA}.crm_email_templates where id = '${tpl.id}'`;
  const borrarPlantilla = () => x.deleteEmailTemplate(forma({ id: tpl.id }));
  como(null);
  await rechazaSinEscribir("sin sesión", borrarPlantilla, [LA_PLANTILLA]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", borrarPlantilla, [LA_PLANTILLA]);
  /*
    Se conformaba con «editar», el nivel del vendedor, cuando las otras tres
    bajas del archivo —etiqueta, objetivo, automatización— piden administrar, y
    la única pantalla que ofrece el botón exige configuración:administrar. La
    plantilla es de todo el equipo: con «editar» un vendedor borraba la de
    cualquiera llamando a la acción directamente. Lo encontró este probe.
  */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", borrarPlantilla, [LA_PLANTILLA]);
  como(ACTOR, "ventas:administrar");
  await borrarPlantilla();
  ok("con administrar, se borra", (await cuantos("crm_email_templates", `where id = '${tpl.id}'`)) === 0);
  const evT = await eventoDeBaja("email_template.deleted", tpl.id);
  ok("y la baja queda firmada por la sesión", evT?.actor_id === ACTOR, String(evT?.actor_id));

  /* ═════════════════════════ Automatizaciones ═════════════════════════ */
  seccion("createAutomation · pide ventas:administrar");
  const AUTOS = `select count(*)::int n from ${ESQUEMA}.crm_automations where name like '${TAG}%'`;
  const automatizar = (campos: Record<string, string> = {}) =>
    x.createAutomation(
      forma({
        name: `${TAG} Automatización`,
        triggerStageId: S,
        activityType: "meeting",
        activitySubject: "Llamar para agendar demo",
        dueInDays: "999",
        ...campos,
      }),
    );
  como(null);
  await rechazaSinEscribir("sin sesión", () => automatizar(), [AUTOS]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => automatizar(), [AUTOS]);
  /* Una automatización le agenda trabajo a TODO el equipo en cada movimiento. */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", () => automatizar(), [AUTOS]);

  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("sin nombre", () => automatizar({ name: "" }), [AUTOS]);
  await rechazaSinEscribir("sin etapa", () => automatizar({ triggerStageId: "" }), [AUTOS]);
  await rechazaSinEscribir("sin asunto de la actividad", () => automatizar({ activitySubject: " " }), [AUTOS]);
  await frenaSinEscribir("un tipo de actividad que no existe", () => automatizar({ activityType: "hackeo" }), [AUTOS]);
  await frenaSinEscribir("días que no son número", () => automatizar({ dueInDays: "mañana" }), [AUTOS]);
  await frenaSinEscribir("la etapa de otra empresa", () => automatizar({ triggerStageId: AS }), [AUTOS]);

  await automatizar();
  const [auto] = await filas<{
    id: string;
    trigger_stage_id: string;
    activity_type: string;
    due_in_days: number;
    active: boolean;
  }>(`select id, trigger_stage_id, activity_type, due_in_days, active
        from ${ESQUEMA}.crm_automations where name = '${TAG} Automatización'`);
  ok("con administrar, se crea", Boolean(auto));
  ok(
    "en su etapa, con su tipo y encendida",
    auto?.trigger_stage_id === S && auto?.activity_type === "meeting" && auto?.active === true,
  );
  ok("999 días se recortan a 365", auto?.due_in_days === 365, String(auto?.due_in_days));
  ok(
    "y no cayó en la empresa ajena",
    (await cuantos("crm_automations", `where name like '${TAG}%'`, AJENO)) === 0,
  );
  if (!auto) throw new Error("sin automatización no se puede seguir");

  /* ────────────────────────── toggleAutomation ─────────────────────────── */
  seccion("toggleAutomation · pide ventas:administrar");
  const LA_AUTO = `select id, active from ${ESQUEMA}.crm_automations where id = '${auto.id}'`;
  const apagar = () => x.toggleAutomation(forma({ id: auto.id, active: "0" }));
  como(null);
  await rechazaSinEscribir("sin sesión", apagar, [LA_AUTO]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", apagar, [LA_AUTO]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", apagar, [LA_AUTO]);
  como(ACTOR, "ventas:administrar");
  await apagar();
  let [estado] = await filas<{ active: boolean }>(LA_AUTO);
  ok("con administrar, se apaga", estado?.active === false);
  await x.toggleAutomation(forma({ id: auto.id, active: "1" }));
  [estado] = await filas<{ active: boolean }>(LA_AUTO);
  ok("y se vuelve a encender", estado?.active === true);

  /* ────────────────────────── deleteAutomation ─────────────────────────── */
  seccion("deleteAutomation · pide ventas:administrar");
  const borrarAuto = () => x.deleteAutomation(forma({ id: auto.id }));
  como(null);
  await rechazaSinEscribir("sin sesión", borrarAuto, [LA_AUTO]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", borrarAuto, [LA_AUTO]);
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", borrarAuto, [LA_AUTO]);
  como(ACTOR, "ventas:administrar");
  await borrarAuto();
  ok("con administrar, se borra", (await cuantos("crm_automations", `where id = '${auto.id}'`)) === 0);
  const evA = await eventoDeBaja("automation.deleted", auto.id);
  ok("y la baja queda firmada por la sesión", evA?.actor_id === ACTOR, String(evA?.actor_id));

  /* ═══════════════════════ Días de estancamiento ═══════════════════════ */
  seccion("updateStageRotting · pide ventas:administrar");
  const LA_ETAPA = `select id, rotting_days from ${ESQUEMA}.crm_stages where id = '${S}'`;
  const rotting = (dias: string, id = S) => x.updateStageRotting(forma({ id, rottingDays: dias }));
  como(null);
  await rechazaSinEscribir("sin sesión", () => rotting("30"), [LA_ETAPA]);
  como(ACTOR, false);
  await rechazaSinEscribir("sin permiso", () => rotting("30"), [LA_ETAPA]);
  /* Mover el umbral cambia qué negocios salen «podridos» en el tablero de todos. */
  como(ACTOR, "ventas:editar");
  await rechazaSinEscribir("con ventas:editar", () => rotting("30"), [LA_ETAPA]);

  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("sin etapa", () => rotting("30", ""), [LA_ETAPA]);
  await frenaSinEscribir("días que no son número", () => rotting("muchos"), [LA_ETAPA]);
  /* El id de una etapa ajena no existe en este esquema: el `update` no toca nada. */
  await rechazaSinEscribir("la etapa de otra empresa", () => rotting("30", AS), [LA_ETAPA, AJENO_TODO]);

  const dias = async () => (await filas<{ rotting_days: number }>(LA_ETAPA))[0]?.rotting_days;
  await rotting("14");
  ok("con administrar, se guarda", (await dias()) === 14, String(await dias()));
  await rotting("9999");
  ok("más de un año se recorta a 365", (await dias()) === 365, String(await dias()));
  await rotting("-5");
  ok("un negativo se queda en cero (sin límite)", (await dias()) === 0, String(await dias()));

  /* ── El cierre: la empresa ajena, intacta ─────────────────────────────── */
  seccion("la empresa ajena salió como entró");
  const [aj] = await filas<{ value_mxn: string; lineas: number; etiquetas: number; rotting: number }>(AJENO_TODO);
  ok(
    "su negocio, su línea, sus etiquetas y su etapa, sin tocar",
    aj?.value_mxn === "700.00" && aj?.lineas === 1 && aj?.etiquetas === 0 && aj?.rotting === 3,
    JSON.stringify(aj),
  );
});
