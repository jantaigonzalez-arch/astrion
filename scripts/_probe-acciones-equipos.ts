/**
 * LAS ACCIONES DE EQUIPOS Y DE REFACCIONES.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-equipos.ts
 *
 * Dos archivos del módulo de servicio que no son tickets:
 *
 *   · `equipment.ts` — alta de equipo, módulo y submódulo, y el borrado de
 *     cualquiera de los tres. Todo pide `servicio:editar`.
 *   · `parts.ts` — alta y edición de refacciones (`inventario:editar`) y el
 *     buscador de los formularios, que no pregunta por permiso sino por ROL:
 *     el catálogo lleva costos y un cliente del portal no tiene por qué verlos.
 *
 * Lo que más vale atar aquí son los importes. `parts.ts` acaba de pasar a leerlos
 * con `lib/importe.ts`: un costo negativo o con letras tiene que rechazarse, no
 * guardarse sin signo ni convertirse en «sin costo». Y el stock no se escribe:
 * entra como movimiento del ledger, firmado, y eso también se comprueba.
 *
 * Lo que NO repite: el ledger en sí (`probe-inventario`), la búsqueda por
 * palabras y su orden (`probe-inventario`), el conteo del listado de equipos
 * (`probe-equipos`).
 *
 * ── LO QUE EL STUB NO DEJA PROBAR ─────────────────────────────────────────
 *
 * El buscador sin sesión. `currentRole()` del stub responde el rol de
 * `PROBE_ROL` —dueño por omisión— haya sesión o no; en la aplicación, sin
 * sesión no hay empresa activa y el rol es `null`. Se prueba lo que depende
 * del rol, que es lo que decide la acción.
 *
 * Todo lo que se crea lleva la marca de la corrida y se borra al final. Otros
 * probes corren a la vez: las fotos van acotadas por la marca o por id.
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

const TAG = marca("EQP");
const SLUG = ESQUEMA.replace(/^tenant_/, "");
/** Un uuid bien formado que no es de nada. */
const FANTASMA = "00000000-0000-4000-8000-000000000000";

async function una<T = Record<string, unknown>>(q: string): Promise<T | undefined> {
  return (await filas<T>(q))[0];
}

/* Los conteos, acotados a la marca. */
const EQUIPOS = `select count(*)::int as n from ${ESQUEMA}.equipment where name like '${TAG}%'`;
const MODULOS = `select count(*)::int as n from ${ESQUEMA}.equipment_modules where name like '${TAG}%'`;
const SUBMODULOS = `select count(*)::int as n from ${ESQUEMA}.equipment_submodules where name like '${TAG}%'`;
const PIEZAS = `select count(*)::int as n from ${ESQUEMA}.spare_parts where part_number like '${TAG}%'`;
const MOVS = `select count(*)::int as n from ${ESQUEMA}.inventory_movements
               where part_id in (select id from ${ESQUEMA}.spare_parts where part_number like '${TAG}%')`;

void probar("equipos y refacciones: guardia, validación y lo que se escribe", async () => {
  const miembro = async (rol: string) =>
    (
      await una<{ id: string }>(
        `select u.id from users u
           join memberships m on m.user_id = u.id
           join tenants t on t.id = m.tenant_id
          where t.slug = '${SLUG}' and m.role = '${rol}' and m.active and u.active
          order by u.created_at, u.id limit 1`,
      )
    )?.id;
  const STAFF = await miembro("agent");
  const CLIENTE = await miembro("client");
  if (!STAFF || !CLIENTE) throw new Error("la base no trae un agente y un cliente activos");

  /*
    Limpieza. El borrado de equipo se lleva módulos y submódulos por cascada.
    Las refacciones van después de sus movimientos: el ledger es `on delete
    restrict` sobre la pieza. Los eventos de borrado se quedan: `domain_events`
    es de solo anexar, y los firma el agente sembrado, no una cuenta de aquí.
  */
  borrarAlFinal("equipment", `name like '${TAG}%'`);
  borrarAlFinal("equipment", `name like '${TAG}%'`, AJENO);
  alLimpiar(async () => {
    await sql.unsafe(
      `delete from ${ESQUEMA}.inventory_movements
        where part_id in (select id from ${ESQUEMA}.spare_parts where part_number like '${TAG}%')`,
    );
    await sql.unsafe(`delete from ${ESQUEMA}.spare_parts where part_number like '${TAG}%'`);
  });
  borrarAlFinal("spare_parts", `part_number like '${TAG}%'`, AJENO);

  const e = await import("@/lib/actions/equipment");
  const p = await import("@/lib/actions/parts");
  const inicial = { ok: false };

  /** Las cuatro formas de no poder, con el escalón de menos del módulo dado. */
  const sinPermiso = (modulo: string) =>
    [
      ["sin sesión", () => como(null)],
      ["sin permiso", () => como(STAFF, false)],
      [`con «${modulo}:ver»`, () => como(STAFF, `${modulo}:ver`)],
      ["siendo cliente", () => como(CLIENTE, false, { rol: "client" })],
    ] as const;

  /* ══ addEquipment ═══════════════════════════════════════════════════════ */
  const equipo = (extra: Record<string, string> = {}) =>
    forma({ ownerId: CLIENTE, brand: "Agilent", name: `${TAG} HPLC`, model: "1260 Infinity", ...extra });

  seccion("addEquipment · la guardia");
  for (const [nombre, quien] of sinPermiso("servicio")) {
    quien();
    await rechazaSinEscribir(`alta de equipo ${nombre}`, () => e.addEquipment(inicial, equipo()), [EQUIPOS], conError("auth"));
  }

  seccion("addEquipment · la captura inválida");
  como(STAFF, "servicio:editar");
  for (const [nombre, extra] of [
    ["dueño que no es uuid", { ownerId: "no-soy-un-uuid" }],
    ["marca fuera del catálogo", { brand: "Marca Inventada" }],
    ["nombre de una letra", { name: "X" }],
  ] as const)
    await rechazaSinEscribir(`equipo con ${nombre}`, () => e.addEquipment(inicial, equipo(extra)), [EQUIPOS], conError("invalid"));
  // Un dueño con forma de uuid que no existe: lo para la llave foránea.
  await rechazaSinEscribir("equipo de un dueño que no existe", () => e.addEquipment(inicial, equipo({ ownerId: FANTASMA })), [EQUIPOS]);

  seccion("addEquipment · el camino feliz");
  let r = await e.addEquipment(inicial, equipo());
  ok("el equipo se da de alta", r.ok === true, r.error);
  const eq = await una<{ id: string; owner_id: string; brand: string; model: string; photo: string | null }>(
    `select id, owner_id, brand, model, photo from ${ESQUEMA}.equipment where name = '${TAG} HPLC'`,
  );
  ok(
    "con dueño, marca y modelo tal cual, y sin foto",
    eq?.owner_id === CLIENTE && eq.brand === "Agilent" && eq.model === "1260 Infinity" && eq.photo === null,
    JSON.stringify(eq),
  );
  ok(`y no aparece en ${AJENO}`, (await cuantos("equipment", `where name like '${TAG}%'`, AJENO)) === 0);
  if (!eq) throw new Error("sin el equipo no se puede seguir");

  /* ══ addModule ══════════════════════════════════════════════════════════ */
  const modulo = (extra: Record<string, string> = {}) =>
    forma({ ownerId: CLIENTE, equipmentId: eq.id, brand: "Agilent", name: `${TAG} bomba`, serialNumber: "SN-0001", ...extra });

  seccion("addModule · la guardia");
  for (const [nombre, quien] of sinPermiso("servicio")) {
    quien();
    await rechazaSinEscribir(`alta de módulo ${nombre}`, () => e.addModule(inicial, modulo()), [MODULOS], conError("auth"));
  }

  seccion("addModule · la captura inválida");
  como(STAFF, "servicio:editar");
  for (const [nombre, extra] of [
    ["equipo que no es uuid", { equipmentId: "no-soy-un-uuid" }],
    ["marca fuera del catálogo", { brand: "Marca Inventada" }],
    ["nombre vacío", { name: "" }],
  ] as const)
    await rechazaSinEscribir(`módulo con ${nombre}`, () => e.addModule(inicial, modulo(extra)), [MODULOS], conError("invalid"));
  await rechazaSinEscribir("módulo de un equipo que no existe", () => e.addModule(inicial, modulo({ equipmentId: FANTASMA })), [MODULOS]);

  seccion("addModule · el camino feliz");
  r = await e.addModule(inicial, modulo());
  ok("el módulo se da de alta", r.ok === true, r.error);
  const mod = await una<{ id: string; equipment_id: string; brand: string; serial_number: string }>(
    `select id, equipment_id, brand, serial_number from ${ESQUEMA}.equipment_modules where name = '${TAG} bomba'`,
  );
  ok(
    "colgado de su equipo, con marca y número de serie",
    mod?.equipment_id === eq.id && mod.brand === "Agilent" && mod.serial_number === "SN-0001",
  );
  if (!mod) throw new Error("sin el módulo no se puede seguir");

  /* ══ addSubmodule ═══════════════════════════════════════════════════════ */
  const sub = (extra: Record<string, string> = {}) =>
    forma({ ownerId: CLIENTE, moduleId: mod.id, name: `${TAG} detector`, serialNumber: "SN-0002", ...extra });

  seccion("addSubmodule · la guardia");
  for (const [nombre, quien] of sinPermiso("servicio")) {
    quien();
    await rechazaSinEscribir(`alta de submódulo ${nombre}`, () => e.addSubmodule(inicial, sub()), [SUBMODULOS], conError("auth"));
  }

  seccion("addSubmodule · la captura inválida");
  como(STAFF, "servicio:editar");
  for (const [nombre, extra] of [
    ["módulo que no es uuid", { moduleId: "no-soy-un-uuid" }],
    ["nombre vacío", { name: "" }],
  ] as const)
    await rechazaSinEscribir(`submódulo con ${nombre}`, () => e.addSubmodule(inicial, sub(extra)), [SUBMODULOS], conError("invalid"));
  await rechazaSinEscribir("submódulo de un módulo que no existe", () => e.addSubmodule(inicial, sub({ moduleId: FANTASMA })), [SUBMODULOS]);

  seccion("addSubmodule · el camino feliz");
  r = await e.addSubmodule(inicial, sub());
  ok("el submódulo se da de alta", r.ok === true, r.error);
  const sm = await una<{ id: string; module_id: string; serial_number: string }>(
    `select id, module_id, serial_number from ${ESQUEMA}.equipment_submodules where name = '${TAG} detector'`,
  );
  ok("colgado de su módulo, con número de serie", sm?.module_id === mod.id && sm.serial_number === "SN-0002");
  if (!sm) throw new Error("sin el submódulo no se puede seguir");

  /* ══ deleteEquipmentItem ════════════════════════════════════════════════ */
  /*
    La foto es el ÁRBOL entero y no un conteo: un borrado con el `kind`
    equivocado se llevaría otra pieza y el total de una sola tabla no lo vería.
  */
  const ARBOL = [EQUIPOS, MODULOS, SUBMODULOS];
  const borrar = (kind: string, id: string | undefined) => e.deleteEquipmentItem(forma({ kind, id, ownerId: CLIENTE }));

  seccion("deleteEquipmentItem · la guardia");
  for (const [nombre, quien] of sinPermiso("servicio")) {
    quien();
    await rechazaSinEscribir(`borrar el submódulo ${nombre}`, () => borrar("submodule", sm.id), ARBOL);
    await rechazaSinEscribir(`borrar el equipo ${nombre}`, () => borrar("equipment", eq.id), ARBOL);
  }

  /*
    `String(formData.get("id"))` convertía la ausencia en "null": pasaba la
    guardia y Postgres reventaba al compararlo con un uuid.
  */
  seccion("deleteEquipmentItem · la captura inválida no borra ni revienta");
  como(STAFF, "servicio:editar");
  await rechazaSinEscribir("un tipo que no existe", () => borrar("todo", eq.id), ARBOL);
  await rechazaSinEscribir("el id de un equipo con el tipo «módulo»", () => borrar("module", eq.id), ARBOL);
  await rechazaSinEscribir("sin id", () => borrar("equipment", undefined), ARBOL);
  await rechazaSinEscribir("con un id que no es uuid", () => borrar("equipment", "no-soy-un-uuid"), ARBOL);

  seccion("deleteEquipmentItem · el camino feliz deja la foto de lo borrado");
  const borrado = async (tipo: string, id: string) =>
    una<{ actor_id: string; payload: { snapshot?: { name?: string } } }>(
      `select actor_id, payload from ${ESQUEMA}.domain_events where aggregate_id = '${id}' and event_type = '${tipo}'`,
    );
  await borrar("submodule", sm.id);
  ok("el submódulo se borra", (await cuantos("equipment_submodules", `where id = '${sm.id}'`)) === 0);
  let ev = await borrado("equipment_submodule.deleted", sm.id);
  ok(
    "y queda su foto en la bitácora, firmada",
    ev?.actor_id === STAFF && ev.payload.snapshot?.name === `${TAG} detector`,
    JSON.stringify(ev?.payload).slice(0, 80),
  );
  await borrar("equipment", eq.id);
  ok(
    "el equipo se borra y se lleva su módulo",
    (await cuantos("equipment", `where id = '${eq.id}'`)) === 0 &&
      (await cuantos("equipment_modules", `where id = '${mod.id}'`)) === 0,
  );
  ev = await borrado("equipment.deleted", eq.id);
  ok("con su foto firmada", ev?.actor_id === STAFF && ev.payload.snapshot?.name === `${TAG} HPLC`);

  /* ══ createPart ═════════════════════════════════════════════════════════ */
  /* Una refacción ya existente, para chocar contra su número de parte. */
  await sql.unsafe(
    `insert into ${ESQUEMA}.spare_parts (part_number, description, cost_mxn, stock)
     values ('${TAG}-DUP', '${TAG} refacción que ya existe', 10, 0)`,
  );
  const pieza = (extra: Record<string, string> = {}) =>
    forma({
      partNumber: `  ${TAG.toLowerCase()}-nueva `,
      description: `${TAG} sello de pistón`,
      brand: "Waters",
      costMxn: "$1,234.50",
      costUsd: "USD 12.5",
      priceMxn: "MXN 2,000",
      priceUsd: "",
      stock: "7",
      ...extra,
    });
  const TODO_P = [PIEZAS, MOVS];

  seccion("createPart · la guardia");
  for (const [nombre, quien] of sinPermiso("inventario")) {
    quien();
    await rechazaSinEscribir(`alta de refacción ${nombre}`, () => p.createPart(inicial, pieza()), TODO_P, conError("auth"));
  }
  // Servicio y no inventario: atender tickets no da de alta el catálogo.
  como(STAFF, "servicio:administrar");
  await rechazaSinEscribir("alta con permiso de servicio pero no de inventario", () => p.createPart(inicial, pieza()), TODO_P, conError("auth"));

  /*
    LOS IMPORTES. Un costo negativo entraba SIN SIGNO y uno con letras quedaba
    vacío —«sin costo»— por la limpieza vieja (`[^0-9.]`). Ver `lib/importe.ts`.
  */
  seccion("createPart · importes negativos o con basura, y stock imposible, no se guardan");
  como(STAFF, "inventario:editar");
  for (const [nombre, extra] of [
    ["número de parte de una letra", { partNumber: "X" }],
    ["descripción de dos letras", { description: "ab" }],
    ["costo negativo", { costMxn: "-5" }],
    ["costo en dólares con letras", { costUsd: "abc" }],
    ["precio negativo de un centavo", { priceMxn: "-0.01" }],
    ["precio con texto detrás", { priceUsd: "12 pesos" }],
    ["costo infinito", { costMxn: "Infinity" }],
    ["stock negativo", { stock: "-1" }],
    ["stock con letras", { stock: "muchas" }],
    ["stock con decimales", { stock: "1.5" }],
  ] as const)
    await rechazaSinEscribir(nombre, () => p.createPart(inicial, pieza(extra)), TODO_P, conError("invalid"));

  seccion("createPart · un número de parte repetido, aunque cambie de mayúsculas");
  await rechazaSinEscribir(
    "alta de un número que ya existe",
    () => p.createPart(inicial, pieza({ partNumber: `${TAG.toLowerCase()}-dup` })),
    TODO_P,
    conError("duplicate"),
  );

  seccion("createPart · el camino feliz: normalizado, y el stock por el ledger");
  const alta = await p.createPart(inicial, pieza());
  ok("la refacción se da de alta", alta.ok === true && alta.partNumber === `${TAG}-NUEVA`, alta.error ?? alta.partNumber);
  type Pieza = {
    id: string;
    description: string;
    brand: string | null;
    cost_mxn: string | null;
    cost_usd: string | null;
    price_mxn: string | null;
    price_usd: string | null;
    stock: number;
    active: boolean;
  };
  const FILA_P = `select id, description, brand, cost_mxn, cost_usd, price_mxn, price_usd, stock, active, updated_at
                    from ${ESQUEMA}.spare_parts where part_number = '${TAG}-NUEVA'`;
  let fp = await una<Pieza>(FILA_P);
  ok("el número de parte, recortado y en mayúsculas", Boolean(fp));
  ok(
    "los importes, sin símbolo, comas ni código de moneda",
    fp?.cost_mxn === "1234.50" && fp.cost_usd === "12.50" && fp.price_mxn === "2000.00",
    `${fp?.cost_mxn} · ${fp?.cost_usd} · ${fp?.price_mxn}`,
  );
  ok("un precio vacío queda vacío, no en cero", fp?.price_usd === null, fp?.price_usd ?? "null");
  const apertura = fp
    ? await filas<{ kind: string; quantity: number; balance_after: number; actor_id: string; unit_cost_mxn: string }>(
        `select kind, quantity, balance_after, actor_id, unit_cost_mxn from ${ESQUEMA}.inventory_movements where part_id = '${fp.id}'`,
      )
    : [];
  ok(
    "el stock inicial entra como UN movimiento de apertura, firmado",
    fp?.stock === 7 &&
      apertura.length === 1 &&
      apertura[0]?.kind === "opening" &&
      apertura[0].quantity === 7 &&
      apertura[0].balance_after === 7 &&
      apertura[0].actor_id === STAFF,
    JSON.stringify(apertura),
  );
  ok(`y no aparece en ${AJENO}`, (await cuantos("spare_parts", `where part_number like '${TAG}%'`, AJENO)) === 0);
  if (!fp) throw new Error("sin la refacción no se puede seguir");
  const ID = fp.id;

  /* ══ updatePart ═════════════════════════════════════════════════════════ */
  const FILA_ID = `select part_number, description, brand, cost_mxn, cost_usd, price_mxn, price_usd, stock, active, updated_at
                     from ${ESQUEMA}.spare_parts where id = '${ID}'`;
  const MOVS_ID = `select count(*)::int as n from ${ESQUEMA}.inventory_movements where part_id = '${ID}'`;
  const TODO_U = [FILA_ID, MOVS_ID];
  const edicion = (extra: Record<string, string> = {}) =>
    forma({
      id: ID,
      partNumber: `${TAG}-NUEVA`,
      description: `${TAG} sello de pistón, cerámico`,
      brand: "",
      costMxn: "1,500",
      costUsd: "",
      priceMxn: "$2,500.75",
      priceUsd: "130",
      stock: "10",
      // `active` ausente: la casilla desmarcada no viaja en el formulario.
      ...extra,
    });

  seccion("updatePart · la guardia no toca la fila");
  for (const [nombre, quien] of sinPermiso("inventario")) {
    quien();
    await rechazaSinEscribir(`editar ${nombre}`, () => p.updatePart(inicial, edicion()), TODO_U, conError("auth"));
  }

  seccion("updatePart · importes negativos o con basura no se guardan");
  como(STAFF, "inventario:editar");
  for (const [nombre, extra, error] of [
    ["sin id", { id: "" }, "invalid"],
    ["costo negativo", { costMxn: "-1" }, "invalid"],
    ["costo en dólares negativo", { costUsd: "-0.5" }, "invalid"],
    ["precio con basura", { priceUsd: "basura" }, "invalid"],
    ["precio negativo", { priceMxn: "-10" }, "invalid"],
    ["stock negativo", { stock: "-3" }, "invalid"],
    ["descripción de dos letras", { description: "ab" }, "invalid"],
    ["el número de otra refacción", { partNumber: `${TAG}-DUP` }, "duplicate"],
  ] as const)
    await rechazaSinEscribir(`edición con ${nombre}`, () => p.updatePart(inicial, edicion(extra)), TODO_U, conError(error));
  /*
    Estos dos pasan Zod —el id no se valida ahí— y los para la base: responden
    «server» (con su traza en la consola, que es el registro de la acción) y
    tampoco escriben. Van con un número de parte libre para no quedarse antes
    en el «duplicate».
  */
  await rechazaSinEscribir(
    "edición con un id que no es uuid",
    () => p.updatePart(inicial, edicion({ id: "no-soy-un-uuid", partNumber: `${TAG}-FANTASMA` })),
    [...TODO_U, PIEZAS],
    conError("server"),
  );
  await rechazaSinEscribir(
    "edición de una refacción que no existe",
    () => p.updatePart(inicial, edicion({ id: FANTASMA, partNumber: `${TAG}-FANTASMA` })),
    [...TODO_U, PIEZAS],
    conError("server"),
  );

  seccion("updatePart · el camino feliz: todo lo del formulario se guarda");
  const ed = await p.updatePart(inicial, edicion());
  ok("la edición responde ok", ed.ok === true, ed.error);
  fp = await una<Pieza>(FILA_ID);
  ok("descripción nueva y marca vacía borrada", fp?.description === `${TAG} sello de pistón, cerámico` && fp.brand === null);
  ok(
    "los costos, limpios; el vacío borra",
    fp?.cost_mxn === "1500.00" && fp.cost_usd === null,
    `${fp?.cost_mxn} · ${fp?.cost_usd}`,
  );
  /*
    Los precios se validaban y se tiraban: la acción respondía «guardado» y la
    columna seguía con el valor de antes. Lo encontró este probe.
  */
  ok(
    "los PRECIOS de venta también se guardan",
    fp?.price_mxn === "2500.75" && fp.price_usd === "130.00",
    `${fp?.price_mxn} · ${fp?.price_usd}`,
  );
  ok("la casilla desmarcada la desactiva", fp?.active === false);
  const ajuste = await filas<{ kind: string; quantity: number; balance_after: number; actor_id: string }>(
    `select kind, quantity, balance_after, actor_id from ${ESQUEMA}.inventory_movements
      where part_id = '${ID}' and kind = 'adjustment'`,
  );
  ok(
    "el stock no se escribe: entra la DIFERENCIA como ajuste firmado (7 → 10)",
    fp?.stock === 10 &&
      ajuste.length === 1 &&
      ajuste[0]?.quantity === 3 &&
      ajuste[0].balance_after === 10 &&
      ajuste[0].actor_id === STAFF,
    JSON.stringify(ajuste),
  );
  const movs = await cuantos("inventory_movements", `where part_id = '${ID}'`);
  await p.updatePart(inicial, edicion());
  ok(
    "guardar otra vez con el mismo stock no deja movimiento",
    (await cuantos("inventory_movements", `where part_id = '${ID}'`)) === movs,
  );

  /* ══ buscarRefaccionesAccion ════════════════════════════════════════════ */
  /*
    El buscador filtra por ROL y no por permiso: lo usan cuatro formularios de
    cuatro módulos distintos (bitácora, orden de compra, requisición, negocio),
    y lo que protege es el costo. Un cliente no tiene formulario que lo pida.
  */
  seccion("buscarRefaccionesAccion · el catálogo con costos es solo para el personal");
  como(CLIENTE, false, { rol: "client" });
  const delCliente = await p.buscarRefaccionesAccion(TAG);
  ok("un cliente no recibe nada, aunque su búsqueda coincida", Array.isArray(delCliente) && delCliente.length === 0, String(delCliente.length));

  como(STAFF, "inventario:editar", { rol: "agent" });
  const delAgente = await p.buscarRefaccionesAccion(TAG);
  const dup = delAgente.find((x) => x.partNumber === `${TAG}-DUP`);
  ok("un agente la encuentra, con su costo", dup !== undefined && dup.costMxn === "10.00", JSON.stringify(dup));
  ok(
    "y la desactivada no sale en el buscador",
    !delAgente.some((x) => x.partNumber === `${TAG}-NUEVA`),
  );

  como(STAFF, false, { rol: "sales" });
  ok("un vendedor, que cotiza con ella, también", (await p.buscarRefaccionesAccion(TAG)).length > 0);
});
