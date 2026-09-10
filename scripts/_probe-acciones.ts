/**
 * LAS ACCIONES DE SERVIDOR DE DINERO. LA PRIMERA PRUEBA QUE LAS TOCA.
 *
 * Cómo se corre:
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-acciones.ts
 *
 * ── POR QUÉ NO HABÍA NINGUNA, Y QUÉ CAMBIÓ ─────────────────────────────────
 *
 * Hay 137 acciones exportadas en 24 archivos y ni un solo probe importaba una.
 * No era desidia: TODAS abren con `if (!session?.user || !(await puedeEn(…)))`,
 * y el stub de sesión devolvía `null`, así que cualquier intento de ejercitar
 * una devolvía «auth» sin llegar a tocar la base. Se probaba el portero y nunca
 * la casa.
 *
 * Ahora `_stub-auth` fabrica una sesión cuando se le pide por entorno
 * (`PROBE_USER_ID`) y `_stub-tenancy` sabe decir que NO (`PROBE_PUEDE=false`).
 * Con esas dos palancas los dos caminos de cada guardia se pueden recorrer.
 *
 * ── QUÉ COMPRUEBA, Y QUÉ DELIBERADAMENTE NO ───────────────────────────────
 *
 * Solo lo que aporta la CAPA DE ACCIÓN, que es lo que estaba sin cubrir:
 *
 *   · que la guardia rechace, y —lo que importa— que al rechazar NO ESCRIBA;
 *   · que Zod rechace una captura inválida sin dejar rastro en la base;
 *   · que el camino feliz escriba de verdad y dé el actor de la sesión;
 *   · que lo escrito caiga en la empresa de la sesión y en ninguna otra.
 *
 * Lo que NO repite: las reglas de negocio. Que no se pague de más, que un CFDI
 * no entre dos veces, que el saldo salga del ledger — eso lo cubren
 * `probe-payables`, `probe-unapply` y `_probe-budget` contra el dominio, y
 * duplicarlo aquí sería mantener dos pruebas para enterarse de lo mismo.
 *
 * ── LA VERIFICACIÓN NO PASA POR EL STUB ────────────────────────────────────
 *
 * Se cuenta con una conexión propia y consultas con el esquema escrito a mano.
 * Comprobar el efecto de una acción usando la misma conexión que la acción usó
 * daría por buena precisamente la pieza bajo sospecha: si el stub apuntara al
 * esquema equivocado, las dos mirarían al mismo sitio equivocado y todo saldría
 * verde. Es la diferencia entre comprobar y creerse.
 */
import "./_env";

const ESQUEMA = process.env.PROBE_SCHEMA ?? "tenant_evoelution";
/** El otro inquilino de la base sembrada. Existe para que el aislamiento
 *  se pueda comprobar contra algo y no contra la nada. */
const AJENO = process.env.PROBE_SCHEMA_AJENO ?? "tenant_acme";
const TAG = `ACC-${Date.now().toString(36).slice(-6).toUpperCase()}`;

let fallos = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  if (!cond) fallos++;
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

/** FormData a partir de un objeto, que es como llegan de un `<form>`. */
function forma(campos: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos))
    if (v !== undefined) fd.set(k, v);
  return fd;
}

async function main() {
  const { default: postgres } = await import("postgres");

  /*
    Conexión de VERIFICACIÓN, aparte de la que usan las acciones. Sin
    `search_path`: cada consulta nombra su esquema, para que una acción que
    escriba en el sitio equivocado se vea en vez de resolverse sola.
  */
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  const cuantos = async (esquema: string, tabla: string, filtro = "") => {
    const q = `select count(*)::int as n from ${esquema}.${tabla} ${filtro}`;
    const [r] = await sql.unsafe(q);
    return Number((r as { n: number }).n);
  };

  /* ── El usuario con el que se firmará ──────────────────────────────────── */
  const [usuario] = await sql`
    select u.id, u.email from users u
    join memberships m on m.user_id = u.id
    join tenants t on t.id = m.tenant_id
    where t.slug = ${ESQUEMA.replace(/^tenant_/, "")}
    limit 1`;

  if (!usuario) {
    console.log("· omitida: la base no trae ningún usuario con membresía.");
    await sql.end();
    process.exit(0);
  }

  const ACTOR = String(usuario.id);

  /*
    Las acciones se importan DESPUÉS de fijar el entorno de la primera sección.
    `_stub-auth` lee `PROBE_USER_ID` en cada llamada, así que el orden no es
    crítico para él, pero `_stub-tenancy` abre su conexión al primer uso y
    conviene que eso ocurra con el esquema ya decidido.
  */
  delete process.env.PROBE_USER_ID;
  delete process.env.PROBE_PUEDE;

  const pagar = await import("@/lib/actions/payables");
  const compras = await import("@/lib/actions/purchasing");
  const contratos = await import("@/lib/actions/contracts");

  /*
    Todo lo que sigue va dentro de un `try` con la limpieza en el `finally`.

    No es ceremonia: sin él, una excepción a mitad —un esquema que no está, una
    columna renombrada— deja las filas marcadas en la base. En el CI la base es
    efímera y daría igual, pero EN LOCAL `PROBE_SCHEMA` puede apuntar a la copia
    de producción, y ahí un probe que se cae no tiene derecho a dejar basura con
    nombre de proveedor.
  */
  try {
    /* ── 1 · SIN SESIÓN NO SE ESCRIBE ──────────────────────────────────────── */
    console.log("\nSIN SESIÓN");

    const antesFacturas = await cuantos(ESQUEMA, "supplier_invoices");
    const sinSesion = await pagar.createSupplierInvoice(
      { ok: false },
      forma({
        supplierId: "00000000-0000-0000-0000-000000000001",
        subtotal: "1000",
        total: "1160",
        taxTotal: "160",
        issuedAt: "2026-08-01",
      }),
    );
    ok(
      "capturar una factura de proveedor devuelve error",
      sinSesion.ok === false,
    );
    ok(
      "y NO se escribió ninguna factura",
      (await cuantos(ESQUEMA, "supplier_invoices")) === antesFacturas,
    );

    /* ── 2 · CON SESIÓN PERO SIN PERMISO, TAMPOCO ──────────────────────────── */
    console.log("\nCON SESIÓN Y SIN PERMISO");
    process.env.PROBE_USER_ID = ACTOR;
    process.env.PROBE_PUEDE = "false";

    const antesProv = await cuantos(ESQUEMA, "suppliers");

    /*
    CADA UNA CON EL MENSAJE QUE LA GUARDIA DEVUELVE, no solo con `ok === false`.

    La primera versión solo exigía que fallaran, y al ensayarla concediendo el
    permiso —para ver si el probe sabía ponerse rojo— dos de las tres SEGUÍAN
    pasando: la factura falla igual porque el proveedor inventado no existe, y
    el contrato porque sus datos tampoco cuadran. O sea que dos comprobaciones
    de la guardia se cumplían por una razón que no era la guardia, y habrían
    seguido en verde con el permiso roto.

    Comparar el mensaje ata cada una a SU camino: si la guardia deja pasar, el
    error que vuelve es otro —el de validación o el del dominio— y esto lo ve.
  */
    const negadas: Array<
      [string, string, Promise<{ ok: boolean; error?: string }>]
    > = [
      [
        "factura de proveedor",
        "Solo un administrador captura facturas de proveedor.",
        pagar.createSupplierInvoice(
          { ok: false },
          forma({
            supplierId: "00000000-0000-0000-0000-000000000001",
            subtotal: "1000",
            total: "1160",
            taxTotal: "160",
            issuedAt: "2026-08-01",
          }),
        ),
      ],
      [
        "alta de proveedor",
        "No tienes permiso para dar de alta proveedores.",
        compras.createSupplier(
          { ok: false },
          forma({ name: `${TAG} No debe existir` }),
        ),
      ],
      [
        // `createContract` contesta «auth» a secas, sin frase. Se compara con lo
        // que devuelve y no con lo que debería devolver: una prueba no es el
        // sitio para corregir el mensaje de otra capa a base de fallar.
        "alta de contrato",
        "auth",
        contratos.createContract(
          { ok: false },
          forma({
            number: `${TAG}-NO`,
            clientId: ACTOR,
            amountMxn: "1000",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
          }),
        ),
      ],
    ];

    for (const [nombre, mensaje, promesa] of negadas) {
      const r = await promesa;
      ok(
        `${nombre}: rechazada POR LA GUARDIA`,
        r.ok === false && r.error === mensaje,
        r.ok ? "pasó" : `dijo «${String(r.error).slice(0, 42)}»`,
      );
    }

    ok(
      "y ninguna dejó rastro: los proveedores no cambiaron",
      (await cuantos(ESQUEMA, "suppliers")) === antesProv,
    );
    ok(
      "ni las facturas",
      (await cuantos(ESQUEMA, "supplier_invoices")) === antesFacturas,
    );
    ok(
      "ni los contratos",
      (await cuantos(ESQUEMA, "contracts", `where number like '${TAG}%'`)) ===
        0,
    );

    /* ── 3 · CON PERMISO, PERO CON BASURA ──────────────────────────────────── */
    console.log("\nCON PERMISO Y CAPTURA INVÁLIDA");
    process.env.PROBE_PUEDE = "true";

    const basura: Array<[string, Promise<{ ok: boolean; error?: string }>]> = [
      [
        "proveedor sin nombre",
        compras.createSupplier({ ok: false }, forma({ name: "" })),
      ],
      [
        "factura con proveedor que no es un uuid",
        pagar.createSupplierInvoice(
          { ok: false },
          forma({
            supplierId: "no-soy-un-uuid",
            subtotal: "1",
            total: "1",
            issuedAt: "2026-08-01",
          }),
        ),
      ],
      [
        "contrato con importe que no es un número",
        contratos.createContract(
          { ok: false },
          forma({
            number: `${TAG}-BASURA`,
            clientId: ACTOR,
            amountMxn: "mil pesos",
            startDate: "2026-01-01",
            endDate: "2026-12-31",
          }),
        ),
      ],
    ];

    for (const [nombre, promesa] of basura) {
      const r = await promesa;
      ok(
        `${nombre}: rechazada por validación`,
        r.ok === false,
        r.error?.slice(0, 46),
      );
    }

    ok(
      "la basura tampoco escribe proveedores",
      (await cuantos(ESQUEMA, "suppliers")) === antesProv,
    );
    ok(
      "ni contratos",
      (await cuantos(ESQUEMA, "contracts", `where number like '${TAG}%'`)) ===
        0,
    );

    /* ── 4 · EL CAMINO FELIZ ESCRIBE, Y FIRMA ──────────────────────────────── */
    console.log("\nCON PERMISO Y DATOS BUENOS");

    const ajenoAntes = await cuantos(AJENO, "suppliers").catch(() => -1);

    const alta = await compras.createSupplier(
      { ok: false },
      forma({
        name: `${TAG} Proveedor`,
        currency: "MXN",
        paymentTermsDays: "30",
      }),
    );
    ok("el alta de proveedor responde ok", alta.ok === true, alta.error);
    ok(
      "y el proveedor está en la base",
      (await cuantos(ESQUEMA, "suppliers", `where name like '${TAG}%'`)) === 1,
    );

    const [prov] = await sql.unsafe(
      `select id from ${ESQUEMA}.suppliers where name like '${TAG}%' limit 1`,
    );

    const factura = await pagar.createSupplierInvoice(
      { ok: false },
      forma({
        supplierId: String((prov as { id: string }).id),
        subtotal: "1000",
        taxTotal: "160",
        total: "1160",
        issuedAt: "2026-08-01",
      }),
    );
    ok("la factura se captura", factura.ok === true, factura.error);

    /*
    EL ACTOR ES LO QUE SOLO LA ACCIÓN APORTA. El dominio recibe `actorId` como
    parámetro y no sabe de sesiones; que ahí llegue la persona correcta —y no
    `null`, que es lo que llevaba el importador y dejó 633 tickets sin técnico—
    es exactamente el pegamento que esta capa añade y que nadie comprobaba.
  */
    const [guardada] = await sql.unsafe(
      `select created_by_id from ${ESQUEMA}.supplier_invoices
     where supplier_id = '${String((prov as { id: string }).id)}' limit 1`,
    );
    ok(
      "y queda firmada por el usuario de la sesión",
      String((guardada as { created_by_id: string | null })?.created_by_id) ===
        ACTOR,
      `esperado ${ACTOR.slice(0, 8)}…, guardado ${String((guardada as { created_by_id: string | null })?.created_by_id).slice(0, 8)}…`,
    );

    /* ── 5 · AISLAMIENTO ───────────────────────────────────────────────────── */
    console.log("\nLO ESCRITO NO SE SALE DE LA EMPRESA");

    if (ajenoAntes < 0) {
      console.log(
        `· sin ${AJENO} en esta base: el aislamiento no se puede medir`,
      );
    } else {
      ok(
        `la empresa ajena (${AJENO}) no ganó proveedores`,
        (await cuantos(AJENO, "suppliers")) === ajenoAntes,
      );
      ok(
        "y no tiene nada con la marca de este probe",
        (await cuantos(AJENO, "suppliers", `where name like '${TAG}%'`)) === 0,
      );
    }
  } finally {
    await sql
      .unsafe(
        `delete from ${ESQUEMA}.supplier_invoices where supplier_id in (
           select id from ${ESQUEMA}.suppliers where name like '${TAG}%')`,
      )
      .catch(() => {});
    await sql
      .unsafe(`delete from ${ESQUEMA}.suppliers where name like '${TAG}%'`)
      .catch(() => {});
    await sql
      .unsafe(`delete from ${ESQUEMA}.contracts where number like '${TAG}%'`)
      .catch(() => {});
    console.log("— limpieza hecha");
    await sql.end();
  }

  console.log(
    fallos
      ? `\n❌ ${fallos} comprobación(es) fallaron\n`
      : "\n✅ las acciones de dinero rechazan sin permiso, validan y firman\n",
  );
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
