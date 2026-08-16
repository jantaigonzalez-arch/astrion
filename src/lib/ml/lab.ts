import "server-only";
import { unstable_cache } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireTenant, tenantDb, tenantDbFor } from "@/lib/tenancy/context";
import { datasetPathFor, freezeDataset, readDataset } from "@/lib/analytics/datasets";
import { mlModels, mlTemplates } from "@/lib/db/schema";
import {
  featureById,
  subjectById,
  targetById,
  MAX_FEATURES,
  type Subject,
  type Target,
} from "./blocks";
import { verdictFor } from "./core";
import { chooseModel } from "./select";
import {
  listTemplates,
  templateById,
  templateByIdIn,
  datasetFor,
  countFor,
  countForIn,
  type Template,
} from "./templates";
import { backfillOpenPredictions, driftByModel, degraded, type Drift } from "./serve";

/**
 * Orquestación del laboratorio: entrenar una plantilla, dejar constancia del
 * veredicto y decidir si sirve.
 *
 * La regla que gobierna todo el módulo: un modelo NO se promueve por decisión
 * de una persona, se promueve porque le ganó a la línea base en un backtest
 * temporal. La persona puede negarse a promoverlo, nunca forzarlo. Es la única
 * defensa contra el sesgo de haber invertido esfuerzo en construirlo.
 */

export type TrainOutcome = {
  ok: boolean;
  /**
   * Explicación en prosa. Sirve para las dos cosas que pueden salir mal —no se
   * pudo entrenar, o se entrenó y quedó rechazado— porque en ambos casos lo que
   * la pantalla necesita mostrar es el motivo, no un código.
   */
  reason?: string;
  modelId?: string;
  /** Dónde quedó congelado el conjunto. Nulo si no se pudo escribir. */
  datasetPath?: string | null;
  /** Veredicto final: si es false, no puede promoverse. */
  approved?: boolean;
  beatsBaseline?: boolean;
  mae?: number;
  baselineMae?: number;
  improvement?: number;
  withinTolerance?: number;
};

/**
 * Entrena una plantilla y guarda el resultado, gane o pierda.
 *
 * Los rechazos se guardan igual que los aprobados. Saber que sobre los datos de
 * esta empresa "predecir el próximo servicio" no funciona es información
 * valiosa: evita que alguien lo reintente en seis meses y, si mañana cambia el
 * mix de tickets, permite comparar contra el intento anterior.
 */
export async function trainTemplate(
  templateId: string,
  trainedById: string | null,
): Promise<TrainOutcome> {
  const template = await templateById(templateId);
  if (!template) return { ok: false, reason: "Esa plantilla no existe." };

  const samples = await datasetFor(template);
  if (samples.length === 0) {
    return {
      ok: false,
      reason:
        "Todavía no hay historial para esta pregunta. El laboratorio no inventa datos.",
    };
  }

  // El mismo guard que `readinessFor`, aquí porque este es el borde real: la
  // pantalla desactiva el botón, pero desactivar un botón no es una defensa.
  //
  // Sin esto, un objetivo constante llega hasta el final y produce el peor
  // informe que sabe emitir este módulo: "acierta el 100%" junto a un rechazo
  // que culpa a la mediana. Medido sobre estos datos con "días hasta
  // resolverse", donde los 456 tickets importados traen `resolved_at` igual a
  // `created_at`: error 0,00 contra línea base 0,00. Todo correcto y todo
  // inútil, porque la pregunta nunca tuvo respuesta que aprender.
  if (new Set(samples.map((s) => s.target)).size <= 1) {
    return {
      ok: false,
      reason:
        `Hay ${samples.length} casos, pero el valor a predecir es idéntico en ` +
        `todos. No hay nada que aprender: el problema está en cómo se registra ` +
        `ese dato, no en el modelo.`,
    };
  }

  // Compiten ALGORITMOS, no solo agrupaciones: mediana por grupo, árbol de
  // regresión y bosque aleatorio, cada uno con sus configuraciones, sobre un
  // tramo de validación que nunca toca el de prueba. Ver `chooseModel`.
  //
  // Cada algoritmo declara cuántos casos necesita para presentarse. Con el
  // volumen de hoy el bosque queda fuera por su propio umbral —y ese es el
  // comportamiento buscado: la capacidad está inscrita esperando datos, no
  // compitiendo antes de tiempo con un número que solo memoriza.
  const result = chooseModel(samples, Object.keys(template.featureLabels), {
    toleranceKind: template.toleranceKind,
    tolerance: template.tolerance,
  });

  if (!result) {
    return {
      ok: false,
      reason:
        `Hay ${samples.length} casos, pero no alcanzan para emitir un veredicto ` +
        `honesto. Se necesitan ~${MIN_SAMPLES}: el histórico se parte en tres ` +
        `—entrenar, elegir la mejor combinación de rasgos, y medir— y el tramo ` +
        `de medición no puede compartirse con el de elección sin inflar el ` +
        `resultado.`,
    };
  }

  const db = await tenantDb();

  // El veredicto exige DOS cosas: ganarle a la línea base y acertar lo
  // suficiente para que el número sirva. Ver `verdictFor`.
  const verdict = verdictFor(result.backtest);

  // Leer el máximo y escribir `máximo + 1` en dos pasos es una carrera: dos
  // administradores entrenando la misma plantilla a la vez leían el mismo
  // número y el segundo INSERT moría contra el índice único, saliendo a la
  // pantalla como "Error del servidor" después de haber recorrido el histórico
  // entero. El lock es de transacción —se suelta solo al confirmar— y va
  // sembrado con `current_schema()` para que dos EMPRESAS distintas entrenando
  // la misma plantilla no se esperen entre sí: solo compiten los que de verdad
  // pelean por el mismo consecutivo.
  const saved = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(current_schema() || ':ml:' || ${templateId}))`,
    );

    // La versión es consecutiva por plantilla: reentrenar nunca pisa la
    // anterior, porque hay predicciones apuntando a ella y borrarla dejaría
    // huérfano el historial con el que se mide la deriva.
    const [prev] = await tx
      .select({ v: mlModels.version })
      .from(mlModels)
      .where(eq(mlModels.template, templateId))
      .orderBy(desc(mlModels.version))
      .limit(1);

    const [row] = await tx
      .insert(mlModels)
      .values({
        template: templateId,
        version: (prev?.v ?? 0) + 1,
        status: verdict.approved ? "backtested" : "rejected",
        // Quién ganó el examen. Deja de ser una constante: la columna ya
        // significa algo y la pantalla puede decir con qué se está prediciendo.
        algorithm: result.algorithmId,
        params: result.model as unknown as Record<string, unknown>,
        // La tabla de la competencia viaja con las métricas: quién compitió y
        // con qué error. Perder también informa —deja escrito que se intentó—
        // y evita que dentro de un año alguien proponga «probemos un árbol».
        metrics: {
          ...result.backtest,
          leaderboard: result.leaderboard,
        } as unknown as Record<string, unknown>,
        // La columna guarda el HECHO estadístico, que no siempre coincide con
        // el veredicto: un modelo puede ganarle a la línea base y aun así
        // rechazarse.
        beatsBaseline: result.beatsBaseline,
        // La fecha del último caso que vio ESTE modelo, no la del corte del
        // backtest: el que se guarda se reentrenó con todo el histórico. Ver
        // `BacktestResult.trainedUpTo`.
        trainedUpTo: result.trainedUpTo,
        trainedById,
        note: verdict.reason,
      })
      .returning({ id: mlModels.id, version: mlModels.version });

    return row;
  });

  /*
    El conjunto se congela DESPUÉS de que la transacción asignó la versión, y
    el mismo orden que en el extractor: primero la fila, después el archivo.

    Al revés habría que inventar un nombre antes de saber la versión, y una
    corrida que muriera en medio dejaría un parquet que nadie reclama. Así el
    peor caso es un modelo sin snapshot —visible, porque `dataset_path` queda
    nulo— en vez de un archivo huérfano en el lago.

    Si congelar falla, el modelo NO se pierde: ya está guardado. Se queda sin
    reproducibilidad y se dice en el registro, que es preferible a tirar un
    entrenamiento que recorrió el histórico entero.
  */
  let datasetPath: string | null = null;
  try {
    const ctx = await requireTenant();
    const rel = datasetPathFor(ctx.slug, templateId, saved.version);
    await freezeDataset(samples, rel);
    await db.update(mlModels).set({ datasetPath: rel }).where(eq(mlModels.id, saved.id));
    datasetPath = rel;
  } catch (e) {
    console.error(`[ml] no se pudo congelar el conjunto de ${templateId}:`, e);
  }

  return {
    ok: true,
    modelId: saved.id,
    datasetPath,
    approved: verdict.approved,
    reason: verdict.reason,
    beatsBaseline: result.beatsBaseline,
    mae: result.backtest.mae,
    baselineMae: result.backtest.baselineMae,
    improvement: result.backtest.improvement,
    withinTolerance: result.backtest.withinTolerance,
  };
}

/**
 * Pone un modelo a servir predicciones.
 *
 * Retira al anterior de la misma plantilla en la misma transacción: si dos
 * quedaran en producción a la vez, las predicciones saldrían de uno u otro
 * según el orden de la consulta, y nadie podría explicar de dónde salió un
 * número. Un modelo por pregunta, siempre.
 */
export async function promoteModel(
  modelId: string,
  opts: { reason?: string } = {},
): Promise<TrainOutcome> {
  const db = await tenantDb();

  const [m] = await db
    .select({
      id: mlModels.id,
      template: mlModels.template,
      status: mlModels.status,
      note: mlModels.note,
    })
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!m) return { ok: false, reason: "Ese modelo no existe." };

  // La compuerta. Un modelo que no le gana al promedio no puede promoverse
  // aunque alguien insista: añadiría una pieza que mantener y un número que el
  // usuario puede malinterpretar, sin dar nada a cambio.
  if (m.status === "rejected") {
    return {
      ok: false,
      reason:
        "Este modelo quedó rechazado en su evaluación, así que no puede " +
        "promoverse. No es una restricción de permisos: es que no aporta. " +
        (m.note ?? ""),
    };
  }
  if (m.status === "production") return { ok: true, modelId };

  // Volver a producción un modelo RETIRADO es legítimo —es la única forma de
  // deshacer una promoción mala— pero no puede ser un clic más. Un retiro
  // ocurre por algo, a veces porque el modelo se estaba degradando, y su
  // veredicto guardado es de cuando se entrenó: no dice nada sobre cómo se
  // porta hoy. Así que se permite, exigiendo que quede escrito por qué. La
  // alternativa era prohibirlo, y eso dejaba sin salida a quien promovió por
  // error hace cinco minutos.
  if (m.status === "retired" && !opts.reason?.trim()) {
    return {
      ok: false,
      reason:
        "Este modelo estaba retirado. Para devolverlo a producción escribe por " +
        `qué: se retiró con el motivo «${m.note ?? "sin motivo"}», y volver ` +
        "atrás sin dejar constancia hace imposible saber después si fue una " +
        "reversión pensada o un descuido.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(mlModels)
      .set({ status: "retired", retiredAt: new Date(), note: "Reemplazado por una versión nueva." })
      .where(and(eq(mlModels.template, m.template), eq(mlModels.status, "production")));

    await tx
      .update(mlModels)
      .set({
        status: "production",
        promotedAt: new Date(),
        retiredAt: null,
        // El motivo de la reversión sustituye a la nota del retiro: es lo
        // último que pasó y es lo que hay que poder leer en la tarjeta.
        ...(opts.reason?.trim()
          ? { note: `Reactivado: ${opts.reason.trim()}` }
          : {}),
      })
      .where(eq(mlModels.id, modelId));
  });

  /*
    Promover no es marcar una fila: es dejar al modelo prediciendo.

    Sin esto, la promoción apagaba el pronóstico en silencio y nadie se
    enteraba. Las predicciones abiertas apuntan al modelo que las hizo, y el
    panel solo enseña las del modelo VIGENTE —tiene que ser así, o estaría
    publicando números de un modelo retirado—. Al promover v6, las 145
    estimaciones de los tickets abiertos seguían siendo de v5, así que el
    bloque «Horas estimadas en la cola» dejó de tener nada que enseñar. El
    laboratorio decía «en producción», la pantalla no decía nada, y las dos
    cosas eran ciertas a la vez.

    El repoblado ya existía, pero colgando de un botón que había que acordarse
    de pulsar después de cada promoción. Un paso obligatorio que depende de la
    memoria de alguien no es un paso: es una avería con retraso.

    Va FUERA de la transacción y sin poder tumbarla. Si el repoblado falla, el
    modelo ya está promovido y eso es correcto —la promoción es la decisión,
    predecir es la consecuencia—; se puede reintentar desde el botón, que
    sigue ahí. Deshacer la promoción por no haber podido predecir sería
    castigar la decisión buena por culpa del efecto.
  */
  try {
    const { issued } = await backfillOpenPredictions(m.template);
    if (issued > 0) {
      console.info(`[ml] ${m.template}: ${issued} estimación(es) reemitidas tras promover.`);
    }
  } catch (e) {
    console.error("[ml] falló el repoblado tras promover", m.template, e);
  }

  return { ok: true, modelId };
}

/** Saca un modelo de producción sin borrarlo: el historial se conserva. */
export async function retireModel(modelId: string, note: string): Promise<void> {
  const db = await tenantDb();
  await db
    .update(mlModels)
    .set({ status: "retired", retiredAt: new Date(), note })
    .where(eq(mlModels.id, modelId));
}

/* ------------------------- Crear y borrar preguntas ------------------------- */

export type NewTemplate = {
  label: string;
  subject: string;
  target: string;
  features: string[];
  tolerance: number;
};

/**
 * Da de alta una pregunta nueva.
 *
 * Valida contra el catálogo de bloques, no contra lo que llegó del formulario.
 * Es la frontera del módulo: todo lo que entra por aquí acaba compilándose a
 * SQL, así que un identificador que no esté en `blocks.ts` se rechaza antes de
 * tocar la base. No hay ruta por la que un rasgo inventado llegue a una
 * consulta.
 */
export async function createTemplate(
  t: NewTemplate,
  createdById: string | null,
): Promise<{ ok: boolean; reason?: string; slug?: string }> {
  const subject = subjectById(t.subject);
  const target = targetById(t.target);

  if (!subject) return { ok: false, reason: "Ese sujeto no existe." };
  if (!target || target.subject !== subject.id) {
    return { ok: false, reason: "Ese objetivo no aplica a ese sujeto." };
  }

  const features = t.features.map(featureById).filter((f) => f !== undefined);
  if (features.length !== t.features.length) {
    return { ok: false, reason: "Hay un rasgo que no existe en el catálogo." };
  }
  if (features.some((f) => !f.subjects.includes(subject.id))) {
    return { ok: false, reason: "Hay un rasgo que no aplica a ese sujeto." };
  }
  if (features.length === 0) {
    return { ok: false, reason: "Elige al menos un rasgo con el que agrupar." };
  }
  // El tope no es de rendimiento: cada rasgo extra multiplica las escaleras
  // candidatas, y cada candidata es una oportunidad más de ganar por azar. Ver
  // `laddersFor`.
  if (features.length > MAX_FEATURES) {
    return {
      ok: false,
      reason: `Como mucho ${MAX_FEATURES} rasgos. Más combinaciones no dan un modelo mejor, solo uno que parece mejor.`,
    };
  }

  const label = t.label.trim();
  if (label.length < 3) return { ok: false, reason: "Ponle un nombre a la pregunta." };
  if (!(t.tolerance > 0)) {
    return { ok: false, reason: "La tolerancia tiene que ser mayor que cero." };
  }

  const db = await tenantDb();

  // El slug se deriva del nombre y se desambigua con un sufijo. Es lo que van a
  // referenciar los modelos, así que tiene que ser estable aunque después
  // alguien renombre la plantilla.
  const base =
    slugify(label) || `${subject.id}_${target.id}`.replace(/[^a-z0-9_]/g, "");
  let slug = base.slice(0, 55);
  for (let i = 2; ; i++) {
    const [taken] = await db
      .select({ id: mlTemplates.id })
      .from(mlTemplates)
      .where(eq(mlTemplates.slug, slug))
      .limit(1);
    if (!taken) break;
    slug = `${base.slice(0, 52)}_${i}`;
  }

  await db.insert(mlTemplates).values({
    slug,
    label,
    question: questionFor(subject, target),
    subject: subject.id,
    target: target.id,
    features: features.map((f) => f.id),
    tolerance: t.tolerance.toFixed(2),
    builtin: false,
    createdById,
  });

  return { ok: true, slug };
}

/**
 * Borra una pregunta.
 *
 * Las de fábrica no se tocan, y una con modelos entrenados tampoco: sus
 * predicciones y desenlaces son el único registro de qué se le prometió al
 * usuario y qué pasó de verdad. Borrar la pregunta dejaría esas filas apuntando
 * a algo que ya nadie puede explicar.
 */
export async function deleteTemplate(
  slug: string,
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();

  const [t] = await db
    .select({ builtin: mlTemplates.builtin })
    .from(mlTemplates)
    .where(eq(mlTemplates.slug, slug))
    .limit(1);

  if (!t) return { ok: false, reason: "Esa pregunta no existe." };
  if (t.builtin) {
    return { ok: false, reason: "Las preguntas de fábrica no se pueden borrar." };
  }

  const [used] = await db
    .select({ id: mlModels.id })
    .from(mlModels)
    .where(eq(mlModels.template, slug))
    .limit(1);

  if (used) {
    return {
      ok: false,
      reason:
        "Esta pregunta ya tiene modelos entrenados, con sus predicciones y " +
        "desenlaces. Borrarla dejaría ese historial sin explicación. Retira el " +
        "modelo de producción si ya no quieres usarla.",
    };
  }

  await db.delete(mlTemplates).where(eq(mlTemplates.slug, slug));
  return { ok: true };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** La pregunta en prosa, armada desde los bloques. */
function questionFor(subject: Subject, target: Target): string {
  return `${subject.article}: ¿${target.label.toLowerCase()}?`;
}

/* ------------------------- Suficiencia de datos ------------------------- */

export type Readiness = {
  samples: number;
  /** Rango cubierto por el histórico. */
  from: Date | null;
  to: Date | null;
  /** ¿Alcanza para intentar siquiera un backtest? */
  enough: boolean;
  hint: string;
};

/**
 * Casos mínimos para que un veredicto signifique algo.
 *
 * Se DERIVA de los parámetros del corte en vez de escribirse a mano. Estaba
 * puesto como un 67 suelto, y un número mágico que replica en silencio la
 * aritmética de otro módulo es una mentira esperando a que alguien toque el
 * reparto: la pantalla seguiría diciendo "hay suficiente" mientras el
 * entrenamiento devuelve null sin explicar nada.
 *
 * Manda el tramo de validación, que es el más chico: con 15% reservado y 15
 * casos exigidos, hacen falta 100. Subió desde 67 al pasar a tres vías, y ese
 * es el costo declarado de que el sistema pueda elegir la escalera sin inflar
 * el resultado. Se paga en plantillas que tardan más en poder evaluarse.
 */
const VAL_RATIO = 0.15;
const TEST_RATIO = 0.3;
const MIN_VAL = 15;
const MIN_TEST = 20;
const MIN_SAMPLES = Math.max(
  Math.ceil(MIN_VAL / VAL_RATIO),
  Math.ceil(MIN_TEST / TEST_RATIO),
);

/**
 * Cuánta historia hay para una plantilla, ANTES de entrenar.
 *
 * Existe para que la pantalla pueda decir "faltan datos" en vez de dejar que
 * alguien pulse *Entrenar* y reciba un error. La pregunta "¿tengo con qué?" es
 * anterior a "¿funciona?", y el producto debería responderla primero.
 *
 * Cuenta con un agregado en vez de traerse el histórico y medir su longitud,
 * que es lo que hacía: la pantalla del laboratorio ejecutaba el join completo
 * de cada plantilla —cientos o miles de filas viajando a Node— para escribir
 * "412 casos" y tirar el resto. Con dos plantillas se aguantaba; el costo crecía
 * con el catálogo y con el tamaño de la empresa a la vez.
 */
export async function readinessFor(template: Template): Promise<Readiness> {
  return readinessFrom(await countFor(template));
}

/**
 * Recalcula las métricas de un modelo desde su conjunto congelado.
 *
 * Es la comprobación que la reproducibilidad hace posible, y que sin ella no
 * existía: leer el parquet que el modelo vio, volver a correr exactamente el
 * mismo backtest y contrastar contra lo que quedó registrado. Si los números no
 * coinciden, algo cambió entre la medición y el registro —el algoritmo, la
 * tolerancia de la plantilla, la partición— y conviene enterarse por una
 * verificación y no por una decisión mal tomada.
 *
 * No guarda nada ni promueve nada. Es un peritaje, no un entrenamiento.
 *
 * Un modelo sin `dataset_path` no se puede peritar, y eso también es un
 * resultado: son los entrenados antes de que existiera el plano analítico.
 */
export type ReproCheck = {
  ok: boolean;
  reason?: string;
  rows?: number;
  /** Lo que quedó escrito cuando se entrenó. */
  registrado?: { mae: number; withinTolerance: number; improvement: number };
  /** Lo que da hoy el mismo cálculo sobre el mismo conjunto. */
  recalculado?: { mae: number; withinTolerance: number; improvement: number };
  /** Si coinciden dentro del margen de redondeo del punto flotante. */
  coincide?: boolean;
};

export async function verifyReproducible(modelId: string): Promise<ReproCheck> {
  const db = await tenantDb();
  const [model] = await db
    .select({
      template: mlModels.template,
      version: mlModels.version,
      metrics: mlModels.metrics,
      datasetPath: mlModels.datasetPath,
    })
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!model) return { ok: false, reason: "Ese modelo no existe." };
  if (!model.datasetPath) {
    return {
      ok: false,
      reason:
        "Este modelo se entrenó antes de que el laboratorio congelara sus " +
        "conjuntos, así que no hay con qué contrastarlo. Es irreproducible por " +
        "construcción, no por un fallo.",
    };
  }

  const template = await templateById(model.template);
  if (!template) {
    return { ok: false, reason: "La plantilla de este modelo ya no existe." };
  }

  const samples = await readDataset(model.datasetPath);
  // La MISMA competencia que en el entrenamiento, no una versión reducida: si
  // el peritaje corriera otro procedimiento, coincidir no probaría nada y
  // diferir no significaría nada.
  const result = chooseModel(samples, Object.keys(template.featureLabels), {
    toleranceKind: template.toleranceKind,
    tolerance: template.tolerance,
  });
  if (!result) {
    return {
      ok: false,
      rows: samples.length,
      reason: `El conjunto tiene ${samples.length} casos y hoy no alcanzan para un backtest.`,
    };
  }

  const m = model.metrics as Record<string, number>;
  const registrado = {
    mae: Number(m.mae),
    withinTolerance: Number(m.withinTolerance),
    improvement: Number(m.improvement),
  };
  const recalculado = {
    mae: result.backtest.mae,
    withinTolerance: result.backtest.withinTolerance,
    improvement: result.backtest.improvement,
  };

  // Margen de redondeo, no de tolerancia: dos cálculos idénticos sobre los
  // mismos datos solo deberían separarse por el último bit del punto flotante.
  // Un umbral generoso aquí convertiría el peritaje en un sello de goma.
  const cerca = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  return {
    ok: true,
    rows: samples.length,
    registrado,
    recalculado,
    coincide:
      cerca(registrado.mae, recalculado.mae) &&
      cerca(registrado.withinTolerance, recalculado.withinTolerance) &&
      cerca(registrado.improvement, recalculado.improvement),
  };
}

/** Etiqueta de caché del laboratorio de una empresa. */
export const mlTag = (schemaName: string) => `ml-lab:${schemaName}`;

/**
 * Suficiencia en caché, por empresa y plantilla.
 *
 * Es la consulta más cara del ERP y la que menos cambia. Medido en la pantalla
 * del laboratorio: 7 785 escaneos de tabla y 84 824 filas leídas por carga,
 * porque cada plantilla ejecuta su join analítico sobre TODO el histórico solo
 * para escribir "412 casos, del 3 de marzo al 12 de agosto". Ese número no se
 * mueve por mirarlo: se mueve cuando entran tickets nuevos.
 *
 * Cómo se mantiene el aislamiento, que aquí es lo delicado —esta caché sí vive
 * en el servidor y sí sobrevive entre peticiones y entre usuarios—:
 *
 * - **El esquema del inquilino va en la clave.** `tenant_evoelution` y
 *   `tenant_acme` son dos entradas distintas y no pueden colisionar.
 * - **Dentro no se lee nada de la petición.** Ni cookies, ni sesión, ni
 *   `tenantDb()`: se usa `tenantDbFor(schemaName)` con el esquema que llegó
 *   como argumento. Es requisito de `unstable_cache` y es lo que hace
 *   imposible que la entrada dependa de quién preguntó.
 * - **Se invalida por etiqueta** al entrenar, crear o borrar una plantilla
 *   (`actions/ml.ts`), que es cuando el catálogo cambia de verdad.
 *
 * Los 15 minutos cubren el otro camino: los tickets nuevos no invalidan nada,
 * así que un caso recién registrado tarda como mucho ese rato en contarse. Para
 * un indicador que responde "¿tengo historia suficiente para aprender algo?",
 * esa demora no cambia ninguna decisión.
 */
/**
 * Lo que de verdad viaja por la caché: las fechas como TEXTO.
 *
 * `unstable_cache` guarda serializando a JSON, y `JSON` no tiene fechas. Un
 * `Date` entra como objeto y sale como cadena — pero solo cuando hay ACIERTO de
 * caché. En el fallo se devuelve el valor recién calculado, con su `Date` real.
 *
 * Ese detalle costó caro y por eso queda escrito: la pantalla del laboratorio
 * llamaba `readiness.from?.toISOString()`, funcionaba perfecto en el primer
 * render tras invalidar y reventaba en todos los siguientes. Y como el catálogo
 * vive dentro de un `<Suspense>`, el error no daba error: la página respondía
 * 200 con el encabezado, el contador y **ninguna plantilla**. Un fallo que se
 * esconde detrás de un éxito es peor que uno que se cae.
 *
 * La defensa es tipar lo que cruza. Este tipo dice «aquí las fechas son texto»,
 * así que el compilador obliga a convertirlas al salir en vez de dejar que
 * alguien asuma que siguen siendo fechas.
 */
type CachedReadiness = Omit<Readiness, "from" | "to"> & {
  from: string | null;
  to: string | null;
};

function cachedReadiness(schemaName: string, template: Template): Promise<Readiness> {
  const load = unstable_cache(
    async (): Promise<CachedReadiness> => {
      // La plantilla se vuelve a leer DENTRO en vez de recibirse por argumento:
      // lleva fragmentos SQL, que no son serializables y por tanto no pueden
      // formar parte de una clave de caché. Lo que entra es su slug.
      const db = tenantDbFor(schemaName);
      const t = await templateByIdIn(db, template.id);
      if (!t) {
        return {
          samples: 0,
          from: null,
          to: null,
          enough: false,
          hint: "Esa plantilla ya no existe.",
        };
      }
      const r = readinessFrom(await countForIn(db, t));
      // Se serializan a la ida, para que acierto y fallo devuelvan LA MISMA
      // forma. Dejar que JSON lo hiciera solo en un caso es lo que producía dos
      // comportamientos distintos según el estado de la caché.
      return {
        ...r,
        from: r.from?.toISOString() ?? null,
        to: r.to?.toISOString() ?? null,
      };
    },
    ["ml-readiness", schemaName, template.id],
    { tags: [mlTag(schemaName)], revalidate: 900 },
  );

  return load().then((c) => ({
    ...c,
    from: c.from ? new Date(c.from) : null,
    to: c.to ? new Date(c.to) : null,
  }));
}

/** El veredicto de suficiencia a partir de los conteos, sin tocar la base. */
function readinessFrom({
  n,
  distinct,
  from,
  to,
}: Awaited<ReturnType<typeof countFor>>): Readiness {

  // Un objetivo que no varía es el fallo más traicionero del laboratorio: hay
  // miles de casos, la pantalla dice "historial suficiente", y lo que se
  // entrena es una constante. Se detecta ANTES de entrenar porque el veredicto
  // no sabría explicarlo: diría "la mediana funciona igual de bien", que es
  // cierto y no sirve de nada. El problema no es el modelo, son los datos.
  if (n > 0 && distinct <= 1) {
    return {
      samples: n,
      from,
      to,
      enough: false,
      hint:
        `Hay ${n} casos, pero el valor a predecir es el mismo en todos. No hay ` +
        `nada que aprender: revisa cómo se está registrando ese dato.`,
    };
  }

  const enough = n >= MIN_SAMPLES;

  return {
    samples: n,
    from,
    to,
    enough,
    hint: enough
      ? "Hay historial suficiente para evaluar."
      : n === 0
        ? "Todavía no hay ningún caso registrado para esta pregunta."
        : `Se necesitan ~${MIN_SAMPLES} casos para un veredicto con sentido; hay ${n}.`,
  };
}

/** Cuántas predicciones ya emitió cada modelo y cuántas tienen desenlace. */
export async function predictionCounts(): Promise<
  Record<string, { predictions: number; outcomes: number }>
> {
  const db = await tenantDb();
  const rows = (await db.execute(sql`
    select p.model_id::text as model_id,
           count(*)::int as predictions,
           count(o.id)::int as outcomes
      from ml_predictions p
      left join ml_outcomes o on o.prediction_id = p.id
     group by p.model_id
  `)) as unknown as Array<Record<string, unknown>>;

  const out: Record<string, { predictions: number; outcomes: number }> = {};
  for (const r of rows) {
    out[String(r.model_id)] = {
      predictions: Number(r.predictions),
      outcomes: Number(r.outcomes),
    };
  }
  return out;
}

/* ------------------------- Vista del laboratorio ------------------------- */

export type TemplateOverview = {
  template: Template;
  readiness: Readiness;
  models: Array<{
    id: string;
    version: number;
    status: string;
    algorithm: string;
    beatsBaseline: boolean;
    metrics: Record<string, unknown>;
    /**
     * El modelo entrenado. La pantalla lo necesita para poder DIBUJAR lo que
     * va a estimar: sin esto solo se puede enseñar el error, que es una
     * propiedad del modelo y no una respuesta a "¿qué me va a decir?".
     */
    params: Record<string, unknown>;
    note: string | null;
    trainedAt: Date;
    promotedAt: Date | null;
    predictions: number;
    outcomes: number;
    /**
     * Cómo se está portando contra la realidad. `null` mientras no haya
     * desenlaces: la ausencia de deriva no es "va bien", es "todavía no se
     * sabe", y la pantalla tiene que poder distinguirlo.
     */
    drift: Drift | null;
    /** ¿La deriva ya es lo bastante mala como para mirarlo? Ver `degraded`. */
    degraded: boolean;
  }>;
};

/**
 * Todo lo que la pantalla del laboratorio necesita, en una pasada.
 *
 * Devuelve las plantillas SIN modelo también, y esa es media función: el
 * laboratorio tiene que mostrar las preguntas que todavía no se pueden
 * responder, no solo las que sí. Un catálogo donde solo aparece lo que
 * funcionó no está midiendo nada.
 */
export async function labOverview(): Promise<TemplateOverview[]> {
  const ctx = await requireTenant();
  const db = await tenantDb();
  const templates = await listTemplates();

  // Las suficiencias van en el mismo lote que el resto y no en un `for` con
  // `await` dentro: son consultas independientes entre sí, y encadenarlas hacía
  // que la página tardara la suma de todas en vez de la más lenta.
  const [rows, counts, drift, readiness] = await Promise.all([
    db.select().from(mlModels).orderBy(desc(mlModels.trainedAt)),
    predictionCounts(),
    driftByModel(),
    Promise.all(templates.map((t) => cachedReadiness(ctx.schemaName, t))),
  ]);

  return templates.map((template, i) => ({
    template,
    readiness: readiness[i],
    models: rows
      .filter((m) => m.template === template.id)
      .map((m) => {
        const d = drift[m.id] ?? null;
        const backtestMae = Number(
          (m.metrics as Record<string, unknown>)?.mae ?? NaN,
        );
        return {
          id: m.id,
          version: m.version,
          status: m.status,
          algorithm: m.algorithm,
          beatsBaseline: m.beatsBaseline,
          metrics: m.metrics,
          params: m.params,
          note: m.note,
          trainedAt: m.trainedAt,
          promotedAt: m.promotedAt,
          predictions: counts[m.id]?.predictions ?? 0,
          outcomes: counts[m.id]?.outcomes ?? 0,
          drift: d,
          degraded: degraded(d ?? undefined, backtestMae),
        };
      }),
  }));
}
