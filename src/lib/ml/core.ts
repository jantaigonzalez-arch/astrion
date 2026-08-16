/**
 * Núcleo del laboratorio: entrenar, predecir y evaluar.
 *
 * Funciones puras, sin base de datos ni sesión. Esa separación no es estética:
 * es lo que permite correr el backtest en una prueba con datos inventados y
 * saber que el resultado que muestra la UI significa lo que dice.
 *
 * El algoritmo es una MEDIANA POR GRUPO CON ESCALERA DE RESPALDO. Es modesto a
 * propósito. Sobre el histórico real de Evoelution —412 servicios con horas—
 * este método baja el error un 21% contra "siempre el promedio", mientras que
 * las estrategias por equipo individual lo EMPEORAN. Con 400 casos, un modelo
 * con más parámetros aprende el ruido y falla en cuanto se usa. Cuando los
 * datos crezcan lo suficiente para sostener algo mayor, el backtest lo dirá
 * solo: bastará añadir otro algoritmo y comparar.
 */

/** Una fila del histórico: rasgos conocidos al predecir, más lo que ocurrió. */
export type Sample = {
  /** Cuándo ocurrió. Manda el corte temporal del backtest. */
  at: Date;
  /**
   * De QUÉ entidad es este caso: el equipo, la pieza, el ticket.
   *
   * El núcleo no lo usa para nada —`train` y `predict` solo miran `features`—
   * y aun así viaja, porque es lo que permite a la etapa de rasgos derivados
   * agrupar la historia de cada entidad consigo misma. Opcional para no
   * romper los conjuntos congelados antes de que existiera.
   */
  key?: string;
  /** Rasgos disponibles ANTES de conocer el resultado. */
  features: Record<string, string>;
  /** Lo que se quiere predecir. */
  target: number;
};

/**
 * Escalera de grupos, de lo más específico a lo más general.
 *
 * `["category","brand"]` antes que `["category"]` significa: usa la mediana de
 * "mantenimiento sobre un Waters" si hay casos suficientes; si no, la de
 * "mantenimiento"; si tampoco, la global. Nunca deja al usuario sin número, y
 * `support` dice con cuántos casos se sostiene el que dio.
 */
export type Ladder = string[][];

export type TrainedModel = {
  ladder: Ladder;
  /** Clave del grupo → estadísticos. La clave es `nivel|valor1|valor2`. */
  groups: Record<string, GroupStat>;
  /** Respaldo final cuando ningún grupo aplica. */
  global: GroupStat;
  minSupport: number;
};

export type GroupStat = { median: number; p25: number; p75: number; n: number };

export type Prediction = {
  value: number;
  lower: number;
  upper: number;
  support: number;
  /** Qué grupo se usó, para poder explicar el número en la UI. */
  matched: string;
};

/* ------------------------- Estadística ------------------------- */

/** Percentil por interpolación lineal. `xs` debe venir ordenado. */
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  if (xs.length === 1) return xs[0];
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

function stats(values: number[]): GroupStat {
  const xs = [...values].sort((a, b) => a - b);
  return {
    median: quantile(xs, 0.5),
    p25: quantile(xs, 0.25),
    p75: quantile(xs, 0.75),
    n: xs.length,
  };
}

/** Clave estable de un grupo. El nivel va dentro para que no choquen niveles. */
function keyFor(level: string[], f: Record<string, string>): string {
  return [level.join("+"), ...level.map((k) => f[k] ?? "?")].join("|");
}

/* ------------------------- Entrenamiento ------------------------- */

export function train(
  samples: Sample[],
  ladder: Ladder,
  minSupport = 5,
): TrainedModel {
  const buckets = new Map<string, number[]>();

  for (const s of samples) {
    for (const level of ladder) {
      // Un grupo con un rasgo desconocido no se aprende: agruparía casos que no
      // tienen nada que ver bajo la etiqueta "?".
      if (level.some((k) => !s.features[k])) continue;
      const k = keyFor(level, s.features);
      const arr = buckets.get(k);
      if (arr) arr.push(s.target);
      else buckets.set(k, [s.target]);
    }
  }

  const groups: Record<string, GroupStat> = {};
  for (const [k, values] of buckets) {
    // Por debajo del mínimo el grupo no se guarda: una mediana de dos casos es
    // una anécdota, y presentarla como predicción es peor que no predecir.
    if (values.length >= minSupport) groups[k] = stats(values);
  }

  return {
    ladder,
    groups,
    global: stats(samples.map((s) => s.target)),
    minSupport,
  };
}

/* ------------------------- Predicción ------------------------- */

export function predict(
  model: TrainedModel,
  features: Record<string, string>,
): Prediction {
  for (const level of model.ladder) {
    if (level.some((k) => !features[k])) continue;
    const k = keyFor(level, features);
    const g = model.groups[k];
    if (g) {
      return {
        value: g.median,
        lower: g.p25,
        upper: g.p75,
        support: g.n,
        matched: k,
      };
    }
  }
  const g = model.global;
  return {
    value: g.median,
    lower: g.p25,
    upper: g.p75,
    support: g.n,
    matched: "global",
  };
}

/* ------------------------- Backtest ------------------------- */

export type Backtest = {
  /** Error absoluto medio del modelo. */
  mae: number;
  /**
   * Error de la LÍNEA BASE: predecir siempre la MEDIANA del entrenamiento.
   *
   * La mediana y no el promedio, y la diferencia no es un detalle. Estos
   * objetivos son asimétricos —unos pocos servicios de 28 horas estiran el
   * promedio muy por encima del caso típico—, así que contra el promedio
   * cualquier método basado en medianas gana solo por serlo. Medido: en horas
   * de servicio, el promedio da 4,00 h de error y la mediana global 3,43 h sin
   * agrupar por nada. Usar el promedio como referencia se habría apuntado ese
   * 14% como mérito del modelo.
   *
   * La regla que queda: la línea base tiene que ser el rival más fuerte de la
   * misma familia, no el más cómodo de batir.
   */
  baselineMae: number;
  /** El promedio, solo para mostrar la diferencia entre ambas referencias. */
  meanBaselineMae: number;
  /** Cuánto mejora sobre la línea base, en porcentaje. Negativo = empeora. */
  improvement: number;
  /** Porcentaje de aciertos dentro de una tolerancia útil para el negocio. */
  withinTolerance: number;
  tolerance: number;
  nTrain: number;
  nTest: number;
  /** Fecha de corte: se entrenó con lo anterior, se evaluó con lo posterior. */
  cutoff: string;
  /** Cuántos casos de prueba cayeron en el respaldo global. */
  fellBackToGlobal: number;
  /** Casos reservados para ELEGIR la escalera. Cero si venía dada. */
  nVal?: number;
  /** Cuántas escaleras compitieron. Cero o una si no hubo elección. */
  candidates?: number;
  /**
   * Los pares [real, estimado] de la evaluación, para poder DIBUJARLA.
   *
   * El backtest ya calculaba cada predicción y la tiraba después de sumarla al
   * error. Guardar los pares no cambia ningún número: cambia lo que se puede
   * enseñar. Un administrador no sabe qué significa "3,12 h de error", pero
   * mirando la nube de puntos contra la diagonal ve en dos segundos si le
   * puede creer al sistema, dónde acierta y —lo más útil— dónde falla.
   *
   * Va acotado y redondeado a dos decimales porque vive en un jsonb que se
   * lee en cada render de la pantalla. Con más de `MAX_POINTS` casos se toma
   * una muestra a paso fijo, que conserva la forma de la nube y el orden
   * temporal sin que el peso crezca con el histórico.
   */
  points?: Array<[number, number]>;
};

/** Tope de pares guardados para la gráfica. Ver `Backtest.points`. */
const MAX_POINTS = 400;

export type BacktestResult = {
  model: TrainedModel;
  backtest: Backtest;
  /** Hecho estadístico: ¿le gana a la línea base con margen suficiente? */
  beatsBaseline: boolean;
  /**
   * Fecha del ÚLTIMO caso que vio el modelo que se devuelve, que no es la del
   * corte del backtest.
   *
   * La distinción importa y se pagó cara: el corte solo delimita lo que se usó
   * para MEDIR, mientras que el modelo que se guarda se reentrena con todo el
   * histórico. Guardar el corte como "entrenado hasta" —que es lo que hacía
   * antes— dejaba una columna de auditoría que afirmaba lo contrario de lo
   * ocurrido, justo en el campo que alguien va a consultar para decidir si un
   * modelo está viejo.
   */
  trainedUpTo: Date;
};

export type Verdict = { approved: boolean; reason: string };

/**
 * Las DOS condiciones para poder promover un modelo.
 *
 * Superar la línea base no basta, y este módulo existe en buena medida por esa
 * distinción. Medido sobre Evoelution: el modelo de intervalos entre servicios
 * le gana a la mediana global por 6,2% —pasaría un examen puramente
 * estadístico— pero acierta apenas el 41% dentro de ±15 días sobre intervalos
 * cuya mediana es 34. Es decir: se equivoca más veces de las que acierta, y
 * quien agende con ese número trabaja peor que consultando el calendario.
 *
 * Así que la segunda condición es de negocio, no de estadística: hay que
 * acertar más de la mitad de las veces dentro de la tolerancia que el propio
 * dominio declaró útil. Un modelo que no llega ahí se rechaza aunque mejore el
 * error promedio.
 */
export function verdictFor(
  b: Backtest,
  opts: { minImprovement?: number; minHitRate?: number } = {},
): Verdict {
  const { minImprovement = 5, minHitRate = 50 } = opts;

  if (b.improvement < minImprovement) {
    return {
      approved: false,
      reason:
        `Mejora ${b.improvement.toFixed(1)}% sobre predecir siempre la mediana, ` +
        `por debajo del ${minImprovement}% exigido. Con estos datos, la mediana ` +
        `funciona igual de bien y no hay nada que mantener.`,
    };
  }

  if (b.withinTolerance < minHitRate) {
    return {
      approved: false,
      reason:
        `Supera a la línea base (${b.improvement.toFixed(1)}%), pero solo acierta ` +
        `el ${b.withinTolerance.toFixed(0)}% de las veces dentro de ±${b.tolerance}. ` +
        `Se equivoca más veces de las que acierta: mejorar el error promedio no ` +
        `alcanza si el número no sirve para decidir.`,
    };
  }

  return {
    approved: true,
    reason:
      `Mejora ${b.improvement.toFixed(1)}% sobre la mediana global y acierta el ` +
      `${b.withinTolerance.toFixed(0)}% dentro de ±${b.tolerance}.`,
  };
}

/**
 * Evalúa una plantilla con CORTE TEMPORAL, nunca aleatorio.
 *
 * Un split aleatorio dejaría que el modelo se entrenara con visitas posteriores
 * del mismo equipo y del mismo cliente, y produciría una métrica optimista que
 * se derrumba en producción. Entrenar solo con el pasado es la única forma de
 * que el número del backtest se parezca a lo que va a pasar.
 *
 * `minImprovement` es el margen que se exige para promover. No basta empatar:
 * un modelo que iguala al promedio añade una pieza que mantener y una cifra que
 * el usuario puede malinterpretar, sin dar nada a cambio.
 */
/**
 * Cómo se convierte un tramo de entrenamiento en algo que predice.
 *
 * Es la única forma en que el backtest conoce a un algoritmo: le da casos y
 * recibe una función. No sabe si detrás hay una mediana, un árbol o un bosque,
 * y ese desconocimiento es justamente lo que permite que compitan en igualdad —
 * ninguno puede pedirle al examen un trato distinto.
 */
export type Fitter = (train: Sample[]) => (features: Record<string, string>) => Prediction;

/**
 * El backtest, sin saber qué algoritmo está evaluando.
 *
 * Aquí vive todo lo que hace honesta a la medición —el corte temporal, la línea
 * base de mediana, la tolerancia, los pares para la gráfica— y nada de esto
 * depende de cómo se aprenda. Extraerlo fue lo que permitió que entrara un
 * segundo algoritmo sin relajar una sola de las defensas.
 */
export function backtestWith(
  samples: Sample[],
  fit: Fitter,
  opts: {
    tolerance: number;
    trainRatio?: number;
    trainCount?: number;
    minImprovement?: number;
    minTest?: number;
    minTrain?: number;
  },
): { backtest: Backtest; beatsBaseline: boolean; trainedUpTo: Date } | null {
  const {
    tolerance,
    trainRatio = 0.7,
    trainCount,
    minImprovement = 5,
    minTest = 20,
    minTrain = 10,
  } = opts;

  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const cut = trainCount ?? Math.floor(ordered.length * trainRatio);
  const tr = ordered.slice(0, cut);
  const te = ordered.slice(cut);

  if (tr.length < minTrain || te.length < minTest) return null;

  const predictor = fit(tr);

  const trTargets = [...tr.map((s) => s.target)].sort((a, b) => a - b);
  const medianBaseline = quantile(trTargets, 0.5);
  const meanBaseline = tr.reduce((a, s) => a + s.target, 0) / tr.length;

  let err = 0;
  let baseErr = 0;
  let meanErr = 0;
  let hits = 0;
  let fellBack = 0;

  const stride = Math.max(1, Math.ceil(te.length / MAX_POINTS));
  const points: Array<[number, number]> = [];

  for (let i = 0; i < te.length; i++) {
    const s = te[i];
    const p = predictor(s.features);
    if (p.matched === "global") fellBack++;
    const e = Math.abs(p.value - s.target);
    err += e;
    baseErr += Math.abs(medianBaseline - s.target);
    meanErr += Math.abs(meanBaseline - s.target);
    if (e <= tolerance) hits++;
    if (i % stride === 0) {
      points.push([Number(s.target.toFixed(2)), Number(p.value.toFixed(2))]);
    }
  }

  const mae = err / te.length;
  const baselineMae = baseErr / te.length;
  const improvement =
    baselineMae === 0 ? 0 : ((baselineMae - mae) / baselineMae) * 100;

  return {
    backtest: {
      mae,
      baselineMae,
      meanBaselineMae: meanErr / te.length,
      improvement,
      withinTolerance: (hits / te.length) * 100,
      tolerance,
      nTrain: tr.length,
      nTest: te.length,
      cutoff: (te[0]?.at ?? ordered[cut - 1].at).toISOString(),
      fellBackToGlobal: fellBack,
      points,
    },
    beatsBaseline: improvement >= minImprovement,
    trainedUpTo: ordered[ordered.length - 1].at,
  };
}

export function backtest(
  samples: Sample[],
  ladder: Ladder,
  opts: {
    tolerance: number;
    trainRatio?: number;
    /**
     * Corte exacto, en número de casos. Gana sobre `trainRatio`.
     *
     * Lo usa `chooseLadder`, y no es un capricho: pasar el corte como fracción
     * y recuperarlo con `floor(n * ratio)` puede devolver un caso menos por
     * redondeo binario, y ese caso sería el último del tramo de VALIDACIÓN
     * cayendo dentro del de prueba. Es una fuga de un solo dato —irrelevante
     * para el resultado y letal para poder afirmar que no la hay—.
     */
    trainCount?: number;
    minSupport?: number;
    minImprovement?: number;
    minTest?: number;
  },
): BacktestResult | null {
  const {
    tolerance,
    trainRatio = 0.7,
    trainCount,
    minSupport = 5,
    minImprovement = 5,
    minTest = 20,
  } = opts;

  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const cut = trainCount ?? Math.floor(ordered.length * trainRatio);
  const tr = ordered.slice(0, cut);
  const te = ordered.slice(cut);

  // Sin datos de prueba suficientes no se emite veredicto. Declarar que un
  // modelo funciona con seis casos es peor que decir "todavía no sé".
  if (tr.length < minSupport * 2 || te.length < minTest) return null;

  const model = train(tr, ladder, minSupport);
  // Las dos referencias. La mediana es la que decide; el promedio se reporta
  // para que se vea cuánto de la mejora vendría solo de cambiar de estadístico.
  const trTargets = [...tr.map((s) => s.target)].sort((a, b) => a - b);
  const medianBaseline = quantile(trTargets, 0.5);
  const meanBaseline = tr.reduce((a, s) => a + s.target, 0) / tr.length;

  let err = 0;
  let baseErr = 0;
  let meanErr = 0;
  let hits = 0;
  let fellBack = 0;

  // Muestreo a paso fijo: con 124 casos entran todos; con 4.000 entra uno de
  // cada diez. La nube conserva su forma y el jsonb no crece con el histórico.
  const stride = Math.max(1, Math.ceil(te.length / MAX_POINTS));
  const points: Array<[number, number]> = [];

  for (let i = 0; i < te.length; i++) {
    const s = te[i];
    const p = predict(model, s.features);
    if (p.matched === "global") fellBack++;
    const e = Math.abs(p.value - s.target);
    err += e;
    baseErr += Math.abs(medianBaseline - s.target);
    meanErr += Math.abs(meanBaseline - s.target);
    if (e <= tolerance) hits++;
    if (i % stride === 0) {
      points.push([
        Number(s.target.toFixed(2)),
        Number(p.value.toFixed(2)),
      ]);
    }
  }

  const mae = err / te.length;
  const baselineMae = baseErr / te.length;
  // Si la línea base no se equivoca nunca —todos los casos de prueba con el
  // mismo valor— no hay margen que mejorar y la división daría NaN. Se informa
  // como 0% de mejora: es lo cierto, y además NaN viajaba hasta el jsonb, donde
  // `JSON.stringify` lo convierte en null y la pantalla lo mostraba como 0 sin
  // que nadie supiera que el cálculo se había roto.
  const improvement =
    baselineMae === 0 ? 0 : ((baselineMae - mae) / baselineMae) * 100;

  return {
    // El modelo que se guarda se reentrena con TODO el histórico: el corte
    // servía para medir, no para producir el que va a predecir mañana.
    model: train(ordered, ladder, minSupport),
    backtest: {
      mae,
      baselineMae,
      meanBaselineMae: meanErr / te.length,
      improvement,
      withinTolerance: (hits / te.length) * 100,
      tolerance,
      nTrain: tr.length,
      nTest: te.length,
      cutoff: (te[0]?.at ?? ordered[cut - 1].at).toISOString(),
      fellBackToGlobal: fellBack,
      points,
    },
    beatsBaseline: improvement >= minImprovement,
    trainedUpTo: ordered[ordered.length - 1].at,
  };
}

/* ------------------------- Selección de escalera ------------------------- */

/**
 * Evalúa VARIAS escaleras y devuelve la mejor, sin inflar el resultado.
 *
 * Esta función existe por un problema que aparece en cuanto el usuario deja de
 * escribir la escalera a mano: si se prueban 24 candidatas y se reporta la que
 * mejor puntuó sobre el conjunto de prueba, el número reportado ya no significa
 * "así de bien va a funcionar". Con suficientes intentos, alguna gana por azar,
 * y el laboratorio —construido entero para no mentir— certificaría esa suerte
 * como si fuera capacidad. Es el mismo pecado que evita el corte temporal,
 * entrando por otra puerta.
 *
 * La defensa es partir en TRES y no en dos:
 *
 *   entrenar (55%) → elegir la escalera (15%) → medir (30%)
 *
 * Las candidatas compiten sobre el tramo de VALIDACIÓN. El tramo de PRUEBA no
 * participa de la elección: se toca una sola vez, con la ganadora ya decidida,
 * y es de ahí que sale el porcentaje que ve el usuario. Un tramo que se usó
 * para elegir deja de servir para medir; no hay forma de tenerlo de las dos
 * maneras.
 *
 * El precio es honesto y hay que decirlo: se necesitan ~100 casos en vez de
 * ~67, y algunas plantillas van a quedarse más tiempo en "faltan datos".
 */
export function chooseLadder(
  samples: Sample[],
  candidates: Ladder[],
  opts: {
    tolerance: number;
    minSupport?: number;
    minImprovement?: number;
    minVal?: number;
    minTest?: number;
  },
): BacktestResult | null {
  const {
    tolerance,
    minSupport = 5,
    minImprovement = 5,
    minVal = 15,
    minTest = 20,
  } = opts;

  if (candidates.length === 0) return null;

  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const cutTrain = Math.floor(ordered.length * 0.55);
  const cutVal = Math.floor(ordered.length * 0.7);

  const tr = ordered.slice(0, cutTrain);
  const va = ordered.slice(cutTrain, cutVal);
  const te = ordered.slice(cutVal);

  if (tr.length < minSupport * 2 || va.length < minVal || te.length < minTest) {
    return null;
  }

  // Ronda de selección. Solo mira `va`.
  let best: { ladder: Ladder; mae: number } | null = null;
  for (const ladder of candidates) {
    const m = train(tr, ladder, minSupport);
    let err = 0;
    for (const s of va) err += Math.abs(predict(m, s.features).value - s.target);
    const mae = err / va.length;
    // El `<` estricto deja ganar a la PRIMERA candidata en caso de empate, y
    // `laddersFor` las emite de la más específica a la más general. Un empate
    // se resuelve así hacia la escalera más informativa, no al azar del orden
    // de iteración.
    if (!best || mae < best.mae) best = { ladder, mae };
  }
  if (!best) return null;

  // Ronda de medición. La escalera ya está decidida; `te` se estrena aquí.
  // Se entrena con entrenamiento + validación: una vez elegida la forma del
  // modelo, retacear datos para ajustarlo no protege de nada.
  const result = backtest(ordered, best.ladder, {
    tolerance,
    trainCount: cutVal,
    minSupport,
    minImprovement,
    minTest,
  });
  if (!result) return null;

  return {
    ...result,
    backtest: {
      ...result.backtest,
      nVal: va.length,
      candidates: candidates.length,
    },
  };
}
