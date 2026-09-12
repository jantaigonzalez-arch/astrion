/**
 * LAS ACCIONES DEL EMBUDO DEL CRM: ALTA, EDICIÓN, ORDEN Y BORRADO DE ETAPAS.
 *
 *   npx tsx --tsconfig tsconfig.probe.json --conditions react-server scripts/_probe-acciones-crm-etapas.ts
 *
 * Cuatro de las veintidós acciones de `lib/actions/crm.ts`. Las demás, en
 * `_probe-acciones-crm-negocios`, `-fichas` y `-seguimiento`.
 *
 * ── LO QUE SE ATA AQUÍ ─────────────────────────────────────────────────────
 *
 * Las cuatro son de configuración: cambian el tablero de TODO el equipo
 * comercial, así que piden «administrar», y con «editar» tienen que decir que
 * no. Es la comprobación que más vale en este archivo.
 *
 * Además, dos cosas que solo decide la acción:
 *
 *   · la probabilidad se recorta a 0..100 y los días de estancamiento a
 *     0..365 — un 150 % inflaría el pronóstico ponderado de todos;
 *   · una etapa con negocios NO se borra: la cascada de `crm_stages` se
 *     llevaría los negocios con ella.
 *
 * Estas acciones leen el `FormData` a mano, sin esquema: un número que no es
 * número acaba en el error de Postgres. Eso se acepta mientras no escriba —ver
 * `noEscribe`—; lo que no se acepta es que escriba.
 *
 * ── AISLAMIENTO FRENTE A LAS OTRAS PRUEBAS ─────────────────────────────────
 *
 * Todo vive en un embudo propio y marcado, y cada foto se acota a él.
 */
import {
  AJENO,
  ESQUEMA,
  borrarAlFinal,
  como,
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
  usuarioDeLaEmpresa,
} from "./_acciones-kit";

const TAG = marca("CRME");
/** Un uuid bien formado que no es de nada. */
const NADIE = "00000000-0000-4000-8000-000000000000";

/**
 * Para capturas que la interfaz NO puede producir —un id que no es uuid, una
 * probabilidad que no es número—: la acción puede volver sin hacer nada o
 * reventar con el error de Postgres, y las dos valen; lo único que no vale es
 * escribir. Ver `_probe-acciones-crm-negocios`.
 */
async function noEscribe(etiqueta: string, fn: () => Promise<unknown>, que: string[]) {
  const antes = await foto(...que);
  const r = await intentar(fn);
  const despues = await foto(...que);
  ok(
    `${etiqueta}: no escribió`,
    antes === despues && r.redirige === undefined,
    antes === despues ? (r.error ? "(reventó, sin rastro)" : "") : `${antes} → ${despues}`,
  );
}

void probar("etapas del embudo: guardia, nivel, validación, firma y aislamiento", async () => {
  const ACTOR = (await usuarioDeLaEmpresa("sales")) ?? (await usuarioDeLaEmpresa());
  if (!ACTOR) throw new Error("la base no trae usuarios con membresía");

  /* ── El terreno: un embudo propio con tres etapas y un negocio ───────── */
  const [p] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_pipelines (name) values ('${TAG} Embudo') returning id`,
  );
  const P = p.id;
  // Borrar el embudo arrastra etapas y negocios por cascada.
  borrarAlFinal("crm_pipelines", `id = '${P}'`);
  const [e0, e1, e2] = await filas<{ id: string }>(
    `insert into ${ESQUEMA}.crm_stages (pipeline_id, name, "order", probability)
     values ('${P}', '${TAG} Prospecto', 0, 10), ('${P}', '${TAG} Propuesta', 1, 50),
            ('${P}', '${TAG} Vacía', 2, 80)
     returning id`,
  );
  const [E0, E1, E2] = [e0.id, e1.id, e2.id];
  // Un negocio en «Propuesta»: la etapa que NO se puede borrar.
  await filas(
    `insert into ${ESQUEMA}.crm_deals (reference, title, pipeline_id, stage_id)
     values ('${TAG}-1', '${TAG} Negocio', '${P}', '${E1}')`,
  );

  const c = await import("@/lib/actions/crm");

  const ETAPAS = `select count(*)::int as n from ${ESQUEMA}.crm_stages where pipeline_id = '${P}'`;
  const ORDEN = `select id, name, "order", probability, rotting_days from ${ESQUEMA}.crm_stages
                  where pipeline_id = '${P}' order by id`;
  /** Las tres respuestas que deben decir que no. «editar» es el escalón de menos. */
  const GUARDIA = [["sin sesión", null], ["sin permiso", false], ["con «editar»", "ventas:editar"]] as const;
  const sesion = (puede: null | false | string) => como(puede === null ? null : ACTOR, puede ?? true);

  /* ════════════════════════ createStage ════════════════════════ */
  seccion("createStage · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    sesion(puede);
    await rechazaSinEscribir(
      `crear etapa ${quien}`,
      () => c.createStage(forma({ pipelineId: P, name: `${TAG} No debe existir` })),
      [ETAPAS],
    );
  }

  seccion("createStage · la captura inválida");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("crear sin nombre", () => c.createStage(forma({ pipelineId: P, name: "" })), [ETAPAS]);
  await rechazaSinEscribir("crear con un nombre de puros espacios", () => c.createStage(forma({ pipelineId: P, name: "   " })), [ETAPAS]);
  await rechazaSinEscribir("crear sin embudo", () => c.createStage(forma({ name: `${TAG} Suelta` })), [ETAPAS]);
  await noEscribe("crear en un embudo que no existe", () => c.createStage(forma({ pipelineId: NADIE, name: `${TAG} Huérfana` })), [ETAPAS]);
  await noEscribe("crear con una probabilidad «abc»", () => c.createStage(forma({ pipelineId: P, name: `${TAG} Rara`, probability: "abc" })), [ETAPAS]);

  seccion("createStage · el camino feliz");
  const ajenoAntes = await cuantos("crm_stages", "", AJENO);
  await c.createStage(forma({ pipelineId: P, name: `  ${TAG} Negociación  `, probability: "150" }));
  await c.createStage(forma({ pipelineId: P, name: `${TAG} Perdida de vista`, probability: "-5" }));
  await c.createStage(forma({ pipelineId: P, name: `${TAG} Por omisión` }));
  const nuevas = await filas<{ name: string; order: number; probability: number }>(
    `select name, "order", probability from ${ESQUEMA}.crm_stages
      where pipeline_id = '${P}' and "order" >= 3 order by "order"`,
  );
  ok("las tres se crean, al final del embudo y en orden", nuevas.map((x) => x.order).join(",") === "3,4,5", nuevas.map((x) => x.order).join(","));
  ok("el nombre, sin espacios de sobra", nuevas[0]?.name === `${TAG} Negociación`, nuevas[0]?.name);
  // Un 150 % inflaría el pronóstico ponderado de todo el equipo.
  ok("una probabilidad de 150 se recorta a 100", nuevas[0]?.probability === 100, String(nuevas[0]?.probability));
  ok("una de -5, a 0", nuevas[1]?.probability === 0, String(nuevas[1]?.probability));
  ok("sin probabilidad, 50", nuevas[2]?.probability === 50, String(nuevas[2]?.probability));

  seccion("createStage · no se sale de la empresa");
  ok(`${AJENO} no ganó etapas`, (await cuantos("crm_stages", "", AJENO)) === ajenoAntes);
  ok("ni tiene nada con la marca", (await cuantos("crm_stages", `where name like '${TAG}%'`, AJENO)) === 0);

  /* ════════════════════════ updateStage ════════════════════════ */
  const FILA_E0 = `select name, probability, rotting_days from ${ESQUEMA}.crm_stages where id = '${E0}'`;
  const edicion = (cambio: Record<string, string> = {}) =>
    forma({ id: E0, name: `${TAG} Prospecto editado`, probability: "20", rottingDays: "7", ...cambio });

  seccion("updateStage · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    sesion(puede);
    await rechazaSinEscribir(`editar etapa ${quien}`, () => c.updateStage(edicion()), [FILA_E0]);
  }

  seccion("updateStage · la captura inválida");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("editar sin nombre", () => c.updateStage(edicion({ name: "" })), [FILA_E0]);
  await rechazaSinEscribir("editar sin id", () => c.updateStage(edicion({ id: "" })), [ORDEN]);
  await rechazaSinEscribir("editar una que no existe", () => c.updateStage(edicion({ id: NADIE })), [ORDEN]);
  await noEscribe("editar con id que no es uuid", () => c.updateStage(edicion({ id: "no-soy-un-uuid" })), [ORDEN]);
  await noEscribe("editar con probabilidad «abc»", () => c.updateStage(edicion({ probability: "abc" })), [FILA_E0]);
  await noEscribe("editar con días de estancamiento «abc»", () => c.updateStage(edicion({ rottingDays: "abc" })), [FILA_E0]);

  seccion("updateStage · el camino feliz");
  type Etapa = { name: string; probability: number; rotting_days: number };
  await c.updateStage(edicion({ name: `  ${TAG} Prospecto editado ` }));
  let [ed] = await filas<Etapa>(FILA_E0);
  ok("guarda nombre recortado, probabilidad y días", ed?.name === `${TAG} Prospecto editado` && ed?.probability === 20 && ed?.rotting_days === 7);
  await c.updateStage(edicion({ probability: "101", rottingDays: "400" }));
  [ed] = await filas<Etapa>(FILA_E0);
  ok("la probabilidad se recorta a 100 y los días a 365", ed?.probability === 100 && ed?.rotting_days === 365, `${ed?.probability} / ${ed?.rotting_days}`);
  await c.updateStage(edicion({ probability: "-1", rottingDays: "-3" }));
  [ed] = await filas<Etapa>(FILA_E0);
  ok("y por abajo, a 0 los dos (0 días = sin aviso)", ed?.probability === 0 && ed?.rotting_days === 0);

  /* ════════════════════════ moveStage ════════════════════════ */
  seccion("moveStage · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    sesion(puede);
    await rechazaSinEscribir(`subir etapa ${quien}`, () => c.moveStage(forma({ id: E1, dir: "up" })), [ORDEN]);
  }

  seccion("moveStage · la captura inválida");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("mover hacia un lado que no existe", () => c.moveStage(forma({ id: E1, dir: "left" })), [ORDEN]);
  await rechazaSinEscribir("mover sin id", () => c.moveStage(forma({ id: "", dir: "up" })), [ORDEN]);
  await rechazaSinEscribir("mover una que no existe", () => c.moveStage(forma({ id: NADIE, dir: "up" })), [ORDEN]);
  await noEscribe("mover con id que no es uuid", () => c.moveStage(forma({ id: "no-soy-un-uuid", dir: "up" })), [ORDEN]);
  // La primera no tiene vecina de arriba: no se inventa un orden negativo.
  await rechazaSinEscribir("subir la primera", () => c.moveStage(forma({ id: E0, dir: "up" })), [ORDEN]);

  seccion("moveStage · el camino feliz");
  await c.moveStage(forma({ id: E1, dir: "up" }));
  const orden = await filas<{ id: string; order: number }>(
    `select id, "order" from ${ESQUEMA}.crm_stages where id in ('${E0}', '${E1}')`,
  );
  const de = (id: string) => orden.find((x) => x.id === id)?.order;
  ok("sube una: intercambia el orden con su vecina", de(E1) === 0 && de(E0) === 1, `${de(E1)} / ${de(E0)}`);

  /* ════════════════════════ deleteStage ════════════════════════ */
  const filaDe = (id: string) => [
    `select count(*)::int as n from ${ESQUEMA}.crm_stages where id = '${id}'`,
    `select count(*)::int as n from ${ESQUEMA}.domain_events where aggregate_id = '${id}'`,
  ];

  seccion("deleteStage · la guardia y el nivel");
  for (const [quien, puede] of GUARDIA) {
    sesion(puede);
    await rechazaSinEscribir(`borrar etapa ${quien}`, () => c.deleteStage(forma({ id: E2 })), filaDe(E2));
  }

  seccion("deleteStage · lo que no se puede borrar");
  como(ACTOR, "ventas:administrar");
  await rechazaSinEscribir("borrar sin id", () => c.deleteStage(forma({ id: "" })), [ORDEN]);
  // La cascada se llevaría el negocio: una etapa con negocios se queda.
  await rechazaSinEscribir(
    "borrar una etapa con negocios",
    () => c.deleteStage(forma({ id: E1 })),
    [...filaDe(E1), `select count(*)::int as n from ${ESQUEMA}.crm_deals where pipeline_id = '${P}'`],
  );

  seccion("deleteStage · el camino feliz");
  await c.deleteStage(forma({ id: E2 }));
  ok("la etapa vacía desaparece", (await cuantos("crm_stages", `where id = '${E2}'`)) === 0);
  const [snap] = await filas<{ actor_id: string; nombre: string }>(
    `select actor_id, payload->'snapshot'->>'name' as nombre from ${ESQUEMA}.domain_events
      where aggregate_id = '${E2}' and event_type = 'stage.deleted'`,
  );
  ok("y la baja queda en la bitácora, con la foto y el actor", snap?.actor_id === ACTOR && snap?.nombre === `${TAG} Vacía`);
});
