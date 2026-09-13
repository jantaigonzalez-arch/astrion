/**
 * LA CONFIGURACIÓN DE CLIENTES (0038): LA ACCIÓN Y LAS CUATRO PERILLAS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-clientes-config.ts
 *
 * Una acción, `guardarPoliticaClientes`, guarda cuatro decisiones que antes
 * estaban fijas en el código. Aquí se prueba la acción —guardia, nivel,
 * validación y lo que escribe— y, como pide el skill `decisiones-configurables`,
 * CADA PERILLA EN SUS DOS ESTADOS allí donde se hace cumplir:
 *
 *   clientes_sla_horas         `createServiceTicket` → `sla_due_at`
 *   clientes_pruebas           `ES_CLIENTE` → `kindDeOrganizacion` y los
 *                              destinos de viáticos (visitas / prospectos)
 *   clientes_69b_presunto      `vetoLista69b` en `createContract`,
 *   clientes_69b_definitivo    `createServiceTicket` y `createTicket`
 *   clientes_uso_cfdi_omision  `getSettings()` (el prellenado es de pantalla)
 *
 * ── LO QUE NO SE PUEDE COMPROBAR AQUÍ ─────────────────────────────────────
 *
 *   · Que el formulario del expediente nazca con el uso de CFDI por omisión y
 *     que la ficha pinte el aviso 69-B con `avisar`: son de pantalla y hacen
 *     falta un navegador. Aquí se ata lo que las alimenta —`getSettings()` y
 *     que `avisar` no bloquee—.
 *   · `vetoClasificacion` (dominio de viáticos) no se exporta; usa la misma
 *     `ES_CLIENTE` que las dos listas que sí se prueban, y la ejercita
 *     `_probe-acciones-viaticos` al pedir viajes.
 *   · Los avisos por correo de los tickets: arman el enlace con `headers()` y
 *     fuera de una petición lanzan (ver `_probe-acciones-tickets`). Se callan.
 *
 * ── «SIN SESIÓN» AQUÍ ES `como(null, false)` ───────────────────────────────
 *
 * La acción no lee la sesión: su única puerta es `puedeEn`, y el real contesta
 * «no» sin sesión. El stub no mira la sesión, así que se reproduce lo que la
 * aplicación le contesta de verdad a quien no entró (igual que
 * `_probe-acciones-viaticos-config`).
 *
 * ── LOS DATOS ──────────────────────────────────────────────────────────────
 *
 * La siembra trae 88 organizaciones cliente, TODAS solo por cuenta de portal, y
 * ningún embudo: el embudo, la etapa, los negocios, las organizaciones y sus
 * cuentas se crean aquí con la marca de la corrida y se borran al final. Las
 * cuentas creadas nunca firman un evento (`domain_events` es de solo anexar y
 * su `actor_id` es `on delete set null`: una cuenta que firmara ya no se podría
 * borrar); por eso `createServiceTicket` lo firma un agente sembrado y el
 * `createTicket` del cliente lo levanta una cuenta cliente SEMBRADA, a cuya
 * organización solo se le añade —y se le quita al final— el expediente SAT.
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
  foto,
  intentar,
  marca,
  ok,
  probar,
  rechazaSinEscribir,
  seccion,
  sql,
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const S = ESQUEMA;
const TAG = marca("CLICFG");
const CORREO = TAG.toLowerCase();
const SIN_PERMISO = "Solo quien administra Clientes puede cambiar esta configuración.";
const TODAS = ["portal", "pedido", "contrato"] as const;
type Prueba = (typeof TODAS)[number];
type Politica = "nada" | "avisar" | "bloquear";

/** Las cinco columnas de la 0038 y `updated_at`: un rechazo no mueve ninguna. */
const FILA = (esquema = S) =>
  `select clientes_sla_horas, clientes_uso_cfdi_omision, clientes_pruebas,
          clientes_69b_presunto, clientes_69b_definitivo, updated_at
     from ${esquema}.settings where id = 'global'`;

type Fila = {
  clientes_sla_horas: number;
  clientes_uso_cfdi_omision: string | null;
  clientes_pruebas: string[];
  clientes_69b_presunto: string;
  clientes_69b_definitivo: string;
};

type Estado = { ok: boolean; error?: string; message?: string; motivo?: string; reference?: string; number?: string };

async function una<T = Record<string, unknown>>(q: string): Promise<T | undefined> {
  return (await filas<T>(q))[0];
}

async function alta(q: string): Promise<string> {
  const f = await una<{ id: string }>(q);
  if (!f) throw new Error(`el alta de la prueba no devolvió id: ${q.slice(0, 80)}`);
  return f.id;
}

/** Lo que la acción dejó, o el lanzamiento convertido en un estado legible. */
async function llamar(fn: () => Promise<Estado>): Promise<Estado> {
  const r = await intentar(fn);
  if (r.valor) return r.valor;
  return { ok: false, error: r.error ? `reventó: ${r.error}` : `redirigió a ${r.redirige}` };
}

/** Las cinco columnas, sin `updated_at`, o `null` si la empresa no tiene fila. */
async function guardado(esquema = S): Promise<Fila | null> {
  const [f] = await filas<Fila>(FILA(esquema));
  if (!f) return null;
  return {
    clientes_sla_horas: f.clientes_sla_horas,
    clientes_uso_cfdi_omision: f.clientes_uso_cfdi_omision,
    clientes_pruebas: f.clientes_pruebas,
    clientes_69b_presunto: f.clientes_69b_presunto,
    clientes_69b_definitivo: f.clientes_69b_definitivo,
  };
}

/*
  Cada aviso de ticket que falla por `headers()` imprime su pila entera: se
  cuentan y se callan, como en `_probe-acciones-tickets`. Cualquier otro error
  sale como siempre.
*/
const errorOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (args.some((a) => a instanceof Error && /outside a request scope/.test(a.message))) return;
  errorOriginal(...args);
};

void probar("configuración de clientes: la acción y cada perilla en sus dos estados", async () => {
  const SLUG = S.replace(/^tenant_/, "");
  const EMPRESA = (await una<{ id: string }>(`select id from tenants where slug = '${SLUG}'`))?.id;
  if (!EMPRESA) throw new Error(`no existe la empresa ${SLUG}`);
  /*
    Un AGENTE sembrado como sesión del staff: firma los eventos de los tickets
    que se levantan, y por eso tiene que ser una cuenta que no se borra.
  */
  const AGENTE = await usuarioDeLaEmpresa("agent");
  if (!AGENTE) throw new Error("la siembra no trae agentes");

  /* ── 0 · la fila `settings`, guardada para reponerla ────────────────── */
  /*
    SE REPONE COMO ESTABA, Y SOLO LO QUE SE TOCÓ.

    Si la fila existía, las cinco columnas vuelven a su valor. Si no existía
    —así viene la base sembrada—, la acción la crea con un upsert: las cinco
    vuelven a su DEFAULT y la fila se borra solo si TODO lo demás sigue en su
    valor de fábrica, es decir, si es indistinguible de no tener fila. Los
    DEFAULT se leen de `information_schema` en vez de copiarlos aquí: una
    columna nueva en `settings` no puede hacer que esta limpieza borre lo que
    otro guardó.
  */
  /*
    `$3::text::jsonb` y no `$3::jsonb`: con `::jsonb` postgres.js ve un
    parámetro jsonb y le vuelve a pasar `JSON.stringify` a la cadena, así que
    `["portal"]` se guardaba como la CADENA jsonb "[\"portal\"]" —y aquí el
    CHECK de la 0038 la rechazaba y la fila se quedaba sin reponer—. Lo encontró
    este probe al correrlo con una fila de ajustes ya existente.
  */
  const original = await guardado();
  /*
    Registrada PRIMERO para correr la ÚLTIMA (la limpieza va al revés): que la
    fila quedara como estaba se comprueba, no se supone. Un fallo de limpieza el
    kit solo lo imprime y el probe salía verde con la fila cambiada.
  */
  alLimpiar(async () => {
    const [antes, despues] = [JSON.stringify(original), JSON.stringify(await guardado())];
    ok("la limpieza repuso la fila `settings` como estaba", antes === despues, antes === despues ? "" : `${antes} → ${despues}`);
  });
  alLimpiar(async () => {
    if (original) {
      return sql.unsafe(
        `update ${S}.settings
            set clientes_sla_horas = $1, clientes_uso_cfdi_omision = $2,
                clientes_pruebas = $3::text::jsonb, clientes_69b_presunto = $4,
                clientes_69b_definitivo = $5
          where id = 'global'`,
        [
          original.clientes_sla_horas,
          original.clientes_uso_cfdi_omision,
          JSON.stringify(original.clientes_pruebas),
          original.clientes_69b_presunto,
          original.clientes_69b_definitivo,
        ],
      );
    }
    await sql.unsafe(
      `update ${S}.settings
          set clientes_sla_horas = default, clientes_uso_cfdi_omision = default,
              clientes_pruebas = default, clientes_69b_presunto = default,
              clientes_69b_definitivo = default
        where id = 'global'`,
    );
    const cols = await filas<{ c: string; d: string | null }>(
      `select column_name as c, column_default as d from information_schema.columns
        where table_schema = '${S}' and table_name = 'settings'
          and column_name not in ('id', 'updated_at')`,
    );
    const deFabrica = cols
      .map(({ c, d }) => (d ? `"${c}" is not distinct from (${d})` : `"${c}" is null`))
      .join(" and ");
    return sql.unsafe(`delete from ${S}.settings where id = 'global' and ${deFabrica}`);
  });

  /* ── 0b · lo que se crea, en el orden en que se deshace al revés ─────── */

  // Al final de todo, las cuentas: la cascada se lleva membresías, tickets y contratos.
  alLimpiar(() => sql.unsafe(`delete from users where email like '${CORREO}-%'`));
  const cuenta = async (quien: string, miembro = true) => {
    const id = await alta(
      `insert into users (name, email, active)
       values ('${TAG} ${quien}', '${CORREO}-${quien}@probe.invalid', true) returning id`,
    );
    if (miembro) {
      await sql.unsafe(
        `insert into memberships (user_id, tenant_id, role, active)
         values ('${id}', '${EMPRESA}', 'client', true)`,
      );
    }
    return id;
  };
  // Las organizaciones (su expediente SAT se va en cascada), antes que las cuentas.
  borrarAlFinal("crm_organizations", `name like '${TAG}%'`);
  const organizacion = async (sufijo: string, clientId: string | null, slaHoras: number | null = null) =>
    alta(
      `insert into ${S}.crm_organizations (name, client_id, sla_hours)
       values ('${TAG} ${sufijo}', ${clientId ? `'${clientId}'` : "null"}, ${slaHoras ?? "null"})
       returning id`,
    );
  // El embudo se lleva etapas y negocios; antes, los contratos que cuelgan de un negocio.
  borrarAlFinal("crm_pipelines", `name like '${TAG}%'`);
  borrarAlFinal("contracts", `number like '${TAG}%'`);
  borrarAlFinal("tickets", `subject like '${TAG}%'`);

  const c = await import("@/lib/actions/clientes-config");
  const ini = { ok: false };
  const BASE = {
    slaHoras: "2",
    usoCfdi: "",
    pruebas: [...TODAS] as string[],
    lista69bPresunto: "nada",
    lista69bDefinitivo: "nada",
  };
  const guardar = (campos: Record<string, string | string[] | null> = {}) => () =>
    c.guardarPoliticaClientes(ini, forma({ ...BASE, ...campos }));
  /** Guarda con quien sí puede y exige que salga bien: es preparación, no la prueba. */
  const ajustar = async (campos: Record<string, string | string[] | null>) => {
    como(AGENTE, "clientes:administrar");
    const r = await llamar(guardar(campos));
    if (!r.ok) throw new Error(`no se pudo preparar la política: ${r.error} (${JSON.stringify(campos)})`);
  };

  /* ── 1 · la acción ───────────────────────────────────────────────────── */
  seccion("la acción: guardia, nivel y lo que escribe");

  const ajenoAntes = JSON.stringify(await filas(FILA(AJENO)));
  for (const [como_, puede] of [
    ["sin sesión", null],
    ["sin permiso", false],
    ["con «clientes:editar»", "clientes:editar"],
    ["con «configuracion:administrar» y nada de clientes", "configuracion:administrar"],
  ] as const) {
    como(puede === null ? null : AGENTE, puede ?? false);
    await rechazaSinEscribir(
      `política, ${como_}`,
      guardar({ slaHoras: "9", usoCfdi: "G03", pruebas: ["pedido"], lista69bPresunto: "bloquear" }),
      [FILA()],
      conError(SIN_PERMISO),
    );
  }

  como(AGENTE, "clientes:administrar");
  let r = await llamar(
    guardar({
      slaHoras: "9",
      usoCfdi: "G03",
      pruebas: ["pedido", "contrato"],
      lista69bPresunto: "avisar",
      lista69bDefinitivo: "bloquear",
    }),
  );
  let g = await guardado();
  ok("con «clientes:administrar» responde ok", r.ok === true && r.message === "Guardado.", r.error ?? r.message);
  ok(
    "y escribe las CINCO columnas exactamente como llegaron",
    JSON.stringify(g) ===
      JSON.stringify({
        clientes_sla_horas: 9,
        clientes_uso_cfdi_omision: "G03",
        clientes_pruebas: ["pedido", "contrato"],
        clientes_69b_presunto: "avisar",
        clientes_69b_definitivo: "bloquear",
      }),
    JSON.stringify(g),
  );
  ok(`y la fila de ${AJENO} no se movió`, JSON.stringify(await filas(FILA(AJENO))) === ajenoAntes);

  seccion("la acción: la captura inválida se rechaza sin escribir");
  /*
    Ya hay fila, así que la foto lleva `updated_at`: un rechazo que aun así
    escribiera —aunque fuera el mismo valor— movería la fecha y se vería.
  */
  const SLA_MAL = "El SLA general va de 1 a 720 horas (treinta días).";
  for (const [nombre, valor] of [
    ["en cero", "0"],
    ["de 721", "721"],
    ["que no es número", "abc"],
    ["con decimales", "2.5"],
    ["negativo", "-4"],
    ["vacío", ""],
  ] as const) {
    await rechazaSinEscribir(`SLA ${nombre}`, guardar({ slaHoras: valor }), [FILA()], conError(SLA_MAL));
  }
  await rechazaSinEscribir("SLA ausente", guardar({ slaHoras: null }), [FILA()], conError(SLA_MAL));

  const USO_MAL = "El uso de CFDI es una clave del SAT, como G03 o S01.";
  for (const valor of ["G3", "GGGG01", "03", "G03X", "G-03", "uso"]) {
    await rechazaSinEscribir(`uso de CFDI «${valor}»`, guardar({ usoCfdi: valor }), [FILA()], conError(USO_MAL));
  }
  /*
    CONTRA EL CATÁLOGO, SOLO SI ESTÁ CARGADO. Sin catálogo, una clave con forma
    de clave no es inválida: es incomprobable (skill `clientes`), y la acción la
    deja pasar a propósito —el expediente de cada cliente la vuelve a validar
    contra su régimen—. La base de pruebas no carga el catálogo del SAT.
  */
  const usosEnCatalogo = await cuantos("sat_uso_cfdi", "", "public");
  if (usosEnCatalogo > 0) {
    const [fuera] = await filas<{ clave: string }>(
      `select c as clave from (values ('Z99'), ('X98'), ('Q97')) v(c)
        where c not in (select clave from public.sat_uso_cfdi) limit 1`,
    );
    if (fuera) {
      await rechazaSinEscribir(
        `uso de CFDI «${fuera.clave}», con forma pero fuera del catálogo`,
        guardar({ usoCfdi: fuera.clave }),
        [FILA()],
        conError(`«${fuera.clave}» no está en el catálogo de usos de CFDI del SAT.`),
      );
    }
    const [dentro] = await filas<{ clave: string }>(`select clave from public.sat_uso_cfdi order by clave limit 1`);
    r = await llamar(guardar({ usoCfdi: dentro!.clave }));
    ok(
      `uno del catálogo («${dentro!.clave}») se guarda`,
      r.ok === true && (await guardado())?.clientes_uso_cfdi_omision === dentro!.clave,
      r.error,
    );
  } else {
    console.log(
      "· `public.sat_uso_cfdi` está vacío en esta base: el rechazo de una clave fuera del catálogo no se puede comprobar aquí (sin catálogo, la acción solo exige la forma)",
    );
  }

  const PRUEBAS_MAL =
    "Marca al menos una prueba de cliente: sin ninguna, todo el padrón pasaría a Ventas como prospecto.";
  await rechazaSinEscribir("sin ninguna prueba marcada", guardar({ pruebas: null }), [FILA()], conError(PRUEBAS_MAL));
  await rechazaSinEscribir(
    "solo pruebas inventadas",
    guardar({ pruebas: ["cliente", "factura", "PORTAL"] }),
    [FILA()],
    conError(PRUEBAS_MAL),
  );
  const POLITICA_MAL = "Elige qué hacer con la lista 69-B.";
  for (const [campo, valor] of [
    ["lista69bPresunto", "prohibir"],
    ["lista69bDefinitivo", "BLOQUEAR"],
    ["lista69bPresunto", ""],
  ] as const) {
    await rechazaSinEscribir(
      `política 69-B «${valor}» en ${campo}`,
      guardar({ [campo]: valor }),
      [FILA()],
      conError(POLITICA_MAL),
    );
  }

  seccion("la acción: lo que se sanea al guardar");
  r = await llamar(guardar({ pruebas: ["portal", "portal", "pedido", "pedido"] }));
  g = await guardado();
  ok(
    "pruebas repetidas se guardan una sola vez",
    r.ok === true && JSON.stringify(g?.clientes_pruebas) === '["portal","pedido"]',
    JSON.stringify(g?.clientes_pruebas),
  );
  r = await llamar(guardar({ pruebas: ["contrato", "inventada"] }));
  g = await guardado();
  ok(
    "una inventada junto a una buena se descarta y se guarda la buena",
    r.ok === true && JSON.stringify(g?.clientes_pruebas) === '["contrato"]',
    JSON.stringify(g?.clientes_pruebas),
  );
  r = await llamar(guardar({ usoCfdi: "  g03 " }));
  g = await guardado();
  ok(
    "el uso en minúsculas y con espacios se guarda limpio y en mayúsculas",
    r.ok === true && g?.clientes_uso_cfdi_omision === "G03",
    r.error ?? String(g?.clientes_uso_cfdi_omision),
  );
  r = await llamar(guardar({ usoCfdi: "cn01" }));
  ok("una clave de dos letras («cn01») también es clave", r.ok === true && (await guardado())?.clientes_uso_cfdi_omision === "CN01");
  r = await llamar(guardar({ usoCfdi: "" }));
  g = await guardado();
  ok("el uso vacío guarda NULO (sin sugerencia), no una cadena vacía", r.ok === true && g?.clientes_uso_cfdi_omision === null);
  r = await llamar(guardar({ usoCfdi: null }));
  ok("y sin el campo, también nulo", r.ok === true && (await guardado())?.clientes_uso_cfdi_omision === null);
  // Los dos bordes del rango entran: un límite que rechaza su borde está mal escrito.
  for (const valor of ["1", "720", " 7 "]) {
    r = await llamar(guardar({ slaHoras: valor }));
    g = await guardado();
    ok(`SLA «${valor}» se guarda`, r.ok === true && g?.clientes_sla_horas === Number(valor), r.error ?? String(g?.clientes_sla_horas));
  }
  /*
    Una política 69-B que no llega vale `nada`, que es lo de fábrica: un
    formulario viejo no puede encender un bloqueo que nadie eligió.
  */
  r = await llamar(guardar({ lista69bPresunto: "bloquear", lista69bDefinitivo: null }));
  g = await guardado();
  ok(
    "sin el campo de definitivo, definitivo queda en `nada` y presunto como llegó",
    r.ok === true && g?.clientes_69b_presunto === "bloquear" && g?.clientes_69b_definitivo === "nada",
    JSON.stringify(g),
  );

  /* ── 2 · el SLA general ─────────────────────────────────────────────── */
  seccion("el SLA general: rige para quien no pactó el suyo, y solo para él");

  const U_SIN = await cuenta("sla-sin");
  const U_CON = await cuenta("sla-con");
  await organizacion("SLA sin pactar", U_SIN);
  await organizacion("SLA pactado", U_CON, 30);

  const t = await import("@/lib/actions/tickets");
  const servicio = (clientId: string, sufijo: string) => () =>
    t.createServiceTicket(
      { ok: false },
      forma({
        clientId,
        subject: `${TAG} ${sufijo}`,
        description: `${TAG} levantado por el probe de configuración de clientes`,
        category: "maintenance",
        priority: "medium",
      }),
    );
  /** Horas entre el alta y el vencimiento del ticket con ese folio. */
  const plazo = async (reference?: string) => {
    if (!reference) return NaN;
    const f = await una<{ s: number }>(
      `select extract(epoch from sla_due_at - created_at)::float8 as s
         from ${S}.tickets where reference = '${reference}'`,
    );
    return f ? Number(f.s) / 3600 : NaN;
  };
  // El vencimiento sale de un `new Date()` de Node y `created_at` de `now()` en
  // Postgres, unos milisegundos después: se compara con holgura de segundos.
  const cerca = (horas: number, esperado: number) => Math.abs(horas - esperado) * 3600 < 5;

  await ajustar({});
  await sql.unsafe(`update ${S}.settings set clientes_sla_horas = default where id = 'global'`);
  const [{ d: slaDeFabrica }] = await filas<{ d: number }>(
    `select clientes_sla_horas as d from ${S}.settings where id = 'global'`,
  );
  ok("el DEFAULT de la columna es 2 h (lo que prometía `SLA_HOURS`)", slaDeFabrica === 2, String(slaDeFabrica));

  for (const general of [2, 7]) {
    if (general !== 2) await ajustar({ slaHoras: String(general) });
    como(AGENTE, "servicio:editar");
    r = await llamar(servicio(U_SIN, `sla sin pactar, general ${general}`));
    let h = await plazo(r.reference);
    ok(
      `general ${general} h${general === 2 ? " (de fábrica)" : ""}: el cliente sin SLA propio vence a las ${general} h`,
      r.ok === true && cerca(h, general),
      r.error ?? `${h.toFixed(4)} h`,
    );
    r = await llamar(servicio(U_CON, `sla pactado, general ${general}`));
    h = await plazo(r.reference);
    ok(
      `general ${general} h: el cliente con 30 h pactadas vence a las 30 h`,
      r.ok === true && cerca(h, 30),
      r.error ?? `${h.toFixed(4)} h`,
    );
  }

  /* ── 3 · qué cuenta como cliente ────────────────────────────────────── */
  seccion("qué cuenta como cliente: cada prueba, puesta y quitada");

  const U_PORTAL = await cuenta("portal", false);
  const U_TITULAR = await cuenta("titular", false);
  const ORG: Record<Prueba, string> = {
    portal: await organizacion("Solo portal", U_PORTAL),
    pedido: await organizacion("Solo pedido", null),
    contrato: await organizacion("Solo contrato", null),
  };
  const EMBUDO = await alta(`insert into ${S}.crm_pipelines (name) values ('${TAG} embudo') returning id`);
  const ETAPA = await alta(
    `insert into ${S}.crm_stages (pipeline_id, name) values ('${EMBUDO}', '${TAG} etapa') returning id`,
  );
  const negocio = (sufijo: string, org: string, estado: "won" | "open") =>
    alta(
      `insert into ${S}.crm_deals (reference, title, pipeline_id, stage_id, organization_id, status, closed_at)
       values ('${TAG}-${sufijo}', '${TAG} ${sufijo}', '${EMBUDO}', '${ETAPA}', '${org}', '${estado}',
               ${estado === "won" ? "now()" : "null"})
       returning id`,
    );
  await negocio("G", ORG.pedido, "won");
  // Un negocio ABIERTO: lo que la hace cliente es el contrato que cuelga de él, no el negocio.
  const DEAL_C = await negocio("C", ORG.contrato, "open");
  await sql.unsafe(
    `insert into ${S}.contracts (number, client_id, deal_id, start_date)
     values ('${TAG}-ORG', '${U_TITULAR}', '${DEAL_C}', '2026-01-01')`,
  );

  const { kindDeOrganizacion } = await import("@/lib/data/crm");
  const clases = async () => ({
    portal: await kindDeOrganizacion(ORG.portal),
    pedido: await kindDeOrganizacion(ORG.pedido),
    contrato: await kindDeOrganizacion(ORG.contrato),
  });

  await ajustar({ pruebas: [...TODAS] });
  let k = await clases();
  ok(
    "con las tres pruebas, las tres organizaciones son cliente",
    k.portal === "client" && k.pedido === "client" && k.contrato === "client",
    JSON.stringify(k),
  );
  for (const quitada of TODAS) {
    await ajustar({ pruebas: TODAS.filter((p) => p !== quitada) });
    k = await clases();
    const otras = TODAS.filter((p) => p !== quitada);
    ok(
      `sin «${quitada}»: la de solo ${quitada} pasa a prospecto y las otras siguen cliente`,
      k[quitada] === "lead" && otras.every((p) => k[p] === "client"),
      JSON.stringify(k),
    );
  }
  // Y cada prueba sola hace cliente a la suya y a ninguna otra.
  for (const sola of TODAS) {
    await ajustar({ pruebas: [sola] });
    k = await clases();
    ok(
      `solo «${sola}»: únicamente la de solo ${sola} es cliente`,
      TODAS.every((p) => k[p] === (p === sola ? "client" : "lead")),
      JSON.stringify(k),
    );
  }

  seccion("qué cuenta como cliente: los destinos de viáticos siguen al ajuste");
  const { prospectosParaViatico, visitasParaViatico } = await import("@/lib/data/viaticos");
  const donde = async (org: string) => ({
    visita: (await visitasParaViatico()).some((o) => o.id === org),
    prospecto: (await prospectosParaViatico()).some((o) => o.id === org),
  });
  await ajustar({ pruebas: ["pedido", "contrato"] });
  let d = await donde(ORG.portal);
  ok(
    "con [pedido, contrato], la de solo portal es un PROSPECTO al que se viaja, no una visita",
    d.prospecto && !d.visita,
    JSON.stringify(d),
  );
  await ajustar({ pruebas: [...TODAS] });
  d = await donde(ORG.portal);
  ok("con las tres, la misma es una VISITA y deja de ser prospecto", d.visita && !d.prospecto, JSON.stringify(d));

  /* ── 4 · la lista 69-B ──────────────────────────────────────────────── */
  seccion("la lista 69-B: nada, avisar y bloquear, contra cada estatus");

  const U69 = await cuenta("lista69b");
  const NOMBRE69 = `${TAG} Listada`;
  const ORG69 = await organizacion("Listada", U69);
  await sql.unsafe(
    `insert into ${S}.cliente_validacion_sat (organization_id, lista_69b) values ('${ORG69}', 'no_listado')`,
  );
  const estatus = (org: string, e: string) =>
    sql.unsafe(`update ${S}.cliente_validacion_sat set lista_69b = '${e}' where organization_id = '${org}'`);

  const ctr = await import("@/lib/actions/contracts");
  let n = 0;
  const contrato = () => () =>
    ctr.createContract({ ok: false }, forma({ number: `${TAG}-69-${++n}`, clientId: U69, startDate: "2026-10-01" }));
  const MIOS = [
    `select count(*)::int as contratos from ${S}.contracts where number like '${TAG}%'`,
    `select count(*)::int as tickets from ${S}.tickets where subject like '${TAG}%'`,
    `select count(*)::int as eventos from ${S}.domain_events where payload->>'clientId' = '${U69}'`,
  ];

  /** Rechaza con `lista69b`, un motivo que nombra al cliente y a la pantalla, y no escribe. */
  const bloquea = async (etiqueta: string, fn: () => Promise<Estado>, nombre: string, e: string) => {
    const antes = await foto(...MIOS);
    const res = await llamar(fn);
    const despues = await foto(...MIOS);
    ok(`${etiqueta}: se bloquea`, res.ok === false && res.error === "lista69b", res.error ?? `ok ${res.reference ?? res.number}`);
    ok(
      `${etiqueta}: el motivo nombra al cliente, su estatus y Configuración → Clientes`,
      Boolean(res.motivo?.includes(`«${nombre}»`) && res.motivo.includes(e) && res.motivo.includes("Configuración → Clientes")),
      res.motivo ?? "sin motivo",
    );
    ok(`${etiqueta}: y no escribe`, antes === despues, antes === despues ? "" : `${antes} → ${despues}`);
  };
  const pasa = async (etiqueta: string, fn: () => Promise<Estado>) => {
    const antes = await foto(...MIOS);
    const res = await llamar(fn);
    const despues = await foto(...MIOS);
    ok(`${etiqueta}: pasa`, res.ok === true && antes !== despues, res.error ?? res.motivo ?? "");
  };

  const OTRO: Record<"presunto" | "definitivo", "presunto" | "definitivo"> = {
    presunto: "definitivo",
    definitivo: "presunto",
  };
  /*
    PRESUNTO Y DEFINITIVO SE CONFIGURAN POR SEPARADO: cada vuelta pone la
    política del estatus bajo prueba y deja la del OTRO en `bloquear`. Así, con
    `nada` o `avisar` en el suyo, que la acción pase demuestra además que el
    `bloquear` del otro estatus no se le aplica.
  */
  for (const e of ["presunto", "definitivo"] as const) {
    await estatus(ORG69, e);
    for (const p of ["nada", "avisar", "bloquear"] as Politica[]) {
      await ajustar({
        [e === "presunto" ? "lista69bPresunto" : "lista69bDefinitivo"]: p,
        [e === "presunto" ? "lista69bDefinitivo" : "lista69bPresunto"]: "bloquear",
      });
      const et = `${e} con «${p}» (y ${OTRO[e]} con «bloquear»)`;
      como(AGENTE, "clientes:administrar,servicio:editar");
      if (p === "bloquear") {
        await bloquea(`contrato, ${et}`, contrato(), NOMBRE69, e);
        await bloquea(`servicio, ${et}`, servicio(U69, `69b ${e} ${p}`), NOMBRE69, e);
      } else {
        await pasa(`contrato, ${et}`, contrato());
        await pasa(`servicio, ${et}`, servicio(U69, `69b ${e} ${p}`));
      }
    }
  }
  /*
    `desvirtuado` es el final en que el contribuyente DEMOSTRÓ que operaba:
    tratarlo como al que no lo hizo sería castigar al que ganó. Con las dos
    políticas en `bloquear`, pasa igual. Y `no_listado`, por supuesto.
  */
  await ajustar({ lista69bPresunto: "bloquear", lista69bDefinitivo: "bloquear" });
  for (const e of ["desvirtuado", "sentencia_favorable", "no_listado"]) {
    await estatus(ORG69, e);
    como(AGENTE, "clientes:administrar,servicio:editar");
    await pasa(`contrato, ${e} con las dos en «bloquear»`, contrato());
    await pasa(`servicio, ${e} con las dos en «bloquear»`, servicio(U69, `69b ${e}`));
  }

  seccion("la lista 69-B: el ticket que levanta el propio cliente desde su portal");
  /*
    Una cuenta cliente SEMBRADA —ver la cabecera: el ticket que pase lo firma
    ella en `domain_events`— con una sola organización y sin expediente SAT. Se
    le añade el expediente y se le quita al final; la organización no se toca.
  */
  const sembrado = await una<{ u: string; org: string; name: string }>(
    `select m.user_id as u, min(o.id::text) as org, min(o.name) as name
       from memberships m
       join ${S}.crm_organizations o on o.client_id = m.user_id
      where m.tenant_id = '${EMPRESA}' and m.role = 'client' and m.active
        and not exists (select 1 from ${S}.cliente_validacion_sat v
                         join ${S}.crm_organizations o2 on o2.id = v.organization_id
                        where o2.client_id = m.user_id)
      group by m.user_id having count(*) = 1
      order by m.user_id limit 1`,
  );
  if (!sembrado) throw new Error("la siembra no trae una cuenta cliente con una sola organización y sin expediente SAT");
  alLimpiar(() =>
    sql.unsafe(`delete from ${S}.cliente_validacion_sat where organization_id = '${sembrado.org}'`),
  );
  await sql.unsafe(
    `insert into ${S}.cliente_validacion_sat (organization_id, lista_69b) values ('${sembrado.org}', 'definitivo')`,
  );
  const solicitud = (sufijo: string) => () =>
    t.createTicket(
      { ok: false },
      forma({
        subject: `${TAG} portal ${sufijo}`,
        description: `${TAG} solicitud levantada desde el portal del cliente`,
        category: "maintenance",
        priority: "low",
      }),
    );
  const SUYOS = [`select count(*)::int as n from ${S}.tickets where subject like '${TAG} portal%'`];

  await ajustar({ lista69bDefinitivo: "bloquear" });
  como(sembrado.u, false, { rol: "client" });
  await rechazaSinEscribir(
    "la solicitud del cliente en definitivo con «bloquear»",
    solicitud("bloquear"),
    SUYOS,
    (x) => x?.ok === false && x.error === "lista69b" && Boolean(x.motivo?.includes(`«${sembrado.name}»`)),
  );
  await ajustar({ lista69bDefinitivo: "avisar" });
  como(sembrado.u, false, { rol: "client" });
  r = await llamar(solicitud("avisar"));
  const nueva = r.reference
    ? await una<{ status: string; created_by_id: string }>(
        `select status, created_by_id from ${S}.tickets where reference = '${r.reference}'`,
      )
    : undefined;
  ok(
    "con «avisar», la misma solicitud entra —pendiente de revisión, a su nombre—",
    r.ok === true && nueva?.status === "pending_review" && nueva.created_by_id === sembrado.u,
    r.error ?? r.motivo ?? JSON.stringify(nueva),
  );

  /* ── 5 · el uso de CFDI por omisión ─────────────────────────────────── */
  seccion("el uso de CFDI por omisión: lo que lee el formulario del expediente");
  const { getSettings } = await import("@/lib/data/settings");
  await ajustar({
    slaHoras: "11",
    usoCfdi: "s01",
    pruebas: ["portal", "contrato"],
    lista69bPresunto: "avisar",
    lista69bDefinitivo: "bloquear",
  });
  let s = await getSettings();
  ok(
    "`getSettings()` devuelve el uso guardado tal cual («S01»)",
    s.clientesUsoCfdiOmision === "S01",
    String(s.clientesUsoCfdiOmision),
  );
  ok(
    "y las otras cuatro perillas, con su forma de la aplicación",
    s.clientesSlaHoras === 11 &&
      JSON.stringify(s.clientesPruebas) === '["portal","contrato"]' &&
      s.clientes69b.presunto === "avisar" &&
      s.clientes69b.definitivo === "bloquear",
    JSON.stringify([s.clientesSlaHoras, s.clientesPruebas, s.clientes69b]),
  );
  await ajustar({ usoCfdi: "" });
  s = await getSettings();
  ok("sin uso guardado, `getSettings()` devuelve nulo (el formulario abre sin sugerencia)", s.clientesUsoCfdiOmision === null);
  console.log(
    "· que el formulario de un expediente NUEVO abra con ese uso ya elegido es de pantalla: no se puede comprobar sin navegador",
  );
});
