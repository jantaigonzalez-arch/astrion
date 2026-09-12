/**
 * LAS ACCIONES DE CUENTAS POR PAGAR.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-pagar.ts
 *
 * Doce acciones en `lib/actions/payables.ts`. `_probe-acciones` ya cubre la
 * guardia y el camino feliz de `createSupplierInvoice`; aquí va todo lo demás:
 * pagos, cancelaciones, notas de crédito, anticipos, sus aplicaciones y la
 * marcha atrás, la división en parcialidades y la importación masiva.
 *
 * ── QUÉ SE COMPRUEBA, Y QUÉ NO ────────────────────────────────────────────
 *
 * La capa de acción: que sin sesión, sin permiso o con «pagar:editar» nada se
 * mueva —las doce piden «administrar», porque reconocer una deuda o sacar
 * dinero no es trabajo del día—, que la captura inválida se rechace sin dejar
 * rastro, que el camino feliz escriba las columnas que tiene que escribir y las
 * firme quien tiene la sesión, y que no se salga de la empresa.
 *
 * Lo que NO: no pagar de más, el CFDI repetido, que el saldo salga del ledger.
 * Eso lo cubren `probe-payables`, `probe-unapply` y `_probe-budget` contra el
 * dominio; repetirlo aquí sería mantener dos pruebas para enterarse de lo mismo.
 *
 * ── LA FOTO ES TODO LO QUE CUELGA DEL PROVEEDOR DE PRUEBA ─────────────────
 *
 * Casi todas estas acciones ACTUALIZAN —el estado de la factura, el de la nota,
 * el vencimiento— además de insertar, así que contar filas no bastaría: un
 * `update` que se colara no movería ningún conteo. La foto lleva las filas del
 * proveedor de prueba con su `updated_at`, los renglones de los ledgers y los
 * eventos de sus documentos. Y se acota a ESE proveedor, no a las tablas
 * enteras: otras pruebas escriben en la misma base a la vez.
 *
 * ── EL IMPORTE ────────────────────────────────────────────────────────────
 *
 * El esquema `importe` y `splitInvoiceAction` leen ahora con `lib/importe.ts`.
 * Antes «mil pesos» se leía como 0 —y un cero pasaba la validación para caer
 * luego en un error del dominio que no hablaba de lo tecleado— y la división
 * limpiaba con `[^0-9.]`, que convertía «-1000» en 1000. Las secciones de pago,
 * notas, anticipos y parcialidades atan las dos cosas.
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
  foto,
  intentar,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const S = ESQUEMA;
const TAG = marca("CXP");

/** Una sola fila de una consulta cruda. */
async function una<T = Record<string, unknown>>(q: string): Promise<T | undefined> {
  return (await filas<T>(q))[0];
}

/** El id de lo que devuelve un `insert … returning id`. */
async function alta(q: string): Promise<string> {
  const f = await una<{ id: string }>(q);
  if (!f) throw new Error(`el alta de la prueba no devolvió id: ${q.slice(0, 80)}`);
  return f.id;
}

/** El actor del último evento de un documento con ese tipo. */
async function actorDelEvento(aggregateId: string, tipo: string): Promise<string | null> {
  const f = await una<{ actor_id: string | null }>(
    `select actor_id from ${S}.domain_events
      where aggregate_id = '${aggregateId}' and event_type = '${tipo}'
      order by id desc limit 1`,
  );
  return f?.actor_id ?? null;
}

void probar("cuentas por pagar: guardia, nivel, validación, firma y aislamiento", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /* ── 0 · los documentos de trabajo ─────────────────────────────────────── */
  /*
    Todo cuelga de UN proveedor inventado, con un RFC que solo existe en esta
    corrida: así la importación lo encuentra a él y a nadie más, y la limpieza
    se lleva todo tirando de un solo hilo.

    Las facturas y la nota a cancelar se siembran por SQL y no con las acciones:
    lo que se prueba de cada acción tiene que partir de un estado conocido, no
    del resultado de otra acción bajo prueba.
  */
  const RFC = TAG.replace(/-/g, "");
  const SID = await alta(
    `insert into ${S}.suppliers (name, rfc, payment_terms_days)
     values ('${TAG} Proveedor', '${RFC}', 30) returning id`,
  );
  const FACTURAS = `(select id from ${S}.supplier_invoices where supplier_id = '${SID}')`;

  // Se registran en este orden para que se ejecuten al revés: primero los
  // renglones de los ledgers, luego los documentos, al final el proveedor. Las
  // llaves foráneas de pagos y aplicaciones son RESTRICT.
  borrarAlFinal("suppliers", `id = '${SID}'`);
  borrarAlFinal("supplier_advances", `supplier_id = '${SID}'`);
  borrarAlFinal("supplier_credit_notes", `supplier_id = '${SID}'`);
  borrarAlFinal("supplier_invoices", `supplier_id = '${SID}'`);
  borrarAlFinal("payable_imports", `file_name like '${TAG}%'`);
  borrarAlFinal("supplier_invoice_installments", `invoice_id in ${FACTURAS}`);
  borrarAlFinal("supplier_payments", `invoice_id in ${FACTURAS}`);
  borrarAlFinal("supplier_credit_note_applications", `invoice_id in ${FACTURAS}`);
  borrarAlFinal("supplier_advance_applications", `invoice_id in ${FACTURAS}`);

  const factura = (n: string) =>
    alta(
      `insert into ${S}.supplier_invoices
         (reference, supplier_id, subtotal, tax_total, total, issued_at, due_at, status, notes)
       values ('${TAG}-${n}', '${SID}', 1000, 160, 1160, '2026-08-01', '2026-08-31',
               'pending', '${TAG}') returning id`,
    );
  const F_PAGO = await factura("F1");
  const F_CANCELAR = await factura("F2");
  const F_DIVIDIR = await factura("F3");
  const F_NOTA = await factura("F4");
  const F_ANTICIPO = await factura("F5");
  const N_CANCELAR = await alta(
    `insert into ${S}.supplier_credit_notes
       (reference, supplier_id, subtotal, tax_total, total, issued_at, status, notes)
     values ('${TAG}-N2', '${SID}', 100, 0, 100, '2026-08-01', 'open', '${TAG}') returning id`,
  );

  /*
    El estado entero del proveedor de prueba. Es la foto de TODAS las
    comprobaciones de rechazo: si una acción rechazada movió cualquier cosa de
    las que estas doce pueden mover, sale aquí.
  */
  const ESTADO = [
    `select id, status, due_at::text, cancel_reason, updated_at
       from ${S}.supplier_invoices where supplier_id = '${SID}' order by reference`,
    `select id, amount::text from ${S}.supplier_payments
      where invoice_id in ${FACTURAS} order by id`,
    `select invoice_id, seq, amount::text, due_at::text from ${S}.supplier_invoice_installments
      where invoice_id in ${FACTURAS} order by invoice_id, seq`,
    `select id, status, cancel_reason, updated_at
       from ${S}.supplier_credit_notes where supplier_id = '${SID}' order by reference`,
    `select id, status, updated_at
       from ${S}.supplier_advances where supplier_id = '${SID}' order by reference`,
    `select id, amount::text from ${S}.supplier_credit_note_applications
      where invoice_id in ${FACTURAS} order by id`,
    `select id, amount::text from ${S}.supplier_advance_applications
      where invoice_id in ${FACTURAS} order by id`,
    `select count(*)::int as eventos from ${S}.domain_events
      where aggregate_id in (
        select id from ${S}.supplier_invoices where supplier_id = '${SID}'
        union all select id from ${S}.supplier_credit_notes where supplier_id = '${SID}'
        union all select id from ${S}.supplier_advances where supplier_id = '${SID}')`,
    `select count(*)::int as lotes from ${S}.payable_imports where file_name like '${TAG}%'`,
  ];

  const pagar = await import("@/lib/actions/payables");
  const inicial = { ok: false };
  type Resultado = { ok: boolean; error?: string; message?: string };

  /**
   * Los tres rechazos de la guardia, con el mensaje propio de cada acción.
   *
   * `fn` lleva datos BUENOS contra los documentos de prueba: si la guardia
   * dejara pasar, la acción escribiría de verdad y la foto lo vería. Con datos
   * malos, el rechazo podría venir de la validación y la guardia quedaría sin
   * probar —es justo lo que le pasó a `_probe-acciones` en su primera versión—.
   *
   * El tercero es el escalón de menos: «pagar:editar» es lo que tiene quien
   * captura el día a día, y ninguna de estas doce es de ese día a día.
   */
  async function guardia<T>(nombre: string, mensaje: string, fn: () => Promise<T>) {
    como(null);
    await rechazaSinEscribir(`${nombre}, sin sesión`, fn, ESTADO, conError(mensaje));
    como(ACTOR, false);
    await rechazaSinEscribir(`${nombre}, sin permiso`, fn, ESTADO, conError(mensaje));
    como(ACTOR!, "pagar:editar");
    await rechazaSinEscribir(`${nombre}, con «pagar:editar»`, fn, ESTADO, conError(mensaje));
    como(ACTOR!, "pagar:administrar");
  }

  /** Rechazo por validación: con permiso, la captura mala no deja rastro. */
  const invalida = <T>(nombre: string, fn: () => Promise<T>, mensaje?: string) =>
    rechazaSinEscribir(nombre, fn, ESTADO, mensaje ? conError(mensaje) : undefined);

  /* ── 1 · createSupplierInvoice: lo que `_probe-acciones` no cubre ──────── */
  seccion("factura de proveedor: el escalón y el importe que no es número");
  const facturaBuena = (extra: Record<string, string> = {}) =>
    forma({
      supplierId: SID,
      supplierFolio: `${TAG}-NUEVA`,
      subtotal: "1000",
      taxTotal: "160",
      total: "1160",
      issuedAt: "2026-08-01",
      ...extra,
    });
  como(ACTOR, "pagar:editar");
  await rechazaSinEscribir(
    "capturar factura con «pagar:editar»",
    () => pagar.createSupplierInvoice(inicial, facturaBuena()),
    ESTADO,
    conError("Solo un administrador captura facturas de proveedor."),
  );
  // «Mil pesos» era un total de CERO: pasaba el esquema y el rechazo lo daba el
  // dominio («debe ser mayor que cero»). Ahora se rechaza donde se lee.
  como(ACTOR, "pagar:administrar");
  await invalida(
    "factura con total «mil pesos»",
    () => pagar.createSupplierInvoice(inicial, facturaBuena({ total: "mil pesos" })),
    "Revisa los datos de la factura.",
  );

  /* ── 2 · payInvoice ────────────────────────────────────────────────────── */
  seccion("pago de factura");
  const pagoBueno = (extra: Record<string, string> = {}) =>
    forma({
      invoiceId: F_PAGO,
      amount: "$160.00",
      method: "check",
      reference: `CHQ-${TAG}`,
      paidAt: "2026-08-10",
      note: `${TAG} primer pago`,
      ...extra,
    });
  await guardia("pago", "Solo un administrador registra pagos.", () =>
    pagar.payInvoice(inicial, pagoBueno()),
  );
  await invalida(
    "pago a una factura que no es uuid",
    () => pagar.payInvoice(inicial, pagoBueno({ invoiceId: "no-soy-un-uuid" })),
    "Revisa los datos del pago.",
  );
  await invalida(
    "pago sin fecha",
    () => pagar.payInvoice(inicial, pagoBueno({ paidAt: "" })),
    "Revisa los datos del pago.",
  );
  await invalida(
    "pago de «mil pesos»",
    () => pagar.payInvoice(inicial, pagoBueno({ amount: "mil pesos" })),
    "Revisa los datos del pago.",
  );
  // El signo se conserva hasta el dominio, que es quien dice que un pago
  // negativo no existe. Lo que importa aquí es que «-160» NO llegue como 160.
  await invalida(
    "pago de «-160»",
    () => pagar.payInvoice(inicial, pagoBueno({ amount: "-160" })),
    "El pago debe ser mayor que cero.",
  );

  let r: Resultado = await pagar.payInvoice(inicial, pagoBueno());
  ok("el pago se registra", r.ok === true, r.error);
  ok("y dice cuánto queda", r.message === "Pago registrado. Quedan 1000.00 por pagar.", r.message);
  const pago = await una<Record<string, string | null>>(
    `select amount::text, balance_after::text, method::text, reference, paid_at::text, note, actor_id
       from ${S}.supplier_payments where invoice_id = '${F_PAGO}'`,
  );
  ok(
    "el renglón lleva el importe limpio y el saldo que deja",
    pago?.amount === "160.00" && pago?.balance_after === "1000.00",
    `${pago?.amount} / ${pago?.balance_after}`,
  );
  ok(
    "con método, referencia, fecha y nota de la captura",
    pago?.method === "check" &&
      pago?.reference === `CHQ-${TAG}` &&
      pago?.paid_at === "2026-08-10" &&
      pago?.note === `${TAG} primer pago`,
  );
  ok("firmado por quien tiene la sesión", pago?.actor_id === ACTOR, String(pago?.actor_id));
  ok(
    "y la factura queda parcial",
    (await una<{ status: string }>(`select status from ${S}.supplier_invoices where id = '${F_PAGO}'`))
      ?.status === "partial",
  );

  /* ── 3 · cancelInvoice ─────────────────────────────────────────────────── */
  seccion("cancelar factura");
  const MOTIVO_F = `${TAG} capturada dos veces`;
  await guardia("cancelar factura", "Solo un administrador cancela facturas.", () =>
    pagar.cancelInvoice(inicial, forma({ invoiceId: F_CANCELAR, reason: MOTIVO_F })),
  );
  await invalida(
    "cancelar sin decir qué factura",
    () => pagar.cancelInvoice(inicial, forma({ reason: MOTIVO_F })),
    "Falta la factura.",
  );
  await invalida(
    "cancelar con un motivo de tres letras",
    () => pagar.cancelInvoice(inicial, forma({ invoiceId: F_CANCELAR, reason: "  ya " })),
    "Escribe el motivo: queda en la bitácora.",
  );
  r = await pagar.cancelInvoice(inicial, forma({ invoiceId: F_CANCELAR, reason: MOTIVO_F }));
  ok("la factura se cancela", r.ok === true, r.error);
  const cancelada = await una<{ status: string; cancel_reason: string; cancelled_at: Date | null }>(
    `select status, cancel_reason, cancelled_at from ${S}.supplier_invoices where id = '${F_CANCELAR}'`,
  );
  ok(
    "queda cancelada, con su motivo y su fecha",
    cancelada?.status === "cancelled" &&
      cancelada?.cancel_reason === MOTIVO_F &&
      cancelada?.cancelled_at !== null,
  );
  // La factura no guarda quién la canceló: lo guarda el evento, y es el único
  // sitio donde esa pregunta tiene respuesta.
  ok(
    "y el evento de la cancelación lo firma el actor",
    (await actorDelEvento(F_CANCELAR, "supplier_invoice.cancelled")) === ACTOR,
  );

  /* ── 4 · createCreditNote ──────────────────────────────────────────────── */
  seccion("nota de crédito");
  const NOTA_TXT = `${TAG} nota por devolución`;
  const notaBuena = (extra: Record<string, string> = {}) =>
    forma({
      supplierId: SID,
      supplierFolio: `${TAG}-NC`,
      subtotal: "MXN 1,000",
      taxTotal: "160",
      total: "$1,160.00",
      issuedAt: "2026-08-05",
      notes: NOTA_TXT,
      ...extra,
    });
  await guardia("nota de crédito", "Solo un administrador captura notas de crédito.", () =>
    pagar.createCreditNote(inicial, notaBuena()),
  );
  await invalida(
    "nota con proveedor que no es uuid",
    () => pagar.createCreditNote(inicial, notaBuena({ supplierId: "x" })),
    "Revisa los datos de la nota.",
  );
  await invalida(
    "nota con total «mil pesos»",
    () => pagar.createCreditNote(inicial, notaBuena({ total: "mil pesos" })),
    "Revisa los datos de la nota.",
  );
  await invalida(
    "nota sin fecha de emisión",
    () => pagar.createCreditNote(inicial, notaBuena({ issuedAt: "" })),
    "Revisa los datos de la nota.",
  );
  await invalida(
    "nota en una moneda que no existe",
    () => pagar.createCreditNote(inicial, notaBuena({ currency: "BTC" })),
    "Revisa los datos de la nota.",
  );

  const ajenoNotasAntes = await cuantos("supplier_credit_notes", `where notes like '${TAG}%'`, AJENO);
  r = await pagar.createCreditNote(inicial, notaBuena());
  ok("la nota se captura", r.ok === true, r.error);
  const nota = await una<Record<string, string | null>>(
    `select id, subtotal::text, tax_total::text, total::text, currency, status::text,
            supplier_folio, created_by_id
       from ${S}.supplier_credit_notes where supplier_id = '${SID}' and notes = '${NOTA_TXT}'`,
  );
  ok(
    "con los importes limpios de «$», comas y «MXN»",
    nota?.subtotal === "1000.00" && nota?.tax_total === "160.00" && nota?.total === "1160.00",
    `${nota?.subtotal} + ${nota?.tax_total} = ${nota?.total}`,
  );
  ok("nace abierta, en pesos y con el folio del proveedor", nota?.status === "open" &&
    nota?.currency === "MXN" && nota?.supplier_folio === `${TAG}-NC`);
  ok("firmada por quien tiene la sesión", nota?.created_by_id === ACTOR, String(nota?.created_by_id));
  ok(
    `y cae en ${ESQUEMA}, no en ${AJENO}`,
    (await cuantos("supplier_credit_notes", `where notes like '${TAG}%'`, AJENO)) === ajenoNotasAntes &&
      ajenoNotasAntes === 0,
  );
  const NC = String(nota?.id);

  /* ── 5 · applyCreditNoteToInvoice ──────────────────────────────────────── */
  seccion("aplicar la nota a una factura");
  const aplicacionBuena = (extra: Record<string, string> = {}) =>
    forma({
      creditNoteId: NC,
      invoiceId: F_NOTA,
      amount: "$100",
      appliedAt: "2026-08-12",
      note: `${TAG} bonificación`,
      ...extra,
    });
  await guardia("aplicar nota", "Solo un administrador aplica notas de crédito.", () =>
    pagar.applyCreditNoteToInvoice(inicial, aplicacionBuena()),
  );
  await invalida(
    "aplicar una nota que no es uuid",
    () => pagar.applyCreditNoteToInvoice(inicial, aplicacionBuena({ creditNoteId: "x" })),
    "Revisa los datos de la aplicación.",
  );
  await invalida(
    "aplicar «mil pesos»",
    () => pagar.applyCreditNoteToInvoice(inicial, aplicacionBuena({ amount: "mil pesos" })),
    "Revisa los datos de la aplicación.",
  );
  await invalida(
    "aplicar sin fecha",
    () => pagar.applyCreditNoteToInvoice(inicial, aplicacionBuena({ appliedAt: "12/08/2026" })),
    "Revisa los datos de la aplicación.",
  );

  r = await pagar.applyCreditNoteToInvoice(inicial, aplicacionBuena());
  ok("la nota se aplica", r.ok === true, r.error);
  const apN = await una<Record<string, string | null>>(
    `select id, amount::text, balance_after::text, applied_at::text, note, actor_id
       from ${S}.supplier_credit_note_applications where credit_note_id = '${NC}'`,
  );
  ok(
    "el renglón lleva importe, saldo y fecha",
    apN?.amount === "100.00" && apN?.balance_after === "1060.00" && apN?.applied_at === "2026-08-12",
    `${apN?.amount} / ${apN?.balance_after}`,
  );
  ok("firmado por quien tiene la sesión", apN?.actor_id === ACTOR, String(apN?.actor_id));
  const APP_NOTA = String(apN?.id);

  /* ── 6 · unapplyCredit (nota) ──────────────────────────────────────────── */
  seccion("quitar la aplicación de la nota");
  const quitar = (tipo: string, applicationId: string, reason = `${TAG} factura equivocada`) =>
    pagar.unapplyCredit(inicial, forma({ tipo, applicationId, reason }));
  await guardia("quitar aplicación", "Solo un administrador quita una aplicación.", () =>
    quitar("nota", APP_NOTA),
  );
  await invalida("quitar con un tipo que no es nota ni anticipo", () => quitar("pago", APP_NOTA));
  await invalida("quitar una aplicación que no es uuid", () => quitar("nota", "x"));
  await invalida("quitar sin motivo", () => quitar("nota", APP_NOTA, " a "), "Falta el motivo.");
  /*
    `tipo` viene de un campo oculto y decide a qué tabla va el borrado. Un id de
    nota con «anticipo» tiene que no encontrar nada, no borrar lo que haya con
    ese id en la tabla que no era.
  */
  await invalida(
    "un id de nota enviado como «anticipo»",
    () => quitar("anticipo", APP_NOTA),
    "Esa imputación ya no existe.",
  );

  r = await quitar("nota", APP_NOTA);
  ok("la aplicación se quita", r.ok === true, r.error);
  ok(
    "el renglón ya no está",
    (await cuantos("supplier_credit_note_applications", `where id = '${APP_NOTA}'`)) === 0,
  );
  const trasQuitar = await una<{ factura: string; nota: string }>(
    `select (select status::text from ${S}.supplier_invoices where id = '${F_NOTA}') as factura,
            (select status::text from ${S}.supplier_credit_notes where id = '${NC}') as nota`,
  );
  ok(
    "la factura vuelve a pendiente y la nota a abierta",
    trasQuitar?.factura === "pending" && trasQuitar?.nota === "open",
    `${trasQuitar?.factura} / ${trasQuitar?.nota}`,
  );
  ok(
    "y el borrado queda en la bitácora firmado por el actor",
    (await actorDelEvento(NC, "supplier_credit_note.unapplied")) === ACTOR,
  );

  /* ── 7 · cancelCreditNoteAction ────────────────────────────────────────── */
  seccion("cancelar nota de crédito");
  const MOTIVO_N = `${TAG} nota duplicada`;
  await guardia("cancelar nota", "Solo un administrador cancela notas de crédito.", () =>
    pagar.cancelCreditNoteAction(inicial, forma({ creditNoteId: N_CANCELAR, reason: MOTIVO_N })),
  );
  await invalida(
    "cancelar sin decir qué nota",
    () => pagar.cancelCreditNoteAction(inicial, forma({ reason: MOTIVO_N })),
    "Falta la nota.",
  );
  await invalida(
    "cancelar nota con motivo de tres letras",
    () => pagar.cancelCreditNoteAction(inicial, forma({ creditNoteId: N_CANCELAR, reason: "no" })),
    "Escribe el motivo: queda en la bitácora.",
  );
  r = await pagar.cancelCreditNoteAction(
    inicial,
    forma({ creditNoteId: N_CANCELAR, reason: `  ${MOTIVO_N}  ` }),
  );
  ok("la nota se cancela", r.ok === true, r.error);
  const notaCancelada = await una<{ status: string; cancel_reason: string }>(
    `select status::text, cancel_reason from ${S}.supplier_credit_notes where id = '${N_CANCELAR}'`,
  );
  ok(
    "queda cancelada con el motivo recortado",
    notaCancelada?.status === "cancelled" && notaCancelada?.cancel_reason === MOTIVO_N,
    notaCancelada?.cancel_reason,
  );
  ok(
    "y el evento lo firma el actor",
    (await actorDelEvento(N_CANCELAR, "supplier_credit_note.cancelled")) === ACTOR,
  );

  /* ── 8 · createAdvance ─────────────────────────────────────────────────── */
  seccion("anticipo");
  const ANT_TXT = `${TAG} anticipo de refacciones`;
  const anticipoBueno = (extra: Record<string, string> = {}) =>
    forma({
      supplierId: SID,
      amount: "$300.00",
      method: "transfer",
      paymentReference: `SPEI-${TAG}`,
      paidAt: "2026-07-20",
      notes: ANT_TXT,
      ...extra,
    });
  await guardia("anticipo", "Solo un administrador registra anticipos.", () =>
    pagar.createAdvance(inicial, anticipoBueno()),
  );
  await invalida(
    "anticipo a un proveedor que no es uuid",
    () => pagar.createAdvance(inicial, anticipoBueno({ supplierId: "x" })),
    "Revisa los datos del anticipo.",
  );
  await invalida(
    "anticipo de «abc»",
    () => pagar.createAdvance(inicial, anticipoBueno({ amount: "abc" })),
    "Revisa los datos del anticipo.",
  );
  await invalida(
    "anticipo con un método que no existe",
    () => pagar.createAdvance(inicial, anticipoBueno({ method: "bitcoin" })),
    "Revisa los datos del anticipo.",
  );
  await invalida(
    "anticipo de «-300»",
    () => pagar.createAdvance(inicial, anticipoBueno({ amount: "-300" })),
    "El anticipo debe ser mayor que cero.",
  );

  const ajenoAntAntes = await cuantos("supplier_advances", `where notes like '${TAG}%'`, AJENO);
  r = await pagar.createAdvance(inicial, anticipoBueno());
  ok("el anticipo se registra", r.ok === true, r.error);
  const ant = await una<Record<string, string | null>>(
    `select id, amount::text, method::text, payment_reference, paid_at::text, status::text, created_by_id
       from ${S}.supplier_advances where supplier_id = '${SID}' and notes = '${ANT_TXT}'`,
  );
  ok(
    "con importe, método, referencia y fecha de la captura",
    ant?.amount === "300.00" &&
      ant?.method === "transfer" &&
      ant?.payment_reference === `SPEI-${TAG}` &&
      ant?.paid_at === "2026-07-20",
    `${ant?.amount} ${ant?.method} ${ant?.payment_reference}`,
  );
  ok("nace abierto", ant?.status === "open");
  ok("firmado por quien tiene la sesión", ant?.created_by_id === ACTOR, String(ant?.created_by_id));
  ok(
    `y cae en ${ESQUEMA}, no en ${AJENO}`,
    (await cuantos("supplier_advances", `where notes like '${TAG}%'`, AJENO)) === ajenoAntAntes &&
      ajenoAntAntes === 0,
  );
  const ANT = String(ant?.id);

  /* ── 9 · applyAdvanceToInvoice ─────────────────────────────────────────── */
  seccion("imputar el anticipo a una factura");
  const imputacionBuena = (extra: Record<string, string> = {}) =>
    forma({
      advanceId: ANT,
      invoiceId: F_ANTICIPO,
      amount: "300",
      appliedAt: "2026-08-15",
      ...extra,
    });
  await guardia("imputar anticipo", "Solo un administrador imputa anticipos.", () =>
    pagar.applyAdvanceToInvoice(inicial, imputacionBuena()),
  );
  await invalida(
    "imputar un anticipo que no es uuid",
    () => pagar.applyAdvanceToInvoice(inicial, imputacionBuena({ advanceId: "x" })),
    "Revisa los datos de la imputación.",
  );
  await invalida(
    "imputar «mil pesos»",
    () => pagar.applyAdvanceToInvoice(inicial, imputacionBuena({ amount: "mil pesos" })),
    "Revisa los datos de la imputación.",
  );
  await invalida(
    "imputar sin fecha",
    () => pagar.applyAdvanceToInvoice(inicial, imputacionBuena({ appliedAt: "" })),
    "Revisa los datos de la imputación.",
  );

  r = await pagar.applyAdvanceToInvoice(inicial, imputacionBuena());
  ok("el anticipo se imputa", r.ok === true, r.error);
  const apA = await una<Record<string, string | null>>(
    `select id, amount::text, balance_after::text, actor_id
       from ${S}.supplier_advance_applications where advance_id = '${ANT}'`,
  );
  ok(
    "el renglón lleva importe y saldo",
    apA?.amount === "300.00" && apA?.balance_after === "860.00",
    `${apA?.amount} / ${apA?.balance_after}`,
  );
  ok("firmado por quien tiene la sesión", apA?.actor_id === ACTOR, String(apA?.actor_id));
  // Imputar NO es pagar: el dinero salió el día del anticipo.
  ok(
    "y no deja un renglón de pago",
    (await cuantos("supplier_payments", `where invoice_id = '${F_ANTICIPO}'`)) === 0,
  );
  const APP_ANT = String(apA?.id);

  /* ── 10 · unapplyCredit (anticipo) ─────────────────────────────────────── */
  seccion("quitar la imputación del anticipo");
  como(ACTOR, "pagar:editar");
  await rechazaSinEscribir(
    "quitar imputación con «pagar:editar»",
    () => quitar("anticipo", APP_ANT),
    ESTADO,
    conError("Solo un administrador quita una aplicación."),
  );
  como(ACTOR, "pagar:administrar");
  r = await quitar("anticipo", APP_ANT);
  ok("la imputación se quita", r.ok === true, r.error);
  const trasQuitarAnt = await una<{ factura: string; anticipo: string; renglones: number }>(
    `select (select status::text from ${S}.supplier_invoices where id = '${F_ANTICIPO}') as factura,
            (select status::text from ${S}.supplier_advances where id = '${ANT}') as anticipo,
            (select count(*)::int from ${S}.supplier_advance_applications where id = '${APP_ANT}') as renglones`,
  );
  ok(
    "el renglón se va, la factura vuelve a pendiente y el anticipo a abierto",
    trasQuitarAnt?.renglones === 0 &&
      trasQuitarAnt?.factura === "pending" &&
      trasQuitarAnt?.anticipo === "open",
    JSON.stringify(trasQuitarAnt),
  );
  ok(
    "y el borrado lo firma el actor",
    (await actorDelEvento(ANT, "supplier_advance.unapplied")) === ACTOR,
  );

  /* ── 11 · splitInvoiceAction ───────────────────────────────────────────── */
  seccion("dividir en parcialidades: el reparto automático");
  const dividir = (campos: Record<string, string | string[]>) =>
    pagar.splitInvoiceAction(inicial, forma({ invoiceId: F_DIVIDIR, ...campos }));
  const autoBueno = { modo: "auto", total: "$1,160.00", count: "3", firstDueAt: "2026-09-15" };

  await guardia("dividir", "Solo un administrador divide una factura.", () => dividir(autoBueno));
  await invalida(
    "dividir sin decir qué factura",
    () => pagar.splitInvoiceAction(inicial, forma(autoBueno)),
    "Falta la factura.",
  );
  /*
    El total, que era el agujero: con `[^0-9.]` «-1160» se leía 1160 y la
    división pasaba. Negativo, cero, vacío y texto se rechazan con el mensaje de
    la acción, antes de llegar al dominio.
  */
  for (const total of ["-1160", "0", "", "mil pesos"])
    await invalida(
      `dividir un total de «${total}»`,
      () => dividir({ ...autoBueno, total }),
      "El total a dividir tiene que ser mayor que cero.",
    );
  for (const count of ["1", "61", "2.5", "tres"])
    await invalida(
      `dividir en «${count}» parcialidades`,
      () => dividir({ ...autoBueno, count }),
      "El número de parcialidades va de 2 a 60.",
    );
  await invalida(
    "dividir sin primer vencimiento",
    () => dividir({ ...autoBueno, firstDueAt: "15/09/2026" }),
    "Falta la fecha del primer vencimiento.",
  );

  const cuotas = async () =>
    (
      await filas<{ seq: number; amount: string; due_at: string }>(
        `select seq, amount::text, due_at::text from ${S}.supplier_invoice_installments
          where invoice_id = '${F_DIVIDIR}' order by seq`,
      )
    )
      .map((c) => `${c.seq}:${c.amount}@${c.due_at}`)
      .join(" ");
  const venceDividida = async () =>
    (await una<{ due_at: string }>(
      `select due_at::text from ${S}.supplier_invoices where id = '${F_DIVIDIR}'`,
    ))?.due_at;

  r = await dividir(autoBueno);
  ok("la factura se divide", r.ok === true && r.message === "Factura dividida en 3 parcialidades.", r.error ?? r.message);
  ok(
    "en tres cuotas mensuales, con el centavo de sobra en la última",
    (await cuotas()) === "1:386.66@2026-09-15 2:386.66@2026-10-15 3:386.68@2026-11-15",
    await cuotas(),
  );
  ok("la factura vence con la última", (await venceDividida()) === "2026-11-15");
  ok(
    "y el evento lo firma el actor",
    (await actorDelEvento(F_DIVIDIR, "supplier_invoice.split")) === ACTOR,
  );

  seccion("dividir en parcialidades: el calendario capturado a mano");
  const manual = (importes: string[], fechas: string[]) =>
    dividir({ modo: "manual", "part-amount": importes, "part-due": fechas });
  const D = ["2026-09-01", "2026-10-01", "2026-11-01"];

  // El número de la parcialidad es el del renglón en pantalla: quien corrige
  // tiene que saber CUÁL, no solo que algo está mal.
  await invalida(
    "un renglón con «abc»",
    () => manual(["580", "abc", "580"], D),
    "La parcialidad 2 no tiene un importe válido.",
  );
  await invalida(
    "un renglón negativo",
    () => manual(["1260", "-100"], D.slice(0, 2)),
    "La parcialidad 2 no tiene un importe válido.",
  );
  await invalida(
    "un primer renglón de «-1160»",
    () => manual(["-1160", "2320"], D.slice(0, 2)),
    "La parcialidad 1 no tiene un importe válido.",
  );
  /*
    Basura SIN fecha. El renglón no está vacío —alguien tecleó un importe—, así
    que tampoco se salta: si se saltara, las otras dos suman el total y la
    factura se dividiría en menos parcialidades de las que se capturaron, sin
    decir nada. Lo encontró este probe; ver el comentario en la acción.
  */
  await invalida(
    "un renglón negativo y sin fecha",
    () => manual(["580", "580", "-100"], [D[0], D[1], ""]),
    "La parcialidad 3 no tiene un importe válido.",
  );
  await invalida(
    "un renglón con texto y sin fecha",
    () => manual(["580", "580", "mil"], [D[0], D[1], ""]),
    "La parcialidad 3 no tiene un importe válido.",
  );

  r = await manual(["$500.00", "", "660"], [D[0], "", D[2]]);
  ok(
    "un renglón vacío se salta y el resto se guarda",
    r.ok === true && r.message === "Factura dividida en 2 parcialidades.",
    r.error ?? r.message,
  );
  ok(
    "el plan nuevo REEMPLAZA al automático, numerado sin el hueco",
    (await cuotas()) === "1:500.00@2026-09-01 2:660.00@2026-11-01",
    await cuotas(),
  );
  ok("y la factura vence con la última", (await venceDividida()) === "2026-11-01");

  /* ── 12 · importación masiva: previsualizar y confirmar ────────────────── */
  seccion("importación de cargos");
  const ARCHIVO = `${TAG}-cargos.csv`;
  const CSV = [
    "rfc,proveedor,folio,uuid,moneda,subtotal,impuestos,total,emision,vencimiento,notas",
    `${RFC},,${TAG}-IMP1,,MXN,1000.00,160.00,1160.00,2026-08-01,,${TAG} importada`,
    // Un proveedor que no existe: el motor la rechaza y el lote sigue.
    `NOEXISTE${RFC},,${TAG}-IMP2,,MXN,100,0,100,2026-08-01,,`,
  ].join("\n");
  const lote = (kind = "charges_csv", archivos: File[] = [new File([CSV], ARCHIVO, { type: "text/csv" })]) => {
    const fd = forma({ kind });
    for (const a of archivos) fd.append("files", a);
    return fd;
  };
  const MSJ_IMPORTAR = "Solo un administrador importa cuentas por pagar.";

  await guardia("previsualizar importación", MSJ_IMPORTAR, () =>
    pagar.previewPayableImport(inicial, lote()),
  );
  await guardia("confirmar importación", MSJ_IMPORTAR, () =>
    pagar.commitPayableImport(inicial, lote()),
  );
  await invalida(
    "importar un tipo que no existe",
    () => pagar.commitPayableImport(inicial, lote("xlsx")),
    "Tipo de importación no reconocido.",
  );
  await invalida(
    "importar sin archivo",
    () => pagar.commitPayableImport(inicial, lote("charges_csv", [])),
    "Elige al menos un archivo.",
  );
  await invalida(
    "importar un archivo vacío",
    () => pagar.commitPayableImport(inicial, lote("charges_csv", [new File([], ARCHIVO)])),
    "Elige al menos un archivo.",
  );

  /*
    La previsualización corre el lote DE VERDAD y lo revierte. Que diga «1 de 2»
    y no deje nada es lo que hace creíble a la pantalla: si escribiera, el botón
    de confirmar lo capturaría dos veces.
  */
  const fotoAntes = await foto(...ESTADO);
  const previa = await intentar(() => pagar.previewPayableImport(inicial, lote()));
  const fotoDespues = await foto(...ESTADO);
  ok(
    "la previsualización responde con el resultado fila a fila",
    previa.valor?.ok === true &&
      previa.valor.phase === "preview" &&
      previa.valor.outcome?.okCount === 1 &&
      previa.valor.outcome?.results.length === 2,
    previa.error ?? previa.valor?.error ?? previa.valor?.message,
  );
  ok("y no escribió nada", fotoAntes === fotoDespues);

  const ajenoImpAntes = await cuantos("payable_imports", `where file_name like '${TAG}%'`, AJENO);
  const conf = await pagar.commitPayableImport(inicial, lote());
  ok(
    "la confirmación importa la fila buena y rechaza la otra",
    conf.ok === true && conf.phase === "commit" && conf.outcome?.okCount === 1 &&
      conf.outcome?.errorCount === 1,
    conf.error ?? conf.message,
  );
  const importada = await una<Record<string, string | null>>(
    `select total::text, due_at::text, created_by_id
       from ${S}.supplier_invoices where supplier_id = '${SID}' and supplier_folio = '${TAG}-IMP1'`,
  );
  ok(
    "la factura importada existe, con su total y el plazo del proveedor",
    importada?.total === "1160.00" && importada?.due_at === "2026-08-31",
    `${importada?.total} vence ${importada?.due_at}`,
  );
  ok(
    "firmada por quien tiene la sesión",
    importada?.created_by_id === ACTOR,
    String(importada?.created_by_id),
  );
  const loteGuardado = await una<Record<string, string | number | null>>(
    `select kind::text, row_count, ok_count, error_count, created_by_id
       from ${S}.payable_imports where file_name = '${ARCHIVO}'`,
  );
  ok(
    "el lote queda registrado con sus cuentas y su autor",
    loteGuardado?.kind === "charges_csv" &&
      loteGuardado?.row_count === 2 &&
      loteGuardado?.ok_count === 1 &&
      loteGuardado?.error_count === 1 &&
      loteGuardado?.created_by_id === ACTOR,
    JSON.stringify(loteGuardado),
  );
  ok(
    `y nada de eso cae en ${AJENO}`,
    ajenoImpAntes === 0 &&
      (await cuantos("payable_imports", `where file_name like '${TAG}%'`, AJENO)) === 0 &&
      (await cuantos("supplier_invoices", `where supplier_folio like '${TAG}%'`, AJENO)) === 0,
  );
});
