/**
 * LAS ACCIONES DE ANÁLISIS Y DE TABLEROS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-tableros.ts
 *
 * Diez acciones, todas de «analisis:administrar»: tres que colocan un análisis
 * en una pantalla (`analyses.ts`) y siete que componen tableros
 * (`dashboards.ts`). Casi todas ACTUALIZAN —renombrar, reordenar, publicar—,
 * así que la guardia se comprueba con la fila entera antes y después, no con un
 * conteo: un `update` no mueve ningún conteo.
 *
 * ── TODO SOBRE TABLEROS PROPIOS ────────────────────────────────────────────
 *
 * Una colocación en `/admin/tickets` la ve la empresa entera, y hay otras
 * pruebas corriendo a la vez contra la misma base. Así que el probe no toca
 * ninguna pantalla de trabajo: crea sus tableros con la marca de la corrida y
 * coloca los análisis en `dashboard:<su slug>`, que `screenByPrefix` acepta por
 * la forma. Todo se borra al final por esa marca.
 *
 * ── «SIN SESIÓN» ES «SIN NIVEL» ────────────────────────────────────────────
 *
 * Ninguna de estas acciones pregunta por la sesión: su guardia es `puedeEn` a
 * secas. En la aplicación eso basta, porque `puedeEn` → `nivelEn` →
 * `getTenantContext`, que sin sesión devuelve `null` y el nivel es «ninguno».
 * El stub de inquilino no lee la sesión, así que aquí «sin sesión» se escribe
 * como lo que produce de verdad: ninguna sesión Y ningún nivel.
 *
 * Lo que no se repite: la mezcla de fábrica con lo configurado y el empaquetado
 * de las cajas, que son reglas de `placements.ts` y `dashboards.ts`.
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

const TAG = marca("ANA");
/** El slug que `slugify` saca de un nombre que empieza por la marca. */
const PRE = TAG.toLowerCase();
const BASE = `${PRE}-base`;
const VACIO = `${PRE}-vacio`;
const PANTALLA = `dashboard:${BASE}`;

const NO_ADMIN_TABLERO = "Solo un administrador compone los tableros.";
const NO_ADMIN_ANALISIS = "Solo un administrador configura los análisis.";

/*
  Las dos fotos que sirven para casi todo. La del tablero lleva `updated_at`
  porque reordenar y cambiar módulos lo tocan aunque no cambie nada más: si una
  guardia dejara pasar, se vería ahí.
*/
const TABLEROS = `
  select d.slug, d.title, d.published_at, d.published_by_id, d.updated_at,
         (select json_agg(m.module order by m.position)
            from ${ESQUEMA}.dashboard_modules m where m.dashboard_id = d.id) as modulos
    from ${ESQUEMA}.dashboards d
   where d.slug like '${PRE}%' order by d.slug`;
const COLOCACIONES = `
  select screen, analysis, position, active, source, x, y, w, h, viz
    from ${ESQUEMA}.analysis_placements
   where screen like 'dashboard:${PRE}%' order by screen, analysis`;

type Colocacion = {
  screen: string;
  analysis: string;
  position: number;
  active: boolean;
  source: string;
  x: number;
  y: number;
  w: number;
  h: number;
  viz: string | null;
};
const colocaciones = (screen: string) =>
  filas<Colocacion>(
    `select screen, analysis, position, active, source, x, y, w, h, viz
       from ${ESQUEMA}.analysis_placements where screen = '${screen}' order by position, analysis`,
  );

/**
 * Borrar termina redirigiendo al portal. Fuera de una petición `next/headers`
 * lanza antes de llegar a `redirect()` —el destino lleva el prefijo de la
 * empresa, que se lee de la cabecera—, y eso pasa DESPUÉS de borrar. Las dos
 * salidas cuentan como «llegó al final»; lo que no cuenta es otro error.
 */
function redirigio(r: { redirige?: string; error?: string }, destino: string): boolean {
  if (r.redirige !== undefined) return r.redirige.endsWith(destino);
  return /headers|request scope|outside/i.test(r.error ?? "");
}

void probar("análisis y tableros: guardia, nivel, validación y lo que se guarda", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    Limpieza por la marca, registrada ANTES de crear nada. Las colocaciones no
    cuelgan del tablero por una foránea —es una convención de cadena—, así que
    hay que borrarlas aparte; `dashboard_modules` sí se va en cascada.
    `domain_events` no se limpia: es de solo añadir, y el borrado lo registra.
  */
  alLimpiar(() =>
    sql.unsafe(`delete from ${ESQUEMA}.dashboards where slug like '${PRE}%'`),
  );
  alLimpiar(() =>
    sql.unsafe(
      `delete from ${ESQUEMA}.analysis_placements where screen like 'dashboard:${PRE}%'`,
    ),
  );

  /*
    Dos tableros de trabajo, sembrados a mano y no con la acción: la guardia se
    prueba contra algo que YA existe, así que un `update` que se colara se vería
    en la foto. `BASE` lleva un bloque encendido y un módulo —publicarlo saldría
    bien si la guardia dejara pasar—; `VACIO` no lleva nada.
  */
  await sql.unsafe(
    `insert into ${ESQUEMA}.dashboards (slug, title) values ($1, $2), ($3, $4)`,
    [BASE, `${TAG} Base`, VACIO, `${TAG} Vacío`],
  );
  await sql.unsafe(
    `insert into ${ESQUEMA}.dashboard_modules (dashboard_id, module, position)
     select id, 'ventas', 0 from ${ESQUEMA}.dashboards where slug = $1`,
    [BASE],
  );
  await sql.unsafe(
    `insert into ${ESQUEMA}.analysis_placements (analysis, screen, position, active, source, x, y, w, h)
     values ('sales.funnel', $1, 0, true, 'user', 0, 0, 12, 8)`,
    [PANTALLA],
  );

  const an = await import("@/lib/actions/analyses");
  const tb = await import("@/lib/actions/dashboards");
  const inicial = { ok: false };

  /* ── 1 · la guardia, y el nivel ──────────────────────────────────────── */
  /*
    Cada llamada lleva datos BUENOS contra el tablero de trabajo: si la guardia
    dejara pasar, escribiría, y la foto lo vería. Con datos malos el rechazo
    llegaría por la validación y la prueba daría verde con la guardia rota.
  */
  const orden = JSON.stringify([
    { analysis: "sales.funnel", x: 0, y: 0, w: 24, h: 8, active: true },
    { analysis: "sales.trend", x: 0, y: 8, w: 12, h: 8, active: true },
  ]);
  const llamadas: Array<[string, () => Promise<unknown>, string | null]> = [
    ["crear tablero", () => tb.createDashboardAction(inicial, forma({ title: `${TAG} Guardia`, modulo: "pagos" })), NO_ADMIN_TABLERO],
    ["renombrar", () => tb.renameDashboardAction(inicial, forma({ slug: BASE, title: `${TAG} Otro` })), NO_ADMIN_TABLERO],
    ["reordenar", () => tb.reorderDashboardAction(inicial, forma({ slug: BASE, orden })), NO_ADMIN_TABLERO],
    ["publicar", () => tb.publishDashboardAction(inicial, forma({ slug: BASE })), NO_ADMIN_TABLERO],
    // `BASE` está sin publicar, pero despublicar toca `updated_at`: se vería.
    ["despublicar", () => tb.unpublishDashboardAction(inicial, forma({ slug: BASE })), NO_ADMIN_TABLERO],
    ["módulos", () => tb.setDashboardModulesAction(inicial, forma({ slug: BASE, modulos: "compras,pagos" })), NO_ADMIN_TABLERO],
    // Borrar no devuelve estado: rechazada es `undefined` y la foto intacta.
    ["borrar tablero", () => tb.deleteDashboardAction(forma({ slug: BASE })), null],
    ["colocar análisis", () => an.togglePlacementAction(inicial, forma({ analysis: "sales.trend", screen: PANTALLA, active: "1" })), NO_ADMIN_ANALISIS],
    ["aceptar propuesta", () => an.acceptRecommendationAction(inicial, forma({ analysis: "sales.trend", screen: PANTALLA })), NO_ADMIN_ANALISIS],
    ["restaurar de fábrica", () => an.resetPlacementAction(inicial, forma({ analysis: "sales.funnel", screen: PANTALLA })), NO_ADMIN_ANALISIS],
  ];

  const identidades: Array<[string, () => void]> = [
    ["sin sesión", () => como(null, false)],
    ["sin permiso", () => como(ACTOR, false)],
    /*
      Un escalón menos. Componer un tablero decide lo que ve el equipo entero al
      entrar a un módulo: no es trabajo de quien solo edita.
    */
    ["con «analisis:editar»", () => como(ACTOR, "analisis:editar")],
  ];

  for (const [quien, ponerse] of identidades) {
    seccion(`${quien}, ninguna escribe`);
    ponerse();
    for (const [nombre, fn, mensaje] of llamadas)
      await rechazaSinEscribir(
        `${nombre}, ${quien}`,
        fn,
        [TABLEROS, COLOCACIONES],
        mensaje ? conError(mensaje) : (r) => r === undefined,
      );
  }

  como(ACTOR, "analisis:administrar");

  /* ── 2 · la captura inválida ─────────────────────────────────────────── */
  seccion("con permiso y captura inválida, tampoco");

  /*
    Un nombre vacío no se queda en «sin nombre»: sin él `slugify` cae a
    `tablero`, y esa es la fila que se buscaría si se colara.
  */
  const SIN_NOMBRE = `select count(*)::int as n from ${ESQUEMA}.dashboards where slug ~ '^tablero(-[0-9]+)?$'`;
  for (const t of ["", "   "])
    await rechazaSinEscribir(
      `crear un tablero llamado «${t}»`,
      () => tb.createDashboardAction(inicial, forma({ title: t })),
      [SIN_NOMBRE, TABLEROS],
      conError("El tablero necesita un nombre."),
    );

  await rechazaSinEscribir(
    "renombrar a vacío",
    () => tb.renameDashboardAction(inicial, forma({ slug: BASE, title: "  " })),
    [TABLEROS],
    conError("El nombre no puede quedar vacío."),
  );

  const NO_EXISTE = conError("Ese tablero no existe.");
  const FANTASMA = `${PRE}-no-existe`;
  await rechazaSinEscribir("renombrar un tablero que no existe", () => tb.renameDashboardAction(inicial, forma({ slug: FANTASMA, title: "X" })), [TABLEROS], NO_EXISTE);
  await rechazaSinEscribir("publicar un tablero que no existe", () => tb.publishDashboardAction(inicial, forma({ slug: FANTASMA })), [TABLEROS], NO_EXISTE);
  await rechazaSinEscribir("módulos de un tablero que no existe", () => tb.setDashboardModulesAction(inicial, forma({ slug: FANTASMA, modulos: "ventas" })), [TABLEROS], NO_EXISTE);
  await rechazaSinEscribir(
    "reordenar un tablero que no existe",
    () => tb.reorderDashboardAction(inicial, forma({ slug: FANTASMA, orden })),
    [TABLEROS, COLOCACIONES],
    NO_EXISTE,
  );
  await rechazaSinEscribir("borrar un tablero que no existe", () => tb.deleteDashboardAction(forma({ slug: FANTASMA })), [TABLEROS, COLOCACIONES], (r) => r === undefined);

  /*
    Despublicar uno que no existe responde «Retirado» —el dominio no mira si la
    fila está— y no es un rechazo. Lo que sí se exige es que no escriba nada.
  */
  {
    const antes = JSON.stringify(await filas(TABLEROS));
    await tb.unpublishDashboardAction(inicial, forma({ slug: FANTASMA }));
    ok("despublicar uno que no existe no toca nada", antes === JSON.stringify(await filas(TABLEROS)));
  }

  await rechazaSinEscribir(
    "publicar un tablero sin ningún bloque encendido",
    () => tb.publishDashboardAction(inicial, forma({ slug: VACIO })),
    [TABLEROS],
    (r) => (r as { ok?: boolean; error?: string })?.ok === false &&
      /ningún análisis encendido/.test((r as { error?: string }).error ?? ""),
  );

  /*
    El orden viene de un campo oculto que rellena el navegador: entrada de
    usuario, aunque la escriba nuestro propio JavaScript.
  */
  const MAL_ORDEN = conError("El orden llegó con una forma que no se entiende.");
  for (const [como_, crudo] of [
    ["no es JSON", "{no es json"],
    ["no es una lista", JSON.stringify({ analysis: "sales.funnel" })],
    ["un bloque sin análisis", JSON.stringify([{ x: 0, y: 0, w: 12, h: 8 }])],
  ] as const)
    await rechazaSinEscribir(
      `reordenar con un orden que ${como_}`,
      () => tb.reorderDashboardAction(inicial, forma({ slug: BASE, orden: crudo })),
      [TABLEROS, COLOCACIONES],
      MAL_ORDEN,
    );

  /*
    UN ORDEN CON UN ANÁLISIS INEXISTENTE NO PUEDE DEJAR LA MITAD ESCRITA.

    `reorderDashboard` promete una transacción —«si se cae a la mitad, el
    tablero queda con la mitad del orden nuevo, que es peor que no haber movido
    nada»— y la abre, pero cuando `setPlacement` devuelve `{ ok: false }` la
    función hace `return r` DENTRO de la transacción. Devolver no es lanzar:
    Drizzle confirma, y lo que ya se escribió se queda. Aquí el primer bloque
    (el de arriba del lienzo) se ensancha a 24 y luego el segundo falla: la
    acción contesta «no existe el análisis» y el tablero quedó cambiado.

    Este probe lo encontró. `reorderDashboard` (`ml/dashboards.ts`) ahora hace
    `tx.rollback()` y devuelve el fallo desde fuera de la transacción.
  */
  await rechazaSinEscribir(
    "reordenar con un análisis inexistente al final",
    () =>
      tb.reorderDashboardAction(
        inicial,
        forma({
          slug: BASE,
          orden: JSON.stringify([
            { analysis: "sales.funnel", x: 0, y: 0, w: 24, h: 8 },
            { analysis: `no.existe.${PRE}`, x: 0, y: 20, w: 12, h: 8 },
          ]),
        }),
      ),
    [TABLEROS, COLOCACIONES],
    (r) => (r as { ok?: boolean })?.ok === false,
  );

  /*
    Las colocaciones: el análisis tiene que existir, la pantalla también, y uno
    de ficha no puede ir donde no hay identificador —quedaría mudo—.
  */
  const RARAS = `select count(*)::int as n from ${ESQUEMA}.analysis_placements
                  where analysis like 'no.existe%' or screen like '/admin/no-existe-${PRE}%'`;
  const colocacionesMalas: Array<[string, Record<string, string>, RegExp]> = [
    ["un análisis que no existe", { analysis: `no.existe.${PRE}`, screen: PANTALLA, active: "1" }, /No existe el análisis/],
    ["una pantalla que no existe", { analysis: "sales.trend", screen: `/admin/no-existe-${PRE}`, active: "1" }, /No existe la pantalla/],
    ["uno de ficha en un tablero", { analysis: "supplier.findings", screen: PANTALLA, active: "1" }, /quedaría mudo/],
  ];
  for (const [nombre, campos, motivo] of colocacionesMalas) {
    await rechazaSinEscribir(
      `colocar ${nombre}`,
      () => an.togglePlacementAction(inicial, forma(campos)),
      [COLOCACIONES, RARAS],
      (r) => (r as { ok?: boolean })?.ok === false && motivo.test((r as { error?: string }).error ?? ""),
    );
    await rechazaSinEscribir(
      `aceptar la propuesta de ${nombre}`,
      () => an.acceptRecommendationAction(inicial, forma(campos)),
      [COLOCACIONES, RARAS],
      (r) => (r as { ok?: boolean })?.ok === false && motivo.test((r as { error?: string }).error ?? ""),
    );
  }

  // Restaurar algo que nunca se configuró es un `delete` que no encuentra nada.
  {
    const antes = JSON.stringify(await filas(COLOCACIONES));
    const r = await an.resetPlacementAction(inicial, forma({ analysis: `no.existe.${PRE}`, screen: PANTALLA }));
    ok("restaurar una colocación inexistente no toca nada", r.ok && antes === JSON.stringify(await filas(COLOCACIONES)));
  }

  /* ── 3 · el camino feliz ─────────────────────────────────────────────── */
  seccion("crear: el tablero nace sin publicar y sembrado desde su módulo");

  const creado = await tb.createDashboardAction(inicial, forma({ title: `${TAG} Cierre de mes`, modulo: "pagos" }));
  const NUEVO = `${PRE}-cierre-de-mes`;
  ok("se crea", creado.ok === true, creado.error);
  ok("y devuelve el slug derivado del nombre", creado.slug === NUEVO, creado.slug);
  const [fila] = await filas<{ id: string; title: string; published_at: Date | null }>(
    `select id, title, published_at from ${ESQUEMA}.dashboards where slug = '${NUEVO}'`,
  );
  ok("la fila guarda el nombre tal cual", fila?.title === `${TAG} Cierre de mes`, fila?.title);
  ok("y nace SIN publicar", fila !== undefined && fila.published_at === null);

  /*
    Sembrar desde «pagos» pone los análisis de fábrica de ese módulo como
    propuestas del sistema, no como decisiones de quien lo creó.
  */
  const sembradas = await colocaciones(`dashboard:${NUEVO}`);
  ok("se sembró con los análisis de fábrica del módulo", sembradas.length >= 1, `${sembradas.length} bloques`);
  ok(
    "todos marcados como del sistema y numerados desde cero",
    sembradas.every((c) => c.source === "system") &&
      sembradas.map((c) => c.position).join() === sembradas.map((_, i) => i).join(),
    sembradas.map((c) => `${c.analysis}@${c.position}/${c.source}`).join(" "),
  );

  seccion("renombrar cambia el nombre y NUNCA el slug");
  let r = await tb.renameDashboardAction(inicial, forma({ slug: BASE, title: `  ${TAG} Pendientes  ` }));
  const [renombrado] = await filas<{ slug: string; title: string }>(
    `select slug, title from ${ESQUEMA}.dashboards where slug = '${BASE}'`,
  );
  ok("se renombra, sin los espacios de los bordes", r.ok && renombrado?.title === `${TAG} Pendientes`, renombrado?.title ?? r.error);

  seccion("reordenar guarda caja, forma y encendido; la posición sale del lienzo");
  /*
    Llega en un orden y se guarda en otro: la posición es el orden de LECTURA
    del lienzo (fila, luego columna), que es como se apilan en un teléfono. Y un
    ancho imposible se recorta en vez de tumbar el guardado.
  */
  r = await tb.reorderDashboardAction(
    inicial,
    forma({
      slug: BASE,
      orden: JSON.stringify([
        { analysis: "sales.funnel", x: 0, y: 8, w: 12, h: 8, active: true, viz: "barras" },
        { analysis: "sales.trend", x: 0, y: 0, w: 99, h: 8, active: true },
        { analysis: "sales.by-owner", x: 12, y: 8, w: 12, h: 8, active: false, viz: "x".repeat(40) },
      ]),
    }),
  );
  ok("se guarda", r.ok === true, r.error);
  const tras = await colocaciones(PANTALLA);
  const de = (id: string) => tras.find((c) => c.analysis === id);
  ok(
    "la posición sigue al lienzo, no al orden en que llegó",
    tras.map((c) => c.analysis).join() === "sales.trend,sales.funnel,sales.by-owner",
    tras.map((c) => `${c.analysis}@${c.position}`).join(" "),
  );
  ok("un ancho de 99 se recorta a la retícula de 24", de("sales.trend")?.w === 24, String(de("sales.trend")?.w));
  ok("la forma elegida se guarda", de("sales.funnel")?.viz === "barras", String(de("sales.funnel")?.viz));
  ok(
    "una forma más larga que la columna vuelve a «que la elija el sistema»",
    de("sales.by-owner")?.viz === null,
    String(de("sales.by-owner")?.viz),
  );
  ok("un bloque apagado se guarda apagado, no se borra", de("sales.by-owner")?.active === false);
  ok("y lo compuesto a mano queda como del usuario", tras.every((c) => c.source === "user"));

  seccion("publicar lo firma quien tiene la sesión; despublicar no borra nada");
  r = await tb.publishDashboardAction(inicial, forma({ slug: NUEVO }));
  const [pub] = await filas<{ published_at: Date | null; published_by_id: string | null }>(
    `select published_at, published_by_id from ${ESQUEMA}.dashboards where slug = '${NUEVO}'`,
  );
  ok("se publica", r.ok === true && pub?.published_at !== null, r.error);
  ok(
    "firmado por el usuario de la sesión",
    pub?.published_by_id === ACTOR,
    `esperado ${ACTOR.slice(0, 8)}…, guardado ${String(pub?.published_by_id).slice(0, 8)}…`,
  );

  const bloquesAntes = (await colocaciones(`dashboard:${NUEVO}`)).length;
  r = await tb.unpublishDashboardAction(inicial, forma({ slug: NUEVO }));
  const [despub] = await filas<{ published_at: Date | null }>(
    `select published_at from ${ESQUEMA}.dashboards where slug = '${NUEVO}'`,
  );
  ok("se despublica", r.ok === true && despub?.published_at === null);
  ok("y lo compuesto sigue ahí", (await colocaciones(`dashboard:${NUEVO}`)).length === bloquesAntes);

  seccion("módulos: la lista entera, en el orden en que llegó");
  const modulosDe = async (slug: string) =>
    (
      await filas<{ module: string }>(
        `select m.module from ${ESQUEMA}.dashboard_modules m
           join ${ESQUEMA}.dashboards d on d.id = m.dashboard_id
          where d.slug = '${slug}' order by m.position`,
      )
    ).map((m) => m.module);

  r = await tb.setDashboardModulesAction(inicial, forma({ slug: NUEVO, modulos: " rentabilidad , ventas " }));
  ok("se guardan", r.ok === true, r.error);
  ok("en el orden elegido: el primero manda", (await modulosDe(NUEVO)).join() === "rentabilidad,ventas", (await modulosDe(NUEVO)).join());

  /*
    Un módulo inventado se descarta —el dominio filtra contra el catálogo— y el
    mensaje tiene que contar lo que QUEDÓ. Decía «Sale en 2 módulos» con uno
    solo guardado: contaba lo que llegó, no lo que se guardó.
  */
  r = await tb.setDashboardModulesAction(inicial, forma({ slug: NUEVO, modulos: `compras,inventado-${PRE}` }));
  ok("un módulo inventado no se guarda", (await modulosDe(NUEVO)).join() === "compras", (await modulosDe(NUEVO)).join());
  ok("y el mensaje cuenta los que quedaron", r.ok && r.message === "Sale en 1 módulo.", r.message ?? r.error);

  /*
    Y un módulo repetido no tumba el guardado. La lista viene de un campo oculto,
    y `dashboard_modules` tiene llave (tablero, módulo): repetido, el INSERT
    reventaba contra la llave y la acción devolvía un error de servidor.
  */
  const rep = await intentar(() => tb.setDashboardModulesAction(inicial, forma({ slug: NUEVO, modulos: "ventas,compras,ventas" })));
  ok("un módulo repetido se guarda una vez", rep.valor?.ok === true && (await modulosDe(NUEVO)).join() === "ventas,compras", rep.error?.slice(0, 80) ?? (await modulosDe(NUEVO)).join());

  r = await tb.setDashboardModulesAction(inicial, forma({ slug: NUEVO, modulos: "" }));
  ok("vacío lo saca de todos: se llega por el menú", r.ok && (await modulosDe(NUEVO)).length === 0);

  seccion("colocar, apagar, aceptar y restaurar un análisis");
  const fila1 = async (analysis: string) =>
    (await colocaciones(PANTALLA)).find((c) => c.analysis === analysis);

  r = await an.togglePlacementAction(inicial, forma({ analysis: "sales.cycle", screen: PANTALLA, active: "1" }));
  let c = await fila1("sales.cycle");
  ok("colocar escribe la fila encendida, como decisión del usuario", r.ok && c?.active === true && c.source === "user", r.error);

  /*
    Apagar GUARDA una fila con `active = false` y no borra: si borrara, el
    análisis de fábrica volvería solo en la siguiente carga.
  */
  r = await an.togglePlacementAction(inicial, forma({ analysis: "sales.cycle", screen: PANTALLA, active: "0" }));
  c = await fila1("sales.cycle");
  ok("apagar deja la fila, apagada", r.ok && c?.active === false, r.error);

  r = await an.acceptRecommendationAction(inicial, forma({ analysis: "sales.lost-reasons", screen: PANTALLA }));
  c = await fila1("sales.lost-reasons");
  ok(
    "aceptar una propuesta la enciende marcada como del SISTEMA",
    r.ok && c?.active === true && c.source === "system",
    r.error ?? c?.source,
  );

  r = await an.resetPlacementAction(inicial, forma({ analysis: "sales.cycle", screen: PANTALLA }));
  ok("restaurar quita la fila: vuelve a lo de fábrica", r.ok && (await fila1("sales.cycle")) === undefined);

  /* ── 4 · aislamiento ─────────────────────────────────────────────────── */
  seccion(`lo escrito no se sale de ${ESQUEMA}`);
  const ajenoTableros = await cuantos("dashboards", `where slug like '${PRE}%'`, AJENO).catch(() => -1);
  if (ajenoTableros < 0) {
    console.log(`· sin ${AJENO} en esta base: el aislamiento no se puede medir`);
  } else {
    ok(`${AJENO} no tiene tableros con la marca`, ajenoTableros === 0, String(ajenoTableros));
    ok(
      "ni colocaciones",
      (await cuantos("analysis_placements", `where screen like 'dashboard:${PRE}%'`, AJENO)) === 0,
    );
    ok(
      `y en ${ESQUEMA} sí están`,
      (await cuantos("dashboards", `where slug like '${PRE}%'`)) === 3 &&
        (await cuantos("analysis_placements", `where screen like 'dashboard:${PRE}%'`)) > 0,
    );
  }

  /* ── 5 · borrar, al final porque se lleva el tablero ─────────────────── */
  seccion("borrar se lleva el tablero, sus módulos y sus bloques, y lo registra");
  await tb.setDashboardModulesAction(inicial, forma({ slug: NUEVO, modulos: "pagos" }));
  const id = fila?.id ?? "";
  const bloques = (await colocaciones(`dashboard:${NUEVO}`)).length;

  const borrado = await intentar(() => tb.deleteDashboardAction(forma({ slug: NUEVO })));
  ok("termina llevando al portal", redirigio(borrado, "/dashboard"), borrado.redirige ?? borrado.error?.slice(0, 80));
  ok("el tablero ya no está", (await cuantos("dashboards", `where slug = '${NUEVO}'`)) === 0);
  ok("ni sus módulos", (await cuantos("dashboard_modules", `where dashboard_id = '${id}'`)) === 0);
  ok(
    "ni sus bloques, que no cuelgan de una foránea",
    (await cuantos("analysis_placements", `where screen = 'dashboard:${NUEVO}'`)) === 0,
    `tenía ${bloques}`,
  );

  /*
    La bitácora es lo que permite reconstruir a mano lo que había, y lo firma
    quien tiene la sesión: sin el actor, un borrado no tiene a quién preguntar.
  */
  const [ev] = await filas<{ actor_id: string | null; n: number }>(
    `select actor_id, jsonb_array_length(payload->'placements')::int as n
       from ${ESQUEMA}.domain_events
      where aggregate_type = 'dashboard' and event_type = 'dashboard.deleted'
        and aggregate_id = '${id}'`,
  );
  ok("queda en la bitácora con los bloques que se llevó", ev?.n === bloques, `${ev?.n} de ${bloques}`);
  ok("firmado por el usuario de la sesión", ev?.actor_id === ACTOR, String(ev?.actor_id).slice(0, 8));
});
