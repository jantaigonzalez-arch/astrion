/**
 * LA ACCIÓN QUE GUARDA EL EXPEDIENTE FISCAL.
 *
 *   PROBE_SCHEMA=tenant_evoelution npx tsx --tsconfig tsconfig.probe.json \
 *     --conditions react-server scripts/_probe-clientes-accion.ts
 *
 * ── QUÉ SE PRUEBA AQUÍ Y NO EN `probe-clientes-fiscal` ────────────────────
 *
 * Aquél cubre las REGLAS —qué es un RFC válido, qué uso admite qué régimen— sin
 * tocar la base. Esto cubre lo que solo aporta la acción: que la guardia
 * rechace sin escribir, que lo que se persiste sea lo NORMALIZADO y no lo
 * tecleado, y que el veredicto del SAT caduque cuando cambia un dato que el SAT
 * contrasta —incluida la copia a la bitácora, que es lo que nadie mira hasta
 * que alguien pregunta desde cuándo dejó de valer—.
 */
import "./_env";

async function main() {
  const { default: postgres } = await import("postgres");
  const ESQUEMA = process.env.PROBE_SCHEMA ?? "tenant_evoelution";
  const TAG = `FIS-${Date.now().toString(36).slice(-6).toUpperCase()}`;

  let fallos = 0;
  const ok = (l: string, c: boolean, e = "") => {
    if (!c) fallos++;
    console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
  };

  // Conexión de verificación propia: comprobar el efecto de una acción con la
  // misma conexión que usó la acción daría por buena la pieza bajo sospecha.
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
  const q = async (t: string, f = "") => {
    const [r] = await sql.unsafe(`select count(*)::int as n from ${ESQUEMA}.${t} ${f}`);
    return Number((r as unknown as { n: number }).n);
  };

  const [usuario] = await sql`
    select u.id from users u join memberships m on m.user_id = u.id
     join tenants t on t.id = m.tenant_id
    where t.slug = ${ESQUEMA.replace(/^tenant_/, "")} limit 1`;
  if (!usuario) {
    console.log("· omitida: la base no trae usuarios con membresía.");
    await sql.end();
    process.exit(0);
  }
  const ACTOR = String((usuario as unknown as { id: string }).id);

  // Una organización de trabajo, creada y borrada por este probe.
  const [org] = await sql.unsafe(
    `insert into ${ESQUEMA}.crm_organizations (name) values ('${TAG} Organización') returning id`,
  );
  const ORG = String((org as unknown as { id: string }).id);

  const forma = (campos: Record<string, string>) => {
    const fd = new FormData();
    fd.set("organizationId", ORG);
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return fd;
  };

  const BUENO = {
    rolFiscal: "normal",
    rfc: "AAA010101AA1",
    nombreFiscal: "Comercializadora Ejemplo, S.A. de C.V.",
    regimenFiscal: "601",
    cpFiscal: "64000",
  };

  try {
    delete process.env.PROBE_USER_ID;
    delete process.env.PROBE_PUEDE;
    const { guardarExpedienteFiscal } = await import("@/lib/actions/clientes");

    /* ── 1 · sin sesión ───────────────────────────────────────────────── */
    console.log("\nSIN SESIÓN NI PERMISO");
    let r = await guardarExpedienteFiscal({ ok: false }, forma(BUENO));
    ok("sin sesión, rechaza", r.ok === false, r.error?.slice(0, 40));
    ok("y no escribe expediente", (await q("cliente_fiscal", `where organization_id='${ORG}'`)) === 0);

    process.env.PROBE_USER_ID = ACTOR;
    process.env.PROBE_PUEDE = "false";
    r = await guardarExpedienteFiscal({ ok: false }, forma(BUENO));
    ok(
      "con sesión y sin permiso, rechaza POR LA GUARDIA",
      r.ok === false && r.error === "Solo un administrador puede cambiar los datos fiscales.",
      r.ok ? "pasó" : `dijo «${String(r.error).slice(0, 34)}»`,
    );
    ok("y sigue sin escribir", (await q("cliente_fiscal", `where organization_id='${ORG}'`)) === 0);

    /* ── 2 · con permiso y datos malos ────────────────────────────────── */
    console.log("\nCON PERMISO Y DATOS MALOS");
    process.env.PROBE_PUEDE = "true";

    r = await guardarExpedienteFiscal({ ok: false }, forma({ ...BUENO, rfc: "NO-SOY-UN-RFC" }));
    ok(
      "un RFC mal formado devuelve error EN SU CAMPO",
      r.ok === false && Boolean(r.errores?.some((e) => e.campo === "rfc")),
    );
    r = await guardarExpedienteFiscal({ ok: false }, forma({ ...BUENO, regimenFiscal: "" }));
    ok(
      "sin régimen fiscal, error con el código del SAT",
      r.ok === false && Boolean(r.errores?.some((e) => e.codigo === "CFDI40149")),
    );
    r = await guardarExpedienteFiscal(
      { ok: false },
      forma({ ...BUENO, rolFiscal: "extranjero", rfc: "XEXX010101000", paisResidencia: "USA" }),
    );
    ok(
      "un extranjero sin registro tributario, rechazado",
      r.ok === false &&
        Boolean(r.errores?.some((e) => e.codigo === "extranjero_sin_num_reg_id_trib")),
    );
    ok(
      "y nada de eso escribió",
      (await q("cliente_fiscal", `where organization_id='${ORG}'`)) === 0,
    );

    /* ── 3 · el camino feliz guarda LO NORMALIZADO ────────────────────── */
    console.log("\nSE GUARDA LO QUE SE VA A TIMBRAR, NO LO QUE SE TECLEÓ");
    r = await guardarExpedienteFiscal({ ok: false }, forma(BUENO));
    ok("guarda", r.ok === true, r.error ?? r.errores?.[0]?.mensaje);

    const [fila] = await sql.unsafe(
      `select rfc, nombre_fiscal, nombre_capturado, persona_tipo, regimen_fiscal, cp_fiscal
         from ${ESQUEMA}.cliente_fiscal where organization_id='${ORG}'`,
    );
    const f = fila as unknown as Record<string, string>;
    ok(
      "el nombre se guardó SIN el régimen de capital",
      f?.nombre_fiscal === "COMERCIALIZADORA EJEMPLO",
      f?.nombre_fiscal,
    );
    ok(
      "y lo tecleado se conservó, para poder explicarlo",
      f?.nombre_capturado === BUENO.nombreFiscal,
    );
    ok("el tipo de persona se DERIVÓ del RFC", f?.persona_tipo === "moral", f?.persona_tipo);
    ok(
      "el aviso dice con qué nombre se va a timbrar",
      Boolean(r.mensaje?.includes("COMERCIALIZADORA EJEMPLO")),
      r.mensaje,
    );
    ok(
      "se advierte que el nombre solo lo confirma el SAT",
      Boolean(r.advertencias?.some((a) => a.codigo === "CFDI40147")),
    );
    ok(
      "nace en «no validado», nunca en válido",
      (await q("cliente_validacion_sat", `where organization_id='${ORG}' and resultado='no_validado'`)) === 1,
    );

    /* ── 3b · el domicilio fiscal NO puede tener otro código postal ───── */
    console.log("\nEL DOMICILIO FISCAL COMPARTE EL CP QUE SE TIMBRA");
    ok(
      "guardar el expediente crea su domicilio fiscal",
      (await q("cliente_domicilio", `where organization_id='${ORG}' and tipo='fiscal'`)) === 1,
    );
    const cpsIguales = async () => {
      const [r0] = await sql.unsafe(
        `select f.cp_fiscal, d.cp from ${ESQUEMA}.cliente_fiscal f
           join ${ESQUEMA}.cliente_domicilio d
             on d.organization_id = f.organization_id and d.tipo = 'fiscal'
          where f.organization_id = '${ORG}'`,
      );
      const x = r0 as unknown as { cp_fiscal: string; cp: string } | undefined;
      return Boolean(x) && x!.cp_fiscal === x!.cp;
    };
    ok("y con el MISMO código postal", await cpsIguales());

    /*
      Y no se puede separar ni mandando otro a propósito.

      El CP del domicilio no sale del formulario: sale de lo que se acaba de
      validar. Se comprueba enviando un `cp` distinto en el envío —que es lo que
      haría alguien manipulando la petición— y exigiendo que no cuele.
    */
    const fd = forma({ ...BUENO, calle: "Prueba 100" });
    fd.set("cp", "99999");
    r = await guardarExpedienteFiscal({ ok: false }, fd);
    ok("un CP suelto en el envío no separa los dos", r.ok === true && (await cpsIguales()));

    /* ── 4 · el veredicto caduca al cambiar un dato ───────────────────── */
    console.log("\nUN «VÁLIDO» NO SOBREVIVE A UN CAMBIO DE DATOS");
    await sql.unsafe(
      `update ${ESQUEMA}.cliente_validacion_sat
          set resultado='valido', validado_en=now(), origen='manual'
        where organization_id='${ORG}'`,
    );
    ok(
      "se dejó un veredicto «válido» a mano",
      (await q("cliente_validacion_sat", `where organization_id='${ORG}' and resultado='valido'`)) === 1,
    );

    const logAntes = await q("cliente_validacion_sat_log", `where organization_id='${ORG}'`);
    r = await guardarExpedienteFiscal(
      { ok: false },
      forma({ ...BUENO, nombreFiscal: "Comercializadora Ejemplo Dos" }),
    );
    ok("se cambia el nombre y guarda", r.ok === true, r.error);
    ok(
      "el veredicto volvió a «no validado» SOLO",
      (await q("cliente_validacion_sat", `where organization_id='${ORG}' and resultado='no_validado'`)) === 1,
    );
    ok(
      "y el veredicto viejo quedó en la bitácora, no se perdió",
      (await q("cliente_validacion_sat_log", `where organization_id='${ORG}'`)) === logAntes + 1,
    );

    /* ── 5 · un cambio que NO toca lo que el SAT contrasta ────────────── */
    console.log("\nLO QUE EL SAT NO CONTRASTA NO INVALIDA NADA");
    await sql.unsafe(
      `update ${ESQUEMA}.cliente_validacion_sat set resultado='valido', validado_en=now()
        where organization_id='${ORG}'`,
    );
    const log2 = await q("cliente_validacion_sat_log", `where organization_id='${ORG}'`);
    r = await guardarExpedienteFiscal(
      { ok: false },
      forma({ ...BUENO, nombreFiscal: "Comercializadora Ejemplo Dos", usoCfdiDefault: "G03" }),
    );
    ok("cambiar solo el uso de CFDI guarda", r.ok === true, r.error);
    ok(
      "y NO tumba el veredicto: el uso no viaja en la comprobación del padrón",
      (await q("cliente_validacion_sat", `where organization_id='${ORG}' and resultado='valido'`)) === 1,
    );
    ok(
      "ni escribe en la bitácora",
      (await q("cliente_validacion_sat_log", `where organization_id='${ORG}'`)) === log2,
    );
  } finally {
    await sql
      .unsafe(`delete from ${ESQUEMA}.cliente_validacion_sat_log where organization_id='${ORG}'`)
      .catch(() => {});
    await sql
      .unsafe(`delete from ${ESQUEMA}.crm_organizations where id='${ORG}'`)
      .catch(() => {});
    console.log("— limpieza hecha");
    await sql.end();
  }

  console.log(
    fallos
      ? `\n❌ ${fallos} comprobación(es) fallaron\n`
      : "\n✅ el expediente se guarda normalizado y el veredicto caduca solo\n",
  );
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
