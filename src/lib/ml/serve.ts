import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { mlModels, mlPredictions, mlOutcomes } from "@/lib/db/schema";
import { loadPredictor } from "./algorithms";
import type { Prediction } from "./core";
import { listTemplates, templateById, type Template } from "./templates";

/**
 * Servicio de predicción: lo que convierte un modelo guardado en un número que
 * alguien puede leer.
 *
 * Tres reglas gobiernan este módulo:
 *
 * 1. NUNCA se predice dentro de un render. Se escribe la fila cuando ocurre el
 *    hecho que la justifica —se abre el ticket, se cierra el servicio— y la
 *    pantalla lee. Una pantalla que calcula hereda la latencia y el fallo del
 *    cálculo, y además produce un número distinto cada vez que se recarga, con
 *    lo cual deja de ser auditable.
 *
 * 2. Predecir NUNCA puede romper la operación. Todo lo que se exporta aquí
 *    falla en silencio y devuelve `null`: si el laboratorio se cae, se levanta
 *    el ticket igual. El día que una predicción impida cerrar un servicio, el
 *    módulo entero se desactiva y con razón.
 *
 * 3. Toda predicción emitida queda escrita ANTES de conocerse el desenlace, y
 *    el desenlace se escribe aparte. Es la única forma de medir después si el
 *    modelo sigue sirviendo sin que nadie pueda retocar la historia.
 */

/* ------------------------- Modelo en producción ------------------------- */

/**
 * Un modelo listo para predecir, sin decir de qué algoritmo salió.
 *
 * Lo que se carga ya no es una estructura de datos que quien predice tenga que
 * saber interpretar, sino una FUNCIÓN. Así `issuePrediction` no necesita
 * ramificar por algoritmo, y añadir el cuarto no le cambia una línea.
 */
type LoadedModel = {
  id: string;
  template: string;
  predict: (features: Record<string, string>) => Prediction;
};

/**
 * El modelo que está sirviendo esta plantilla, si hay alguno.
 *
 * Que no haya es el caso NORMAL, no un error: una plantilla puede estar
 * rechazada, sin datos suficientes o entrenada pero sin promover. Por eso
 * devuelve `null` sin ruido y quien llama simplemente no muestra predicción.
 */
export async function productionModelFor(
  templateId: string,
): Promise<LoadedModel | null> {
  const db = await tenantDb();
  const [row] = await db
    .select({
      id: mlModels.id,
      template: mlModels.template,
      algorithm: mlModels.algorithm,
      params: mlModels.params,
    })
    .from(mlModels)
    .where(and(eq(mlModels.template, templateId), eq(mlModels.status, "production")))
    .limit(1);

  if (!row) return null;

  /*
    El modelo viaja como JSON, así que llega sin garantías de tipo, y ahora
    tampoco se sabe de antemano QUÉ algoritmo lo produjo: la columna
    `algorithm` decide quién sabe leerlo.

    Cada algoritmo comprueba la forma de sus propios `params` y devuelve `null`
    si no cuadra. Un jsonb corrupto, o guardado por una versión anterior, tiene
    que degradar a «sin predicción» y nunca reventar en medio del alta de un
    ticket: la predicción es información derivada y no puede tumbar el hecho
    del que deriva.
  */
  const predictor = loadPredictor(row.algorithm, row.params);
  if (!predictor) {
    console.error(
      `[ml] modelo ${row.id} (${row.algorithm}) con params ilegibles; se ignora.`,
    );
    return null;
  }

  return { id: row.id, template: row.template, predict: predictor };
}

/* ------------------------- Emitir una predicción ------------------------- */

export type IssuedPrediction = {
  id: string;
  modelId: string;
  templateId: string;
  value: number;
  lower: number | null;
  upper: number | null;
  support: number | null;
  features: Record<string, string>;
  createdAt: Date;
};

/**
 * Predice sobre un sujeto y DEJA LA FILA ESCRITA.
 *
 * Devuelve `null` cuando no hay nada que decir —sin modelo en producción, sin
 * rasgos, o el sujeto ya tenía su predicción—, y también cuando algo falla. La
 * diferencia entre ambos casos no le importa a quien llama: en los dos, la
 * operación sigue exactamente igual.
 */
export async function issuePrediction(
  templateId: string,
  subjectId: string,
): Promise<IssuedPrediction | null> {
  try {
    const template = await templateById(templateId);
    if (!template) return null;

    const loaded = await productionModelFor(templateId);
    if (!loaded) return null;

    const db = await tenantDb();

    // Un ticket se predice una sola vez. Sin esta comprobación, reintentar el
    // alta o aprobar dos veces dejaría dos predicciones del mismo modelo sobre
    // el mismo hecho, y al medir la deriva ese hecho pesaría el doble.
    if (template.predictOncePerSubject) {
      const [prev] = await db
        .select({ id: mlPredictions.id })
        .from(mlPredictions)
        .where(
          and(
            eq(mlPredictions.modelId, loaded.id),
            eq(mlPredictions.subjectType, template.subjectType),
            eq(mlPredictions.subjectId, subjectId),
          ),
        )
        .limit(1);
      if (prev) return null;
    }

    const features = await template.featuresFor(subjectId);
    if (!features) return null;

    const p = loaded.predict(features);
    // Un modelo entrenado sobre cero casos deja estadísticos NaN. No debería
    // llegar aquí —el backtest lo habría rechazado— pero escribir NaN en una
    // columna numérica es un error de base de datos en medio del alta.
    if (!Number.isFinite(p.value)) return null;

    const num = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : null);

    const [saved] = await db
      .insert(mlPredictions)
      .values({
        modelId: loaded.id,
        subjectType: template.subjectType,
        subjectId,
        value: p.value.toFixed(2),
        lower: num(p.lower),
        upper: num(p.upper),
        support: p.support,
        // Se guardan los rasgos usados, no solo el número. Dentro de seis meses,
        // "¿por qué predijo 6 horas?" solo se puede responder si quedó escrito
        // con qué se predijo — el modelo para entonces será otro.
        features: { ...features, matched: p.matched },
      })
      .returning({ id: mlPredictions.id, createdAt: mlPredictions.createdAt });

    return {
      id: saved.id,
      modelId: loaded.id,
      templateId,
      value: p.value,
      lower: p.lower,
      upper: p.upper,
      support: p.support,
      features,
      createdAt: saved.createdAt,
    };
  } catch (e) {
    // Se registra y se sigue. Ver la regla 2 de la cabecera del módulo.
    console.error(`[ml] no se pudo predecir ${templateId}/${subjectId}:`, e);
    return null;
  }
}

/* ------------------------- Registrar el desenlace ------------------------- */

/**
 * Escribe lo que pasó DE VERDAD sobre las predicciones abiertas de un sujeto.
 *
 * Cierra TODAS las que estén sin desenlace, no solo la última. Si dos modelos
 * llegaron a predecir sobre el mismo hecho —porque uno se promovió en medio—,
 * ambos tienen que quedar medidos contra la misma realidad; si no, el que se
 * quedó sin outcome parecería no haberse equivocado nunca.
 *
 * Devuelve cuántas se cerraron. Nunca lanza.
 */
export async function settleOutcome(
  subjectType: "ticket" | "equipment" | "part",
  subjectId: string,
  actual: number,
): Promise<number> {
  try {
    if (!Number.isFinite(actual) || actual < 0) return 0;

    const db = await tenantDb();
    const open = (await db.execute(sql`
      select p.id::text as id, p.value::float8 as value
        from ml_predictions p
        left join ml_outcomes o on o.prediction_id = p.id
       where p.subject_type = ${subjectType}
         and p.subject_id = ${subjectId}
         and o.id is null
    `)) as unknown as Array<Record<string, unknown>>;

    if (open.length === 0) return 0;

    await db
      .insert(mlOutcomes)
      .values(
        open.map((r) => ({
          predictionId: String(r.id),
          actual: actual.toFixed(2),
          // Firmado: positivo = el modelo se quedó corto. El signo importa —un
          // modelo que subestima sistemáticamente hace perder dinero de otra
          // manera que uno que sobrestima, y el valor absoluto lo esconde.
          error: (actual - Number(r.value)).toFixed(2),
        })),
      )
      // Si dos cierres compiten, el índice único deja pasar uno solo. Una
      // predicción tiene un desenlace y no se corrige.
      .onConflictDoNothing();

    return open.length;
  } catch (e) {
    console.error(`[ml] no se pudo registrar el desenlace de ${subjectId}:`, e);
    return 0;
  }
}

/* ------------------------- Lectura para la UI ------------------------- */

export type PredictionView = {
  id: string;
  value: number;
  lower: number | null;
  upper: number | null;
  support: number | null;
  createdAt: Date;
  /** Qué rasgos la sostienen, ya con etiquetas legibles. */
  explain: Array<{ label: string; value: string }>;
  /** Cuál de los grupos de la escalera se usó. `global` = ninguno aplicó. */
  matched: string;
  unit: string;
  label: string;
  /** El desenlace, si ya se conoce. */
  actual: number | null;
};

/**
 * La predicción vigente sobre un sujeto. Una fila, sin cálculo.
 *
 * Es lo único que la pantalla debería llamar: si esta función devolviera un
 * modelo en vez de una fila, volveríamos a tener inferencia dentro del render.
 */
export async function latestPredictionFor(
  templateId: string,
  subjectId: string,
): Promise<PredictionView | null> {
  try {
    const template = await templateById(templateId);
    if (!template) return null;

    const db = await tenantDb();
    const rows = (await db.execute(sql`
      select p.id::text as id,
             p.value::float8 as value,
             p.lower::float8 as lower,
             p.upper::float8 as upper,
             p.support as support,
             p.features as features,
             p.created_at as created_at,
             o.actual::float8 as actual
        from ml_predictions p
        join ml_models m on m.id = p.model_id and m.template = ${templateId}
        left join ml_outcomes o on o.prediction_id = p.id
       where p.subject_type = ${template.subjectType}
         and p.subject_id = ${subjectId}
       order by p.created_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0];
    if (!r) return null;

    const features = (r.features ?? {}) as Record<string, string>;

    // Se explica con los rasgos que el modelo USÓ, no con todos los que tenía.
    // La clave del grupo es `categoria+marca|válvulas|Waters`, así que el
    // primer tramo dice exactamente en qué peldaño de la escalera cayó. Listar
    // los tres rasgos cuando el grupo solo agrupaba por categoría le atribuye
    // al número una precisión que no tiene: quien lea "mantenimiento · Waters ·
    // alta" va a creer que hay casos de esa marca detrás, y puede no haberlos.
    const matched = String(features.matched ?? "");
    const usedKeys =
      matched && matched !== "global" ? matched.split("|")[0].split("+") : [];
    const explain = usedKeys
      .filter((k) => template.featureLabels[k] && features[k])
      .map((k) => ({ label: template.featureLabels[k], value: features[k] }));

    return {
      id: String(r.id),
      value: Number(r.value),
      lower: r.lower === null ? null : Number(r.lower),
      upper: r.upper === null ? null : Number(r.upper),
      support: r.support === null ? null : Number(r.support),
      createdAt: new Date(String(r.created_at)),
      explain,
      matched,
      unit: template.unit,
      label: template.label,
      actual: r.actual === null || r.actual === undefined ? null : Number(r.actual),
    };
  } catch (e) {
    console.error(`[ml] no se pudo leer la predicción de ${subjectId}:`, e);
    return null;
  }
}

/* ------------------------- Deriva ------------------------- */

export type Drift = {
  /** Desenlaces registrados. Por debajo de un puñado no se dice nada. */
  n: number;
  /** Error absoluto medio EN PRODUCCIÓN. */
  mae: number;
  /** Aciertos dentro de la tolerancia de la plantilla, en producción. */
  withinTolerance: number;
  /** Sesgo: promedio del error firmado. Positivo = el modelo se queda corto. */
  bias: number;
};

/**
 * Cómo se está portando cada modelo contra la realidad, no contra el backtest.
 *
 * Es la medición que el laboratorio prometía y no hacía. Un modelo puede haber
 * pasado su evaluación con holgura y estar fallando hoy porque cambió el mix de
 * equipos o entró un cliente grande; el backtest, que se calculó una vez y no
 * se vuelve a tocar, no se entera nunca. La comparación honesta es esta cifra
 * contra `metrics.mae`, lado a lado.
 *
 * Devuelve un mapa por `modelId` y solo incluye a los que ya tienen desenlaces.
 */
export async function driftByModel(): Promise<Record<string, Drift>> {
  try {
    const db = await tenantDb();
    // Las tolerancias entran como VALUES desde el catálogo en vez de repetirse
    // en el SQL: si mañana el negocio decide que ±2 h ya no es útil, se cambia
    // en la plantilla y esta consulta lo respeta sola.
    // Los dos casts son obligatorios, no decorativos: dentro de un VALUES de
    // CTE, Postgres no tiene de dónde inferir el tipo de un parámetro y aborta
    // con "could not determine data type of parameter".
    const tolerances = sql.join(
      (await listTemplates()).map(
        (t) => sql`(${t.id}::text, ${t.tolerance}::float8)`,
      ),
      sql`, `,
    );

    const rows = (await db.execute(sql`
      with tol(template, tolerance) as (values ${tolerances})
      select m.id::text as model_id,
             count(o.id)::int as n,
             avg(abs(o.error::float8))::float8 as mae,
             avg(o.error::float8)::float8 as bias,
             (count(*) filter (where abs(o.error::float8) <= tol.tolerance)::float8
               / nullif(count(o.id), 0) * 100)::float8 as within
        from ml_outcomes o
        join ml_predictions p on p.id = o.prediction_id
        join ml_models m on m.id = p.model_id
        join tol on tol.template = m.template
       group by m.id
    `)) as unknown as Array<Record<string, unknown>>;

    const out: Record<string, Drift> = {};
    for (const r of rows) {
      out[String(r.model_id)] = {
        n: Number(r.n),
        mae: Number(r.mae),
        withinTolerance: Number(r.within ?? 0),
        bias: Number(r.bias),
      };
    }
    return out;
  } catch (e) {
    console.error("[ml] no se pudo calcular la deriva:", e);
    return {};
  }
}

/**
 * ¿Hay que preocuparse por este modelo?
 *
 * El umbral es deliberadamente tolerante —30% peor que en el backtest— porque
 * la alternativa es peor: una alarma que salta por ruido estadístico se aprende
 * a ignorar en dos semanas, y entonces tampoco avisa cuando el modelo sí se
 * rompió. `minOutcomes` existe por lo mismo: con cinco desenlaces, cualquier
 * cosa parece una tendencia.
 */
export function degraded(
  d: Drift | undefined,
  backtestMae: number,
  opts: { minOutcomes?: number; worseBy?: number } = {},
): boolean {
  const { minOutcomes = 20, worseBy = 1.3 } = opts;
  if (!d || d.n < minOutcomes || !Number.isFinite(backtestMae) || backtestMae <= 0) {
    return false;
  }
  return d.mae > backtestMae * worseBy;
}

/** Plantillas que hoy tienen un modelo sirviendo. Para saber a quién llamar. */
export async function servingTemplates(): Promise<Template[]> {
  const db = await tenantDb();
  const rows = await db
    .select({ template: mlModels.template })
    .from(mlModels)
    .where(eq(mlModels.status, "production"))
    .orderBy(desc(mlModels.promotedAt));

  const ids = new Set(rows.map((r) => r.template));
  return (await listTemplates()).filter((t) => ids.has(t.id));
}

/* ------------------------- Arranque ------------------------- */

/**
 * Emite las predicciones que faltan sobre los sujetos que siguen abiertos.
 *
 * Los enganches de operación solo disparan cuando entra un ticket nuevo, así
 * que el día que se promueve el primer modelo la cola histórica se queda sin
 * estimación y las pantallas de análisis no tienen nada que decir hasta que
 * llegue el próximo servicio. Esto la arranca.
 *
 * LA REGLA QUE LO HACE HONESTO: solo toca sujetos ABIERTOS. Rellenar tickets
 * ya cerrados generaría predicciones cuyo desenlace ya se conoce, y al medirlas
 * después la deriva saldría favorecida por construcción —el modelo habría
 * «predicho» algo que ya había pasado—. Un servicio abierto, en cambio, todavía
 * no tiene horas finales: la estimación se hace sobre rasgos que ya estaban
 * fijados al levantarlo y el desenlace llega después, igual que en un ticket
 * nuevo. La fecha de la predicción es la de hoy y eso es lo cierto: la está
 * emitiendo el modelo de hoy.
 */
export async function backfillOpenPredictions(
  templateId: string,
): Promise<{ ok: boolean; issued: number; reason?: string }> {
  const template = await templateById(templateId);
  if (!template) return { ok: false, issued: 0, reason: "Esa pregunta no existe." };

  if (template.subjectType !== "ticket") {
    return {
      ok: false,
      issued: 0,
      reason:
        "Por ahora solo se pueden generar estimaciones pendientes sobre " +
        "tickets: son los únicos sujetos con un estado que distingue lo " +
        "abierto de lo cerrado.",
    };
  }

  const loaded = await productionModelFor(templateId);
  if (!loaded) {
    return {
      ok: false,
      issued: 0,
      reason: "No hay ningún modelo en producción para esta pregunta.",
    };
  }

  const db = await tenantDb();
  const rows = (await db.execute(sql`
    select t.id::text as id
      from tickets t
      left join ml_predictions p
             on p.subject_type = 'ticket'
            and p.subject_id = t.id::text
            and p.model_id = ${loaded.id}::uuid
     where t.status in ('open', 'in_progress', 'waiting')
       and p.id is null
     order by t.created_at
  `)) as unknown as Array<Record<string, unknown>>;

  let issued = 0;
  for (const r of rows) {
    // En serie y no en paralelo a propósito: esto se dispara desde un botón de
    // administración sobre cientos de filas, y no vale la pena saturar el pool
    // del inquilino —que es de 3 conexiones— por una tarea que nadie espera
    // mirando el reloj.
    if (await issuePrediction(templateId, String(r.id))) issued++;
  }

  return { ok: true, issued };
}
