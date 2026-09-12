/* eslint-disable @typescript-eslint/no-explicit-any --
   Este probe habla con la base por `execute` crudo, que devuelve filas sin
   forma: describir a mano la de cada `select` sería copiar el esquema a un
   archivo que no se exporta ni entra en la aplicación, y esa copia es
   exactamente la que se desincroniza. Los `any` están acotados a las filas
   leídas y a los savepoints; lo que se comprueba son valores concretos. */
/**
 * VIÁTICOS: LOS CONTROLES SE SOSTIENEN.
 *
 * Un módulo de gastos vale lo que valen sus controles, así que esto no comprueba
 * que las pantallas pinten: comprueba que lo que NO debe poder hacerse, no se
 * pueda. Y lo hace contra la base de verdad, no contra una foto de resultados.
 *
 * Se prueban cuatro cosas, y las tres primeras son las que sostienen el módulo:
 *
 *   1 · LAS RESTRICCIONES DE LA BASE. «Otros» sin especificar, importes en
 *       cero, un regreso anterior a la salida y un aviso sin asunto tienen que
 *       ser RECHAZADOS por Postgres, no solo por el formulario. Una validación
 *       que vive únicamente en la pantalla se salta desde cualquier otro camino
 *       que escriba en la tabla.
 *
 *   2 · QUIÉN PIDE NO FIRMA. Es la regla entera del módulo, y se comprueba
 *       sobre la tabla de transiciones y sobre el guardia de firma.
 *
 *   3 · SOLO CUENTA LO CERRADO. Un anticipo autorizado no es un costo. Se mete
 *       un viático en cada estado y se exige que la utilidad solo vea el
 *       cerrado.
 *
 *   4 · EL REPARTO DE PERMISOS del rol nuevo, módulo por módulo.
 *
 *   5 · LO QUE TRAJO LA 0028: que un gasto no pueda ir a un ticket y a un
 *       negocio a la vez, y que un aprobador NOMBRADO sea el único que puede
 *       tocar el documento — ni el que lo pidió ni otro administrador que pase
 *       por ahí.
 *
 *   6 · LO QUE TRAJO LA 0037: el destino dejó la cabecera y vive en
 *       `viatico_destinos`. Que el tipo y sus llaves no se contradigan, que un
 *       viaje no repita contrato ni empresa, que un ticket o un negocio siempre
 *       estén DENTRO de un destino, y que cada tope de destinos POR TIPO
 *       —contratos, visitas, prospectos— no salga de 1..20.
 *
 * TODO CORRE DENTRO DE UNA TRANSACCIÓN QUE SE DESHACE, y además contra la base
 * de PRUEBAS: `.env.local` apunta a la copia de producción, con clientes reales,
 * y este probe no puede dejar un viático inventado colgando de un contrato de
 * verdad —ni siquiera durante lo que tarda en deshacerse—.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-viaticos.mts
 */
import { config } from "dotenv";

/*
  LA BASE SE FIJA ANTES DE CARGAR `.env.local`, y es la de pruebas.

  Antes este probe leía `.env.local` a secas y, corrido a mano sin
  `DATABASE_URL`, iba a la copia de producción. Ahora hace lo mismo que el kit
  de las pruebas de acciones: toma la URL de `pruebas/base.ts` —la del entorno
  si la hay (el CI la pone), si no el servidor de `.env.local` con la base
  `evoelution_ci`— y se niega a arrancar contra una base cuyo nombre no termine
  en `_ci`, `_test` o `_pruebas`. dotenv no pisa lo que ya está, así que cargar
  `.env.local` después no la cambia.
*/
const { urlDePruebas } = await import("./pruebas/base.ts");
const URL_BASE = urlDePruebas();
const NOMBRE_BASE = URL_BASE ? new URL(URL_BASE).pathname.replace(/^\//, "") : "";
if (!URL_BASE || !/_(ci|test|pruebas)$/.test(NOMBRE_BASE)) {
  console.error(
    `✗ Me niego a correr contra «${NOMBRE_BASE || "?"}»: solo contra una base de pruebas ` +
      "(_ci, _test o _pruebas). Levantala con: npm run pruebas:base",
  );
  process.exit(1);
}
process.env.DATABASE_URL = URL_BASE;
config({ path: ".env.local", quiet: true });

const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { sql } = await import("drizzle-orm");
const { computeProfit } = await import("./src/lib/profit.ts");
const { cuadre, saldoEnPalabras, consumoPorRubro, diasDeViaje, estimadoSugerido } =
  await import("./src/lib/viaticos.ts");
const { nivelEfectivo } = await import("./src/lib/permisos.ts");
/*
  El dominio, importado de verdad y no reimplementado.

  `reclassifyExpense` es la única transición que se puede ejercitar desde aquí:
  las demás leen `memberships` con `listTenantMembers()`, que necesita el
  contexto de una petición y en un script no existe. Esta no lo necesita —recibe
  `puedeAdministrar` ya resuelto—, así que se prueba el guardia REAL y no una
  copia suya, que es la que se quedaría vieja.
*/
const { reclassifyExpense, addExpense } = await import("./src/lib/domain/viaticos.ts");
const hoy = new Date().toISOString().slice(0, 10);

const db = tenantDbFor("tenant_evoelution");
let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

/** Corre algo que DEBE fallar y devuelve el código de error de Postgres. */
async function debeFallar(tx: any, q: any): Promise<string | null> {
  try {
    await tx.execute(q);
    return null;
  } catch (e: any) {
    // La restricción viola la transacción entera, así que cada intento va en su
    // propio savepoint. Sin esto, el primer rechazo aborta lo que queda.
    return e?.cause?.code ?? e?.code ?? "error";
  }
}

/**
 * Como `debeFallar`, pero dice QUÉ restricción saltó.
 *
 * Desde la 0037 un mismo `insert` puede chocar con dos CHECK distintos del
 * mismo código (23514): un gasto con ticket y sin destino viola
 * `en_destino_ck`, y uno con ticket y negocio, `destino_ck`. Comparar solo el
 * código daría verde aunque saltara la que no es — y la que se quiere probar
 * podría no existir.
 */
async function restriccionQueSalta(tx: any, q: any): Promise<string | null> {
  try {
    await tx.execute(q);
    return null;
  } catch (e: any) {
    return e?.cause?.constraint_name ?? e?.constraint_name ?? `sin nombre (${e?.cause?.code ?? e?.code})`;
  }
}

/* ═════════════════ 4 · Permisos (puro, sin base) ═════════════════ */

console.log("\nEL REPARTO DE PERMISOS DEL ROL GENERAL");
const esperado: Record<string, string> = {
  servicio: "ver",
  ventas: "ninguno",
  clientes: "ninguno",
  inventario: "ninguno",
  compras: "administrar",
  pagar: "administrar",
  viaticos: "administrar",
  analisis: "ninguno",
  configuracion: "ninguno",
};
for (const [modulo, nivel] of Object.entries(esperado)) {
  const real = nivelEfectivo("general" as any, null, modulo as any);
  ok(`general · ${modulo.padEnd(14)} = ${nivel}`, real === nivel, `dio «${real}»`);
}

console.log("\nY LO QUE CAMBIÓ PARA LOS DEMÁS");
// Que el módulo nuevo no le haya regalado acceso a nadie es la propiedad que
// permite desplegar esto sin revisar cuenta por cuenta.
ok(
  "el agente PIDE viáticos pero no los firma",
  nivelEfectivo("agent" as any, null, "viaticos" as any) === "editar",
);
ok(
  "el vendedor no entra a viáticos",
  nivelEfectivo("sales" as any, null, "viaticos" as any) === "ninguno",
);
ok(
  "el cliente no entra a viáticos",
  nivelEfectivo("client" as any, null, "viaticos" as any) === "ninguno",
);
ok(
  "el administrador los firma",
  nivelEfectivo("admin" as any, null, "viaticos" as any) === "administrar",
);
// El ajuste por persona tiene que poder darle la firma a un agente SIN
// convertirlo en General: es el caso que hace que enrutar por capacidad y no
// por etiqueta de rol sea la decisión correcta.
ok(
  "un ajuste por persona le da la firma a un agente",
  nivelEfectivo("agent" as any, { viaticos: "administrar" }, "viaticos" as any) ===
    "administrar",
);

/* ═════════════════ El cuadre (puro) ═════════════════ */

console.log("\nEL CUADRE DEL ANTICIPO");
const sobra = cuadre(10000, 8500);
ok("sobró dinero → saldo positivo", sobra.saldo === 1500 && !sobra.excedido);
ok("y se lee desde la empresa", saldoEnPalabras(sobra) === "Por devolver a la empresa");
const falta = cuadre(8000, 9200);
ok("se pasó → saldo negativo y marcado", falta.saldo === -1200 && falta.excedido);
ok("y se lee al revés", saldoEnPalabras(falta) === "Por reembolsar a quien viajó");
ok("exacto → ni una cosa ni la otra", cuadre(5000, 5000).saldo === 0);
// Sin anticipo no se divide entre cero.
ok("sin anticipo, consumido = 0 y no NaN", cuadre(0, 500).consumido === 0);

console.log("\nEL VIÁTICO ENTRA EN LA UTILIDAD COMO COSTO SIN INGRESO");
const sinViaje = computeProfit({
  hours: 10,
  parts: [{ quantity: 1, unitCostMxn: "1000", unitPriceMxn: "1500" }],
  laborCostPerHour: 200,
  laborRatePerHour: 500,
});
const conViaje = computeProfit({
  hours: 10,
  parts: [{ quantity: 1, unitCostMxn: "1000", unitPriceMxn: "1500" }],
  laborCostPerHour: 200,
  laborRatePerHour: 500,
  viaticosCost: 3000,
});
ok(
  "el ingreso NO cambia (al cliente no se le factura el vuelo)",
  conViaje.revenue === sinViaje.revenue,
);
ok("el costo sube exactamente el viático", conViaje.cost === sinViaje.cost + 3000);
ok("la utilidad baja exactamente el viático", conViaje.profit === sinViaje.profit - 3000);
ok("y el margen baja", conViaje.margin < sinViaje.margin);
// La compatibilidad hacia atrás importa: todo lo que ya llamaba a computeProfit
// sin viáticos tiene que dar lo mismo que antes.
ok("omitirlo da cero y no cambia nada", sinViaje.viaticosCost === 0);

console.log("\nEL PRESUPUESTO POR RUBRO");

const RUBROS = [
  { id: "r-hotel", name: "Hotel", dailyBudgetMxn: 1500, requiresNote: false },
  { id: "r-comida", name: "Comida", dailyBudgetMxn: 500, requiresNote: false },
  { id: "r-libre", name: "Sin tope", dailyBudgetMxn: null, requiresNote: false },
];

// Salir y volver el mismo día es UN día, no cero: con cero, el tope de todo
// rubro sería cero y cada gasto de un viaje relámpago saldría en rojo.
ok("ida y vuelta el mismo día cuenta como un día", diasDeViaje("2026-03-10", "2026-03-10") === 1);
ok("tres días son tres, contando los dos extremos", diasDeViaje("2026-03-10", "2026-03-12") === 3);

/*
  LA PRUEBA QUE JUSTIFICA COMPARAR TOTALES Y NO GASTOS SUELTOS.

  Una factura de hotel por tres noches es UN renglón de 4 200 que contra el tope
  diario de 1 500 parecería casi el triple de lo autorizado. Contra el tope del
  viaje —1 500 × 3 = 4 500— no se pasó de nada, que es la verdad.
*/
const tresNoches = consumoPorRubro(
  [{ rubroId: "r-hotel", amountMxn: 4200 }],
  RUBROS,
  3,
);
ok(
  "una factura de 3 noches NO se marca contra el tope del viaje",
  tresNoches[0].tope === 4500 && !tresNoches[0].excedido,
  `tope ${tresNoches[0].tope}, excedido ${tresNoches[0].excedido}`,
);

const pasado = consumoPorRubro(
  [
    { rubroId: "r-comida", amountMxn: 900 },
    { rubroId: "r-comida", amountMxn: 400 },
  ],
  RUBROS,
  2,
);
ok(
  "la SUMA del rubro sí se marca, y dice cuánto",
  pasado[0].excedido && pasado[0].exceso === 300,
  `exceso ${pasado[0].exceso}`,
);

// Nulo es «no lo hemos definido», no «no se paga»: convertirlo en cero pondría
// en rojo a toda empresa que no haya configurado nada todavía.
const libre = consumoPorRubro([{ rubroId: "r-libre", amountMxn: 99999 }], RUBROS, 1);
ok("un rubro SIN tope no se marca nunca", libre[0].tope === null && !libre[0].excedido);

// El rubro desactivado —o borrado del catálogo de la prueba— no revienta el
// cálculo: el histórico sigue sumando aunque el nombre ya no esté.
const huerfano = consumoPorRubro([{ rubroId: "r-que-ya-no-existe", amountMxn: 100 }], RUBROS, 1);
ok(
  "un gasto de un rubro que ya no está sigue sumando",
  huerfano[0].gastado === 100 && huerfano[0].tope === null,
);

ok(
  "el estimado sugerido es la suma de los topes por los días",
  estimadoSugerido(RUBROS, 2) === (1500 + 500) * 2,
  `dio ${estimadoSugerido(RUBROS, 2)}`,
);

/* ═════════════════ Contra la base, y se deshace ═════════════════ */

console.log("\nLO QUE LA BASE TIENE QUE RECHAZAR");

await db
  .transaction(async (tx: any) => {
    /*
      Contrato y ticket se eligen JUNTOS: un ticket de un equipo que el contrato
      ampara. Se tomaban por separado —el primero de cada tabla—, y cuando el
      dominio empezó a exigir que el gasto de un viático de contrato vaya a un
      ticket DE ESE contrato (lo encontró `_probe-acciones-viaticos`), el par al
      azar dejó de ser un caso posible.
    */
    const [{ id: contractId, ticket_id: ticketId }] = (await tx.execute(
      sql`select ce.contract_id::text as id, t.id::text as ticket_id
            from contract_equipment ce join tickets t on t.equipment_id = ce.equipment_id
           limit 1`,
    )) as any;
    const [{ id: userId }] = (await tx.execute(
      sql`select requested_by_id::text as id from (select created_by_id as requested_by_id from tickets limit 1) x`,
    )) as any;

    ok("hay contrato, persona y ticket con los que probar", Boolean(contractId && userId && ticketId));

    /*
      LOS RUBROS DE FÁBRICA, por su clave.

      Desde la 0029 el rubro es una fila y no un valor del enum, así que cada
      `insert` necesita su uuid. Se resuelven por `key` —que es inmutable— y no
      por nombre: el nombre lo puede haber cambiado la empresa, y una prueba que
      dependa de eso se rompe el día que alguien escriba «Hospedaje».
    */
    const rubro = async (clave: string) => {
      const [r] = (await tx.execute(
        sql`select id::text as id from viatico_rubros where key = ${clave}`,
      )) as any;
      return r?.id as string;
    };
    const rHotel = await rubro("hotel");
    const rOtros = await rubro("otros");
    ok("los cinco rubros de fábrica están sembrados", Boolean(rHotel && rOtros));

    /*
      Un viático de UN destino de contrato, que es lo que era todo viático
      antes de la 0037. Desde ella la cabecera ya no dice a dónde se va: el
      contrato vive en su fila de `viatico_destinos`, y el gasto con ticket
      tiene que colgar de esa fila (`viatico_expenses_en_destino_ck`), así que
      se devuelven los dos ids.
    */
    const nuevo = async (estado: string, ref: string) => {
      const [f] = (await tx.execute(sql`
        insert into viaticos (reference, requested_by_id, destination,
                              purpose, departs_on, returns_on, estimated_mxn, status)
        values (${ref}, ${userId}::uuid, 'PROBE', 'PROBE',
                current_date, current_date + 2, 5000, ${estado}::viatico_status)
        returning id::text as id`)) as any;
      const [d] = (await tx.execute(sql`
        insert into viatico_destinos (viatico_id, tipo, contract_id)
        values (${f.id}::uuid, 'contrato', ${contractId}::uuid)
        returning id::text as id`)) as any;
      return { id: f.id as string, destino: d.id as string };
    };

    /* ── 1 · Las restricciones ── */
    await tx.execute(sql`savepoint s1`);
    const e1 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, requested_by_id, destination,
                                purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-MAL-1', ${userId}::uuid, 'X', 'X',
                  current_date, current_date - 1, 5000)`,
    );
    ok("un regreso anterior a la salida se rechaza", e1 === "23514", `dio ${e1}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const e2 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, requested_by_id, destination,
                                purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-MAL-2', ${userId}::uuid, 'X', 'X',
                  current_date, current_date, 0)`,
    );
    ok("pedir cero se rechaza", e2 === "23514", `dio ${e2}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const { id: vId } = await nuevo("autorizado", "PROBE-V-1");

    /*
      LA REGLA DE LA NOTA YA NO LA GUARDA LA BASE, Y POR ESO SE PRUEBA AQUÍ.

      Hasta la 0028 un CHECK exigía que la categoría `otros` llevara etiqueta.
      Con el catálogo administrado la regla pasó a ser «los rubros marcados
      `requiresNote`», que depende de otra tabla: un CHECK no puede leerla, así
      que bajó a `addExpense`.

      La migración dice que se perdió algo real —un `insert` a mano puede dejar
      la nota vacía—, y esta prueba es lo que impide que se pierda también la
      regla: se ejercita el dominio de verdad, no una copia suya.
    */
    const sinNota = await addExpense(
      tx,
      {
        viaticoId: vId,
        destino: { tipo: "ticket", ticketId },
        rubroId: rOtros,
        description: "sin especificar",
        amountMxn: 100,
        spentOn: hoy,
      },
      userId,
    );
    ok(
      "un rubro que pide nota la exige, y ya no lo hace un CHECK",
      !sinNota.ok && sinNota.reason.includes("especificar"),
      sinNota.ok ? "lo dejó pasar" : sinNota.reason,
    );

    const conNota = await addExpense(
      tx,
      {
        viaticoId: vId,
        destino: { tipo: "ticket", ticketId },
        rubroId: rOtros,
        note: "envío de paquetería",
        description: "con nota",
        amountMxn: 100,
        spentOn: hoy,
      },
      userId,
    );
    ok("y con la nota puesta entra", conNota.ok, conNota.ok ? "" : conNota.reason);
    await tx.execute(sql`rollback to savepoint s1`);

    /*
      EL BLOQUEO ES UNA OPCIÓN DE CADA RUBRO, Y SE PRUEBA EN LOS DOS MODOS.

      Un interruptor que solo se prueba encendido no demuestra nada: lo que hay
      que sostener es que APAGADO deja pasar —que es lo de fábrica y lo que
      viven hoy los usuarios— y ENCENDIDO rechaza. Con una sola de las dos
      mitades, cambiar el valor por omisión pasaría inadvertido.

      El tope se mide como el aviso: suma del rubro en el viaje contra
      presupuesto × días. Aquí son 2 días × 1 000 = 2 000, y se intenta 2 500.
    */
    console.log("\nEL TOPE BLOQUEA SOLO SI EL RUBRO LO PIDE");
    await tx.execute(sql`update viatico_rubros set daily_budget_mxn = 1000 where key = 'hotel'`);
    const { id: vTope } = await nuevo("autorizado", "PROBE-TOPE");
    await tx.execute(sql`
      update viaticos set departs_on = current_date, returns_on = current_date + 1
       where id = ${vTope}::uuid`);

    const gasto = {
      viaticoId: vTope,
      destino: { tipo: "ticket" as const, ticketId },
      rubroId: rHotel,
      description: "hotel caro",
      amountMxn: 2500,
      spentOn: hoy,
    };

    await tx.execute(sql`update viatico_rubros set blocks_over_budget = false where key = 'hotel'`);
    const suelto = await addExpense(tx, gasto, userId);
    ok(
      "apagado: pasarse del tope SÍ se puede guardar",
      suelto.ok,
      suelto.ok ? "" : suelto.reason,
    );
    await tx.execute(sql`delete from viatico_expenses where viatico_id = ${vTope}::uuid`);

    await tx.execute(sql`update viatico_rubros set blocks_over_budget = true where key = 'hotel'`);
    const frenado = await addExpense(tx, gasto, userId);
    ok(
      "encendido: el mismo gasto se rechaza",
      !frenado.ok && frenado.reason.includes("tope"),
      frenado.ok ? "lo dejó pasar" : frenado.reason,
    );

    // Y por debajo del tope entra igual: un bloqueo que rechaza todo no es un
    // bloqueo, es una avería.
    const cabe = await addExpense(tx, { ...gasto, amountMxn: 1800 }, userId);
    ok("encendido: por debajo del tope entra", cabe.ok, cabe.ok ? "" : cabe.reason);

    // La suma es lo que manda, no el gasto suelto: 1 800 + 500 pasa de 2 000.
    const acumula = await addExpense(tx, { ...gasto, amountMxn: 500 }, userId);
    ok(
      "encendido: bloquea por la SUMA del rubro, no por el gasto suelto",
      !acumula.ok,
      acumula.ok ? "lo dejó pasar" : acumula.reason,
    );

    /*
      Y LO QUE HACE QUE VALGA LA PENA QUE SEA POR RUBRO: que uno bloquee no
      arrastra al de al lado. Con Hotel cerrado a cal y canto, Comida —con tope
      y sin bandera— tiene que seguir dejando pasar y limitarse a marcar.
    */
    await tx.execute(sql`
      update viatico_rubros set daily_budget_mxn = 100, blocks_over_budget = false
       where key = 'comida'`);
    const rComida = await rubro("comida");
    const otroRubro = await addExpense(
      tx,
      { ...gasto, rubroId: rComida, amountMxn: 5000, description: "comida cara" },
      userId,
    );
    ok(
      "un rubro que bloquea NO arrastra a los demás",
      otroRubro.ok,
      otroRubro.ok ? "" : otroRubro.reason,
    );

    await tx.execute(sql`rollback to savepoint s1`);

    const vId2 = await nuevo("autorizado", "PROBE-V-1");
    // Con su destino puesto: sin él saltaría `en_destino_ck` antes que el del
    // importe, con el mismo código, y el aserto pasaría por la razón equivocada.
    const e4 = await restriccionQueSalta(
      tx,
      sql`insert into viatico_expenses (viatico_id, destino_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
          values (${vId2.id}::uuid, ${vId2.destino}::uuid, ${ticketId}::uuid, ${rHotel}::uuid,
                  'importe cero', 0, current_date)`,
    );
    ok("un gasto en cero se rechaza", e4 === "viatico_expenses_importe_ck", `dio ${e4}`);
    await tx.execute(sql`rollback to savepoint s1`);

    /* La campana: exactamente un asunto. */
    const e5 = await debeFallar(
      tx,
      sql`insert into notifications (user_id, kind, title) values (${userId}::uuid, 'x', 'sin asunto')`,
    );
    ok("un aviso SIN asunto se rechaza", e5 === "23514", `dio ${e5}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const { id: vId3 } = await nuevo("enviado", "PROBE-V-2");
    const e6 = await debeFallar(
      tx,
      sql`insert into notifications (user_id, kind, title, ticket_id, viatico_id)
          values (${userId}::uuid, 'x', 'dos asuntos', ${ticketId}::uuid, ${vId3}::uuid)`,
    );
    ok("un aviso con DOS asuntos se rechaza", e6 === "23514", `dio ${e6}`);
    await tx.execute(sql`rollback to savepoint s1`);

    /* Y los dos que sí valen. */
    const { id: vId4 } = await nuevo("enviado", "PROBE-V-3");
    await tx.execute(sql`insert into notifications (user_id, kind, title, viatico_id)
                         values (${userId}::uuid, 'viatico.enviado', 'ok', ${vId4}::uuid)`);
    await tx.execute(sql`insert into notifications (user_id, kind, title, ticket_id)
                         values (${userId}::uuid, 'ticket.creado', 'ok', ${ticketId}::uuid)`);
    ok("un aviso de viático y uno de ticket sí entran", true);

    /* ── 3 · Solo cuenta lo cerrado ── */
    console.log("\nSOLO EL VIÁTICO CERRADO CUENTA EN LA UTILIDAD");
    const estados = ["borrador", "enviado", "autorizado", "en_revision", "cerrado"];
    for (const [i, e] of estados.entries()) {
      const v = await nuevo(e, `PROBE-EST-${i}`);
      await tx.execute(sql`
        insert into viatico_expenses (viatico_id, destino_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
        values (${v.id}::uuid, ${v.destino}::uuid, ${ticketId}::uuid, ${rHotel}::uuid, 'PROBE', 1000, current_date)`);
    }

    const [{ n: totalTodos }] = (await tx.execute(sql`
      select coalesce(sum(g.amount_mxn), 0)::float8 as n
        from viatico_expenses g
        join viaticos v on v.id = g.viatico_id
       where v.reference like 'PROBE-EST-%'`)) as any;
    const [{ n: soloCerrados }] = (await tx.execute(sql`
      select coalesce(sum(g.amount_mxn), 0)::float8 as n
        from viatico_expenses g
        join viaticos v on v.id = g.viatico_id
       where v.reference like 'PROBE-EST-%' and v.status = 'cerrado'`)) as any;

    // Que la comparación PUEDA fallar: si los cinco no se hubieran insertado,
    // los dos números coincidirían en cero y el aserto pasaría sin comprobar nada.
    ok(`se sembraron los cinco estados (${Number(totalTodos)} en total)`, Number(totalTodos) === 5000);
    ok(
      `la utilidad solo ve el cerrado (${Number(soloCerrados)} de ${Number(totalTodos)})`,
      Number(soloCerrados) === 1000,
    );

    /* ── El ticket no se puede borrar si tiene gasto encima ── */
    const e7 = await debeFallar(tx, sql`delete from tickets where id = ${ticketId}::uuid`);
    ok(
      "borrar un ticket con viáticos cargados se rechaza",
      e7 === "23503",
      `dio ${e7}`,
    );
    await tx.execute(sql`rollback to savepoint s1`);

    /* ══════════ 5 · Lo que trajo la 0028 ══════════ */

    /*
      LAS DOS EMPRESAS Y SUS NEGOCIOS SE CREAN AQUÍ, no se buscan.

      La siembra sintética no genera negocios —avisa «el embudo no tiene
      etapas» y los omite—, así que buscarlos habría dejado esta mitad del probe
      sin correr en el CI: verde por no haber probado nada, que es justamente lo
      que este archivo existe para evitar.

      Crearlos también es lo correcto por sí mismo: lo que se comprueba es un
      cruce ENTRE dos empresas distintas, y depender de que el padrón traiga dos
      con oportunidad abierta es depender de un dato que nadie sostiene.

      ── TODO LO QUE HAGA FALTA DESPUÉS SE CREA ANTES DEL SAVEPOINT ──────────

      Cada aserción de restricción termina con `rollback to savepoint s28`,
      porque una violación de CHECK aborta la transacción entera y sin volver al
      savepoint no se puede seguir. El precio es que TODO lo creado después del
      savepoint desaparece en el primer rechazo. Costó dos «Failed query» que no
      nombraban la causa —el insert válido fallaba porque su organización ya no
      existía—, así que el orden es: primero lo que tiene que sobrevivir,
      después el savepoint, y al final lo que se espera que falle.
    */
    const [{ id: pipelineId }] = (await tx.execute(sql`
      insert into crm_pipelines (name) values ('PROBE embudo')
      returning id::text as id`)) as any;
    const [{ id: stageId }] = (await tx.execute(sql`
      insert into crm_stages (pipeline_id, name) values (${pipelineId}::uuid, 'PROBE etapa')
      returning id::text as id`)) as any;

    const crearOrgConNegocio = async (n: string) => {
      const [{ id: org }] = (await tx.execute(sql`
        insert into crm_organizations (name) values (${`PROBE org ${n}`})
        returning id::text as id`)) as any;
      const [{ id: deal }] = (await tx.execute(sql`
        insert into crm_deals (reference, title, pipeline_id, stage_id, organization_id)
        values (${`PROBE-D-${n}`}, ${`PROBE negocio ${n}`}, ${pipelineId}::uuid,
                ${stageId}::uuid, ${org}::uuid)
        returning id::text as id`)) as any;
      return { org: org as string, deal: deal as string };
    };

    const A = await crearOrgConNegocio("A");
    const B = await crearOrgConNegocio("B");
    ok("se crearon dos empresas con negocio para probar", A.org !== B.org);

    /* Otra persona, para las pruebas de firma cruzada. */
    const [{ id: otro }] = (await tx.execute(sql`
      select id::text as id from public.users where id <> ${userId}::uuid limit 1`)) as any;
    ok("hay una segunda persona con la que probar la firma", Boolean(otro));

    console.log("\nUN VIAJE A PROSPECTO, CON SU NEGOCIO, EN SU DESTINO");

    /*
      El viaje a prospecto de la 0028, en la forma de la 0037: la cabecera sin
      asunto y el prospecto —con su negocio— en su fila de destino. Los CHECK
      de «uno de dos asuntos» (`viaticos_asunto_ck`, `viaticos_negocio_ck`) se
      fueron con las columnas; lo que dicen ahora lo dice
      `viatico_destinos_llave_ck`, y se prueba en la sección de la 0037.
    */
    const [vProsp] = (await tx.execute(sql`
      insert into viaticos (reference, requested_by_id, approver_id, destination, purpose,
                            departs_on, returns_on, estimated_mxn, status)
      values ('PROBE-28-OK', ${userId}::uuid, ${userId}::uuid, 'PROBE', 'PROBE',
              current_date, current_date + 1, 5000, 'en_revision')
      returning id::text as id`)) as any;
    const [dProsp] = (await tx.execute(sql`
      insert into viatico_destinos (viatico_id, tipo, organization_id, deal_id)
      values (${vProsp.id}::uuid, 'prospecto', ${A.org}::uuid, ${A.deal}::uuid)
      returning id::text as id`)) as any;
    ok("un viaje a prospecto con negocio SÍ entra", Boolean(vProsp?.id && dProsp?.id));

    /*
      El gasto comercial suelto: sin ticket y sin negocio. Es el caso que la
      0028 vino a permitir, así que tiene que entrar sin protestar — y es el
      renglón sobre el que se prueba después quién puede moverlo. Cuelga del
      único destino, que es donde la 0037 dejó los gastos de antes.
    */
    const [gCom] = (await tx.execute(sql`
      insert into viatico_expenses (viatico_id, destino_id, rubro_id, description, amount_mxn, spent_on)
      values (${vProsp.id}::uuid, ${dProsp.id}::uuid, ${rHotel}::uuid, 'comida de prospección', 800, current_date)
      returning id::text as id`)) as any;
    ok("un gasto comercial SIN ticket ni negocio sí entra", Boolean(gCom?.id));

    await tx.execute(sql`savepoint s28`);

    console.log("\nEL GASTO VA A UN SITIO, A OTRO O A NINGUNO");

    // Con destino: el que tiene que saltar es el de «ticket o negocio», no el
    // de «dentro de un destino».
    const g1 = await restriccionQueSalta(
      tx,
      sql`insert into viatico_expenses (viatico_id, destino_id, ticket_id, deal_id, rubro_id,
                                        description, amount_mxn, spent_on)
          values (${vProsp.id}::uuid, ${dProsp.id}::uuid, ${ticketId}::uuid, ${A.deal}::uuid,
                  ${rHotel}::uuid, 'a dos sitios', 100, current_date)`,
    );
    ok("un gasto con ticket Y negocio se rechaza", g1 === "viatico_expenses_destino_ck", `dio ${g1}`);
    await tx.execute(sql`rollback to savepoint s28`);

    console.log("\nSOLO FIRMA QUIEN TIENE EL VIÁTICO A SU NOMBRE");

    /*
      De aquí en adelante se llama al DOMINIO, no a la base.

      Sus resultados son datos —`{ ok, reason }`— y no excepciones, así que
      ninguno aborta la transacción y no hace falta volver al savepoint entre
      uno y otro. Que se pueda encadenar así es consecuencia de esa decisión de
      diseño, no casualidad.
    */
    const rOtro = await reclassifyExpense(tx, {
      expenseId: gCom.id,
      actorId: otro,
      puedeAdministrar: true,
      destino: { tipo: "negocio", dealId: A.deal },
    });
    ok(
      "otro administrador NO puede firmar lo que no está a su nombre",
      !rOtro.ok && rOtro.reason.includes("otra persona"),
      rOtro.ok ? "lo dejó pasar" : rOtro.reason,
    );

    // El viático está a nombre de quien lo pidió —se puede, la base no lo
    // impide— y aun así no puede firmarlo. Es la regla que sostiene el módulo:
    // tener el documento a tu nombre no te convierte en quien lo revisa.
    const rMio = await reclassifyExpense(tx, {
      expenseId: gCom.id,
      actorId: userId,
      puedeAdministrar: true,
      destino: { tipo: "negocio", dealId: A.deal },
    });
    ok(
      "y quien lo pidió tampoco, aunque lo tenga a su nombre",
      !rMio.ok && rMio.reason.includes("pediste tú"),
      rMio.ok ? "lo dejó pasar" : rMio.reason,
    );

    /* Ahora con un aprobador que NO es el solicitante: tiene que poder. */
    await tx.execute(sql`
      update viaticos set approver_id = ${otro}::uuid where id = ${vProsp.id}::uuid`);

    const rCruzado = await reclassifyExpense(tx, {
      expenseId: gCom.id,
      actorId: otro,
      puedeAdministrar: true,
      // El negocio es de OTRA empresa: cargarle la cena de una a la oportunidad
      // de otra es lo que el informe comercial daría por bueno sin esto.
      destino: { tipo: "negocio", dealId: B.deal },
    });
    ok(
      "un negocio de OTRA empresa se rechaza",
      // Desde la 0037 el negocio tiene que ser de UNA de las empresas del viaje.
      !rCruzado.ok && rCruzado.reason.includes("ninguna de las empresas de este viaje"),
      rCruzado.ok ? "lo dejó pasar" : rCruzado.reason,
    );

    const rOk = await reclassifyExpense(tx, {
      expenseId: gCom.id,
      actorId: otro,
      puedeAdministrar: true,
      destino: { tipo: "negocio", dealId: A.deal },
    });
    ok("el aprobador nombrado SÍ mueve el gasto", rOk.ok, rOk.ok ? "" : rOk.reason);

    const [gDespues] = (await tx.execute(sql`
      select deal_id::text as deal, destino_id::text as destino, reclassified_by_id::text as quien
        from viatico_expenses where id = ${gCom.id}::uuid`)) as any;
    ok("quedó cargado al negocio", gDespues.deal === A.deal, `dio ${gDespues.deal}`);
    // El negocio se lleva su destino: el de la empresa del negocio (0037).
    ok("y dentro del destino de esa empresa", gDespues.destino === dProsp.id, `dio ${gDespues.destino}`);
    // El rastro es media razón de que la columna exista: sin él, meses después
    // nadie puede decir quién decidió que esa cena fuera del negocio.
    ok("y queda escrito quién lo movió", gDespues.quien === otro, `dio ${gDespues.quien}`);

    /* Cerrado ya no se toca: el costo entró en la utilidad. */
    await tx.execute(sql`
      update viaticos set status = 'cerrado' where id = ${vProsp.id}::uuid`);
    const rCerrado = await reclassifyExpense(tx, {
      expenseId: gCom.id,
      actorId: otro,
      puedeAdministrar: true,
      destino: { tipo: "comercial" },
    });
    ok(
      "un viático cerrado ya no se reclasifica",
      !rCerrado.ok && rCerrado.reason.includes("cerrado"),
      rCerrado.ok ? "lo dejó pasar" : rCerrado.reason,
    );

    /* ══════════ 6 · Lo que trajo la 0037 ══════════ */

    /*
      UNA GIRA: contrato + prospecto + visita, y un segundo viaje al MISMO
      contrato. Todo lo que tiene que sobrevivir se crea ANTES del savepoint,
      por lo mismo que en la 0028: cada rechazo vuelve a `s37` y se lleva lo
      creado después.

      La base no clasifica —que la visita sea a un cliente sin contrato
      vigente lo decide `vetoClasificacion` en el dominio, porque cambia con el
      tiempo—; aquí solo se prueba que el TIPO y sus LLAVES no se contradigan.
    */
    console.log("\n0037 · EL DESTINO VIVE EN SU TABLA, Y LA BASE CUIDA SUS LLAVES");

    const [{ id: contrato2 }] = (await tx.execute(sql`
      select id::text as id from contracts where id <> ${contractId}::uuid order by id limit 1`)) as any;
    ok("hay un segundo contrato con el que probar", Boolean(contrato2));

    const [vGira] = (await tx.execute(sql`
      insert into viaticos (reference, requested_by_id, destination, purpose,
                            departs_on, returns_on, estimated_mxn)
      values ('PROBE-37-GIRA', ${userId}::uuid, 'PROBE', 'PROBE', current_date, current_date + 3, 9000)
      returning id::text as id`)) as any;
    const destino = async (q: any) => ((await tx.execute(q)) as any)[0]?.id as string | undefined;
    const dGiraC = await destino(sql`
      insert into viatico_destinos (viatico_id, tipo, contract_id, position)
      values (${vGira.id}::uuid, 'contrato', ${contractId}::uuid, 0) returning id::text as id`);
    const dGiraP = await destino(sql`
      insert into viatico_destinos (viatico_id, tipo, organization_id, deal_id, position)
      values (${vGira.id}::uuid, 'prospecto', ${A.org}::uuid, ${A.deal}::uuid, 1) returning id::text as id`);
    // Una visita sin negocio: el negocio es opcional en los destinos de empresa.
    const dGiraV = await destino(sql`
      insert into viatico_destinos (viatico_id, tipo, organization_id, position)
      values (${vGira.id}::uuid, 'visita', ${B.org}::uuid, 2) returning id::text as id`);
    ok(
      "un viaje con contrato, prospecto con negocio y visita sin negocio SÍ entra",
      Boolean(dGiraC && dGiraP && dGiraV),
    );

    // Los índices únicos son POR VIAJE: el mismo contrato en otro viaje es otro viaje.
    const [vOtro] = (await tx.execute(sql`
      insert into viaticos (reference, requested_by_id, destination, purpose,
                            departs_on, returns_on, estimated_mxn)
      values ('PROBE-37-OTRO', ${userId}::uuid, 'PROBE', 'PROBE', current_date, current_date, 1000)
      returning id::text as id`)) as any;
    const dOtro = await destino(sql`
      insert into viatico_destinos (viatico_id, tipo, contract_id)
      values (${vOtro.id}::uuid, 'contrato', ${contractId}::uuid) returning id::text as id`);
    ok("el mismo contrato en OTRO viaje sí entra", Boolean(dOtro));

    /*
      El gasto general del viaje: sin destino, sin ticket y sin negocio. Es lo
      único que la 0037 deja fuera de un destino, y tiene que entrar.
    */
    const [gGeneral] = (await tx.execute(sql`
      insert into viatico_expenses (viatico_id, rubro_id, description, amount_mxn, spent_on)
      values (${vGira.id}::uuid, ${rHotel}::uuid, 'hotel de la gira', 1500, current_date)
      returning id::text as id`)) as any;
    ok("un gasto general, sin destino ni ticket ni negocio, sí entra", Boolean(gGeneral?.id));
    // Y uno con ticket, dentro de su destino de contrato: el que después
    // impide quitar ese destino del viaje.
    await tx.execute(sql`
      insert into viatico_expenses (viatico_id, destino_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
      values (${vGira.id}::uuid, ${dGiraC}::uuid, ${ticketId}::uuid, ${rHotel}::uuid, 'servicio', 700, current_date)`);

    // La fila de ajustes tiene que existir para poder tocar su CHECK.
    await tx.execute(sql`insert into settings (id) values ('global') on conflict (id) do nothing`);

    await tx.execute(sql`savepoint s37`);

    /** Intenta, dice qué restricción saltó, y vuelve al savepoint. */
    const rechazo = async (q: any) => {
      const r = await restriccionQueSalta(tx, q);
      await tx.execute(sql`rollback to savepoint s37`);
      return r;
    };
    const LLAVE = "viatico_destinos_llave_ck";

    for (const [nombre, q] of [
      [
        "un destino de CONTRATO que además nombra una empresa",
        sql`insert into viatico_destinos (viatico_id, tipo, contract_id, organization_id)
            values (${vOtro.id}::uuid, 'contrato', ${contrato2}::uuid, ${A.org}::uuid)`,
      ],
      [
        "un destino de contrato SIN contrato",
        sql`insert into viatico_destinos (viatico_id, tipo) values (${vOtro.id}::uuid, 'contrato')`,
      ],
      // El negocio es de una empresa, no de un contrato: un contrato con
      // oportunidad pegada es la combinación que nadie sabría leer (era a3).
      [
        "un negocio colgado de un destino de CONTRATO",
        sql`insert into viatico_destinos (viatico_id, tipo, contract_id, deal_id)
            values (${vOtro.id}::uuid, 'contrato', ${contrato2}::uuid, ${A.deal}::uuid)`,
      ],
      [
        "una VISITA sin empresa",
        sql`insert into viatico_destinos (viatico_id, tipo) values (${vOtro.id}::uuid, 'visita')`,
      ],
      [
        "un PROSPECTO sin empresa, aunque traiga negocio",
        sql`insert into viatico_destinos (viatico_id, tipo, deal_id)
            values (${vOtro.id}::uuid, 'prospecto', ${A.deal}::uuid)`,
      ],
      [
        "una visita que además nombra un contrato",
        sql`insert into viatico_destinos (viatico_id, tipo, contract_id, organization_id)
            values (${vOtro.id}::uuid, 'visita', ${contrato2}::uuid, ${B.org}::uuid)`,
      ],
    ] as const) {
      const r = await rechazo(q);
      ok(`${nombre} se rechaza`, r === LLAVE, `dio ${r}`);
    }

    console.log("\n0037 · UN CONTRATO O UNA EMPRESA, UNA SOLA VEZ POR VIAJE");
    const u1 = await rechazo(sql`
      insert into viatico_destinos (viatico_id, tipo, contract_id, position)
      values (${vGira.id}::uuid, 'contrato', ${contractId}::uuid, 5)`);
    ok("el mismo contrato dos veces en un viaje se rechaza", u1 === "viatico_destinos_contrato_unico_idx", `dio ${u1}`);
    // Con OTRO tipo: la unicidad es de la empresa, no del par empresa-tipo. Si
    // no, una empresa podría ir como prospecto y como visita en el mismo viaje
    // y sus gastos no sabrían a cuál de los dos ir.
    const u2 = await rechazo(sql`
      insert into viatico_destinos (viatico_id, tipo, organization_id, position)
      values (${vGira.id}::uuid, 'visita', ${A.org}::uuid, 5)`);
    ok(
      "la misma empresa dos veces en un viaje —aun con otro tipo— se rechaza",
      u2 === "viatico_destinos_organizacion_unico_idx",
      `dio ${u2}`,
    );

    console.log("\n0037 · UN TICKET O UN NEGOCIO SIEMPRE VAN DENTRO DE UN DESTINO");
    const d1 = await rechazo(sql`
      insert into viatico_expenses (viatico_id, ticket_id, rubro_id, description, amount_mxn, spent_on)
      values (${vGira.id}::uuid, ${ticketId}::uuid, ${rHotel}::uuid, 'ticket suelto', 100, current_date)`);
    ok("un gasto con TICKET y sin destino se rechaza", d1 === "viatico_expenses_en_destino_ck", `dio ${d1}`);
    const d2 = await rechazo(sql`
      insert into viatico_expenses (viatico_id, deal_id, rubro_id, description, amount_mxn, spent_on)
      values (${vGira.id}::uuid, ${A.deal}::uuid, ${rHotel}::uuid, 'negocio suelto', 100, current_date)`);
    ok("un gasto con NEGOCIO y sin destino se rechaza", d2 === "viatico_expenses_en_destino_ck", `dio ${d2}`);

    // `restrict`: un destino con gastos no se quita sin decidir antes a dónde van.
    const d3 = await rechazo(sql`delete from viatico_destinos where id = ${dGiraC}::uuid`);
    ok("quitar del viaje un destino con gastos se rechaza", d3 === "viatico_expenses_destino_id_fk", `dio ${d3}`);
    // Y por el otro lado: la ficha de a quien se le viajó no se borra.
    const d4 = await rechazo(sql`delete from contracts where id = ${contractId}::uuid`);
    ok("borrar un contrato al que se le viajó se rechaza", d4 === "viatico_destinos_contract_id_fk", `dio ${d4}`);

    /*
      UN TOPE POR TIPO, Y LOS TRES DE 1 A 20 (`settings_viaticos_max_por_tipo_ck`).

      Un solo CHECK cubre las tres columnas, así que se prueba CADA UNA por
      separado: si alguien quitara una de la condición, las otras dos seguirían
      rechazando y un aserto sobre «el CHECK» a secas daría verde.
    */
    console.log("\n0037 · CADA TOPE POR TIPO VA DE 1 A 20");
    const TOPES = ["viaticos_max_contratos", "viaticos_max_visitas", "viaticos_max_prospectos"] as const;
    for (const columna of TOPES) {
      for (const n of [0, 21]) {
        const r = await rechazo(sql`update settings set ${sql.identifier(columna)} = ${n} where id = 'global'`);
        ok(`${columna} = ${n} se rechaza`, r === "settings_viaticos_max_por_tipo_ck", `dio ${r}`);
      }
      // Los dos bordes entran: un CHECK que rechaza el borde es un CHECK mal escrito.
      for (const n of [1, 20]) {
        const r = await restriccionQueSalta(
          tx,
          sql`update settings set ${sql.identifier(columna)} = ${n} where id = 'global'`,
        );
        ok(`${columna} = ${n} sí entra`, r === null, `dio ${r}`);
      }
    }
    // Una fila recién creada nace con los tres topes en 1: lo de antes de la
    // 0037. Se borra y se vuelve a crear dentro de la transacción que se deshace.
    await tx.execute(sql`delete from settings where id = 'global'`);
    await tx.execute(sql`insert into settings (id) values ('global')`);
    const [nueva] = (await tx.execute(sql`
      select viaticos_max_contratos as c, viaticos_max_visitas as v, viaticos_max_prospectos as p
        from settings where id = 'global'`)) as any;
    ok(
      "una fila de ajustes nueva trae los tres topes en 1",
      Number(nueva?.c) === 1 && Number(nueva?.v) === 1 && Number(nueva?.p) === 1,
      JSON.stringify(nueva),
    );

    /*
      Y BORRAR EL VIAJE SE LLEVA TODO LO SUYO. Los gastos cuelgan del destino
      con `restrict` y los dos cuelgan del viático en `cascade`: se comprueba
      que la cascada no tropieza con el `restrict` —es de lo que dependen las
      limpiezas de todos los probes que crean viáticos—.
    */
    const d5 = await restriccionQueSalta(tx, sql`delete from viaticos where id = ${vGira.id}::uuid`);
    const [{ quedan }] = (await tx.execute(sql`
      select ((select count(*) from viatico_destinos where viatico_id = ${vGira.id}::uuid)
            + (select count(*) from viatico_expenses where viatico_id = ${vGira.id}::uuid))::int as quedan`)) as any;
    ok(
      "borrar un viaje con destinos y gastos se lleva los dos",
      d5 === null && Number(quedan) === 0,
      d5 ? `dio ${d5}` : `quedan ${quedan}`,
    );

    // DESHACER: nada de esto queda. Ver la cabecera.
    throw new Error("__rollback__");
  })
  .catch((e: any) => {
    if (e?.message !== "__rollback__" && !String(e?.message).includes("__rollback__")) {
      console.error("\n✗ el probe se cayó:", e?.message ?? e);
      fallos++;
    }
  });

console.log(
  fallos ? `\n❌ ${fallos} fallo(s)\n` : "\n✅ los controles se sostienen (y la base quedó intacta)\n",
);
process.exit(fallos ? 1 : 0);
