/**
 * LAS ACCIONES DE COMPRAS: PROVEEDORES, ÓRDENES Y SUSPENSIÓN.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-compras.ts
 *
 * Ocho de las nueve acciones de `lib/actions/purchasing.ts`. La novena,
 * `createSupplier`, la cubre `scripts/_probe-acciones.ts` y no se repite.
 *
 * ── EL REPARTO QUE SE ATA ──────────────────────────────────────────────────
 *
 * Soporte levanta, envía y recibe órdenes y corrige proveedores
 * (`compras:editar`): es quien sabe qué hace falta y quien abre la caja. Borrar
 * un proveedor, cancelar una orden y suspender o levantar una suspensión es de
 * administración (`compras:administrar`): son las que dejan huella hacia atrás
 * o cortan la relación con un tercero. Cada acción se llama con un escalón
 * menos del que exige, y el camino feliz con el nivel justo.
 *
 * ── LOS IMPORTES ───────────────────────────────────────────────────────────
 *
 * El costo de cada renglón se lee con `lib/importe.ts`. Lo que se comprueba es
 * que el formato de dinero se entienda («$1,250.50»), que VACÍO herede el
 * costo del catálogo —es una estimación de arranque, documentada en la
 * acción— y que un negativo o basura NO se conviertan en nada: ni en su valor
 * absoluto, que es lo que hacía la limpieza vieja, ni en el costo del catálogo.
 *
 * ── LO QUE NO SE REPITE ────────────────────────────────────────────────────
 *
 * Que no se reciba de más, que cancelar no revierta lo recibido, que a un
 * suspendido no se le envíe: reglas del dominio (`lib/domain/purchasing.ts`),
 * con su probe. Aquí solo lo que la acción aporta: guardia, nivel, validación
 * de la captura, firma y empresa.
 *
 * «Sin sesión» es `como(null, false)`: en la aplicación, sin sesión no hay
 * contexto y `puedeEn` dice «ninguno». Las dos acciones de suspensión
 * preguntan además por la sesión ellas mismas, y eso se comprueba aparte con
 * el permiso concedido.
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
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const M = marca("COM");
/** Un uuid bien formado que no es de nadie. */
const NADIE = "00000000-0000-4000-8000-000000000001";

/*
  Las acciones registran con `console.error` cada error que atrapan, con la
  pila entera. Aquí varios son justo lo que se busca —un id que no es uuid y
  Postgres que dice que no—, y veinte líneas de pila por cada uno esconden los
  ✓ y ✗. Se resumen en una línea; lo que no venga de una acción pasa intacto.
*/
const errorOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && /^\[compras\]/.test(args[0])) {
    const e = args[1] as { message?: string; cause?: { message?: string } } | undefined;
    const causa = e?.cause?.message ?? e?.message ?? String(e);
    console.log(`  · la acción registró ${args[0]} ${causa.split("\n")[0].slice(0, 90)}`);
    return;
  }
  errorOriginal(...args);
};

const uno = async (q: string): Promise<string> => {
  const [f] = await filas<{ id: string }>(q);
  if (!f) throw new Error(`el fixture no se creó: ${q.slice(0, 80)}`);
  return f.id;
};

void probar("compras: proveedores, órdenes y suspensión — guardia, nivel, captura y firma", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    La limpieza se registra ANTES de crear nada y por marca: si el probe
    revienta a medio camino, lo escrito se borra igual. Corre al revés de como
    se registra, que es el orden de las llaves foráneas: movimientos de
    inventario → órdenes (arrastran sus renglones) → proveedores → refacciones.
    Los eventos de la bitácora se quedan: `domain_events` es de solo anexar.
  */
  for (const esq of [ESQUEMA, AJENO]) {
    borrarAlFinal("spare_parts", `part_number like '${M}-%'`, esq);
    borrarAlFinal("suppliers", `name like '${M} %'`, esq);
  }
  borrarAlFinal("purchase_orders", `supplier_id in (select id from ${ESQUEMA}.suppliers where name like '${M} %')`);
  borrarAlFinal("purchase_orders", `notes like '%${M}%'`, AJENO);
  borrarAlFinal("inventory_movements", `part_id in (select id from ${ESQUEMA}.spare_parts where part_number like '${M}-%')`);

  /* ── Fixtures ─────────────────────────────────────────────────────────── */
  const P1 = await uno(
    `insert into ${ESQUEMA}.spare_parts (part_number, description, stock, cost_mxn)
     values ('${M}-P1', 'Refacción de prueba uno', 0, 100) returning id`,
  );
  const P2 = await uno(
    `insert into ${ESQUEMA}.spare_parts (part_number, description, stock, cost_mxn)
     values ('${M}-P2', 'Refacción de prueba dos', 0, 40) returning id`,
  );
  const proveedor = (nombre: string) =>
    uno(`insert into ${ESQUEMA}.suppliers (name) values ('${M} ${nombre}') returning id`);
  const S = await proveedor("Proveedor principal"); // órdenes, y al final la baja que desactiva
  const SE = await proveedor("Proveedor a corregir");
  const SB = await proveedor("Proveedor sin compras"); // la baja que sí borra
  const SS = await proveedor("Proveedor a suspender");
  const PA = await uno(
    `insert into ${AJENO}.spare_parts (part_number, description, stock) values ('${M}-AJ', 'Refacción ajena', 0) returning id`,
  );
  const SA = await uno(`insert into ${AJENO}.suppliers (name) values ('${M} Proveedor ajeno') returning id`);
  /** La fila ajena entera: ninguna acción de esta empresa debe moverla. */
  const FILA_SA = `select name, active, suspended_at, updated_at from ${AJENO}.suppliers where id = '${SA}'`;

  const c = await import("@/lib/actions/purchasing");
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

  /* ── 1 · Corregir un proveedor ────────────────────────────────────────── */
  seccion("corregir un proveedor: compras:editar");
  const FILA_SE = `select name, rfc, email, payment_terms_days, currency, notes, active, updated_at
                     from ${ESQUEMA}.suppliers where id = '${SE}'`;
  const BUENO = {
    supplierId: SE,
    name: `${M} Proveedor corregido`,
    // Sin espacios alrededor: el esquema mide el largo ANTES de recortar, y un
    // RFC de 13 con un espacio pegado se rechaza como «Revisa los datos».
    rfc: "aaa010101aa1",
    email: "Compras@Ejemplo.TEST",
    paymentTermsDays: "45",
    currency: "USD",
    notes: "  Paga a 45 días  ",
    active: "on",
  };
  const corregir = (cambios: Record<string, string | undefined> = {}) =>
    c.updateSupplier(inicial, forma({ ...BUENO, ...cambios }));

  await guardia("corregir", () => corregir(), [FILA_SE], "No tienes permiso para editar proveedores.", "compras:ver");
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("corregir sin decir cuál", () => corregir({ supplierId: undefined }), [FILA_SE], conError("Falta el proveedor."));
  await rechazaSinEscribir("corregir un id que no es uuid", () => corregir({ supplierId: "basura" }), [FILA_SE]);
  for (const [nombre, cambio] of [
    ["sin nombre", { name: "" }],
    ["con días de crédito negativos", { paymentTermsDays: "-5" }],
    ["con días de crédito que no son número", { paymentTermsDays: "treinta" }],
    ["con un correo que no es correo", { email: "no-es-correo" }],
    ["con una moneda que no existe", { currency: "MXP" }],
  ] as const)
    await rechazaSinEscribir(`corregir ${nombre}`, () => corregir(cambio), [FILA_SE], conError("Revisa los datos del proveedor."));
  /*
    El id viaja en el formulario y nada impide mandar el de un proveedor de otra
    empresa. No debe alcanzarlo: la conexión de la acción solo ve el esquema de
    la sesión, y ahí ese id no existe.
  */
  await rechazaSinEscribir(
    "corregir el proveedor de la empresa ajena",
    () => corregir({ supplierId: SA }),
    [FILA_SE, FILA_SA],
    conError("El proveedor no existe."),
  );

  let res = await corregir();
  type FilaSE = { name: string; rfc: string; email: string; payment_terms_days: number; currency: string; notes: string; active: boolean };
  let [fse] = await filas<FilaSE>(FILA_SE);
  ok("con «editar» se corrige", res.ok === true, res.error);
  ok(
    "se guarda normalizado: RFC en mayúsculas, correo en minúsculas, nota sin espacios",
    fse?.name === `${M} Proveedor corregido` && fse?.rfc === "AAA010101AA1" &&
      fse?.email === "compras@ejemplo.test" && fse?.notes === "Paga a 45 días",
    JSON.stringify(fse),
  );
  ok("con los días y la moneda nuevos", fse?.payment_terms_days === 45 && fse?.currency === "USD");
  res = await corregir({ active: undefined });
  [fse] = await filas<FilaSE>(FILA_SE);
  ok("sin la casilla de activo, queda inactivo y lo dice", res.ok && fse?.active === false, res.message);

  /* ── 2 · Dar de baja un proveedor ─────────────────────────────────────── */
  seccion("dar de baja un proveedor: compras:administrar");
  const FILA_SB = `select id, active from ${ESQUEMA}.suppliers where id = '${SB}'`;
  const baja = (supplierId?: string) => c.deleteSupplier(inicial, forma({ supplierId }));
  await guardia("dar de baja", () => baja(SB), [FILA_SB], "Solo un administrador da de baja proveedores.", "compras:editar");
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("dar de baja sin decir cuál", () => baja(), [FILA_SB], conError("Falta el proveedor."));
  await rechazaSinEscribir("dar de baja un id que no es uuid", () => baja("basura"), [FILA_SB]);
  await rechazaSinEscribir(
    "dar de baja el proveedor de la empresa ajena",
    () => baja(SA),
    [FILA_SB, FILA_SA],
    conError("El proveedor no existe."),
  );
  res = await baja(SB);
  ok("con «administrar», uno sin compras se borra de verdad", res.ok === true && (await filas(FILA_SB)).length === 0, res.message ?? res.error);
  const [evBaja] = await filas<{ actor_id: string | null; nombre: string | null }>(
    `select actor_id, payload->'snapshot'->>'name' as nombre from ${ESQUEMA}.domain_events
      where aggregate_id = '${SB}' and event_type = 'supplier.deleted'`,
  );
  ok(
    "y la bitácora guarda quién lo borró y qué había",
    evBaja?.actor_id === ACTOR && evBaja?.nombre === `${M} Proveedor sin compras`,
    JSON.stringify(evBaja),
  );

  /* ── 3 · Levantar una orden ───────────────────────────────────────────── */
  seccion("levantar una orden: compras:editar");
  const ORDENES_S = `select id from ${ESQUEMA}.purchase_orders where supplier_id = '${S}' order by id`;
  /*
    Tres renglones, el último vacío: es como llega del navegador, que siempre
    trae uno de sobra para poder agregar. Debe descartarse sin más.
  */
  const renglones = (costo1: string, parte1 = P1, cantidad1 = "2") => ({
    "line-part": [parte1, P2, ""],
    "line-qty": [cantidad1, "1", ""],
    "line-cost": [costo1, "", ""],
  });
  const levantar = (campos: Record<string, string | string[] | undefined> = {}) =>
    c.createPurchaseOrder(
      inicial,
      forma({
        supplierId: S,
        currency: "MXN",
        expectedAt: "2026-10-15",
        notes: `${M} orden de prueba`,
        ...renglones("$1,250.50"),
        ...campos,
      }),
    );

  await guardia("levantar", () => levantar(), [ORDENES_S], "No tienes permiso para crear órdenes de compra.", "compras:ver");
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("levantar con un proveedor que no es uuid", () => levantar({ supplierId: "basura" }), [ORDENES_S], conError("Elige un proveedor válido."));
  await rechazaSinEscribir(
    "levantar sin renglones",
    () => levantar({ "line-part": [""], "line-qty": [""], "line-cost": [""] }),
    [ORDENES_S],
    conError("Agrega al menos un renglón con refacción y cantidad."),
  );
  await rechazaSinEscribir(
    "levantar con cantidades en cero y negativas",
    () => levantar({ "line-part": [P1, P2], "line-qty": ["0", "-3"], "line-cost": ["", ""] }),
    [ORDENES_S],
    conError("Agrega al menos un renglón con refacción y cantidad."),
  );
  await rechazaSinEscribir(
    "levantar con una refacción que no es uuid",
    () => levantar(renglones("", "no-soy-un-uuid")),
    [ORDENES_S],
    conError("Un renglón apunta a una refacción inexistente."),
  );
  /*
    Un costo negativo o que no es número. Con la limpieza vieja «-50» entraba
    como 50; con `importeOpcional` el renglón lo descartaba en silencio y
    heredaba el costo del CATÁLOGO: se tecleaba -50 y se guardaba 100, con
    «Orden creada». Lo encontró este probe y se arregló en la acción.
  */
  for (const costo of ["-50", "abc", "12o"])
    await rechazaSinEscribir(
      `levantar con un costo «${costo}»`,
      () => levantar(renglones(costo)),
      [ORDENES_S],
      conError("Un renglón trae un costo que no es un importe."),
    );
  // Cada empresa tiene su catálogo y sus proveedores: los ids de otra no existen aquí.
  await rechazaSinEscribir(
    "levantar a un proveedor de la empresa ajena",
    () => levantar({ supplierId: SA }),
    [ORDENES_S],
    conError("El proveedor no existe."),
  );
  await rechazaSinEscribir(
    "levantar con una refacción de la empresa ajena",
    () => levantar(renglones("", PA)),
    [ORDENES_S],
    conError("Un renglón apunta a una refacción inexistente."),
  );

  res = await levantar();
  ok("con «editar» se levanta", res.ok === true, res.error);
  const O = res.orderId ?? NADIE;
  const [orden] = await filas<{ status: string; supplier_id: string; created_by_id: string | null; currency: string; expected_at: string }>(
    `select status, supplier_id, created_by_id, currency, expected_at::text from ${ESQUEMA}.purchase_orders where id = '${O}'`,
  );
  ok(
    "en borrador, del proveedor elegido y firmada por quien la levantó",
    orden?.status === "draft" && orden?.supplier_id === S && orden?.created_by_id === ACTOR,
    JSON.stringify(orden),
  );
  ok("con la moneda y la fecha esperada", orden?.currency === "MXN" && orden?.expected_at === "2026-10-15");
  const lineasO = await filas<{ id: string; part_id: string; quantity: number; unit_cost_mxn: string | null }>(
    `select id, part_id, quantity, unit_cost_mxn from ${ESQUEMA}.purchase_order_lines where order_id = '${O}'`,
  );
  const L1 = lineasO.find((l) => l.part_id === P1);
  const L2 = lineasO.find((l) => l.part_id === P2);
  ok("dos renglones: el vacío del final se descartó", lineasO.length === 2, `${lineasO.length}`);
  ok("«$1,250.50» se guarda como 1250.50", L1?.quantity === 2 && L1?.unit_cost_mxn === "1250.50", JSON.stringify(L1));
  ok("sin costo capturado, hereda el del catálogo", L2?.unit_cost_mxn === "40.00", JSON.stringify(L2));
  ok(
    `y nada cae en la empresa ajena (${AJENO})`,
    (await cuantos("purchase_orders", `where notes like '%${M}%'`, AJENO)) === 0,
  );

  /* ── 4 · Enviarla ─────────────────────────────────────────────────────── */
  seccion("enviar la orden: compras:editar");
  const FILA_O = `select status, sent_at, closed_at from ${ESQUEMA}.purchase_orders where id = '${O}'`;
  const enviar = (orderId?: string) => c.sendOrder(inicial, forma({ orderId }));
  await guardia("enviar", () => enviar(O), [FILA_O], "No tienes permiso.", "compras:ver");
  como(ACTOR, "compras:editar");
  await rechazaSinEscribir("enviar sin decir cuál", () => enviar(), [FILA_O]);
  await rechazaSinEscribir("enviar un id que no es uuid", () => enviar("basura"), [FILA_O]);
  res = await enviar(O);
  const [fo] = await filas<{ status: string; sent_at: Date | null }>(FILA_O);
  ok("con «editar» se envía", res.ok === true, res.error);
  ok("queda enviada, con la hora", fo?.status === "sent" && fo?.sent_at != null, fo?.status);
  const [evEnvio] = await filas<{ actor_id: string | null }>(
    `select actor_id from ${ESQUEMA}.domain_events where aggregate_id = '${O}' and event_type = 'purchase_order.sent'`,
  );
  ok("a nombre de quien la envió", evEnvio?.actor_id === ACTOR, String(evEnvio?.actor_id));
  await rechazaSinEscribir("enviarla otra vez", () => enviar(O), [FILA_O], conError("Solo se puede enviar una orden en borrador."));

  /* ── 5 · Recibir ──────────────────────────────────────────────────────── */
  seccion("recibir mercancía: compras:editar");
  /*
    Recibir es la única acción que mueve el inventario, así que la foto lleva
    las tres cosas que toca: el renglón, la existencia y el ledger.
  */
  const RECEPCION = [
    `select id, received_quantity from ${ESQUEMA}.purchase_order_lines where order_id = '${O}' order by id`,
    `select id, stock from ${ESQUEMA}.spare_parts where part_number like '${M}-%' order by id`,
    `select count(*)::int as n from ${ESQUEMA}.inventory_movements where part_id in ('${P1}', '${P2}')`,
    FILA_O,
  ];
  const recibir = (lineas: string[], cantidades: string[], orderId = O) =>
    c.receiveOrder(
      inicial,
      forma({ orderId, "receive-line": lineas, "receive-qty": cantidades, note: "  Llegó una caja  " }),
    );
  const L1id = L1?.id ?? NADIE;
  await guardia("recibir", () => recibir([L1id], ["1"]), RECEPCION, "No tienes permiso para recibir mercancía.", "compras:ver");
  como(ACTOR, "compras:editar");
  for (const q of ["-1", "abc", "0"])
    await rechazaSinEscribir(
      `recibir «${q}» piezas`,
      () => recibir([L1id], [q]),
      RECEPCION,
      conError("No indicaste ninguna cantidad a recibir."),
    );
  await rechazaSinEscribir("recibir media pieza", () => recibir([L1id], ["1.5"]), RECEPCION, conError("Las cantidades recibidas deben ser enteras."));
  await rechazaSinEscribir("recibir un renglón de otra orden", () => recibir([NADIE], ["1"]), RECEPCION, conError("Un renglón no pertenece a esta orden."));
  await rechazaSinEscribir("recibir contra una orden que no es uuid", () => recibir([L1id], ["1"], "basura"), RECEPCION);

  res = await recibir([L1id], ["1"]);
  ok("con «editar» se recibe", res.ok === true, res.error);
  const [mov] = await filas<{ kind: string; quantity: number; actor_id: string | null; note: string; unit_cost_mxn: string; purchase_order_line_id: string }>(
    `select kind, quantity, actor_id, note, unit_cost_mxn, purchase_order_line_id
       from ${ESQUEMA}.inventory_movements where part_id = '${P1}'`,
  );
  ok(
    "entra UN movimiento de compra, con el costo de la orden y ligado al renglón",
    mov?.kind === "purchase" && mov?.quantity === 1 && mov?.unit_cost_mxn === "1250.50" && mov?.purchase_order_line_id === L1id,
    JSON.stringify(mov),
  );
  ok("firmado por quien recibió, con la nota limpia", mov?.actor_id === ACTOR && mov?.note === "Llegó una caja", `${mov?.note}`);
  const [existencia] = await filas<{ stock: number }>(`select stock from ${ESQUEMA}.spare_parts where id = '${P1}'`);
  const [rec] = await filas<{ received_quantity: number }>(
    `select received_quantity from ${ESQUEMA}.purchase_order_lines where id = '${L1id}'`,
  );
  const [fo2] = await filas<{ status: string }>(FILA_O);
  ok(
    "sube la existencia, el renglón cuenta lo recibido y la orden queda parcial",
    existencia?.stock === 1 && rec?.received_quantity === 1 && fo2?.status === "partial",
    `stock ${existencia?.stock} · recibidas ${rec?.received_quantity} · ${fo2?.status}`,
  );

  /* ── 6 · Cancelar ─────────────────────────────────────────────────────── */
  seccion("cancelar la orden: compras:administrar, con motivo");
  const cancelar = (reason: string, orderId = O) => c.cancelOrder(inicial, forma({ orderId, reason }));
  await guardia("cancelar", () => cancelar("El proveedor no surte"), [FILA_O], "Solo un administrador cancela órdenes.", "compras:editar");
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("cancelar sin motivo", () => cancelar("   "), [FILA_O], conError("Escribe el motivo. Queda en el historial."));
  await rechazaSinEscribir("cancelar una orden que no es uuid", () => cancelar("El proveedor no surte", "basura"), [FILA_O]);
  res = await cancelar("  El proveedor no surte  ");
  const [fo3] = await filas<{ status: string; closed_at: Date | null }>(FILA_O);
  ok("con «administrar» se cancela", res.ok === true, res.error);
  ok("cancelada y cerrada", fo3?.status === "cancelled" && fo3?.closed_at != null, fo3?.status);
  const [evCancel] = await filas<{ actor_id: string | null; nota: string | null }>(
    `select actor_id, payload->>'note' as nota from ${ESQUEMA}.domain_events
      where aggregate_id = '${O}' and event_type = 'purchase_order.cancelled'`,
  );
  ok(
    "la bitácora dice quién y por qué",
    evCancel?.actor_id === ACTOR && evCancel?.nota === "El proveedor no surte",
    JSON.stringify(evCancel),
  );
  await rechazaSinEscribir("cancelarla otra vez", () => cancelar("Otra vez"), [FILA_O]);

  /* ── 7 · Suspender y levantar la suspensión ───────────────────────────── */
  const FILA_SS = `select suspended_at, suspend_reason, suspended_by_id, active from ${ESQUEMA}.suppliers where id = '${SS}'`;
  type FilaSS = { suspended_at: Date | null; suspend_reason: string | null; suspended_by_id: string | null; active: boolean };
  const suspender = (supplierId: string | undefined, reason = "Disputa de facturas") =>
    c.suspendSupplierAction(inicial, forma({ supplierId, reason }));
  const levantarSusp = (supplierId?: string) =>
    c.reinstateSupplierAction(inicial, forma({ supplierId, note: "  Ya se aclaró  " }));

  seccion("suspender: compras:administrar, y con sesión");
  /*
    Estas dos preguntan por la sesión además del permiso. Se comprueba con el
    permiso CONCEDIDO: es la única forma de ver que ese `if` existe y no es la
    guardia de `puedeEn` la que dice que no.
  */
  como(null, true);
  await rechazaSinEscribir(
    "suspender sin sesión aunque el permiso diga que sí",
    () => suspender(SS),
    [FILA_SS],
    conError("Solo un administrador suspende proveedores."),
  );
  await guardia("suspender", () => suspender(SS), [FILA_SS], "Solo un administrador suspende proveedores.", "compras:editar");
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("suspender sin decir cuál", () => suspender(undefined), [FILA_SS], conError("Falta el proveedor."));
  await rechazaSinEscribir("suspender sin motivo", () => suspender(SS, "  "), [FILA_SS]);
  await rechazaSinEscribir("suspender un id que no es uuid", () => suspender("basura"), [FILA_SS]);
  await rechazaSinEscribir(
    "suspender al proveedor de la empresa ajena",
    () => suspender(SA),
    [FILA_SS, FILA_SA],
    conError("El proveedor no existe."),
  );
  res = await suspender(SS, "  Disputa de facturas  ");
  let [fss] = await filas<FilaSS>(FILA_SS);
  ok("con «administrar» se suspende", res.ok === true, res.error);
  ok(
    "suspendido, con el motivo y firmado por quien suspendió",
    fss?.suspended_at != null && fss?.suspend_reason === "Disputa de facturas" && fss?.suspended_by_id === ACTOR,
    JSON.stringify(fss),
  );
  ok("y sigue activo: suspender no es dar de baja", fss?.active === true);
  await rechazaSinEscribir("suspenderlo otra vez", () => suspender(SS), [FILA_SS]);

  seccion("levantar la suspensión: compras:administrar, y con sesión");
  como(null, true);
  await rechazaSinEscribir(
    "levantar sin sesión aunque el permiso diga que sí",
    () => levantarSusp(SS),
    [FILA_SS],
    conError("Solo un administrador levanta la suspensión."),
  );
  await guardia("levantar la suspensión", () => levantarSusp(SS), [FILA_SS], "Solo un administrador levanta la suspensión.", "compras:editar");
  como(ACTOR, "compras:administrar");
  await rechazaSinEscribir("levantar sin decir cuál", () => levantarSusp(), [FILA_SS], conError("Falta el proveedor."));
  await rechazaSinEscribir("levantar un id que no es uuid", () => levantarSusp("basura"), [FILA_SS]);
  res = await levantarSusp(SS);
  [fss] = await filas<FilaSS>(FILA_SS);
  ok("con «administrar» se levanta", res.ok === true, res.error);
  ok(
    "sin rastro en el proveedor",
    fss?.suspended_at === null && fss?.suspend_reason === null && fss?.suspended_by_id === null,
    JSON.stringify(fss),
  );
  const [evLev] = await filas<{ actor_id: string | null; motivo: string | null; nota: string | null }>(
    `select actor_id, payload->>'motivoOriginal' as motivo, payload->>'nota' as nota
       from ${ESQUEMA}.domain_events where aggregate_id = '${SS}' and event_type = 'supplier.reinstated'`,
  );
  ok(
    "y en la bitácora: quién, el motivo original y la nota",
    evLev?.actor_id === ACTOR && evLev?.motivo === "Disputa de facturas" && evLev?.nota === "Ya se aclaró",
    JSON.stringify(evLev),
  );
  await rechazaSinEscribir("levantarla sin estar suspendido", () => levantarSusp(SS), [FILA_SS]);

  /* ── 8 · La baja de uno CON compras desactiva, no borra ───────────────── */
  seccion("la baja de un proveedor con órdenes lo desactiva");
  como(ACTOR, "compras:administrar");
  res = await baja(S);
  const [fs] = await filas<{ active: boolean }>(`select active from ${ESQUEMA}.suppliers where id = '${S}'`);
  ok(
    "responde ok, el proveedor sigue ahí e inactivo",
    res.ok === true && fs?.active === false && Boolean(res.message?.includes("desactivó")),
    res.message ?? res.error,
  );

  seccion("lo de la empresa ajena, intacto");
  const [sa] = await filas<{ name: string; active: boolean; suspended_at: Date | null }>(FILA_SA);
  ok(
    `el proveedor de ${AJENO} conserva su nombre, activo y sin suspender`,
    sa?.name === `${M} Proveedor ajeno` && sa?.active === true && sa?.suspended_at === null,
    JSON.stringify(sa),
  );
});
