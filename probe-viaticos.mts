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
 *   5 · LO QUE TRAJO LA 0028: que el asunto sea uno de dos y nunca ninguno,
 *       que un gasto no pueda ir a un ticket y a un negocio a la vez, y que un
 *       aprobador NOMBRADO sea el único que puede tocar el documento — ni el
 *       que lo pidió ni otro administrador que pase por ahí.
 *
 * TODO CORRE DENTRO DE UNA TRANSACCIÓN QUE SE DESHACE. La base local es una
 * copia de producción con clientes reales: este probe no puede dejar un viático
 * inventado colgando de un contrato de verdad.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-viaticos.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { sql } = await import("drizzle-orm");
const { computeProfit } = await import("./src/lib/profit.ts");
const { cuadre, saldoEnPalabras } = await import("./src/lib/viaticos.ts");
const { nivelEfectivo } = await import("./src/lib/permisos.ts");
/*
  El dominio, importado de verdad y no reimplementado.

  `reclassifyExpense` es la única transición que se puede ejercitar desde aquí:
  las demás leen `memberships` con `listTenantMembers()`, que necesita el
  contexto de una petición y en un script no existe. Esta no lo necesita —recibe
  `puedeAdministrar` ya resuelto—, así que se prueba el guardia REAL y no una
  copia suya, que es la que se quedaría vieja.
*/
const { reclassifyExpense } = await import("./src/lib/domain/viaticos.ts");

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
ok("y se lee al revés", saldoEnPalabras(falta) === "Por reembolsar al ingeniero");
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

/* ═════════════════ Contra la base, y se deshace ═════════════════ */

console.log("\nLO QUE LA BASE TIENE QUE RECHAZAR");

await db
  .transaction(async (tx: any) => {
    const [{ id: contractId }] = (await tx.execute(
      sql`select id::text as id from contracts limit 1`,
    )) as any;
    const [{ id: userId }] = (await tx.execute(
      sql`select requested_by_id::text as id from (select created_by_id as requested_by_id from tickets limit 1) x`,
    )) as any;
    const [{ id: ticketId }] = (await tx.execute(
      sql`select id::text as id from tickets limit 1`,
    )) as any;

    ok("hay contrato, persona y ticket con los que probar", Boolean(contractId && userId && ticketId));

    const nuevo = async (estado: string, ref: string) => {
      const [f] = (await tx.execute(sql`
        insert into viaticos (reference, contract_id, requested_by_id, destination,
                              purpose, departs_on, returns_on, estimated_mxn, status)
        values (${ref}, ${contractId}::uuid, ${userId}::uuid, 'PROBE', 'PROBE',
                current_date, current_date + 2, 5000, ${estado}::viatico_status)
        returning id::text as id`)) as any;
      return f.id as string;
    };

    /* ── 1 · Las restricciones ── */
    await tx.execute(sql`savepoint s1`);
    const e1 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, contract_id, requested_by_id, destination,
                                purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-MAL-1', ${contractId}::uuid, ${userId}::uuid, 'X', 'X',
                  current_date, current_date - 1, 5000)`,
    );
    ok("un regreso anterior a la salida se rechaza", e1 === "23514", `dio ${e1}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const e2 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, contract_id, requested_by_id, destination,
                                purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-MAL-2', ${contractId}::uuid, ${userId}::uuid, 'X', 'X',
                  current_date, current_date, 0)`,
    );
    ok("pedir cero se rechaza", e2 === "23514", `dio ${e2}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const vId = await nuevo("autorizado", "PROBE-V-1");

    const e3 = await debeFallar(
      tx,
      sql`insert into viatico_expenses (viatico_id, ticket_id, category, description, amount_mxn, spent_on)
          values (${vId}::uuid, ${ticketId}::uuid, 'otros', 'sin especificar', 100, current_date)`,
    );
    ok("«otros» sin especificar se rechaza", e3 === "23514", `dio ${e3}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const vId2 = await nuevo("autorizado", "PROBE-V-1");
    const e4 = await debeFallar(
      tx,
      sql`insert into viatico_expenses (viatico_id, ticket_id, category, description, amount_mxn, spent_on)
          values (${vId2}::uuid, ${ticketId}::uuid, 'hotel', 'importe cero', 0, current_date)`,
    );
    ok("un gasto en cero se rechaza", e4 === "23514", `dio ${e4}`);
    await tx.execute(sql`rollback to savepoint s1`);

    /* La campana: exactamente un asunto. */
    const e5 = await debeFallar(
      tx,
      sql`insert into notifications (user_id, kind, title) values (${userId}::uuid, 'x', 'sin asunto')`,
    );
    ok("un aviso SIN asunto se rechaza", e5 === "23514", `dio ${e5}`);
    await tx.execute(sql`rollback to savepoint s1`);

    const vId3 = await nuevo("enviado", "PROBE-V-2");
    const e6 = await debeFallar(
      tx,
      sql`insert into notifications (user_id, kind, title, ticket_id, viatico_id)
          values (${userId}::uuid, 'x', 'dos asuntos', ${ticketId}::uuid, ${vId3}::uuid)`,
    );
    ok("un aviso con DOS asuntos se rechaza", e6 === "23514", `dio ${e6}`);
    await tx.execute(sql`rollback to savepoint s1`);

    /* Y los dos que sí valen. */
    const vId4 = await nuevo("enviado", "PROBE-V-3");
    await tx.execute(sql`insert into notifications (user_id, kind, title, viatico_id)
                         values (${userId}::uuid, 'viatico.enviado', 'ok', ${vId4}::uuid)`);
    await tx.execute(sql`insert into notifications (user_id, kind, title, ticket_id)
                         values (${userId}::uuid, 'ticket.creado', 'ok', ${ticketId}::uuid)`);
    ok("un aviso de viático y uno de ticket sí entran", true);

    /* ── 3 · Solo cuenta lo cerrado ── */
    console.log("\nSOLO EL VIÁTICO CERRADO CUENTA EN LA UTILIDAD");
    const estados = ["borrador", "enviado", "autorizado", "en_revision", "cerrado"];
    for (const [i, e] of estados.entries()) {
      const id = await nuevo(e, `PROBE-EST-${i}`);
      await tx.execute(sql`
        insert into viatico_expenses (viatico_id, ticket_id, category, description, amount_mxn, spent_on)
        values (${id}::uuid, ${ticketId}::uuid, 'hotel', 'PROBE', 1000, current_date)`);
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

    console.log("\nEL ASUNTO ES UNO DE DOS, Y LA BASE LO EXIGE");

    /* El que sí vale: viaje a prospecto, con su negocio y su aprobador. */
    const [vProsp] = (await tx.execute(sql`
      insert into viaticos (reference, organization_id, deal_id, requested_by_id,
                            approver_id, destination, purpose, departs_on, returns_on,
                            estimated_mxn, status)
      values ('PROBE-28-OK', ${A.org}::uuid, ${A.deal}::uuid, ${userId}::uuid,
              ${userId}::uuid, 'PROBE', 'PROBE', current_date, current_date + 1,
              5000, 'en_revision')
      returning id::text as id`)) as any;
    ok("un viaje a prospecto con negocio SÍ entra", Boolean(vProsp?.id));

    /*
      El gasto comercial suelto: sin ticket y sin negocio. Es el caso que la
      0028 vino a permitir, así que tiene que entrar sin protestar — y es el
      renglón sobre el que se prueba después quién puede moverlo.
    */
    const [gCom] = (await tx.execute(sql`
      insert into viatico_expenses (viatico_id, category, description, amount_mxn, spent_on)
      values (${vProsp.id}::uuid, 'comida', 'comida de prospección', 800, current_date)
      returning id::text as id`)) as any;
    ok("un gasto comercial SIN ticket ni negocio sí entra", Boolean(gCom?.id));

    await tx.execute(sql`savepoint s28`);

    const a1 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, requested_by_id, destination, purpose,
                                departs_on, returns_on, estimated_mxn)
          values ('PROBE-28-A', ${userId}::uuid, 'X', 'X',
                  current_date, current_date, 5000)`,
    );
    ok("un viático SIN asunto se rechaza", a1 === "23514", `dio ${a1}`);
    await tx.execute(sql`rollback to savepoint s28`);

    const a2 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, contract_id, organization_id, requested_by_id,
                                destination, purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-28-B', ${contractId}::uuid, ${A.org}::uuid, ${userId}::uuid,
                  'X', 'X', current_date, current_date, 5000)`,
    );
    ok("un viático con LOS DOS asuntos se rechaza", a2 === "23514", `dio ${a2}`);
    await tx.execute(sql`rollback to savepoint s28`);

    // El negocio cuelga del prospecto, no del contrato: sin esto se podría
    // guardar un viático de contrato con una oportunidad pegada, y nadie sabría
    // qué significa esa combinación.
    const a3 = await debeFallar(
      tx,
      sql`insert into viaticos (reference, contract_id, deal_id, requested_by_id,
                                destination, purpose, departs_on, returns_on, estimated_mxn)
          values ('PROBE-28-C', ${contractId}::uuid, ${A.deal}::uuid, ${userId}::uuid,
                  'X', 'X', current_date, current_date, 5000)`,
    );
    ok("un negocio colgado de un CONTRATO se rechaza", a3 === "23514", `dio ${a3}`);
    await tx.execute(sql`rollback to savepoint s28`);

    console.log("\nEL GASTO VA A UN SITIO, A OTRO O A NINGUNO");

    const g1 = await debeFallar(
      tx,
      sql`insert into viatico_expenses (viatico_id, ticket_id, deal_id, category,
                                        description, amount_mxn, spent_on)
          values (${vProsp.id}::uuid, ${ticketId}::uuid, ${A.deal}::uuid, 'comida',
                  'a dos sitios', 100, current_date)`,
    );
    ok("un gasto con ticket Y negocio se rechaza", g1 === "23514", `dio ${g1}`);
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
      !rCruzado.ok && rCruzado.reason.includes("no es de la empresa"),
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
      select deal_id::text as deal, reclassified_by_id::text as quien
        from viatico_expenses where id = ${gCom.id}::uuid`)) as any;
    ok("quedó cargado al negocio", gDespues.deal === A.deal, `dio ${gDespues.deal}`);
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
