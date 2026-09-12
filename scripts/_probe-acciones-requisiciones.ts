/**
 * LAS ACCIONES DE REQUISICIONES: QUIÉN PIDE, QUIÉN AUTORIZA, QUIÉN COMPRA.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-requisiciones.ts
 *
 * ── LO QUE VALE LA PENA ATAR AQUÍ ──────────────────────────────────────────
 *
 * El reparto de permisos ES el módulo (ver la cabecera de
 * `lib/actions/requisitions.ts`): pedir, editar el borrador y mandarlo a
 * autorizar es `compras:editar`; autorizar, rechazar, cancelar y convertir en
 * órdenes es `compras:administrar`. Si una sola de esas cuatro se conformara
 * con «editar», quien pide podría autorizarse a sí mismo y la requisición
 * dejaría de ser un control. Por eso cada acción se llama con EXACTAMENTE un
 * escalón menos del que exige, y el camino feliz se recorre con el nivel justo
 * —no con «todo concedido»—: así un nivel pedido de más también se ve.
 *
 * Además, lo que solo la capa de acción decide o puede romper:
 *
 *   · que un estado que no admite la transición no se mueva —aprobar un
 *     borrador, convertir algo sin autorizar— y que al negarse NO escriba;
 *   · que convertir dos veces no duplique órdenes, ni en serie ni con dos
 *     pulsaciones simultáneas del botón;
 *   · que un renglón no acepte una refacción ni un proveedor de OTRA empresa;
 *   · que lo escrito lleve la firma de quien tiene la sesión.
 *
 * La resta (pedido − existencia − en camino − en trámite), la sugerencia de
 * proveedor y la idempotencia del alta son reglas del dominio y las cubre
 * `scripts/check-requisitions.ts`; aquí no se repiten.
 *
 * ── «SIN SESIÓN» ES `como(null, false)` ────────────────────────────────────
 *
 * En la aplicación, sin sesión no hay contexto de empresa y `puedeEn` responde
 * «ninguno» (`getTenantContext` devuelve null). El stub, en cambio, concede por
 * omisión aunque no haya sesión, así que `como(null)` a secas modelaría un
 * estado imposible. Estas acciones no preguntan por la sesión aparte: confían
 * en `puedeEn`, que es lo correcto mientras el contexto real siga atado a ella.
 */
import {
  AJENO,
  ESQUEMA,
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
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const M = marca("REQ");
/** Un uuid bien formado que no es de nadie. */
const NADIE = "00000000-0000-4000-8000-000000000001";

/*
  Las acciones registran con `console.error` cada error que atrapan, con la
  pila entera. Aquí varios de esos errores son justo lo que se busca —una llave
  foránea que dice que no—, y veinte líneas de pila por cada uno esconden los
  ✓ y ✗. Se resumen en una línea; lo que no venga de una acción pasa intacto.
*/
const errorOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && /^\[(requisiciones|compras)\]/.test(args[0])) {
    const e = args[1] as { message?: string; cause?: { message?: string } } | undefined;
    const causa = e?.cause?.message ?? e?.message ?? String(e);
    console.log(`  · la acción registró ${args[0]} ${causa.split("\n")[0].slice(0, 90)}`);
    return;
  }
  errorOriginal(...args);
};

type Id = { id: string };
type FilaA = { part_id: string | null; supplier_id: string | null; supplier_reason: string | null; quantity: number };
type FilaR1 = {
  status: string;
  submitted_at: Date | null;
  approved_by_id: string | null;
  approved_at: Date | null;
};
const uno = async (q: string): Promise<string> => {
  const [f] = await filas<Id>(q);
  if (!f) throw new Error(`el fixture no se creó: ${q.slice(0, 80)}`);
  return f.id;
};

void probar("requisiciones: permisos por transición, estados, conversión y firma", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    La limpieza se registra ANTES de crear nada y por marca, no por id: si el
    probe revienta a medio fixture, lo que alcanzó a escribirse se borra igual.
    Corre en orden inverso, que es el que piden las llaves foráneas: órdenes →
    requisiciones → embudo (arrastra negocios y sus productos) → proveedores →
    refacciones.
  */
  for (const esq of [ESQUEMA, AJENO]) {
    borrarAlFinal("spare_parts", `part_number like '${M}-%'`, esq);
    borrarAlFinal("suppliers", `name like '${M} %'`, esq);
  }
  borrarAlFinal("crm_pipelines", `name like '${M} %'`);
  for (const esq of [ESQUEMA, AJENO])
    borrarAlFinal("requisitions", `title like '${M}%' or reference like '${M}%'`, esq);
  borrarAlFinal("purchase_orders", `supplier_id in (select id from ${ESQUEMA}.suppliers where name like '${M} %')`);
  borrarAlFinal("purchase_orders", `notes like '%${M}%'`, AJENO);

  /* ── Fixtures ─────────────────────────────────────────────────────────── */
  // La base sembrada no trae embudos: el negocio necesita uno y una etapa.
  const EMBUDO = await uno(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${M} embudo') returning id`,
  );
  const ETAPA = await uno(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name) values ('${EMBUDO}', 'Prueba') returning id`,
  );
  // Existencia cero: todo lo pedido hace falta y la resta no se mete en medio.
  const P1 = await uno(
    `insert into ${ESQUEMA}.spare_parts (part_number, description, stock, cost_mxn)
     values ('${M}-P1', 'Refacción de prueba uno', 0, 100) returning id`,
  );
  const P2 = await uno(
    `insert into ${ESQUEMA}.spare_parts (part_number, description, stock, cost_mxn)
     values ('${M}-P2', 'Refacción de prueba dos', 0, 40) returning id`,
  );
  const S1 = await uno(
    `insert into ${ESQUEMA}.suppliers (name, currency) values ('${M} Proveedor uno', 'MXN') returning id`,
  );
  // De la OTRA empresa: un renglón no debe poder apuntarles.
  const PA = await uno(
    `insert into ${AJENO}.spare_parts (part_number, description, stock) values ('${M}-AJ', 'Refacción ajena', 0) returning id`,
  );
  const SA = await uno(
    `insert into ${AJENO}.suppliers (name) values ('${M} Proveedor ajeno') returning id`,
  );
  const PEDIDO = await uno(
    `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id)
     values ('${M}-D1', 'Pedido de prueba', '${EMBUDO}', '${ETAPA}') returning id`,
  );
  await sql.unsafe(
    `insert into ${ESQUEMA}.crm_deal_products (deal_id, part_id, name, quantity) values
       ('${PEDIDO}', '${P1}', 'Refacción uno', 3),
       ('${PEDIDO}', null, 'Pieza escrita a mano', 2)`,
  );

  const r = await import("@/lib/actions/requisitions");
  const inicial = { ok: false };

  /** Los tres «no» de una guardia: sin sesión, sin permiso y un escalón abajo. */
  async function guardia(
    nombre: string,
    fn: () => Promise<unknown>,
    que: string[],
    mensaje: string,
    escalonMenos: string,
  ) {
    como(null, false);
    await rechazaSinEscribir(`${nombre}, sin sesión`, fn, que, conError(mensaje));
    como(ACTOR, false);
    await rechazaSinEscribir(`${nombre}, sin permiso`, fn, que, conError(mensaje));
    como(ACTOR, escalonMenos);
    await rechazaSinEscribir(`${nombre}, con «${escalonMenos}»`, fn, que, conError(mensaje));
  }

  /* ── 1 · Levantar la requisición desde el pedido ──────────────────────── */
  seccion("levantar desde el pedido: compras:editar");
  const DEL_PEDIDO = `select id, status from ${ESQUEMA}.requisitions where deal_id = '${PEDIDO}' order by id`;
  const crear = (dealId: string) =>
    r.createRequisitionFromDealAction(
      inicial,
      forma({ dealId, neededBy: "2026-10-01", notes: "  Para la prueba  " }),
    );

  await guardia(
    "levantar",
    () => crear(PEDIDO),
    [DEL_PEDIDO],
    "No tienes permiso para levantar requisiciones.",
    "compras:ver",
  );
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("levantar con un pedido que no es uuid", () => crear("no-soy-un-uuid"), [DEL_PEDIDO], conError("Pedido inválido."));
  await rechazaSinEscribir("levantar con un pedido que no existe", () => crear(NADIE), [DEL_PEDIDO]);

  const alta = await crear(PEDIDO);
  ok("con «editar» basta para levantarla", alta.ok === true, alta.error);
  const R1 = alta.requisitionId ?? "";
  const [req] = await filas<{
    status: string;
    requested_by_id: string | null;
    needed_by: string | null;
    notes: string | null;
    reference: string;
  }>(
    `select status, requested_by_id, needed_by::text, notes, reference
       from ${ESQUEMA}.requisitions where id = '${R1 || NADIE}'`,
  );
  ok("devuelve el id y la fila existe, del pedido", Boolean(req), R1);
  ok("nace en borrador", req?.status === "draft", req?.status);
  ok("firmada por quien la pidió", req?.requested_by_id === ACTOR, String(req?.requested_by_id));
  ok(
    "con la fecha y la nota capturadas (la nota, sin espacios de sobra)",
    req?.needed_by === "2026-10-01" && req?.notes === "Para la prueba",
    `${req?.needed_by} · «${req?.notes}»`,
  );
  const lineas = await filas<{ id: string; part_id: string | null; quantity: number }>(
    `select id, part_id, quantity from ${ESQUEMA}.requisition_lines
      where requisition_id = '${R1 || NADIE}' order by part_id nulls last`,
  );
  const A = lineas.find((l) => l.part_id === P1)?.id ?? NADIE;
  const B = lineas.find((l) => l.part_id === null)?.id ?? NADIE;
  ok(
    "un renglón por producto del pedido: la refacción y la pieza escrita a mano",
    lineas.length === 2 && A !== NADIE && B !== NADIE,
    lineas.map((l) => `${l.part_id ? "catálogo" : "a mano"}×${l.quantity}`).join(", "),
  );
  ok(
    `y nada cae en la empresa ajena (${AJENO})`,
    (await cuantos("requisitions", `where title like '${M}%'`, AJENO)) === 0,
  );

  /* ── 2 · Editar el borrador ───────────────────────────────────────────── */
  seccion("resolver un renglón: compras:editar, y solo con cosas de esta empresa");
  const FILA_A = `select part_id, supplier_id, supplier_reason, quantity
                    from ${ESQUEMA}.requisition_lines where id = '${A}'`;
  const resolver = (campos: Record<string, string>) =>
    r.resolveRequisitionLine(inicial, forma({ lineId: A, ...campos }));

  await guardia(
    "resolver",
    () => resolver({ partId: P1, supplierId: S1, quantity: "5" }),
    [FILA_A],
    "Sin permiso.",
    "compras:ver",
  );

  como(ACTOR, "compras:editar");
  await rechazaSinEscribir(
    "resolver un renglón que no es uuid",
    () => r.resolveRequisitionLine(inicial, forma({ lineId: "basura", partId: P1 })),
    [FILA_A],
    conError("Renglón inválido."),
  );
  await rechazaSinEscribir(
    "resolver un renglón que no existe",
    () => r.resolveRequisitionLine(inicial, forma({ lineId: NADIE, partId: P1 })),
    [FILA_A],
    conError("El renglón no existe."),
  );
  /*
    Una refacción o un proveedor que NO son uuid se tomaban por «sin asignar»:
    `partId.success ? partId.data : null`. Mandar basura en el campo le BORRABA
    la refacción al renglón y respondía «Renglón actualizado». Lo encontró este
    probe y se arregló en la acción. Vacío sí es «sin asignar» —es lo que manda
    el selector— y eso se sigue aceptando abajo.
  */
  await rechazaSinEscribir(
    "resolver con una refacción que no es uuid",
    () => resolver({ partId: "no-soy-un-uuid", supplierId: S1 }),
    [FILA_A],
    conError("Refacción inválida."),
  );
  await rechazaSinEscribir(
    "resolver con un proveedor que no es uuid",
    () => resolver({ partId: P1, supplierId: "no-soy-un-uuid" }),
    [FILA_A],
    conError("Proveedor inválido."),
  );
  /*
    Lo que un uuid bien formado no garantiza es que sea de ESTA empresa. Lo
    detiene la llave foránea del esquema —cada empresa tiene sus tablas—, y es
    lo que se comprueba: si un día el renglón perdiera la llave, o la acción
    escribiera por otra conexión, esto se pondría rojo.
  */
  await rechazaSinEscribir(
    "resolver con una refacción de la empresa ajena",
    () => resolver({ partId: PA, supplierId: S1 }),
    [FILA_A],
  );
  await rechazaSinEscribir(
    "resolver con un proveedor de la empresa ajena",
    () => resolver({ partId: P1, supplierId: SA }),
    [FILA_A],
  );

  let res = await resolver({ partId: P1, supplierId: S1, quantity: "5" });
  let [fa] = await filas<FilaA>(FILA_A);
  ok("con «editar» se resuelve", res.ok === true, res.error);
  ok(
    "queda con la refacción, el proveedor elegido «a mano» y la cantidad nueva",
    fa?.part_id === P1 && fa?.supplier_id === S1 && fa?.supplier_reason === "Elegido a mano" && fa?.quantity === 5,
    JSON.stringify(fa),
  );
  res = await resolver({ partId: P1, supplierId: S1, quantity: "-4" });
  [fa] = await filas<FilaA>(FILA_A);
  ok("una cantidad negativa no se escribe", fa?.quantity === 5, String(fa?.quantity));

  res = await r.resolveRequisitionLine(inicial, forma({ lineId: B, partId: "", supplierId: "" }));
  ok("vacío sigue siendo «sin asignar», no un error", res.ok === true, res.error);

  seccion("quitar un renglón: compras:editar");
  // Un renglón de sobra, para poder quitarlo sin tocar los que se convierten.
  const X = await uno(
    `insert into ${ESQUEMA}.requisition_lines (requisition_id, description, quantity)
     values ('${R1 || NADIE}', 'Renglón de sobra', 1) returning id`,
  );
  const FILA_X = `select id from ${ESQUEMA}.requisition_lines where id = '${X}'`;
  const quitar = (lineId: string) => r.removeRequisitionLine(inicial, forma({ lineId }));
  await guardia("quitar", () => quitar(X), [FILA_X], "Sin permiso.", "compras:ver");
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("quitar un renglón que no es uuid", () => quitar("basura"), [FILA_X], conError("Renglón inválido."));
  res = await quitar(X);
  ok("con «editar» se quita", res.ok === true, res.error);
  ok("y el renglón ya no está", (await filas(FILA_X)).length === 0);

  /* ── 3 · El circuito ──────────────────────────────────────────────────── */
  const FILA_R1 = `select status, submitted_at, approved_by_id, approved_at, resolution_reason, closed_at
                     from ${ESQUEMA}.requisitions where id = '${R1 || NADIE}'`;
  const ORDENES_R1 = `select count(distinct order_id)::int as n from ${ESQUEMA}.purchase_order_lines
                       where requisition_line_id in (select id from ${ESQUEMA}.requisition_lines
                                                      where requisition_id = '${R1 || NADIE}')`;
  const LINEAS_R1 = `select id, ordered_quantity from ${ESQUEMA}.requisition_lines
                      where requisition_id = '${R1 || NADIE}' order by id`;
  const convertir = (id: string, lineIds?: string[]) =>
    r.convertRequisitionAction(inicial, forma({ id, lineId: lineIds }));
  const aprobar = (id: string) => r.approveRequisitionAction(inicial, forma({ id }));

  seccion("un borrador no se autoriza ni se convierte");
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("autorizar un borrador", () => aprobar(R1), [FILA_R1]);
  await rechazaSinEscribir("convertir un borrador", () => convertir(R1), [FILA_R1, ORDENES_R1, LINEAS_R1]);

  seccion("mandar a autorizar: compras:editar");
  const enviar = (id: string) => r.submitRequisitionAction(inicial, forma({ id }));
  await guardia("mandar a autorizar", () => enviar(R1), [FILA_R1], "Sin permiso.", "compras:ver");
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("mandar una requisición que no es uuid", () => enviar("basura"), [FILA_R1], conError("Requisición inválida."));
  res = await enviar(R1);
  let [fr] = await filas<FilaR1>(FILA_R1);
  ok("con «editar» se manda", res.ok === true, res.error);
  ok("queda por autorizar, con la hora de envío", fr?.status === "submitted" && fr?.submitted_at != null, fr?.status);
  const [evEnvio] = await filas<{ actor_id: string | null }>(
    `select actor_id from ${ESQUEMA}.domain_events
      where aggregate_id = '${R1 || NADIE}' and event_type = 'requisition.submitted'`,
  );
  ok("y el envío queda en la bitácora a nombre de quien lo mandó", evEnvio?.actor_id === ACTOR, String(evEnvio?.actor_id));

  seccion("enviada, el borrador ya no se toca");
  await rechazaSinEscribir(
    "resolver un renglón ya enviado",
    () => resolver({ partId: P2, supplierId: S1, quantity: "9" }),
    [FILA_A],
    conError("Solo se edita el borrador. Ya se mandó a autorizar."),
  );
  await rechazaSinEscribir(
    "quitar un renglón ya enviado",
    () => quitar(B),
    [`select id from ${ESQUEMA}.requisition_lines where id = '${B}'`],
    conError("Solo se edita el borrador."),
  );
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("convertir sin autorizar", () => convertir(R1), [FILA_R1, ORDENES_R1, LINEAS_R1]);

  seccion("autorizar: compras:administrar, y ningún otro módulo");
  await guardia(
    "autorizar",
    () => aprobar(R1),
    [FILA_R1],
    "Solo administración autoriza requisiciones.",
    "compras:editar",
  );
  // Administrar OTRO módulo no sirve: el permiso es por módulo, no un rango global.
  como(ACTOR, "pagar:administrar,inventario:administrar,compras:editar");
  await rechazaSinEscribir(
    "autorizar administrando pagos e inventario",
    () => aprobar(R1),
    [FILA_R1],
    conError("Solo administración autoriza requisiciones."),
  );
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("autorizar una requisición que no es uuid", () => aprobar("basura"), [FILA_R1], conError("Requisición inválida."));
  res = await aprobar(R1);
  [fr] = await filas<FilaR1>(FILA_R1);
  ok("con «administrar» se autoriza", res.ok === true, res.error);
  ok(
    "autorizada, firmada por quien autorizó y con la hora",
    fr?.status === "approved" && fr?.approved_by_id === ACTOR && fr?.approved_at != null,
    `${fr?.status} · ${String(fr?.approved_by_id).slice(0, 8)}`,
  );
  await rechazaSinEscribir("autorizarla otra vez", () => aprobar(R1), [FILA_R1]);

  /* ── 4 · Rechazar y cancelar ──────────────────────────────────────────── */
  /*
    Dos requisiciones más, escritas directo: la acción que se prueba es la de
    resolverlas, no la de crearlas, y crearlas por el pedido las haría
    depender de la resta.
  */
  const R2 = await uno(
    `insert into ${ESQUEMA}.requisitions (reference, title, status, submitted_at)
     values ('${M}-R2', '${M} por autorizar', 'submitted', now()) returning id`,
  );
  const R3 = await uno(
    `insert into ${ESQUEMA}.requisitions (reference, title) values ('${M}-R3', '${M} borrador') returning id`,
  );
  const fila = (id: string) =>
    `select status, resolution_reason, closed_at from ${ESQUEMA}.requisitions where id = '${id}'`;
  type Cierre = { status: string; resolution_reason: string | null; closed_at: Date | null };

  seccion("rechazar: compras:administrar, con motivo");
  const rechazar = (id: string, reason: string) =>
    r.rejectRequisitionAction(inicial, forma({ id, reason }));
  await guardia(
    "rechazar",
    () => rechazar(R2, "No hay presupuesto"),
    [fila(R2)],
    "Solo administración resuelve requisiciones.",
    "compras:editar",
  );
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("rechazar una requisición que no es uuid", () => rechazar("basura", "No hay presupuesto"), [fila(R2)], conError("Requisición inválida."));
  await rechazaSinEscribir("rechazar sin motivo", () => rechazar(R2, "   "), [fila(R2)]);
  await rechazaSinEscribir("rechazar un borrador", () => rechazar(R3, "No hay presupuesto"), [fila(R3)]);
  res = await rechazar(R2, "  No hay presupuesto  ");
  let [fc] = await filas<Cierre>(fila(R2));
  ok("con «administrar» se rechaza", res.ok === true, res.error);
  ok(
    "rechazada, cerrada y con el motivo limpio",
    fc?.status === "rejected" && fc?.closed_at != null && fc?.resolution_reason === "No hay presupuesto",
    JSON.stringify(fc),
  );
  const [evRechazo] = await filas<{ actor_id: string | null }>(
    `select actor_id from ${ESQUEMA}.domain_events
      where aggregate_id = '${R2}' and event_type = 'requisition.rejected'`,
  );
  ok("el rechazo queda a nombre de quien rechazó", evRechazo?.actor_id === ACTOR, String(evRechazo?.actor_id));

  seccion("cancelar: compras:administrar, con motivo");
  const cancelar = (id: string, reason: string) =>
    r.cancelRequisitionAction(inicial, forma({ id, reason }));
  await guardia(
    "cancelar",
    () => cancelar(R3, "Se cayó el pedido"),
    [fila(R3)],
    "Solo administración cancela requisiciones.",
    "compras:editar",
  );
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("cancelar una requisición que no es uuid", () => cancelar("basura", "Se cayó el pedido"), [fila(R3)], conError("Requisición inválida."));
  await rechazaSinEscribir("cancelar sin motivo", () => cancelar(R3, ""), [fila(R3)]);
  await rechazaSinEscribir("cancelar una ya rechazada", () => cancelar(R2, "Se cayó el pedido"), [fila(R2)]);
  res = await cancelar(R3, "Se cayó el pedido");
  [fc] = await filas<Cierre>(fila(R3));
  ok("con «administrar» se cancela", res.ok === true, res.error);
  ok(
    "cancelada, cerrada y con el motivo",
    fc?.status === "cancelled" && fc?.closed_at != null && fc?.resolution_reason === "Se cayó el pedido",
    JSON.stringify(fc),
  );

  /* ── 5 · Convertir en órdenes ─────────────────────────────────────────── */
  seccion("convertir: compras:administrar");
  await guardia(
    "convertir",
    () => convertir(R1),
    [FILA_R1, ORDENES_R1, LINEAS_R1],
    "Solo administración genera órdenes de compra.",
    "compras:editar",
  );
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir(
    "convertir una requisición que no es uuid",
    () => convertir("basura"),
    [FILA_R1, ORDENES_R1, LINEAS_R1],
    conError("Requisición inválida."),
  );

  const conv = await convertir(R1);
  ok("con «administrar» se convierte", conv.ok === true, conv.error);
  ok(
    "y avisa del renglón que no pudo llevarse (la pieza sin catálogo)",
    conv.omitidas?.length === 1 && conv.omitidas[0].description === "Pieza escrita a mano",
    JSON.stringify(conv.omitidas),
  );
  const ordenes = await filas<{
    id: string;
    status: string;
    supplier_id: string;
    created_by_id: string | null;
    currency: string;
    expected_at: string | null;
  }>(
    `select distinct o.id, o.status, o.supplier_id, o.created_by_id, o.currency, o.expected_at::text
       from ${ESQUEMA}.purchase_orders o
       join ${ESQUEMA}.purchase_order_lines l on l.order_id = o.id
      where l.requisition_line_id = '${A}'`,
  );
  const o = ordenes[0];
  ok("sale UNA orden, del proveedor elegido", ordenes.length === 1 && o?.supplier_id === S1, `${ordenes.length}`);
  ok(
    "en borrador, firmada por quien convirtió, con la fecha en que se necesita",
    o?.status === "draft" && o?.created_by_id === ACTOR && o?.expected_at === "2026-10-01",
    `${o?.status} · ${String(o?.created_by_id).slice(0, 8)} · ${o?.expected_at}`,
  );
  const [lo] = await filas<{ part_id: string; quantity: number; unit_cost_mxn: string | null }>(
    `select part_id, quantity, unit_cost_mxn from ${ESQUEMA}.purchase_order_lines where requisition_line_id = '${A}'`,
  );
  ok(
    "el renglón de la orden lleva la refacción, la cantidad resuelta y el costo del catálogo",
    lo?.part_id === P1 && lo?.quantity === 5 && lo?.unit_cost_mxn === "100.00",
    JSON.stringify(lo),
  );
  [fr] = await filas<FilaR1>(FILA_R1);
  ok("la requisición queda parcial: la pieza sin catálogo sigue pendiente", fr?.status === "partial", fr?.status);

  /*
    La segunda pulsación. `partial` SÍ admite convertir —es como se termina una
    requisición a la que le faltaba un renglón—, así que aquí no protege el
    estado sino que lo ya convertido cuente como convertido. Si no, cada clic
    sacaría otra orden por las mismas cinco piezas.
  */
  await rechazaSinEscribir(
    "convertirla otra vez",
    () => convertir(R1),
    [FILA_R1, ORDENES_R1, LINEAS_R1],
    conError("No se generó ninguna orden: ningún renglón estaba listo."),
  );
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir(
    "quitar un renglón que ya es orden",
    () => quitar(A),
    [LINEAS_R1],
    conError("Ese renglón ya se convirtió en orden. Cancela la orden, no el renglón."),
  );

  /*
    Y la pulsación DOBLE: dos conversiones de la misma requisición a la vez, que
    es lo que hace un botón sin deshabilitar o una red lenta. Cada una lee
    «autorizada, nada convertido» antes de que la otra confirme, y si nada las
    serializa, las dos sacan su orden.

    Este probe lo encontró en rojo. Medido antes del arreglo: dos órdenes por
    el mismo renglón de 2 piezas, las dos respuestas «ok», tres de tres
    corridas. Y no se ve en ninguna parte, porque `ordered_quantity` se fija en
    valor absoluto (`= quantity`) y no se suma: el renglón dice «2 de 2
    pedidas» con 4 pedidas al proveedor. `convertToPurchaseOrders`
    (`lib/domain/requisitions.ts`) leía la requisición sin candado; ahora, con
    `.for("update")` en ese primer `select`, la segunda espera, vuelve a leer
    los renglones ya convertidos y no saca nada.
  */
  seccion("dos conversiones simultáneas sacan UNA orden");
  const R4 = await uno(
    `insert into ${ESQUEMA}.requisitions (reference, title, status, approved_at, approved_by_id)
     values ('${M}-R4', '${M} autorizada', 'approved', now(), '${ACTOR}') returning id`,
  );
  await sql.unsafe(
    `insert into ${ESQUEMA}.requisition_lines (requisition_id, part_id, supplier_id, description, quantity)
     values ('${R4}', '${P2}', '${S1}', 'Refacción de prueba dos', 2)`,
  );
  const ORDENES_R4 = `select count(*)::int as n from ${ESQUEMA}.purchase_orders where notes like '%${M}-R4.%'`;
  como(ACTOR, "compras:administrar");
  /*
    EL SOLAPE SE FUERZA, NO SE ESPERA.

    Lanzar las dos a la vez y ya salía rojo nueve veces de diez: la décima, la
    segunda tardó en abrir su conexión y la primera ya había confirmado. Una
    prueba de carrera que depende del reloj da verdes que no significan nada.

    Se retiene con `for update` la fila de NUESTRO proveedor. El `insert` de la
    orden comprueba la llave foránea con `for key share` sobre esa fila, así que
    cada conversión se detiene justo DESPUÉS de haber leído «autorizada, nada
    convertido» y antes de escribir. Cuando las dos están esperando, se suelta.
    Sin candado en el dominio, las dos siguen y sacan su orden; con él, la
    segunda está esperando en la requisición, no aquí, y al pasar ya la ve
    convertida. Solo se bloquea el proveedor del fixture: las pruebas que
    corren en paralelo no lo ven.
  */
  let soltar = () => {};
  let tomado = () => {};
  const yaTomado = new Promise<void>((ok) => (tomado = ok));
  const candado = sql.begin(async (tx) => {
    await tx.unsafe(`select id from ${ESQUEMA}.suppliers where id = '${S1}' for update`);
    tomado();
    await new Promise<void>((ok) => (soltar = ok));
  });
  await yaTomado;
  const enVuelo = Promise.all([intentar(() => convertir(R4)), intentar(() => convertir(R4))]);
  const esperando = async () => {
    const [f] = await filas<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and (query ilike '%purchase_orders%' or query ilike '%requisitions%')`,
    );
    return f?.n ?? 0;
  };
  for (let t = 0; t < 60 && (await esperando()) < 2; t++) await new Promise((ok) => setTimeout(ok, 50));
  soltar();
  await candado;
  const dobles = await enVuelo;
  const [{ n: nR4 }] = await filas<{ n: number }>(ORDENES_R4);
  ok(
    "dos pulsaciones a la vez dejan una sola orden",
    nR4 === 1,
    `${nR4} órdenes; respuestas: ${dobles.map((d) => (d.valor?.ok ? "ok" : (d.valor?.error ?? d.error))).join(" / ")}`,
  );
  const [lr4] = await filas<{ quantity: number; pedidas: number }>(
    `select l.quantity, coalesce(sum(ol.quantity), 0)::int as pedidas
       from ${ESQUEMA}.requisition_lines l
       left join ${ESQUEMA}.purchase_order_lines ol on ol.requisition_line_id = l.id
      where l.requisition_id = '${R4}' group by l.id, l.quantity`,
  );
  ok(
    "y al proveedor se le piden las piezas del renglón, no el doble",
    lr4?.pedidas === lr4?.quantity,
    `renglón de ${lr4?.quantity}, pedidas ${lr4?.pedidas}`,
  );
  await rechazaSinEscribir(
    "convertir una requisición ya convertida entera",
    () => convertir(R4),
    [ORDENES_R4, fila(R4)],
    conError("Solo se convierte una requisición autorizada. Pide la autorización primero."),
  );

  seccion("lo convertido no sale de la empresa");
  ok(
    `la empresa ajena (${AJENO}) no tiene órdenes de estas requisiciones`,
    (await cuantos("purchase_orders", `where notes like '%${M}%'`, AJENO)) === 0,
  );
});
