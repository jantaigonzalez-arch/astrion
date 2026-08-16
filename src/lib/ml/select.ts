import type { BacktestResult, Fitter, Sample } from "./core";
import { backtestWith } from "./core";
import { ALGORITHMS, type Algorithm } from "./algorithms";

/**
 * El examen: todos los algoritmos y todas sus configuraciones, un solo ganador.
 *
 * Generaliza `chooseLadder` sin cambiarle una coma a su defensa. La partición
 * sigue siendo en tres —entrenar 55 %, elegir 15 %, medir 30 %— y el tramo de
 * PRUEBA se sigue tocando **una sola vez**, con el ganador ya decidido. Lo único
 * que cambió es quién compite: antes eran agrupaciones de un mismo algoritmo,
 * ahora son algoritmos distintos con sus agrupaciones.
 *
 * Y esa ampliación hace más necesaria la partición en tres, no menos. Con tres
 * algoritmos y sus configuraciones se prueban decenas de candidatos; si el
 * ganador se eligiera mirando el tramo de prueba, la probabilidad de que alguno
 * acierte por azar deja de ser teórica. Aquí ninguno lo ve hasta que la
 * decisión está tomada.
 *
 * `minSamples` de cada algoritmo se respeta ANTES de dejarlo competir. Un
 * bosque sobre 80 casos no pierde limpiamente: memoriza, y con un tramo de
 * prueba chico puede ganar por suerte. Más vale que no se presente.
 */

export type Contender = {
  algorithm: Algorithm;
  config: unknown;
  /** Error sobre el tramo de VALIDACIÓN. Nunca sobre el de prueba. */
  mae: number;
};

export type Selection = BacktestResult & {
  /** Quién ganó, para guardarlo en `ml_models.algorithm`. */
  algorithmId: string;
  /**
   * La configuración ganadora.
   *
   * Se devuelve para poder REAJUSTAR al ganador sobre otro tramo sin repetir la
   * selección — que es lo que necesita el duelo contra el modelo vigente: hay
   * que entrenar al aspirante solo con lo que el vigente ya había visto, o el
   * examen no está parejo.
   */
  config: unknown;
  /** Cómo quedó la competencia. Se muestra: perder también informa. */
  leaderboard: Array<{ algorithm: string; label: string; mae: number }>;
};

/**
 * Elige algoritmo Y configuración, y mide al ganador una sola vez.
 *
 * Devuelve `null` cuando ningún candidato pudo evaluarse: no hay casos
 * suficientes para partir en tres, o ningún algoritmo alcanzó su `minSamples`.
 * Decir "todavía no sé" es un resultado válido y el único honesto ahí.
 */
export function chooseModel(
  samples: Sample[],
  featureIds: string[],
  opts: {
    tolerance: number;
    minSupport?: number;
    minImprovement?: number;
    minVal?: number;
    minTest?: number;
  },
): Selection | null {
  const {
    tolerance,
    minSupport = 5,
    minImprovement = 5,
    minVal = 15,
    minTest = 20,
  } = opts;

  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const cutTrain = Math.floor(ordered.length * 0.55);
  const cutVal = Math.floor(ordered.length * 0.7);

  const tr = ordered.slice(0, cutTrain);
  const va = ordered.slice(cutTrain, cutVal);
  const te = ordered.slice(cutVal);

  if (tr.length < minSupport * 2 || va.length < minVal || te.length < minTest) {
    return null;
  }

  /* --- Ronda de selección. Solo mira `va`. --- */
  const tabla: Contender[] = [];
  for (const algorithm of ALGORITHMS) {
    // El umbral se comprueba contra el tramo con el que de verdad se va a
    // entrenar, no contra el total: un bosque que necesita 300 casos y solo ve
    // 220 en el tramo de entrenamiento no está en condiciones de competir.
    if (tr.length < algorithm.minSamples) continue;

    for (const config of algorithm.candidates(featureIds)) {
      const params = algorithm.fit(tr, config, minSupport);
      const predictor = algorithm.load(params);
      if (!predictor) continue;

      let err = 0;
      for (const s of va) err += Math.abs(predictor(s.features).value - s.target);
      tabla.push({ algorithm, config, mae: err / va.length });
    }
  }
  if (tabla.length === 0) return null;

  // `<` estricto: en empate gana el PRIMERO, y `ALGORITHMS` va de lo simple a
  // lo complejo. Un bosque que solo iguala a la mediana no merece el puesto —
  // añade piezas que mantener y una cifra más difícil de explicar, a cambio de
  // nada. La sencillez desempata.
  let best = tabla[0];
  for (const c of tabla) if (c.mae < best.mae) best = c;

  /* --- Ronda de medición. El ganador ya está decidido; `te` se estrena aquí. --- */
  const fit: Fitter = (rows) => {
    const params = best.algorithm.fit(rows, best.config, minSupport);
    const predictor = best.algorithm.load(params);
    // No puede fallar: la misma combinación ya se cargó en la selección. Si
    // fallara, devolver una constante mentiría; mejor que reviente aquí.
    if (!predictor) throw new Error(`El algoritmo ${best.algorithm.id} no se pudo recargar.`);
    return predictor;
  };

  const medido = backtestWith(ordered, fit, {
    tolerance,
    trainCount: cutVal,
    minImprovement,
    minTest,
    minTrain: minSupport * 2,
  });
  if (!medido) return null;

  // El modelo que se GUARDA se reentrena con todo el histórico: el corte servía
  // para medir, no para producir el que va a predecir mañana.
  const finalParams = best.algorithm.fit(ordered, best.config, minSupport);

  // El mejor de cada algoritmo, para que la pantalla pueda enseñar quién
  // compitió. Perder también informa: deja escrito que se intentó.
  const mejorPorAlgoritmo = new Map<string, Contender>();
  for (const c of tabla) {
    const prev = mejorPorAlgoritmo.get(c.algorithm.id);
    if (!prev || c.mae < prev.mae) mejorPorAlgoritmo.set(c.algorithm.id, c);
  }

  return {
    ...medido,
    model: finalParams as never,
    algorithmId: best.algorithm.id,
    config: best.config,
    backtest: {
      ...medido.backtest,
      nVal: va.length,
      candidates: tabla.length,
    },
    leaderboard: [...mejorPorAlgoritmo.values()]
      .sort((a, b) => a.mae - b.mae)
      .map((c) => ({ algorithm: c.algorithm.id, label: c.algorithm.label, mae: c.mae })),
  };
}
