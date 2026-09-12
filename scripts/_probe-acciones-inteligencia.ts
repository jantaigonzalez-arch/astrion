/**
 * LAS ACCIONES DE LA CAPA DE INTELIGENCIA, Y EL ASISTENTE.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-inteligencia.ts
 *
 * Ocho acciones de «analisis:administrar» sobre preguntas y modelos
 * (`intelligence.ts`) y `analyzeRoute` (`assistant.ts`), que no pregunta por
 * permiso sino por ROL.
 *
 * ── EL SERVICIO DE PYTHON SE SUSTITUYE EN SU BORDE, NO EN EL CÓDIGO ────────
 *
 * Entrenar y emitir un pronóstico cruzan la red hasta `services/intelligence`,
 * que en esta máquina no está levantado —y aunque lo estuviera, entrenar de
 * verdad son decenas de segundos y un resultado que depende de los datos—. Sin
 * él, `client.ts` degrada como promete («no está disponible») y el camino feliz
 * no se podría recorrer nunca.
 *
 * Así que el probe levanta un servicio FALSO en un puerto local y apunta
 * `INTELLIGENCE_URL` a él antes de cargar las acciones: el mismo `fetch`, el
 * mismo contrato (`contracts.ts`), respuestas fijas. Lo que se ejercita es todo
 * lo del lado del ERP —la guardia, lo que se escribe, quién lo firma, a qué
 * empresa se le pregunta— y nada del lado de Python, que tiene sus propias
 * pruebas en `services/intelligence/tests`. Además deja probar lo que pasa
 * cuando el servicio se cae, que con el de verdad no se puede provocar a
 * voluntad.
 *
 * ── LO QUE NO SE REPITE ────────────────────────────────────────────────────
 *
 * `probe-borrar-modelos.mts` cubre el borrado en el dominio: que lo que sirve
 * no se borre, que la cascada se lleve SUS pronósticos y nada más, y que
 * limpiar rechazados no toque la pregunta vecina. Aquí solo se comprueba que
 * las dos acciones de borrar tienen guardia, validan y llegan a borrar.
 *
 * «Sin sesión» se escribe como «sin sesión y sin nivel», por lo mismo que en
 * `_probe-acciones-tableros`: estas acciones solo miran `puedeEn`, y en la
 * aplicación `puedeEn` sin sesión es «ninguno». El stub no lee la sesión.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
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

const TAG = marca("INT");
/** El slug de una pregunta solo admite `[a-z0-9._]`: la marca, sin guion. */
const T = TAG.toLowerCase().replace(/[^a-z0-9]/g, "");
const MODULO = "rentabilidad";
const QF = `${MODULO}.${T}fx.h3`;
const QV = `${MODULO}.${T}vacia.h3`;
const BLOB = Buffer.from(`modelo falso ${TAG}`).toString("base64");

const NO_ADMIN = "Solo un administrador configura la capa de inteligencia.";

/*
  Las fotos, acotadas a la marca. `%..h%` es el slug que saldría de una pregunta
  sin serie —`rentabilidad..h1`—: si la validación dejara pasar una, ahí caería.
*/
const PREGUNTAS = `
  select slug, module, subject, label, question, horizon, tolerance, tolerance_kind,
         unit, algorithm, builtin, created_by_id
    from ${ESQUEMA}.ml_templates
   where slug like '%${T}%' or slug like '%..h%' order by slug`;
const MODELOS = `
  select template, version, status, promoted_at, retired_at, trained_by_id, data_profile
    from ${ESQUEMA}.ml_models where template like '%${T}%' order by template, version`;
/*
  Con `issued_at`: reemitir el mismo periodo con el mismo modelo es un upsert
  que deja valor y periodo iguales, y sin la fecha la foto no vería que se
  reescribió. Lo destapó forzar la guardia a «editar» para ver si esto se
  ponía rojo: emitir pasaba en verde.
*/
const PRONOSTICOS = `
  select m.template, m.version, f.period, f.value, f.issued_at
    from ${ESQUEMA}.ml_forecasts f join ${ESQUEMA}.ml_models m on m.id = f.model_id
   where m.template like '%${T}%' order by 1, 2, 3`;

/* ── El servicio falso ─────────────────────────────────────────────────── */

type Modo = "aprobado" | "rechazado" | "caido" | "error";
const servicio = {
  modo: "aprobado" as Modo,
  llamadas: [] as Array<{ ruta: string; cuerpo: Record<string, unknown> | null }>,
};

/** `n` meses seguidos desde octubre de 2026, como los devuelve el servicio. */
const meses = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9 + i, 1));
    return d.toISOString().slice(0, 10);
  });

function responder(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

async function atender(req: IncomingMessage, res: ServerResponse) {
  let crudo = "";
  for await (const trozo of req) crudo += String(trozo);
  const cuerpo = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : null;
  const ruta = (req.url ?? "").split("?")[0];
  servicio.llamadas.push({ ruta, cuerpo });

  // Caído de verdad: se corta la conexión, que es lo que ve `fetch` cuando el
  // contenedor no está. Un 500 sería otra cosa —un servicio vivo que falla—.
  if (servicio.modo === "caido") return req.socket.destroy();
  if (servicio.modo === "error")
    return responder(res, 422, { detail: "la tarea classification todavía no está implementada" });

  if (ruta === "/entrenar") {
    const q = (cuerpo?.question ?? {}) as { slug?: string };
    const aprobado = servicio.modo === "aprobado";
    return responder(res, 200, {
      slug: q.slug,
      profile: { rows: 24, from_at: null, to_at: null, target_distinct: 20, target_constant: false, entities: null, columns: [], warnings: [], tail: [] },
      winner: { algorithm: "ridge", label: "Ridge", params: {}, val_error: 1.5, fitted: true, skipped_reason: null },
      leaderboard: [],
      backtest: {
        mae: 2, baseline_mae: 3, baseline_name: "último valor", improvement_pct: aprobado ? 33 : 1,
        within_tolerance_pct: 80, baseline_within_tolerance_pct: 60, n_train: 18, n_val: 3, n_test: 3,
        cutoff: "2026-06-01", horizon: 3,
      },
      verdict: { approved: aprobado, reason: aprobado ? "Le gana a la respuesta ingenua." : "No le gana a la respuesta ingenua." },
      // El servicio real manda el artefacto AUNQUE el veredicto sea negativo
      // (`automl/search.py`): el falso hace lo mismo.
      model_blob: BLOB,
      trained_up_to: "2026-09-01T00:00:00",
      seed: 7,
    });
  }
  if (ruta === "/pronosticar") {
    const n = Number(cuerpo?.periods ?? 6);
    return responder(res, 200, {
      slug: "x",
      subject_key: null,
      points: meses(n).map((at, i) => ({ at, value: 100 + i, lower: 90 + i, upper: 110 + i })),
      history: [{ at: "2026-09-01", value: 98, lower: 98, upper: 98 }],
      model: "ridge",
      trained_up_to: "2026-09-01",
    });
  }
  if (ruta.startsWith("/perfil/"))
    return responder(res, 200, {
      rows: 24, from_at: null, to_at: null, target_distinct: 20, target_constant: false,
      entities: null, columns: [], warnings: [], tail: [],
    });
  return responder(res, 404, { detail: `ruta desconocida ${ruta}` });
}

const VACIO = { label: null, blocks: [], watching: [] };

void probar("inteligencia y asistente: guardia, nivel, validación y lo que se guarda", async () => {
  const ACTOR = await usuarioDeLaEmpresa();
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /*
    El servicio falso se levanta ANTES de cargar las acciones: `client.ts` lee
    `INTELLIGENCE_URL` una sola vez, al importarse. Pisa lo que traiga
    `.env.local`, que es justo lo que se quiere.
  */
  const servidor = createServer((req, res) => void atender(req, res));
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  process.env.INTELLIGENCE_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  alLimpiar(async () => {
    servidor.closeAllConnections();
    await new Promise((listo) => servidor.close(listo));
  });

  /*
    Limpieza por la marca, registrada antes de sembrar. Los pronósticos se van
    en cascada con sus modelos.
  */
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.ml_templates where slug like '%${T}%'`));
  alLimpiar(() => sql.unsafe(`delete from ${ESQUEMA}.ml_models where template like '%${T}%'`));

  /*
    La pregunta de trabajo, sembrada a mano con un modelo de cada estado: uno
    probado, uno rechazado, uno sirviendo y uno sin artefacto. Así cada guardia
    tiene algo que ESCRIBIR si dejara pasar —promover el probado, retirar el que
    sirve, limpiar el rechazado—, y la foto lo vería. La vacía existe para lo
    mismo: borrar una pregunta con modelos se niega por otra razón.

    El módulo es Rentabilidad porque no tiene pantalla de trabajo que publique
    preguntas (`MODULE_SCREEN`): lo que sirva la de prueba no aparece en
    ninguna pantalla de la empresa mientras corre.
  */
  await sql.unsafe(
    `insert into ${ESQUEMA}.ml_templates (slug, module, label, question, subject, target, horizon, tolerance, tolerance_kind)
     values ($1, $3, $4, '¿?', $5, 'value', 3, 10, 'relative'),
            ($2, $3, $6, '¿?', $7, 'value', 3, 10, 'relative')`,
    [QF, QV, MODULO, `${TAG} Trabajo`, `${T}fx`, `${TAG} Vacía`, `${T}vacia`],
  );
  const modelo = async (version: number, status: string, blob: string | null) => {
    const [m] = await filas<{ id: string }>(
      `insert into ${ESQUEMA}.ml_models (template, version, status, algorithm, params, metrics, beats_baseline, model_blob, note)
       values ('${QF}', ${version}, '${status}', 'ridge', '{}', '{"mae": 2}', false,
               ${blob ? `'${blob}'` : "null"}, 'sembrado por el probe')
       returning id`,
    );
    return m.id;
  };
  const PROBADO = await modelo(1, "backtested", BLOB);
  const RECHAZADO = await modelo(2, "rejected", BLOB);
  const SIRVIENDO = await modelo(3, "production", BLOB);
  const SIN_BLOB = await modelo(4, "backtested", null);

  const it = await import("@/lib/actions/intelligence");
  const { analyzeRoute } = await import("@/lib/actions/assistant");
  const { analysisById } = await import("@/lib/ml/analyses");
  const inicial = { ok: false };
  const estado = async (id: string) =>
    (await filas<{ status: string }>(`select status from ${ESQUEMA}.ml_models where id = '${id}'`))[0]?.status;

  /* ── 1 · la guardia, y el nivel ──────────────────────────────────────── */
  const llamadas: Array<[string, () => Promise<unknown>]> = [
    ["crear pregunta", () => it.createQuestionAction(inicial, forma({ module: MODULO, subject: `${T}g`, label: `${TAG} Guardia`, tolerance: "10" }))],
    ["borrar pregunta", () => it.deleteQuestionAction(inicial, forma({ slug: QV }))],
    ["entrenar", () => it.trainQuestionAction(inicial, forma({ slug: QF }))],
    ["promover", () => it.promoteModelAction(inicial, forma({ modelId: PROBADO, slug: QF }))],
    ["retirar", () => it.retireModelAction(inicial, forma({ modelId: SIRVIENDO }))],
    ["borrar modelo", () => it.deleteModelAction(inicial, forma({ modelId: PROBADO }))],
    ["limpiar rechazados", () => it.cleanRejectedModelsAction(inicial, forma({ slug: QF }))],
    ["emitir pronóstico", () => it.issueForecastAction(inicial, forma({ slug: QF, periods: "3" }))],
  ];
  const identidades: Array<[string, () => void]> = [
    ["sin sesión", () => como(null, false)],
    ["sin permiso", () => como(ACTOR, false)],
    /*
      Un escalón menos. Promover un modelo decide qué cifra ve quien compra: no
      es trabajo de quien solo edita.
    */
    ["con «analisis:editar»", () => como(ACTOR, "analisis:editar")],
  ];

  const llamadasAntes = servicio.llamadas.length;
  for (const [quien, ponerse] of identidades) {
    seccion(`${quien}, ninguna escribe`);
    ponerse();
    for (const [nombre, fn] of llamadas)
      await rechazaSinEscribir(`${nombre}, ${quien}`, fn, [PREGUNTAS, MODELOS, PRONOSTICOS], conError(NO_ADMIN));
  }
  /*
    Y el portero va ANTES del servicio: una guardia que llamara a Python y
    luego descartara el resultado no escribiría nada, pero habría puesto a
    entrenar minutos al servicio por cuenta de quien no puede.
  */
  ok("ninguna llegó a llamar al servicio de inteligencia", servicio.llamadas.length === llamadasAntes, `${servicio.llamadas.length - llamadasAntes} llamadas`);

  como(ACTOR, "analisis:administrar");

  /* ── 2 · la captura inválida ─────────────────────────────────────────── */
  seccion("con permiso y captura inválida, tampoco");
  const FALTA = conError("Falta el módulo, la serie o el nombre.");
  for (const [falta, campos] of [
    ["el nombre", { module: MODULO, subject: `${T}v1`, label: "  ", tolerance: "10" }],
    ["el módulo", { module: "", subject: `${T}v2`, label: "X", tolerance: "10" }],
    ["la serie", { module: MODULO, subject: "", label: "X", tolerance: "10" }],
  ] as const)
    await rechazaSinEscribir(`crear una pregunta sin ${falta}`, () => it.createQuestionAction(inicial, forma(campos)), [PREGUNTAS], FALTA);

  /*
    El margen es lo que define qué cuenta como acierto. Cero, negativo o texto
    dejarían un veredicto que no significa nada.
  */
  for (const t of ["0", "-5", "abc", ""])
    await rechazaSinEscribir(
      `crear una pregunta con margen «${t}»`,
      () => it.createQuestionAction(inicial, forma({ module: MODULO, subject: `${T}m`, label: "X", tolerance: t })),
      [PREGUNTAS],
      (r) => /^El margen tiene que ser mayor que cero/.test((r as { error?: string })?.error ?? ""),
    );

  await rechazaSinEscribir(
    "crear otra con el mismo módulo, serie y horizonte",
    () => it.createQuestionAction(inicial, forma({ module: MODULO, subject: `${T}fx`, label: "Otra", tolerance: "10", horizon: "3" })),
    [PREGUNTAS],
    (r) => /^Ya existe una pregunta/.test((r as { error?: string })?.error ?? ""),
  );
  await rechazaSinEscribir(
    "borrar una pregunta que ya tiene modelos",
    () => it.deleteQuestionAction(inicial, forma({ slug: QF })),
    [PREGUNTAS, MODELOS],
    (r) => /ya tiene modelos entrenados/.test((r as { error?: string })?.error ?? ""),
  );

  const llamadasValidacion = servicio.llamadas.length;
  await rechazaSinEscribir(
    "entrenar una pregunta que no existe",
    () => it.trainQuestionAction(inicial, forma({ slug: `${MODULO}.${T}nada.h1` })),
    [MODELOS],
    conError("Esa pregunta no existe."),
  );
  await rechazaSinEscribir(
    "emitir sin modelo en producción",
    () => it.issueForecastAction(inicial, forma({ slug: QV })),
    [MODELOS, PRONOSTICOS],
    conError("No hay modelo en producción para esta pregunta."),
  );
  ok("ninguna de las dos molestó al servicio", servicio.llamadas.length === llamadasValidacion);

  /*
    EL ID DEL MODELO LLEGA DE UN CAMPO OCULTO: puede no ser un UUID.

    Las tres acciones de modelo se lo pasaban tal cual a un `where id = …` y
    Postgres respondía «invalid input syntax for type uuid»: la acción LANZABA
    y la pantalla recibía un error de servidor, cuando la cabecera de
    `intelligence.ts` promete devolver siempre el motivo.
  */
  const MAL_ID = "no-soy-un-uuid";
  const INEXISTENTE = "00000000-0000-4000-8000-000000000000";
  const NO_EXISTE_MODELO = conError("Ese modelo no existe.");
  await rechazaSinEscribir("promover un id que no es UUID", () => it.promoteModelAction(inicial, forma({ modelId: MAL_ID, slug: QF })), [MODELOS, PRONOSTICOS], NO_EXISTE_MODELO);
  await rechazaSinEscribir("retirar un id que no es UUID", () => it.retireModelAction(inicial, forma({ modelId: MAL_ID })), [MODELOS], NO_EXISTE_MODELO);
  await rechazaSinEscribir("borrar un id que no es UUID", () => it.deleteModelAction(inicial, forma({ modelId: MAL_ID })), [MODELOS], NO_EXISTE_MODELO);
  await rechazaSinEscribir("promover un modelo que no existe", () => it.promoteModelAction(inicial, forma({ modelId: INEXISTENTE, slug: QF })), [MODELOS, PRONOSTICOS], NO_EXISTE_MODELO);
  await rechazaSinEscribir("borrar un modelo que no existe", () => it.deleteModelAction(inicial, forma({ modelId: INEXISTENTE })), [MODELOS], conError("Ese entrenamiento ya no existe."));

  // La compuerta de la regla 1: se promueve porque aporta, no porque alguien quiera.
  await rechazaSinEscribir(
    "promover uno RECHAZADO en su evaluación",
    () => it.promoteModelAction(inicial, forma({ modelId: RECHAZADO, slug: QF })),
    [MODELOS, PRONOSTICOS],
    (r) => /quedó rechazado/.test((r as { error?: string })?.error ?? ""),
  );
  await rechazaSinEscribir(
    "promover uno sin artefacto",
    () => it.promoteModelAction(inicial, forma({ modelId: SIN_BLOB, slug: QF })),
    [MODELOS, PRONOSTICOS],
    (r) => /no tiene artefacto/.test((r as { error?: string })?.error ?? ""),
  );

  {
    const antes = JSON.stringify(await filas(MODELOS));
    const r = await it.cleanRejectedModelsAction(inicial, forma({ slug: `${MODULO}.${T}nada.h1` }));
    ok(
      "limpiar los rechazados de una pregunta que no existe no borra nada",
      r.ok && r.message === "0 entrenamientos rechazados borrados." && antes === JSON.stringify(await filas(MODELOS)),
      r.message,
    );
  }

  /* ── 3 · con el servicio caído, o fallando ───────────────────────────── */
  seccion("si el servicio no está, se dice y no se escribe nada");
  servicio.modo = "caido";
  const CAIDO = conError("La capa de inteligencia no está disponible.");
  /*
    `client.ts` registra cada fallo con su pila entera. Se intercepta en vez de
    dejarlo salir —cuarenta líneas de undici que no dicen nada nuevo— y se
    comprueba que se registró: degradar en silencio sería peor que romper.
  */
  const registrado: string[] = [];
  const errorOriginal = console.error;
  console.error = (...args: unknown[]) => void registrado.push(String(args[0]));
  try {
    await rechazaSinEscribir("entrenar con el servicio caído", () => it.trainQuestionAction(inicial, forma({ slug: QF })), [MODELOS], CAIDO);
    await rechazaSinEscribir("emitir con el servicio caído", () => it.issueForecastAction(inicial, forma({ slug: QF })), [MODELOS, PRONOSTICOS], CAIDO);
  } finally {
    console.error = errorOriginal;
  }
  ok(
    "y el fallo queda en el registro del servidor",
    registrado.some((l) => l.includes("/entrenar falló")) && registrado.some((l) => l.includes("/pronosticar falló")),
    registrado.join(" | ").slice(0, 80),
  );

  /*
    Un servicio VIVO que se niega viaja con su motivo: «respondió 422» sin el
    `detail` de FastAPI no le dice a nadie qué hacer.
  */
  servicio.modo = "error";
  await rechazaSinEscribir(
    "entrenar cuando el servicio contesta 422",
    () => it.trainQuestionAction(inicial, forma({ slug: QF })),
    [MODELOS],
    (r) => /respondió 422\. .*todavía no está implementada/.test((r as { error?: string })?.error ?? ""),
  );
  servicio.modo = "aprobado";

  /* ── 4 · el camino feliz ─────────────────────────────────────────────── */
  seccion("crear: lo que se guarda y quién lo firma");
  let r = await it.createQuestionAction(
    inicial,
    forma({
      module: MODULO,
      subject: `${T}n`,
      label: `  ${TAG} Nueva  `,
      question: "",
      tolerance: "12.5",
      toleranceKind: "absolute",
      horizon: "99",
      unit: "piezas por mes y por sucursal",
      algorithm: "   ",
    }),
  );
  const QN = `${MODULO}.${T}n.h12`;
  ok("se crea", r.ok === true, r.error);
  const [p] = await filas<{
    label: string; question: string; horizon: number; tolerance: string; tolerance_kind: string;
    unit: string; algorithm: string | null; builtin: boolean; created_by_id: string | null;
  }>(`select label, question, horizon, tolerance, tolerance_kind, unit, algorithm, builtin, created_by_id
        from ${ESQUEMA}.ml_templates where slug = '${QN}'`);
  ok("el horizonte de 99 se acota a 12, y entra en el slug", p?.horizon === 12, p ? String(p.horizon) : "no está");
  ok("sin pregunta escrita, la pregunta es el nombre", p?.question === `${TAG} Nueva` && p.label === `${TAG} Nueva`, p?.question);
  ok("el margen absoluto, tal cual", p?.tolerance === "12.50" && p.tolerance_kind === "absolute", `${p?.tolerance} ${p?.tolerance_kind}`);
  ok("la unidad, recortada a los 20 de la columna", p?.unit === "piezas por mes y por", p?.unit);
  ok("algoritmo en blanco es AutoML: null, no cadena vacía", p?.algorithm === null, String(p?.algorithm));
  ok("nunca nace como de fábrica", p?.builtin === false);
  ok("firmada por el usuario de la sesión", p?.created_by_id === ACTOR, String(p?.created_by_id).slice(0, 8));

  seccion("entrenar guarda el resultado, gane o pierda");
  const antesEntrenar = servicio.llamadas.length;
  r = await it.trainQuestionAction(inicial, forma({ slug: QN }));
  ok("entrena y devuelve el veredicto", r.ok === true && r.message === "Aprobado — Le gana a la respuesta ingenua.", r.message ?? r.error);
  const pedido = servicio.llamadas.slice(antesEntrenar).find((l) => l.ruta === "/entrenar")?.cuerpo as
    | { tenant?: string; question?: { slug?: string } }
    | undefined;
  /*
    La regla 3 de `client.ts`: el servicio solo alcanza el esquema de la
    empresa activa, y la empresa la pone el contexto, no quien llama.
  */
  ok(
    "al servicio se le pregunta por la empresa de la sesión, y por esa pregunta",
    pedido?.tenant === ESQUEMA.replace(/^tenant_/, "") && pedido.question?.slug === QN,
    `${pedido?.tenant} · ${pedido?.question?.slug}`,
  );

  type M = { id: string; version: number; status: string; trained_by_id: string | null; model_blob: string | null; note: string | null; promoted_at: Date | null; retired_at: Date | null; data_profile: Record<string, unknown> | null };
  const modelosDe = (slug: string) =>
    filas<M>(
      `select id, version, status, trained_by_id, model_blob, note, promoted_at, retired_at, data_profile
         from ${ESQUEMA}.ml_models where template = '${slug}' order by version`,
    );
  let ms = await modelosDe(QN);
  ok("queda la versión 1, probada", ms.length === 1 && ms[0].version === 1 && ms[0].status === "backtested", ms.map((m) => `${m.version}/${m.status}`).join());
  ok("con el artefacto y el motivo del veredicto", ms[0]?.model_blob === BLOB && ms[0]?.note === "Le gana a la respuesta ingenua.");
  ok("firmada por el usuario de la sesión", ms[0]?.trained_by_id === ACTOR, String(ms[0]?.trained_by_id).slice(0, 8));

  servicio.modo = "rechazado";
  r = await it.trainQuestionAction(inicial, forma({ slug: QN }));
  servicio.modo = "aprobado";
  ms = await modelosDe(QN);
  ok(
    "un rechazo no es un fallo: ok, con el motivo",
    r.ok === true && r.message === "Rechazado — No le gana a la respuesta ingenua.",
    r.message ?? r.error,
  );
  ok("y se guarda como versión 2, sin pisar la 1", ms.map((m) => `${m.version}/${m.status}`).join() === "1/backtested,2/rejected", ms.map((m) => `${m.version}/${m.status}`).join());

  /* ── 5 · aislamiento, con algo ya escrito ────────────────────────────── */
  const ajeno = await cuantos("ml_templates", `where slug like '%${T}%'`, AJENO).catch(() => -1);
  if (ajeno < 0) console.log(`· sin ${AJENO} en esta base: el aislamiento no se puede medir`);
  else {
    seccion(`lo escrito no se sale de ${ESQUEMA}`);
    ok(`${AJENO} no tiene preguntas con la marca`, ajeno === 0, String(ajeno));
    ok("ni modelos", (await cuantos("ml_models", `where template like '%${T}%'`, AJENO)) === 0);
  }

  seccion("promover pone a servir y emite en el acto");
  const V1 = ms[0].id;
  const V2 = ms[1].id;
  r = await it.promoteModelAction(inicial, forma({ modelId: V1, slug: QN }));
  ok("se promueve, con el pronóstico emitido", r.ok === true && r.message === "En producción, con 6 periodos pronosticados.", r.message ?? r.error);
  ms = await modelosDe(QN);
  ok("la versión 1 queda en producción, con su fecha", ms[0].status === "production" && ms[0].promoted_at !== null, ms[0].status);
  ok("y sus seis periodos escritos", (await cuantos("ml_forecasts", `where model_id = '${V1}'`)) === 6);

  seccion("emitir: los periodos se acotan y la historia viaja con el modelo");
  const antesEmitir = servicio.llamadas.length;
  r = await it.issueForecastAction(inicial, forma({ slug: QN, periods: "999" }));
  const pidio = servicio.llamadas.slice(antesEmitir).find((l) => l.ruta === "/pronosticar")?.cuerpo?.periods;
  ok("999 periodos se piden como 24", r.ok === true && pidio === 24, `${pidio} · ${r.message ?? r.error}`);
  ok("y se escriben 24, reemplazando los 6 de antes en vez de duplicarlos", (await cuantos("ml_forecasts", `where model_id = '${V1}'`)) === 24);
  ms = await modelosDe(QN);
  ok("la cola observada queda en el perfil del modelo", Array.isArray(ms[0].data_profile?.tail));

  seccion("retirar, borrar y limpiar");
  r = await it.retireModelAction(inicial, forma({ modelId: V1 }));
  ms = await modelosDe(QN);
  ok("retirar lo apaga y deja la fila, con su fecha", r.ok && ms[0].status === "retired" && ms[0].retired_at !== null, ms[0].status);

  r = await it.deleteModelAction(inicial, forma({ modelId: V1 }));
  ok("borrar un retirado lo quita", r.ok === true && (await estado(V1)) === undefined, r.error);

  r = await it.cleanRejectedModelsAction(inicial, forma({ slug: QN }));
  ok("limpiar se lleva el rechazado y lo cuenta", r.message === "1 entrenamiento rechazado borrado." && (await estado(V2)) === undefined, r.message);

  r = await it.deleteQuestionAction(inicial, forma({ slug: QN }));
  ok("sin modelos, la pregunta se borra", r.ok === true && (await cuantos("ml_templates", `where slug = '${QN}'`)) === 0, r.error);

  /*
    UN RECHAZADO NO PUEDE VOLVERSE PROMOVIBLE PASANDO POR «RETIRADO».

    La regla 1 dice que la persona puede negarse a promover, nunca forzarlo, y
    la compuerta de `promoteModel` es `status === 'rejected'`. Pero
    `retireModel` pone `retired` a CUALQUIER modelo, también a uno rechazado,
    y el servicio manda el artefacto aunque el veredicto sea negativo. Retirar
    y luego promover saltaba la compuerta: un modelo que no le gana a la
    respuesta ingenua acababa sirviendo cifras. La pantalla no ofrece «retirar»
    en un rechazado, pero la acción se puede llamar a mano.

    Este probe lo encontró. `retireModel` (`intelligence/questions.ts`) ahora
    solo retira lo que está en producción.
  */
  seccion("la compuerta no se salta retirando antes");
  await it.retireModelAction(inicial, forma({ modelId: RECHAZADO }));
  const salto = await intentar(() => it.promoteModelAction(inicial, forma({ modelId: RECHAZADO, slug: QF })));
  const quedo = await estado(RECHAZADO);
  ok(
    "retirar un rechazado y luego promoverlo sigue sin ponerlo a servir",
    salto.valor?.ok === false && quedo !== "production",
    `quedó «${quedo}»${salto.valor?.message ? ` — ${salto.valor.message.slice(0, 50)}` : ""}`,
  );

  /* ── 6 · el asistente ────────────────────────────────────────────────── */
  /*
    `analyzeRoute` no pregunta por permiso sino por ROL, con `currentRole()`:
    soporte es el piso —un cliente o un vendedor reciben vacío— y los análisis
    de administración se descartan ANTES de consultarse. Lo que se compara es
    `watching`, que sale de los análisis colocados sin depender de los datos
    del día, así que no hay que sembrar tickets para poder afirmar algo.
  */
  seccion("el asistente responde según el rol");
  const vigila = (id: string) => analysisById(id)?.watching[0] ?? `(sin ${id})`;
  const esVacio = (x: unknown) => JSON.stringify(x) === JSON.stringify(VACIO);
  const COLA = "/admin/tickets";
  const PAGOS = "/admin/compras/cuentas-por-pagar";

  como(null);
  ok("sin sesión, vacío", esVacio(await analyzeRoute(COLA)));
  for (const rol of ["client", "sales", "general"]) {
    como(ACTOR, true, { rol });
    const x = await analyzeRoute(COLA);
    ok(`rol «${rol}» en la cola de servicio: vacío`, esVacio(x), x.label ?? "");
  }

  como(ACTOR, true, { rol: "agent" });
  let x = await analyzeRoute(COLA);
  ok("un agente en la cola ve lo que vigila la cola", x.label === "Cola de servicio" && x.watching.includes(vigila("tickets.findings")), x.label ?? "vacío");
  ok("un agente en cuentas por pagar: vacío, todo ahí es de administración", esVacio(await analyzeRoute(PAGOS)));

  como(ACTOR, true, { rol: "admin" });
  x = await analyzeRoute(PAGOS);
  ok("un administrador en cuentas por pagar sí lo ve", x.label === "Cuentas por pagar" && x.watching.includes(vigila("payables.findings")), x.label ?? "vacío");
  ok("una pantalla que no analiza nada: vacío", esVacio(await analyzeRoute("/admin/configuracion")));

  /*
    El permiso viaja con el DATO, no con la pantalla: un análisis de saldos
    colocado en la cola de servicio sigue siendo de administración. Se coloca
    uno a mano —solo si no había ya una fila, para no pisar configuración
    ajena— y en la empresa AJENA otro distinto, que no debe verse aquí.
  */
  seccion("un análisis de administración en la cola no se le enseña al agente");
  const colocar = async (esquema: string, analysis: string) => {
    const hecho = await filas<{ id: string }>(
      `insert into ${esquema}.analysis_placements (analysis, screen, position, active, source)
       values ('${analysis}', '${COLA}', 90, true, 'user')
       on conflict (analysis, screen) do nothing returning id`,
    );
    if (hecho[0]) alLimpiar(() => sql.unsafe(`delete from ${esquema}.analysis_placements where id = '${hecho[0].id}'`));
    return Boolean(hecho[0]);
  };
  const puesto = await colocar(ESQUEMA, "payables.findings");
  const ajenoPuesto = ajeno >= 0 && (await colocar(AJENO, "payables.calendar"));

  if (!puesto) console.log(`· ${ESQUEMA} ya tenía «payables.findings» en la cola: no se prueba sobre configuración ajena`);
  else {
    como(ACTOR, true, { rol: "agent" });
    x = await analyzeRoute(COLA);
    ok("el agente sigue viendo la cola, sin los saldos", x.label === "Cola de servicio" && !x.watching.includes(vigila("payables.findings")));
    como(ACTOR, true, { rol: "admin" });
    x = await analyzeRoute(COLA);
    ok("el administrador los ve en la cola", x.watching.includes(vigila("payables.findings")));
  }
  if (ajenoPuesto)
    ok(
      `lo colocado en ${AJENO} no aparece aquí`,
      !(await analyzeRoute(COLA)).watching.includes(vigila("payables.calendar")),
    );
});
