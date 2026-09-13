/**
 * LA CONFIGURACIÓN DE VIÁTICOS: LA POLÍTICA DE DESTINOS Y LOS RUBROS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-viaticos-config.ts
 *
 * Cuatro acciones que deciden la política de gasto de la empresa. Desde la 0037
 * la primera ya no es el interruptor de prospectos (`guardarViaticosProspectos`,
 * que desapareció) sino la política de destinos ENTERA, en una sola acción
 * (`guardarPoliticaViaticos`): quién viaja a contratos, a visitas y a
 * prospectos, cuántos destinos de CADA TIPO caben y si se mezclan. Aquí se prueba que la
 * guarde quien debe, que sanee lo que llega y que escriba exactamente lo
 * marcado; que la política SE CUMPLA —cada perilla en sus dos estados— lo
 * prueba `_probe-acciones-viaticos`, que es donde se piden viajes. Lo que vale
 * la pena atar es el PERMISO: es `viaticos: administrar` y NO `configuracion`
 * —la cabecera de la acción explica por qué: el rol General administra el
 * gasto y no tiene Configuración—. Así que además del escalón de menos
 * (`viaticos: editar`) se prueba el permiso EQUIVOCADO: quien administra todo
 * Configuración pero no viáticos tiene que oír que no.
 *
 * Ninguna de las cuatro guarda autor —ni `settings` ni `viatico_rubros` tienen
 * columna para eso—, así que no hay firma que comprobar.
 *
 * ── «SIN SESIÓN» AQUÍ ES `como(null, false)` ───────────────────────────────
 *
 * Estas acciones no leen la sesión: su única puerta es `puedeEn`, y el real
 * contesta «ninguno» cuando no hay sesión (`getTenantContext` vuelve nulo).
 * El stub de `puedeEn` no mira la sesión, así que `como(null)` con todo
 * concedido probaría el stub y no la acción; lo que se reproduce es lo que la
 * aplicación le contesta de verdad a quien no entró.
 */
import {
  AJENO,
  ESQUEMA,
  alLimpiar,
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
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const MARCA = marca("VIA");
/** La clave que `claveDesde` le saca a un nombre con la marca delante. */
const CLAVE = MARCA.toLowerCase();
const FANTASMA = "00000000-0000-4000-8000-00000000dead";
const SIN_PERMISO = "No tienes permiso para configurar viáticos.";

/** Las siete columnas de la política, y `updated_at`: un rechazo no la toca. */
const AJUSTES = (esquema: string) =>
  `select viaticos_contratos_roles, viaticos_visitas_roles, viaticos_prospectos_roles,
          viaticos_max_contratos, viaticos_max_visitas, viaticos_max_prospectos,
          viaticos_mezclar_destinos, updated_at
     from ${esquema}.settings where id = 'global'`;
/*
  Los rubros de esta corrida y el «Hotel» de fábrica, que es contra el que se
  prueba el choque de nombres: si una acción rechazada lo tocara —o creara un
  segundo «hotel»— se vería aquí. No se fotografía el catálogo entero: otros
  probes corren a la vez contra la misma base.
*/
const RUBROS = `select id, key, name, daily_budget_mxn, requires_note, blocks_over_budget, active, position
                  from ${ESQUEMA}.viatico_rubros
                 where name like '${MARCA}%' or key like '${CLAVE}%' or lower(btrim(name)) = 'hotel'
                 order by id`;
const RUBRO = (id: string) =>
  `select id, key, name, daily_budget_mxn, requires_note, blocks_over_budget, active, position
     from ${ESQUEMA}.viatico_rubros where id = '${id}'`;

type Rubro = {
  id: string;
  key: string;
  name: string;
  daily_budget_mxn: string | null;
  requires_note: boolean;
  blocks_over_budget: boolean;
  active: boolean;
  position: number;
};
type Politica = {
  viaticos_contratos_roles: string[];
  viaticos_visitas_roles: string[];
  viaticos_prospectos_roles: string[];
  viaticos_max_contratos: number;
  viaticos_max_visitas: number;
  viaticos_max_prospectos: number;
  viaticos_mezclar_destinos: boolean;
};
type Estado = { ok: boolean; error?: string; message?: string };

async function llamar(fn: () => Promise<Estado>): Promise<Estado> {
  const r = await intentar(fn);
  if (r.valor) return r.valor;
  return { ok: false, error: r.error ? `reventó: ${r.error}` : `redirigió a ${r.redirige}` };
}

/** La política guardada, sin `updated_at`, o `null` si la empresa no tiene fila. */
async function politica(esquema = ESQUEMA): Promise<Politica | null> {
  const [f] = await filas<Politica>(AJUSTES(esquema));
  if (!f) return null;
  return {
    viaticos_contratos_roles: f.viaticos_contratos_roles,
    viaticos_visitas_roles: f.viaticos_visitas_roles,
    viaticos_prospectos_roles: f.viaticos_prospectos_roles,
    viaticos_max_contratos: f.viaticos_max_contratos,
    viaticos_max_visitas: f.viaticos_max_visitas,
    viaticos_max_prospectos: f.viaticos_max_prospectos,
    viaticos_mezclar_destinos: f.viaticos_mezclar_destinos,
  };
}

void probar("configuración de viáticos: el permiso es el del gasto, no el del sistema", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    LA POLÍTICA SE REPONE COMO ESTABA, Y SOLO ELLA.

    Si la fila no existía, la acción la crea (upsert). Borrarla al final sería
    lo simétrico, pero `settings` es UNA fila que comparten el tipo de cambio y
    las tarifas: otro probe puede estar a mitad de usarla, y un `delete` le
    quitaría lo que acaba de escribir. Así que se borra solo si nadie más la
    tocó —todo lo demás en sus valores de fábrica—; si no, las siete columnas de
    viáticos vuelven a su DEFAULT, que es exactamente lo que significa no tener
    fila.
  */
  const original = await politica();
  /*
    `::text::jsonb` y no `::jsonb` a secas: con `JSON.stringify`, `$1::jsonb`
    guardaba la lista dos veces codificada —una CADENA jsonb—, que
    `getSettings()` lee como `[]`. Si la fila existía antes de la prueba, la
    reponía dejando a nadie con permiso de pedir viáticos. Lo encontró
    `_probe-acciones-clientes-config`, que se tropezó con lo mismo.
  */
  alLimpiar(async () => {
    if (original !== null) {
      return sql.unsafe(
        `update ${ESQUEMA}.settings
            set viaticos_contratos_roles = $1::text::jsonb, viaticos_visitas_roles = $2::text::jsonb,
                viaticos_prospectos_roles = $3::text::jsonb, viaticos_max_contratos = $4,
                viaticos_max_visitas = $5, viaticos_max_prospectos = $6,
                viaticos_mezclar_destinos = $7
          where id = 'global'`,
        [
          JSON.stringify(original.viaticos_contratos_roles),
          JSON.stringify(original.viaticos_visitas_roles),
          JSON.stringify(original.viaticos_prospectos_roles),
          original.viaticos_max_contratos,
          original.viaticos_max_visitas,
          original.viaticos_max_prospectos,
          original.viaticos_mezclar_destinos,
        ],
      );
    }
    await sql.unsafe(
      `delete from ${ESQUEMA}.settings
        where id = 'global' and usd_rate is null and labor_cost_per_hour is null
          and labor_rate_per_hour is null and tipo_cambio_automatico`,
    );
    return sql.unsafe(
      `update ${ESQUEMA}.settings
          set viaticos_contratos_roles = default, viaticos_visitas_roles = default,
              viaticos_prospectos_roles = default, viaticos_max_contratos = default,
              viaticos_max_visitas = default, viaticos_max_prospectos = default,
              viaticos_mezclar_destinos = default
        where id = 'global'`,
    );
  });
  // Los rubros, al final de todo: antes tiene que irse el gasto que sostiene a uno.
  alLimpiar(() =>
    sql.unsafe(
      `delete from ${ESQUEMA}.viatico_rubros where name like '${MARCA}%' or key like '${CLAVE}%'`,
    ),
  );

  const c = await import("@/lib/actions/viaticos-config");
  const ini = { ok: false };

  /**
   * Las cuatro puertas cerradas: sin sesión, todo denegado, un escalón de
   * menos en el módulo correcto, y el nivel máximo en el módulo EQUIVOCADO.
   */
  async function guardia(nombre: string, fn: () => Promise<unknown>, que: string[]) {
    for (const [como_, puede] of [
      ["sin sesión", null],
      ["sin permiso", false],
      ["con «viaticos:editar»", "viaticos:editar"],
      ["con «configuracion:administrar» y nada de viáticos", "configuracion:administrar"],
    ] as const) {
      como(puede === null ? null : ACTOR, puede ?? false);
      await rechazaSinEscribir(`${nombre}, ${como_}`, fn, que, conError(SIN_PERMISO));
    }
  }

  /* ── 1 · la política de destinos ────────────────────────────────────── */
  seccion("la política de destinos: quién viaja a dónde, cuántos de cada tipo y si se mezclan");

  const POLITICA = {
    rolesContrato: ["agent", "general"],
    rolesVisita: ["sales", "general"],
    rolesProspecto: ["owner"],
    maxContratos: "2",
    maxVisitas: "3",
    maxProspectos: "4",
    mezclar: "on",
  };
  const guardarPolitica = (campos: Record<string, string | string[] | null> = {}) => () =>
    c.guardarPoliticaViaticos(ini, forma({ ...POLITICA, ...campos }));
  const ajenoAntes = JSON.stringify(await filas(AJUSTES(AJENO)));

  /*
    La foto lleva `updated_at` y las siete columnas: un rechazo que aun así
    escribiera —aunque fuera el mismo valor— movería la fecha y se vería.
  */
  await guardia("política", guardarPolitica(), [AJUSTES(ESQUEMA)]);

  como(ACTOR, "viaticos:administrar");
  /*
    CADA TOPE va de 1 a 20 —el rango del CHECK de la 0037, dicho antes— y el
    mensaje NOMBRA el tipo que está mal: con tres campos, «el máximo va de 1 a
    20» no dice cuál corregir. Se prueba cada campo por separado, con los otros
    dos bien, para que un rechazo no lo cause el vecino. Vacío no es «el de
    fábrica»: el formulario siempre lo manda, así que vacío es un error de
    captura; lo que vale 1 es el campo que NO llega.
  */
  const TOPES = [
    ["maxContratos", "contratos"],
    ["maxVisitas", "visitas"],
    ["maxProspectos", "prospectos"],
  ] as const;
  for (const [campo, plural] of TOPES) {
    for (const [nombre, valor] of [
      ["en cero", "0"],
      ["de 21", "21"],
      ["que no es número", "abc"],
      ["negativo", "-3"],
      ["con decimales", "2.5"],
      ["vacío", ""],
    ] as const) {
      await rechazaSinEscribir(
        `política, ${campo} ${nombre}`,
        guardarPolitica({ [campo]: valor }),
        [AJUSTES(ESQUEMA)],
        conError(`El máximo de ${plural} por viático va de 1 a 20.`),
      );
    }
  }

  let r = await llamar(guardarPolitica());
  let p = await politica();
  ok("guardar la política responde ok", r.ok === true && r.message === "Guardado.", r.error ?? r.message);
  ok(
    "y escribe las SIETE perillas, exactamente como llegaron —cada tope en su columna—",
    JSON.stringify(p) ===
      JSON.stringify({
        viaticos_contratos_roles: ["agent", "general"],
        viaticos_visitas_roles: ["sales", "general"],
        viaticos_prospectos_roles: ["owner"],
        viaticos_max_contratos: 2,
        viaticos_max_visitas: 3,
        viaticos_max_prospectos: 4,
        viaticos_mezclar_destinos: true,
      }),
    JSON.stringify(p),
  );

  /*
    Lo que no es un rol de la casa no se guarda: un rol inventado en `jsonb` no
    falla al escribir, falla meses después al leerlo; `client` no entra al
    portal interno y no viaja; y una casilla enviada dos veces se guardaba dos
    veces. Cada lista, por su cuenta.
  */
  r = await llamar(
    guardarPolitica({
      rolesContrato: ["general", "general", "client", "agent"],
      rolesVisita: ["superusuario", "sales", "sales"],
      rolesProspecto: ["client", "owner", "owner", "admin"],
    }),
  );
  p = await politica();
  ok(
    "roles repetidos, inventados y `client` se descartan, en las tres listas",
    r.ok === true &&
      JSON.stringify([p?.viaticos_contratos_roles, p?.viaticos_visitas_roles, p?.viaticos_prospectos_roles]) ===
        JSON.stringify([["general", "agent"], ["sales"], ["owner", "admin"]]),
    JSON.stringify([p?.viaticos_contratos_roles, p?.viaticos_visitas_roles, p?.viaticos_prospectos_roles]),
  );

  // Los dos bordes del rango entran en cada tope: un límite que rechaza su
  // borde está mal escrito. Y los espacios alrededor no estorban.
  const columna = {
    maxContratos: "viaticos_max_contratos",
    maxVisitas: "viaticos_max_visitas",
    maxProspectos: "viaticos_max_prospectos",
  } as const;
  for (const [campo] of TOPES) {
    for (const valor of ["1", "20", " 7 "]) {
      r = await llamar(guardarPolitica({ [campo]: valor }));
      p = await politica();
      ok(
        `${campo} = «${valor}» se guarda`,
        r.ok === true && p?.[columna[campo]] === Number(valor),
        r.error ?? String(p?.[columna[campo]]),
      );
    }
  }

  /*
    UN CAMPO AUSENTE VALE 1, que es lo de fábrica: un formulario viejo —o uno
    que todavía no enseña ese tope— no puede dejar la política en un valor
    que nadie eligió, ni fallar por algo que no preguntó.
  */
  r = await llamar(guardarPolitica({ maxContratos: null, maxVisitas: null, maxProspectos: null }));
  p = await politica();
  ok(
    "sin los tres campos de tope, los tres se guardan en 1",
    r.ok === true &&
      p?.viaticos_max_contratos === 1 &&
      p?.viaticos_max_visitas === 1 &&
      p?.viaticos_max_prospectos === 1,
    r.error ?? JSON.stringify(p),
  );
  r = await llamar(guardarPolitica({ maxVisitas: null }));
  p = await politica();
  ok(
    "sin uno solo, ése vale 1 y los otros dos se guardan como llegaron",
    r.ok === true &&
      p?.viaticos_max_contratos === 2 &&
      p?.viaticos_max_visitas === 1 &&
      p?.viaticos_max_prospectos === 4,
    r.error ?? JSON.stringify(p),
  );

  /*
    Las casillas desmarcadas no se envían. Así que sin `mezclar` se APAGA —no
    se queda como estaba—, y una lista sin marcar se guarda vacía: la lista
    vacía ES el apagado, no hay otro interruptor que la contradiga.
  */
  r = await llamar(guardarPolitica({ mezclar: null, rolesVisita: null }));
  p = await politica();
  ok(
    "sin la casilla de mezclar, se apaga; sin casillas de visita, nadie visita",
    r.ok === true && p?.viaticos_mezclar_destinos === false && JSON.stringify(p?.viaticos_visitas_roles) === "[]",
    JSON.stringify(p),
  );
  r = await llamar(guardarPolitica({ mezclar: "algo" }));
  ok("`mezclar` solo se enciende con «on»", r.ok === true && (await politica())?.viaticos_mezclar_destinos === false);

  // Sin un solo rol marcado nadie puede pedir viáticos, y la acción lo dice.
  r = await llamar(guardarPolitica({ rolesContrato: null, rolesVisita: null, rolesProspecto: null }));
  p = await politica();
  ok(
    "sin ningún rol marcado se guarda, y avisa que nadie podrá pedir",
    r.ok === true &&
      r.message === "Guardado. Sin ningún rol marcado, nadie puede pedir viáticos." &&
      JSON.stringify([p?.viaticos_contratos_roles, p?.viaticos_visitas_roles, p?.viaticos_prospectos_roles]) ===
        "[[],[],[]]",
    r.message ?? r.error,
  );
  ok(
    `y la configuración de ${AJENO} no se movió`,
    JSON.stringify(await filas(AJUSTES(AJENO))) === ajenoAntes,
  );

  /* ── 2 · crear rubro ─────────────────────────────────────────────────── */
  seccion("crear rubro");

  const NUEVO = {
    name: `${MARCA} Casetas y peajes`,
    dailyBudgetMxn: "$1,250.5",
    requiresNote: "on",
  };
  const crear = (campos: Record<string, string> = {}) => () =>
    c.crearRubroAction(ini, forma({ ...NUEVO, ...campos }));

  await guardia("crear rubro", crear(), [RUBROS]);

  como(ACTOR, "viaticos:administrar");
  const TOPE_MAL = "El presupuesto por día tiene que ser mayor que cero, o déjalo vacío.";
  for (const [nombre, campos, mensaje] of [
    ["sin nombre", { name: "   " }, "Ponle nombre al rubro."],
    // Cero diría «no se paga»; lo que se quiere decir con nada es «sin tope».
    ["presupuesto en cero", { dailyBudgetMxn: "0" }, TOPE_MAL],
    ["presupuesto negativo", { dailyBudgetMxn: "-5" }, TOPE_MAL],
    ["presupuesto que no es número", { dailyBudgetMxn: "abc" }, TOPE_MAL],
    // Sin distinguir mayúsculas ni espacios: «HOTEL» junto a «Hotel» es lo que
    // el catálogo cerrado viene a evitar.
    ["un nombre que ya existe con otras mayúsculas", { name: "  HOTEL " }, "Ya existe un rubro llamado «HOTEL»."],
  ] as const) {
    await rechazaSinEscribir(`crear rubro, ${nombre}`, crear(campos), [RUBROS], conError(mensaje));
  }

  const [{ n: posAntes }] = await filas<{ n: number }>(
    `select coalesce(max(position), 0)::int as n from ${ESQUEMA}.viatico_rubros`,
  );
  r = await llamar(crear());
  const [r1] = await filas<Rubro>(
    `select id::text as id, key, name, daily_budget_mxn, requires_note, blocks_over_budget, active, position
       from ${ESQUEMA}.viatico_rubros where name = '${NUEVO.name}'`,
  );
  ok("crear rubro responde ok", r.ok === true, r.error);
  ok("está en la base", Boolean(r1));
  ok(
    "con la clave derivada del nombre",
    r1?.key === `${CLAVE}-casetas-y-peajes`,
    r1?.key,
  );
  ok("el presupuesto, sin símbolo ni comas y a dos decimales", r1?.daily_budget_mxn === "1250.50", r1?.daily_budget_mxn ?? "null");
  ok(
    "pide nota, no bloquea y nace activo",
    r1?.requires_note === true && r1?.blocks_over_budget === false && r1?.active === true,
  );
  ok("va al final del catálogo", r1?.position === posAntes + 1, `${r1?.position} tras ${posAntes}`);

  r = await llamar(crear({ name: `${MARCA} Propinas`, dailyBudgetMxn: "", requiresNote: "", blocksOverBudget: "on" }));
  const [r2] = await filas<Rubro>(
    `select id::text as id, daily_budget_mxn, requires_note, blocks_over_budget
       from ${ESQUEMA}.viatico_rubros where name = '${MARCA} Propinas'`,
  );
  ok("un rubro sin presupuesto se crea", r.ok === true && Boolean(r2), r.error);
  ok("y queda SIN TOPE (nulo), no en cero", r2?.daily_budget_mxn === null, r2?.daily_budget_mxn ?? "null");
  ok("con las casillas como llegaron", r2?.requires_note === false && r2?.blocks_over_budget === true);

  ok(
    `y ${AJENO} no ganó rubros con la marca`,
    (await cuantos("viatico_rubros", `where name like '${MARCA}%'`, AJENO)) === 0,
  );

  const R1 = r1?.id ?? FANTASMA;
  const R2 = r2?.id ?? FANTASMA;

  /* ── 3 · guardar rubro ───────────────────────────────────────────────── */
  seccion("guardar rubro: renombra, pero la clave no se toca");

  const guardar = (campos: Record<string, string>) => () =>
    c.guardarRubroAction(
      ini,
      forma({ id: R1, name: `${MARCA} Peajes`, dailyBudgetMxn: "", blocksOverBudget: "on", ...campos }),
    );
  await guardia("guardar rubro", guardar({}), [RUBRO(R1), RUBROS]);

  como(ACTOR, "viaticos:administrar");
  for (const [nombre, campos, mensaje] of [
    ["id que no es uuid", { id: "x" }, "Rubro inválido."],
    ["nombre vacío", { name: "" }, "El nombre no puede quedar vacío."],
    ["presupuesto en cero", { dailyBudgetMxn: "0" }, TOPE_MAL],
    ["presupuesto negativo", { dailyBudgetMxn: "-1" }, TOPE_MAL],
    ["presupuesto que no es número", { dailyBudgetMxn: "mil" }, TOPE_MAL],
    ["renombrar encima de otro", { name: "hotel" }, "Ya existe otro rubro llamado «hotel»."],
    /*
      Un rubro que ya no existe —otra persona lo borró con la pantalla abierta—
      contestaba «Rubro actualizado.»: el `update` no tocaba ninguna fila y la
      acción no lo miraba. Lo encontró este probe.
    */
    ["rubro que no existe", { id: FANTASMA }, "Ese rubro ya no existe."],
  ] as const) {
    await rechazaSinEscribir(`guardar rubro, ${nombre}`, guardar(campos), [RUBRO(R1), RUBROS], conError(mensaje));
  }

  r = await llamar(guardar({}));
  const [r1b] = await filas<Rubro>(RUBRO(R1));
  ok("guardar rubro responde ok", r.ok === true, r.error);
  ok("con el nombre nuevo", r1b?.name === `${MARCA} Peajes`, r1b?.name);
  ok("y la clave de antes: renombrar no rompe el histórico", r1b?.key === r1?.key, r1b?.key);
  ok("el presupuesto vacío lo deja sin tope", r1b?.daily_budget_mxn === null);
  ok(
    "las casillas que no llegan se APAGAN: ya no pide nota y queda inactivo",
    r1b?.requires_note === false && r1b?.active === false,
  );
  ok("y la que llega se enciende", r1b?.blocks_over_budget === true);
  // El choque excluye al propio rubro: guardarlo con su nombre en otras
  // mayúsculas no es chocar consigo mismo.
  r = await llamar(guardar({ name: `${MARCA} PEAJES`.toLowerCase() }));
  ok("guardarlo con su propio nombre en minúsculas no choca consigo", r.ok === true, r.error);

  /* ── 4 · borrar rubro ────────────────────────────────────────────────── */
  seccion("borrar rubro: solo si nadie lo usó");

  const borrar = (id: string) => () => c.borrarRubroAction(ini, forma({ id }));
  await guardia("borrar rubro", borrar(R2), [RUBRO(R2)]);

  /*
    Un gasto que usa R1. El viático y su gasto se siembran a mano —lo que se
    prueba es la acción de borrar, no la de capturar— y se borran antes que el
    rubro: la llave del gasto al rubro es `restrict`.
  */
  /*
    Desde la 0037 la cabecera no dice a dónde se viaja, y el gasto sin ticket ni
    negocio puede ir sin destino (gasto general): para lo que se prueba aquí
    —que el rubro está en uso— no hace falta sembrar un destino.
  */
  const [vi] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.viaticos
       (reference, requested_by_id, destination, purpose, departs_on, returns_on,
        estimated_mxn, status)
     values ('${MARCA}-C1', '${ACTOR}', '${MARCA} config', 'probe',
             '2026-10-01', '2026-10-01', 100, 'autorizado')
     returning id::text as id`,
  );
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.viaticos where id = '${vi.id}'`));
  await sql.unsafe(
    `insert into ${ESQUEMA}.viatico_expenses (viatico_id, rubro_id, description, amount_mxn, spent_on)
     values ('${vi.id}', '${R1}', '${MARCA} peaje', 50, '2026-10-01')`,
  );

  como(ACTOR, "viaticos:administrar");
  await rechazaSinEscribir("borrar, id que no es uuid", borrar("x"), [RUBRO(R2)], conError("Rubro inválido."));
  await rechazaSinEscribir(
    "borrar un rubro que ya no existe",
    borrar(FANTASMA),
    [RUBROS],
    conError("Ese rubro ya no existe."),
  );
  await rechazaSinEscribir(
    "borrar un rubro que un gasto usa",
    borrar(R1),
    [RUBRO(R1)],
    conError(
      "No se puede borrar: 1 gasto(s) ya lo usan. Desactívalo para retirarlo del formulario sin perder el histórico.",
    ),
  );

  r = await llamar(borrar(R2));
  ok("borrar un rubro sin uso responde ok", r.ok === true, r.error);
  ok("y ya no está", (await cuantos("viatico_rubros", `where id = '${R2}'`)) === 0);
  ok("el que tiene gasto sigue ahí", (await cuantos("viatico_rubros", `where id = '${R1}'`)) === 1);
});
