import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { mlModels } from "@/lib/db/schema";
import { algorithmById, loadPredictor } from "./algorithms";
import { verdictFor, type Sample } from "./core";
import { chooseModel } from "./select";
import { datasetFor, listTemplates, templateById } from "./templates";
import { driftByModel, degraded } from "./serve";
import { trainTemplate, promoteModel } from "./lab";

/**
 * El lazo cerrado: medir, reentrenar, comparar y promover — o no.
 *
 * Hasta aquí las tres piezas existían y ninguna hablaba con la siguiente.
 * `driftByModel` medía el error real, `verdictFor` sabía juzgar y
 * `promoteModel` sabía promover, pero el único camino entre ellas era una
 * persona mirando una pantalla y apretando un botón. Un sistema que solo mejora
 * cuando alguien se acuerda de mirarlo no mejora.
 *
 * Lo que este módulo NO hace, y es tan importante como lo que hace: no promueve
 * por antigüedad, ni porque el modelo nuevo sea nuevo, ni porque el viejo lleve
 * mucho. Solo promueve cuando el aspirante **le gana al vigente sobre casos que
 * ninguno de los dos había visto**. Sin esa condición, un lazo automático es una
 * máquina de sustituir modelos buenos por modelos recientes.
 */

export type ReviewAction =
  | "sin-modelo"
  | "sin-desenlaces"
  | "sano"
  | "promovido"
  | "aspirante-rechazado"
  | "aspirante-peor"
  | "sin-datos-para-reentrenar";

export type Review = {
  template: string;
  action: ReviewAction;
  detail: string;
  /** Error real medido en producción contra el que prometió el backtest. */
  drift?: { n: number; mae: number; prometido: number };
  /** La comparación que decide, cuando hubo aspirante. */
  duelo?: { vigente: number; aspirante: number; algoritmo: string };
};

/**
 * Vuelve a examinar al modelo vigente sobre un conjunto de casos concreto.
 *
 * Existe porque las métricas guardadas no sirven para comparar: se midieron
 * sobre el histórico que había el día que se entrenó, y el aspirante se mide
 * sobre el de hoy. Enfrentar esos dos números sería comparar exámenes distintos
 * y llamarlo competencia.
 *
 * Quien llama decide QUÉ casos, y esa decisión es la que hace justo el duelo
 * (ver la nota larga en `reviewTemplate`): tienen que ser casos posteriores al
 * entrenamiento del vigente, o se le estaría examinando sobre lo que ya vio.
 */
async function evaluarVigente(
  modelId: string,
  test: Sample[],
): Promise<number | null> {
  const db = await tenantDb();
  const [m] = await db
    .select({ algorithm: mlModels.algorithm, params: mlModels.params })
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);
  if (!m) return null;

  const predictor = loadPredictor(m.algorithm, m.params);
  if (!predictor) return null;

  let err = 0;
  for (const s of test) err += Math.abs(predictor(s.features).value - s.target);
  return err / test.length;
}

/**
 * Revisa UNA pregunta y actúa si hace falta.
 *
 * El disparo lo decide `degraded`, que exige un mínimo de desenlaces medidos
 * antes de opinar: sin eso, tres predicciones desafortunadas bastarían para
 * tirar un modelo sano. Mientras no haya suficientes, la respuesta correcta es
 * «todavía no sé», y eso también se reporta.
 */
export async function reviewTemplate(templateId: string): Promise<Review> {
  const db = await tenantDb();

  const [vigente] = await db
    .select({
      id: mlModels.id,
      metrics: mlModels.metrics,
      algorithm: mlModels.algorithm,
      trainedUpTo: mlModels.trainedUpTo,
    })
    .from(mlModels)
    .where(and(eq(mlModels.template, templateId), eq(mlModels.status, "production")))
    .orderBy(desc(mlModels.promotedAt))
    .limit(1);

  if (!vigente) {
    return {
      template: templateId,
      action: "sin-modelo",
      detail: "No hay ningún modelo en producción para esta pregunta.",
    };
  }

  const prometido = Number((vigente.metrics as Record<string, number>)?.mae ?? NaN);
  const drift = (await driftByModel())[vigente.id];

  if (!degraded(drift, prometido)) {
    // Dos situaciones distintas bajo la misma respuesta «no toco nada», y se
    // separan porque significan cosas opuestas: una es salud comprobada, la
    // otra es ignorancia.
    if (!drift || drift.n < 20) {
      return {
        template: templateId,
        action: "sin-desenlaces",
        detail:
          `Hay ${drift?.n ?? 0} desenlace(s) medido(s); hacen falta 20 para ` +
          `poder afirmar que se está degradando. Sin eso, reentrenar sería ` +
          `actuar sobre ruido.`,
        drift: drift ? { n: drift.n, mae: drift.mae, prometido } : undefined,
      };
    }
    return {
      template: templateId,
      action: "sano",
      detail:
        `Error real ${drift.mae.toFixed(2)} contra ${prometido.toFixed(2)} ` +
        `prometido, sobre ${drift.n} desenlaces. Dentro de lo esperado.`,
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }

  /* --- Se degradó: entra un aspirante --- */
  const template = await templateById(templateId);
  if (!template) {
    return {
      template: templateId,
      action: "sin-modelo",
      detail: "La plantilla de este modelo ya no existe.",
    };
  }

  const entrenado = await trainTemplate(templateId, null);
  if (!entrenado.ok || !entrenado.modelId) {
    return {
      template: templateId,
      action: "sin-datos-para-reentrenar",
      detail: entrenado.reason ?? "No se pudo reentrenar.",
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }
  if (!entrenado.approved) {
    return {
      template: templateId,
      action: "aspirante-rechazado",
      detail:
        `El modelo vigente se está degradando, pero el reentrenado tampoco ` +
        `pasa el examen: ${entrenado.reason}. Se deja el vigente y queda ` +
        `constancia del intento.`,
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }

  /* --- El duelo, sobre casos que NINGUNO de los dos ha visto --- */

  /*
    Aquí estuvo el error que casi se me cuela, y vale la pena dejarlo escrito.

    La primera versión enfrentaba a los dos sobre el tramo de prueba habitual
    (el último 30 % del histórico). Suena justo y no lo es: el modelo que está
    en producción se REENTRENÓ con todo el histórico cuando se guardó, así que
    esos casos están dentro de sus datos de entrenamiento. Medido sobre estos
    datos, el vigente daba 2,899 contra los 3,117 que había prometido —salía
    mejor de lo que era— y el aspirante no habría podido ganarle nunca.
    Examinar a uno con las respuestas en la mano.

    El corte honesto es la fecha hasta la que el vigente vio datos: lo posterior
    es territorio nuevo para él. Y al aspirante se le entrena SOLO con lo
    anterior, para que llegue al mismo examen en las mismas condiciones.

    Además es la pregunta que de verdad importa cuando algo se degrada: «con lo
    que ha pasado desde entonces, ¿quién lo hace mejor?».
  */
  const samples = await datasetFor(template);
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());

  const corte = vigente.trainedUpTo ? new Date(vigente.trainedUpTo) : null;
  const previos = corte ? ordered.filter((s) => s.at <= corte) : [];
  const nuevos = corte ? ordered.filter((s) => s.at > corte) : ordered;

  if (!corte || nuevos.length < 20) {
    return {
      template: templateId,
      action: "aspirante-rechazado",
      detail:
        `El vigente se está degradando, pero solo hay ${nuevos.length} caso(s) ` +
        `posteriores a su entrenamiento. Con menos de 20 no se puede decidir un ` +
        `relevo sin apostar; se deja el vigente y se vuelve a mirar más adelante.`,
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }

  // El aspirante se elige y se ajusta con lo ANTERIOR al corte.
  const seleccion = chooseModel(previos, Object.keys(template.featureLabels), {
    tolerance: template.tolerance,
  });
  if (!seleccion) {
    return {
      template: templateId,
      action: "aspirante-rechazado",
      detail: "No hay casos suficientes anteriores al corte para formar un aspirante.",
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }

  const algoritmo = algorithmById(seleccion.algorithmId);
  const aspiranteParams = algoritmo?.fit(previos, seleccion.config, 5);
  const aspirantePredictor = aspiranteParams
    ? algoritmo?.load(aspiranteParams)
    : null;
  const maeVigente = await evaluarVigente(vigente.id, nuevos);

  if (!aspirantePredictor || maeVigente === null) {
    return {
      template: templateId,
      action: "aspirante-rechazado",
      detail: "No se pudo comparar al aspirante contra el vigente; se deja el vigente.",
      drift: { n: drift.n, mae: drift.mae, prometido },
    };
  }

  let errAsp = 0;
  for (const s of nuevos) errAsp += Math.abs(aspirantePredictor(s.features).value - s.target);

  const duelo = {
    vigente: maeVigente,
    aspirante: errAsp / nuevos.length,
    algoritmo: seleccion.algorithmId,
  };

  // Empatar no basta. Sustituir un modelo en producción invalida las
  // predicciones abiertas que apuntan al anterior y reinicia la medición de
  // deriva; hacerlo por un empate cuesta más de lo que da.
  if (duelo.aspirante >= duelo.vigente) {
    return {
      template: templateId,
      action: "aspirante-peor",
      detail:
        `El vigente se degradó, pero reentrenar no ayuda: sobre los ` +
        `${nuevos.length} casos posteriores a su entrenamiento el aspirante da ` +
        `${duelo.aspirante.toFixed(2)} y el vigente ${duelo.vigente.toFixed(2)}. ` +
        `El problema no es el modelo — es que la realidad cambió de una forma ` +
        `que estos rasgos no capturan.`,
      drift: { n: drift.n, mae: drift.mae, prometido },
      duelo,
    };
  }

  await promoteModel(entrenado.modelId, {
    reason:
      `Promovido automáticamente: el vigente se degradó a ${drift.mae.toFixed(2)} ` +
      `(prometía ${prometido.toFixed(2)}), y sobre los ${nuevos.length} casos ` +
      `posteriores a su entrenamiento el aspirante da ${duelo.aspirante.toFixed(2)} ` +
      `contra ${duelo.vigente.toFixed(2)} del vigente.`,
  });

  return {
    template: templateId,
    action: "promovido",
    detail:
      `Reemplazado. ${verdictFor(seleccion.backtest).reason} ` +
      `Sobre territorio nuevo le gana al vigente por ` +
      `${(((duelo.vigente - duelo.aspirante) / duelo.vigente) * 100).toFixed(1)}%.`,
    drift: { n: drift.n, mae: drift.mae, prometido },
    duelo,
  };
}

/** Revisa todas las preguntas de la empresa. */
export async function reviewAll(): Promise<Review[]> {
  const out: Review[] = [];
  // En serie: reentrenar recorre el histórico completo, y lanzar cinco a la vez
  // sobre el pool del inquilino —que es de tres conexiones— los pondría a
  // esperarse entre sí sin ganar nada.
  for (const t of await listTemplates()) {
    out.push(await reviewTemplate(t.id));
  }
  return out;
}
