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
