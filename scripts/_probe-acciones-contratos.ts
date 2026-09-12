/**
 * LAS ACCIONES DE CONTRATOS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-contratos.ts
 *
 * Cuatro acciones en `lib/actions/contracts.ts`. `_probe-acciones` ya cubre la
 * guardia sin permiso de `createContract` y que «mil pesos» no entre como
 * importe; aquí va el resto: el escalón de permiso, las PARTES del contrato, el
 * camino feliz de las cuatro y la marcha atrás de los equipos amparados.
 *
 * ── LAS PARTES SON LO QUE MÁS IMPORTA ─────────────────────────────────────
 *
 * `clientId` y `salesRepId` llegan del formulario y la llave foránea apunta a
 * `public.users`, el padrón de TODA la plataforma: la base no impide firmar un
 * contrato a nombre de alguien de otra empresa. Lo impide `validateParties`, y
 * por eso se le prueba con cada forma de «no es de aquí»: de baja en la
 * empresa, con la cuenta apagada, miembro de otra empresa, y miembro de ésta
 * con un rol que no es el suyo (un vendedor como titular, un agente o un
 * cliente como vendedor). Esas personas se dan de alta aquí, con la marca de la
 * corrida, y se borran al final.
 *
 * ── EL IMPORTE ────────────────────────────────────────────────────────────
 *
 * Se valida con `importeOpcional` (`lib/importe.ts`): vacío es «sin monto» y
 * BORRA el que hubiera; negativo o texto es `invalid`. `updateContract` no
 * tenía ninguna prueba y es donde «vacío» y «basura» se confunden más fácil,
 * porque el contrato ya trae un monto que se puede perder.
 *
 * ── LO QUE NO SE PRUEBA, Y POR QUÉ ────────────────────────────────────────
 *
 * «Sin sesión» en `createContract`: la acción no llama a `auth()`, solo a
 * `puedeEn()`, y el `puedeEn` de verdad devuelve `false` sin sesión porque
 * `getTenantContext()` es `null`. El stub no modela eso —concede sin mirar la
 * sesión—, así que la prueba solo repetiría la de «sin permiso», que ya está en
 * `_probe-acciones`.
 */
import { randomUUID } from "node:crypto";
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
  alLimpiar,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const S = ESQUEMA;
/*
  «PRBCTR» y no «CTR»: los contratos sembrados se numeran `CTR-00360`, y la
  limpieza borra por `number like '<marca>%'`. Una marca que empezara igual que
  los folios de verdad estaría a un carácter de llevárselos.
*/
const TAG = marca("PRBCTR");
const CORREO = TAG.toLowerCase();

async function una<T = Record<string, unknown>>(q: string): Promise<T | undefined> {
  return (await filas<T>(q))[0];
}

async function alta(q: string): Promise<string> {
  const f = await una<{ id: string }>(q);
  if (!f) throw new Error(`el alta de la prueba no devolvió id: ${q.slice(0, 80)}`);
  return f.id;
}

void probar("contratos: guardia, nivel, partes, importe y equipos", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  const SLUG = ESQUEMA.replace(/^tenant_/, "");
  const empresa = async (slug: string) =>
    (await una<{ id: string }>(`select id from tenants where slug = '${slug}'`))?.id;
  const EMPRESA = await empresa(SLUG);
  const EMPRESA_AJENA = await empresa(AJENO.replace(/^tenant_/, ""));
  if (!EMPRESA || !EMPRESA_AJENA) throw new Error("faltan las empresas sembradas");

  /* ── 0 · las personas ──────────────────────────────────────────────────── */
  /*
    Las buenas se toman de la base sembrada y no se tocan: un cliente activo que
    tenga equipos, un vendedor y un agente. Las malas se crean, porque la
    siembra no trae a nadie de baja ni a nadie de otra empresa.
  */
  const miembro = async (rol: string, extra = "") =>
    (
      await una<{ id: string }>(
        `select u.id from users u join memberships m on m.user_id = u.id
          where m.tenant_id = '${EMPRESA}' and m.role = '${rol}' and m.active and u.active
            ${extra}
          order by u.created_at, u.id limit 1`,
      )
    )?.id;
  const CLIENTE = await miembro(
    "client",
    `and exists (select 1 from ${S}.equipment e where e.owner_id = u.id)`,
  );
  const VENDEDOR = await miembro("sales");
  const AGENTE = await miembro("agent");
  if (!CLIENTE || !VENDEDOR || !AGENTE) throw new Error("la siembra no trae cliente, vendedor y agente");
  const OTRO_CLIENTE = await miembro("client", `and u.id <> '${CLIENTE}'`);
  if (!OTRO_CLIENTE) throw new Error("la siembra no trae dos clientes");

  const EQ_PROPIO = (
    await una<{ id: string }>(
      `select id from ${S}.equipment where owner_id = '${CLIENTE}' order by id limit 1`,
    )
  )?.id;
  // Dos ajenos: uno se enlaza en la siembra (el «heredado») y el otro queda
  // libre, para que intentar ampararlo pueda escribir si la validación falla.
  const [EQ_AJENO, EQ_AJENO_LIBRE] = (
    await filas<{ id: string }>(
      `select id from ${S}.equipment where owner_id <> '${CLIENTE}' order by id limit 2`,
    )
  ).map((x) => x.id);
  if (!EQ_PROPIO || !EQ_AJENO || !EQ_AJENO_LIBRE) throw new Error("la siembra no trae equipos");

  // Al final se borran las personas: la cascada se lleva sus membresías.
  alLimpiar(() => sql.unsafe(`delete from users where email like '${CORREO}-%'`));

  const persona = async (
    quien: string,
    rol: string,
    { empresa = EMPRESA, activo = true, cuenta = true } = {},
  ) => {
    const id = await alta(
      `insert into users (name, email, active)
       values ('${TAG} ${quien}', '${CORREO}-${quien}@probe.invalid', ${cuenta}) returning id`,
    );
    await sql.unsafe(
      `insert into memberships (user_id, tenant_id, role, active)
       values ('${id}', '${empresa}', '${rol}', ${activo})`,
    );
    return id;
  };
  const CLI_BAJA = await persona("cliente-baja", "client", { activo: false });
  const CLI_APAGADO = await persona("cliente-apagado", "client", { cuenta: false });
  const CLI_AJENO = await persona("cliente-ajeno", "client", { empresa: EMPRESA_AJENA });
  const VEN_BAJA = await persona("vendedor-baja", "sales", { activo: false });
  const VEN_AJENO = await persona("vendedor-ajeno", "sales", { empresa: EMPRESA_AJENA });

  /* ── 0b · los contratos de trabajo ─────────────────────────────────────── */
  // Se registra DESPUÉS que las personas para ejecutarse ANTES: la limpieza va
  // al revés, y un contrato apunta a su cliente.
  borrarAlFinal("contracts", `number like '${TAG}%'`);

  const contrato = (sufijo: string, cliente: string, extra = "") =>
    alta(
      `insert into ${S}.contracts
         (number, client_id, sales_rep_id, amount_mxn, amount_usd, start_date, end_date, notes)
       values ('${TAG}-${sufijo}', '${cliente}', ${extra || "null"}, 1000, 100,
               '2026-01-01', '2026-12-31', '${TAG} sembrado') returning id`,
    );
  const C_EDITAR = await contrato("EDITAR", CLIENTE, `'${VENDEDOR}'`);
  await contrato("OTRO", CLIENTE);
  const C_BAJA = await contrato("BAJA", CLI_BAJA);
  const C_BORRAR = await contrato("BORRAR", CLIENTE);
  const C_EQUIPO = await contrato("EQUIPO", CLIENTE);
  /*
    Enlaces a un equipo AJENO, como los que dejó el importador al enlazar por
    número de serie sin mirar de quién era el equipo. Editar el contrato debe
    quitarlo; desvincularlo a mano también, aunque el equipo no sea del cliente.
  */
  await sql.unsafe(
    `insert into ${S}.contract_equipment (contract_id, equipment_id) values
       ('${C_EDITAR}', '${EQ_AJENO}'), ('${C_EQUIPO}', '${EQ_AJENO}'), ('${C_BORRAR}', '${EQ_PROPIO}')`,
  );

  const fila = (id: string) =>
    `select number, sales_rep_id, deal_id, amount_mxn::text, amount_usd::text,
            start_date::text, end_date::text, notes
       from ${S}.contracts where id = '${id}'`;
  const enlaces = (id: string) =>
    `select equipment_id from ${S}.contract_equipment where contract_id = '${id}' order by 1`;
  const MIS_CONTRATOS = `select count(*)::int as contratos from ${S}.contracts where number like '${TAG}%'`;

  const c = await import("@/lib/actions/contracts");
  const inicial = { ok: false };

  /* ── 1 · createContract ────────────────────────────────────────────────── */
  seccion("alta de contrato: el escalón y la captura");
  const altaBuena = (extra: Record<string, string | string[]> = {}) =>
    forma({
      number: `  ${TAG}-NUEVO  `,
      clientId: CLIENTE,
      salesRepId: VENDEDOR,
      amountMxn: "$1,250.50",
      amountUsd: "",
      startDate: "2026-02-01",
      endDate: "2027-01-31",
      notes: `${TAG} alta`,
      ...extra,
    });

  // El alta es de administrador: «editar» es lo que tiene quien atiende al
  // cliente, y un contrato fija dinero y alcance.
  como(ACTOR, "clientes:editar");
  await rechazaSinEscribir(
    "alta con «clientes:editar»",
    () => c.createContract(inicial, altaBuena()),
    [MIS_CONTRATOS],
    conError("auth"),
  );

  como(ACTOR, "clientes:administrar");
  const altaInvalida = (nombre: string, extra: Record<string, string>, error = "invalid") =>
    rechazaSinEscribir(
      nombre,
      () => c.createContract(inicial, altaBuena(extra)),
      [MIS_CONTRATOS],
      conError(error),
    );
  // Negativo: con la limpieza vieja el signo se perdía y entraba como 1000.
  await altaInvalida("alta con importe «-1000»", { amountMxn: "-1000" });
  await altaInvalida("alta con dólares «abc»", { amountUsd: "abc" });
  await altaInvalida("alta con número de una letra", { number: "X" });
  await altaInvalida("alta con cliente que no es uuid", { clientId: "no-soy-un-uuid" });

  seccion("alta de contrato: las partes tienen que ser de aquí y con su rol");
  await altaInvalida("titular dado de baja en la empresa", { clientId: CLI_BAJA });
  await altaInvalida("titular con la cuenta apagada", { clientId: CLI_APAGADO });
  await altaInvalida(`titular que es cliente de ${AJENO}`, { clientId: CLI_AJENO });
  await altaInvalida("titular que no existe", { clientId: randomUUID() });
  await altaInvalida("un vendedor como titular", { clientId: VENDEDOR });
  await altaInvalida("un agente como vendedor", { salesRepId: AGENTE });
  await altaInvalida("un cliente como vendedor", { salesRepId: OTRO_CLIENTE });
  await altaInvalida("un vendedor dado de baja", { salesRepId: VEN_BAJA });
  await altaInvalida(`un vendedor de ${AJENO}`, { salesRepId: VEN_AJENO });
  // El número se compara ya recortado: con espacios alrededor sigue siendo el
  // mismo contrato.
  await altaInvalida("un número que ya existe", { number: ` ${TAG}-OTRO ` }, "duplicate");

  seccion("alta de contrato: el camino feliz");
  const ajenoAntes = await cuantos("contracts", `where number like '${TAG}%'`, AJENO);
  const r = await c.createContract(
    inicial,
    altaBuena({ dealId: randomUUID(), equipmentIds: [EQ_PROPIO, EQ_AJENO] }),
  );
  ok("el contrato se da de alta", r.ok === true && r.number === `${TAG}-NUEVO`, r.error);
  const nuevo = await una<Record<string, string | null> & { id: string; client_id: string }>(
    `select id, client_id, number, sales_rep_id, deal_id, amount_mxn::text, amount_usd::text,
            start_date::text, end_date::text, notes
       from ${S}.contracts where number = '${TAG}-NUEVO'`,
  );
  ok("con el número recortado, del cliente y con su vendedor",
    nuevo?.client_id === CLIENTE && nuevo?.sales_rep_id === VENDEDOR);
  ok(
    "el monto limpio de «$» y comas; los dólares vacíos, SIN monto",
    nuevo?.amount_mxn === "1250.50" && nuevo?.amount_usd === null,
    `${nuevo?.amount_mxn} / ${nuevo?.amount_usd}`,
  );
  ok(
    "fechas y notas como se capturaron",
    nuevo?.start_date === "2026-02-01" && nuevo?.end_date === "2027-01-31" && nuevo?.notes === `${TAG} alta`,
  );
  // Un negocio que no es de este cliente se descarta sin tumbar el alta.
  ok("un negocio que no es del cliente se guarda sin enlace", nuevo?.deal_id === null);
  const eqNuevo = (await filas<{ equipment_id: string }>(enlaces(nuevo?.id ?? randomUUID()))).map(
    (e) => e.equipment_id,
  );
  ok(
    "ampara el equipo del cliente y descarta el ajeno",
    eqNuevo.length === 1 && eqNuevo[0] === EQ_PROPIO,
    eqNuevo.join(", "),
  );
  ok(
    `y cae en ${ESQUEMA}, no en ${AJENO}`,
    ajenoAntes === 0 && (await cuantos("contracts", `where number like '${TAG}%'`, AJENO)) === 0,
  );

  /* ── 2 · updateContract ────────────────────────────────────────────────── */
  seccion("editar contrato: la guardia");
  const FOTO_EDITAR = [fila(C_EDITAR), enlaces(C_EDITAR), MIS_CONTRATOS];
  const edicionBuena = (extra: Record<string, string | string[]> = {}) =>
    forma({
      id: C_EDITAR,
      number: `${TAG}-EDITADO`,
      salesRepId: "",
      amountMxn: "MXN 2,000.00",
      amountUsd: "",
      startDate: "2026-03-01",
      endDate: "",
      notes: "",
      equipmentIds: [EQ_PROPIO, EQ_AJENO],
      ...extra,
    });
  const editar = (extra: Record<string, string | string[]> = {}) =>
    c.updateContract(inicial, edicionBuena(extra));

  como(null);
  await rechazaSinEscribir("editar sin sesión", () => editar(), FOTO_EDITAR, conError("auth"));
  como(ACTOR, false);
  await rechazaSinEscribir("editar sin permiso", () => editar(), FOTO_EDITAR, conError("auth"));
  como(ACTOR, "clientes:editar");
  await rechazaSinEscribir("editar con «clientes:editar»", () => editar(), FOTO_EDITAR, conError("auth"));

  seccion("editar contrato: el importe y la captura");
  como(ACTOR, "clientes:administrar");
  const edicionInvalida = (nombre: string, extra: Record<string, string>, error = "invalid") =>
    rechazaSinEscribir(nombre, () => editar(extra), FOTO_EDITAR, conError(error));
  /*
    Estos tres son el punto de `importeOpcional` en la edición. El contrato YA
    tiene 1000 pesos y 100 dólares: si «mil pesos» se leyera como vacío, la
    edición BORRARÍA el monto y respondería ok.
  */
  await edicionInvalida("editar con importe «-5»", { amountMxn: "-5" });
  await edicionInvalida("editar con importe «mil pesos»", { amountMxn: "mil pesos" });
  await edicionInvalida("editar con dólares «abc»", { amountUsd: "abc" });
  await edicionInvalida("editar con un id que no es uuid", { id: "x" });
  await edicionInvalida("editar un contrato que no existe", { id: randomUUID() });
  await edicionInvalida("editar dejando el número vacío", { number: "" });
  await edicionInvalida("editar al número de OTRO contrato", { number: `${TAG}-OTRO` }, "duplicate");

  seccion("editar contrato: el vendedor y el titular siguen siendo de aquí");
  await edicionInvalida("editar poniendo a un agente de vendedor", { salesRepId: AGENTE });
  await edicionInvalida("editar poniendo a un cliente de vendedor", { salesRepId: OTRO_CLIENTE });
  await edicionInvalida("editar poniendo a un vendedor de baja", { salesRepId: VEN_BAJA });
  await edicionInvalida(`editar poniendo a un vendedor de ${AJENO}`, { salesRepId: VEN_AJENO });
  /*
    El titular no viaja en el formulario de edición, pero se vuelve a validar el
    que tiene: un contrato cuyo cliente ya se dio de baja no se edita como si
    nada. Se prueba con un monto válido para que el rechazo sea por él.
  */
  await rechazaSinEscribir(
    "editar el contrato de un cliente dado de baja",
    () => c.updateContract(inicial, edicionBuena({ id: C_BAJA, number: `${TAG}-BAJA` })),
    [fila(C_BAJA), enlaces(C_BAJA)],
    conError("invalid"),
  );

  seccion("editar contrato: el camino feliz");
  let e = await editar();
  ok("el contrato se edita", e.ok === true && e.number === `${TAG}-EDITADO`, e.error);
  const editado = await una<Record<string, string | null>>(fila(C_EDITAR));
  ok("con el número nuevo", editado?.number === `${TAG}-EDITADO`);
  ok(
    "el monto limpio de «MXN» y comas",
    editado?.amount_mxn === "2000.00",
    String(editado?.amount_mxn),
  );
  // Vacío es una decisión —«este contrato no tiene monto en dólares»—, no un
  // error de captura: borra el que había en vez de rechazarse o de conservarlo.
  ok("los dólares vacíos BORRAN los 100 que había", editado?.amount_usd === null, String(editado?.amount_usd));
  ok(
    "el vendedor vacío lo quita, y lo mismo el fin y las notas",
    editado?.sales_rep_id === null && editado?.end_date === null && editado?.notes === null,
  );
  const eqEditado = (await filas<{ equipment_id: string }>(enlaces(C_EDITAR))).map((x) => x.equipment_id);
  ok(
    "los equipos se re-sincronizan: el propio entra y el ajeno heredado sale",
    eqEditado.length === 1 && eqEditado[0] === EQ_PROPIO,
    eqEditado.join(", "),
  );
  e = await editar({ amountMxn: "0", salesRepId: VENDEDOR });
  const otraVez = await una<Record<string, string | null>>(fila(C_EDITAR));
  ok(
    "guardar con el MISMO número no choca consigo mismo; cero es un monto válido",
    e.ok === true && otraVez?.amount_mxn === "0.00" && otraVez?.sales_rep_id === VENDEDOR,
    e.error ?? String(otraVez?.amount_mxn),
  );
  ok(
    `y la edición no se sale a ${AJENO}`,
    (await cuantos("contracts", `where number like '${TAG}%'`, AJENO)) === 0,
  );

  /* ── 3 · deleteContract ────────────────────────────────────────────────── */
  seccion("borrar contrato");
  const FOTO_BORRAR = [fila(C_BORRAR), enlaces(C_BORRAR)];
  const borrar = (id = C_BORRAR) => c.deleteContract(forma({ id }));
  como(null);
  await rechazaSinEscribir("borrar sin sesión", () => borrar(), FOTO_BORRAR);
  como(ACTOR, false);
  await rechazaSinEscribir("borrar sin permiso", () => borrar(), FOTO_BORRAR);
  // Es el borrado con más peso de auditoría del sistema: «editar» no alcanza.
  como(ACTOR, "clientes:editar");
  await rechazaSinEscribir("borrar con «clientes:editar»", () => borrar(), FOTO_BORRAR);
  como(ACTOR, "clientes:administrar");
  await rechazaSinEscribir(
    "borrar sin decir cuál",
    () => c.deleteContract(forma({})),
    [MIS_CONTRATOS],
  );

  const b = await intentar(() => borrar());
  /*
    El final feliz es redirigir a la lista. `redirectAfterAction` lee
    `headers()` antes de llamar a `redirect()`, y fuera de una petición
    `headers()` revienta: el kit no tiene stub de `next/headers`. Así que se
    aceptan las dos salidas —la redirección, o ESE reventón y ningún otro— y lo
    que se comprueba de verdad es la base.
  */
  const salida = b.redirige ?? b.error ?? "";
  ok(
    "termina redirigiendo a la lista (o llega hasta el `headers()` que la calcula)",
    (b.redirige?.includes("/admin/contratos") ?? false) || /headers/i.test(b.error ?? ""),
    salida.slice(0, 90),
  );
  ok("el contrato ya no está", (await cuantos("contracts", `where id = '${C_BORRAR}'`)) === 0);
  ok("ni sus equipos amparados", (await cuantos("contract_equipment", `where contract_id = '${C_BORRAR}'`)) === 0);
  const evento = await una<{ actor_id: string; payload: { snapshot?: { number?: string }; equipmentIds?: string[] } }>(
    `select actor_id, payload from ${S}.domain_events
      where aggregate_id = '${C_BORRAR}' and event_type = 'contract.deleted'
      order by id desc limit 1`,
  );
  ok(
    "y la baja queda en la bitácora, firmada, con la copia y los equipos que se llevó",
    evento?.actor_id === ACTOR &&
      evento?.payload?.snapshot?.number === `${TAG}-BORRAR` &&
      evento?.payload?.equipmentIds?.[0] === EQ_PROPIO,
    JSON.stringify(evento?.payload?.equipmentIds),
  );

  /* ── 4 · toggleContractEquipment ───────────────────────────────────────── */
  seccion("amparar y soltar equipos");
  const FOTO_EQ = [enlaces(C_EQUIPO)];
  const amparar = (equipmentId: string, attach = true) =>
    c.toggleContractEquipment(
      forma({ contractId: C_EQUIPO, equipmentId, attach: attach ? "1" : "0" }),
    );
  como(null);
  await rechazaSinEscribir("amparar sin sesión", () => amparar(EQ_PROPIO), FOTO_EQ);
  como(ACTOR, false);
  await rechazaSinEscribir("amparar sin permiso", () => amparar(EQ_PROPIO), FOTO_EQ);
  como(ACTOR, "clientes:ver");
  await rechazaSinEscribir("amparar con «clientes:ver»", () => amparar(EQ_PROPIO), FOTO_EQ);
  await rechazaSinEscribir("soltar con «clientes:ver»", () => amparar(EQ_AJENO, false), FOTO_EQ);

  // Es trabajo del día: con «editar» basta, y se prueba con eso y no con más.
  como(ACTOR, "clientes:editar");
  // Con el ajeno LIBRE, no con el que ya está enlazado: sobre ése el alta
  // choca con `onConflictDoNothing` y la foto no cambiaría ni con la
  // validación rota.
  await rechazaSinEscribir(
    "amparar un equipo que no es del cliente del contrato",
    () => amparar(EQ_AJENO_LIBRE),
    FOTO_EQ,
  );
  await rechazaSinEscribir(
    "amparar sin decir qué equipo",
    () => c.toggleContractEquipment(forma({ contractId: C_EQUIPO, attach: "1" })),
    FOTO_EQ,
  );

  const listaEq = async () =>
    (await filas<{ equipment_id: string }>(enlaces(C_EQUIPO))).map((x) => x.equipment_id).sort();
  await amparar(EQ_PROPIO);
  ok(
    "con «editar», el equipo del cliente se ampara",
    (await listaEq()).includes(EQ_PROPIO),
  );
  await amparar(EQ_PROPIO);
  ok(
    "ampararlo dos veces no lo duplica",
    (await listaEq()).filter((x) => x === EQ_PROPIO).length === 1,
  );
  // Soltar NO se valida contra el dueño: un enlace equivocado tiene que poder
  // quitarse, o se queda clavado para siempre.
  await amparar(EQ_AJENO, false);
  ok("el enlace heredado a un equipo ajeno se puede soltar", !(await listaEq()).includes(EQ_AJENO));
  await amparar(EQ_PROPIO, false);
  ok("y el propio también", (await listaEq()).length === 0, (await listaEq()).join(", "));
});
