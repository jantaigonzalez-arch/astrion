/**
 * LA CONFIGURACIÓN DE VIÁTICOS: EL INTERRUPTOR DE PROSPECTOS Y LOS RUBROS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-viaticos-config.ts
 *
 * Cuatro acciones que deciden la política de gasto de la empresa. Lo que vale
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

const AJUSTES = (esquema: string) =>
  `select viaticos_prospectos_roles from ${esquema}.settings where id = 'global'`;
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
type Estado = { ok: boolean; error?: string; message?: string };

async function llamar(fn: () => Promise<Estado>): Promise<Estado> {
  const r = await intentar(fn);
  if (r.valor) return r.valor;
  return { ok: false, error: r.error ? `reventó: ${r.error}` : `redirigió a ${r.redirige}` };
}

async function roles(esquema = ESQUEMA): Promise<string[] | null> {
  const [f] = await filas<{ viaticos_prospectos_roles: string[] }>(AJUSTES(esquema));
  return f ? f.viaticos_prospectos_roles : null;
}

void probar("configuración de viáticos: el permiso es el del gasto, no el del sistema", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    EL INTERRUPTOR SE REPONE COMO ESTABA, Y SOLO ÉL.

    Si la fila no existía, la acción la crea (upsert). Borrarla al final sería
    lo simétrico, pero `settings` es UNA fila que comparten el tipo de cambio y
    las tarifas: otro probe puede estar a mitad de usarla, y un `delete` le
    quitaría lo que acaba de escribir. Así que se borra solo si nadie más la
    tocó —todo en sus valores de fábrica—; si no, se deja la lista vacía, que es
    exactamente lo que significa no tener fila.
  */
  const original = await roles();
  alLimpiar(async () => {
    if (original !== null) {
      return sql.unsafe(
        `update ${ESQUEMA}.settings set viaticos_prospectos_roles = $1::jsonb where id = 'global'`,
        [JSON.stringify(original)],
      );
    }
    await sql.unsafe(
      `delete from ${ESQUEMA}.settings
        where id = 'global' and usd_rate is null and labor_cost_per_hour is null
          and labor_rate_per_hour is null and tipo_cambio_automatico`,
    );
    return sql.unsafe(
      `update ${ESQUEMA}.settings set viaticos_prospectos_roles = '[]'::jsonb where id = 'global'`,
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

  /* ── 1 · el interruptor de prospectos ────────────────────────────────── */
  seccion("viáticos a prospectos: qué roles pueden pedirlos");

  const prospectos = (lista: string[]) => () =>
    c.guardarViaticosProspectos(ini, forma({ roles: lista }));
  const ajenoAntes = JSON.stringify(await filas(AJUSTES(AJENO)));

  await guardia("prospectos", prospectos(["agent", "general"]), [AJUSTES(ESQUEMA)]);

  como(ACTOR, "viaticos:administrar");
  let r = await llamar(prospectos(["agent", "general"]));
  ok("guardar dos roles responde ok", r.ok === true && r.message === "Guardado.", r.error ?? r.message);
  let guardados = await roles();
  ok(
    "y se guardan exactamente esos",
    JSON.stringify(guardados) === JSON.stringify(["agent", "general"]),
    JSON.stringify(guardados),
  );

  /*
    Un rol inventado no se guarda. En `jsonb` no fallaría al escribir: fallaría
    meses después, al leerlo —es la lección que la acción cita—.
  */
  r = await llamar(prospectos(["sales", "superusuario", "owner"]));
  guardados = await roles();
  ok(
    "un rol que no existe se descarta y los buenos se quedan",
    r.ok === true && JSON.stringify(guardados) === JSON.stringify(["sales", "owner"]),
    JSON.stringify(guardados),
  );

  // La lista vacía ES el apagado: no hay otro interruptor que la contradiga.
  r = await llamar(prospectos([]));
  guardados = await roles();
  ok(
    "sin roles marcados se apaga, y lo dice",
    r.ok === true &&
      JSON.stringify(guardados) === "[]" &&
      r.message === "Guardado. Sin roles marcados, nadie puede pedir viajes a prospectos.",
    r.message,
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
  const [contrato] = await filas<{ id: string }>(
    `select id::text as id from ${ESQUEMA}.contracts order by id limit 1`,
  );
  if (!contrato) throw new Error("la base no trae contratos");
  const [vi] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.viaticos
       (reference, contract_id, requested_by_id, destination, purpose, departs_on, returns_on,
        estimated_mxn, status)
     values ('${MARCA}-C1', '${contrato.id}', '${ACTOR}', '${MARCA} config', 'probe',
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
