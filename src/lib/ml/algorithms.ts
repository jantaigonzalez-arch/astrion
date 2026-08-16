import type { Prediction, Sample } from "./core";
import { train, predict as predictByGroup, type TrainedModel } from "./core";
import { laddersFor } from "./blocks";

/**
 * El registro de algoritmos: la costura por la que entra un modelo nuevo.
 *
 * Hasta aquí el laboratorio tenía **un** algoritmo escrito a mano —mediana por
 * grupo— y `chooseLadder` comparaba agrupaciones entre sí. El discurso del
 * núcleo decía «cuando los datos crezcan, bastará añadir otro algoritmo y
 * comparar», y no era cierto: `train` y `predict` eran funciones concretas, no
 * un contrato, así que un candidato nuevo no tenía por dónde presentarse. El
 * veredicto existía y el aspirante no podía entrar a examen.
 *
 * Esa asimetría es lo que este archivo elimina. Ahora compiten ALGORITMOS, cada
 * uno con sus configuraciones, sobre el mismo tramo de validación y bajo el
 * mismo veredicto. Un bosque aleatorio se presenta igual que una mediana: si
 * gana, gana; si pierde, queda registrado que perdió, y eso también es
 * información.
 *
 * Tres reglas que ningún algoritmo puede romper:
 *
 * **Determinismo.** Mismo conjunto, mismo resultado, siempre. El laboratorio
 * congela sus datos de entrenamiento en parquet para poder reproducir una
 * medición bit a bit; un algoritmo que use azar sin semilla fija destruiría esa
 * propiedad en silencio. Por eso el bosque siembra su generador con una
 * constante y no con el reloj.
 *
 * **Serializable.** El modelo entrenado viaja como jsonb a `ml_models.params` y
 * se rehidrata al predecir. Nada de funciones ni clases: solo datos.
 *
 * **Con incertidumbre declarada.** Toda predicción devuelve banda (`lower` /
 * `upper`) y `support`. Un algoritmo que solo supiera dar un número no podría
 * usarse aquí, y es deliberado: la pantalla promete decir entre qué valores se
 * mueve y con cuántos casos se sostiene.
 */

export type Predictor = (features: Record<string, string>) => Prediction;

export type Algorithm = {
  id: string;
  label: string;
  /**
   * Por debajo de este número de casos el algoritmo NO se presenta.
   *
   * No es una salvaguarda de rendimiento: es de honestidad. Un bosque sobre 80
   * casos produce un número con aspecto de sofisticado que solo memoriza el
   * entrenamiento, y el backtest podría no cazarlo si el tramo de prueba es
   * chico. Más vale que no compita a que compita y engañe.
   */
  minSamples: number;
  /** Configuraciones que este algoritmo quiere probar para esos rasgos. */
  candidates: (featureIds: string[]) => unknown[];
  /** Entrena y devuelve SOLO datos, listos para jsonb. */
  fit: (samples: Sample[], config: unknown, minSupport: number) => unknown;
  /**
   * Rehidrata desde jsonb. `null` si la forma no cuadra.
   *
   * Un modelo guardado por una versión anterior tiene que degradar a "sin
   * predicción", nunca reventar en medio del alta de un ticket.
   */
  load: (params: unknown) => Predictor | null;
};

/* ============================================================
   Estadística compartida
   ============================================================ */

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

type Leaf = { median: number; p25: number; p75: number; n: number };

function leafOf(values: number[]): Leaf {
  const xs = [...values].sort((a, b) => a - b);
  return {
    median: quantile(xs, 0.5),
    p25: quantile(xs, 0.25),
    p75: quantile(xs, 0.75),
    n: xs.length,
  };
}

/**
 * Suma de desviaciones absolutas respecto a la mediana.
 *
 * Es el criterio de impureza correcto **para este laboratorio**, y no la
 * varianza que usa un CART de libro. La razón es de coherencia: todo el sistema
 * predice medianas y se evalúa con error absoluto medio, así que partir por
 * varianza optimizaría una cosa distinta de la que se mide. Un árbol que
 * minimiza varianza persigue la media, y la media de estos objetivos —unos
 * pocos servicios de 28 horas— no es el caso típico.
 */
function sad(values: number[]): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const m = quantile(xs, 0.5);
  let s = 0;
  for (const v of xs) s += Math.abs(v - m);
  return s;
}

/**
 * Generador pseudoaleatorio con semilla explícita (mulberry32).
 *
 * `Math.random()` habría bastado para que el bosque funcionara y habría roto la
 * reproducibilidad sin avisar: dos entrenamientos sobre el mismo parquet
 * congelado darían métricas distintas, y el peritaje que compara lo registrado
 * contra lo recalculado empezaría a fallar sin que nada estuviera mal.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
   1 · Mediana por grupo — el que ya estaba
   ============================================================ */

/**
 * El algoritmo histórico, ahora presentándose por la misma puerta que los demás.
 *
 * Su implementación no cambió una línea: `train` y `predict` siguen viviendo en
 * `core.ts`. Lo único nuevo es que ya no es *el* algoritmo, sino *un* candidato.
 */
export const medianByGroup: Algorithm = {
  id: "median_by_group",
  label: "Mediana por grupo",
  minSamples: 0,
  candidates: (ids) => laddersFor(ids),
  fit: (samples, config, minSupport) =>
    train(samples, config as string[][], minSupport),
  load: (params) => {
    const m = params as TrainedModel;
    if (!m || !Array.isArray(m.ladder) || !m.groups || !m.global) return null;
    return (features) => predictByGroup(m, features);
  },
};

/* ============================================================
   2 · Árbol de regresión — el escalón intermedio
   ============================================================ */

type TreeConfig = { maxDepth: number; minLeaf: number };

type TreeNode =
  | { kind: "leaf"; leaf: Leaf }
  | { kind: "split"; feature: string; value: string; yes: TreeNode; no: TreeNode };

type TreeParams = { algorithm: "regression_tree"; config: TreeConfig; root: TreeNode };

/**
 * Corte binario sobre un rasgo CATEGÓRICO: «¿es igual a este valor?».
 *
 * Los rasgos de este sistema son todos categóricos —categoría, marca, familia,
 * proveedor—, nunca números. Un CART clásico busca umbrales (`x < 3.5`), que
 * aquí no significan nada. La partición correcta es por pertenencia a un valor,
 * y probar todos los valores presentes en el nodo.
 */
function bestSplit(
  rows: Sample[],
  featureIds: string[],
  minLeaf: number,
): { feature: string; value: string; gain: number } | null {
  const targets = rows.map((r) => r.target);
  const base = sad(targets);
  let best: { feature: string; value: string; gain: number } | null = null;

  for (const f of featureIds) {
    const values = new Set<string>();
    for (const r of rows) {
      const v = r.features[f];
      // Un valor desconocido no define un grupo: agruparía casos que no tienen
      // nada que ver bajo la etiqueta vacía. Misma regla que en `train`.
      if (v) values.add(v);
    }
    for (const v of values) {
      const yes: number[] = [];
      const no: number[] = [];
      for (const r of rows) (r.features[f] === v ? yes : no).push(r.target);
      if (yes.length < minLeaf || no.length < minLeaf) continue;
      const gain = base - (sad(yes) + sad(no));
      if (gain > 0 && (!best || gain > best.gain)) best = { feature: f, value: v, gain };
    }
  }
  return best;
}

function growTree(
  rows: Sample[],
  featureIds: string[],
  cfg: TreeConfig,
  depth: number,
): TreeNode {
  if (depth >= cfg.maxDepth || rows.length < cfg.minLeaf * 2) {
    return { kind: "leaf", leaf: leafOf(rows.map((r) => r.target)) };
  }
  const split = bestSplit(rows, featureIds, cfg.minLeaf);
  if (!split) return { kind: "leaf", leaf: leafOf(rows.map((r) => r.target)) };

  const yes: Sample[] = [];
  const no: Sample[] = [];
  for (const r of rows) (r.features[split.feature] === split.value ? yes : no).push(r);

  return {
    kind: "split",
    feature: split.feature,
    value: split.value,
    yes: growTree(yes, featureIds, cfg, depth + 1),
    no: growTree(no, featureIds, cfg, depth + 1),
  };
}

function walk(node: TreeNode, features: Record<string, string>): Leaf {
  let n = node;
  for (;;) {
    if (n.kind === "leaf") return n.leaf;
    n = features[n.feature] === n.value ? n.yes : n.no;
  }
}

export const regressionTree: Algorithm = {
  id: "regression_tree",
  label: "Árbol de regresión",
  // Con menos de 150 casos un árbol podado se queda en dos hojas y equivale a
  // la mediana por grupo, pero con más piezas que mantener.
  minSamples: 150,
  candidates: (ids) =>
    ids.length === 0
      ? []
      : ([
          { maxDepth: 2, minLeaf: 25 },
          { maxDepth: 3, minLeaf: 15 },
          { maxDepth: 4, minLeaf: 10 },
        ] satisfies TreeConfig[]),
  fit: (samples, config) => {
    const cfg = config as TreeConfig;
    const ids = [...new Set(samples.flatMap((s) => Object.keys(s.features)))].sort();
    return {
      algorithm: "regression_tree",
      config: cfg,
      root: growTree(samples, ids, cfg, 0),
    } satisfies TreeParams;
  },
  load: (params) => {
    const p = params as TreeParams;
    if (!p || p.algorithm !== "regression_tree" || !p.root) return null;
    return (features) => {
      const leaf = walk(p.root, features);
      return {
        value: leaf.median,
        lower: leaf.p25,
        upper: leaf.p75,
        support: leaf.n,
        matched: `árbol(prof≤${p.config.maxDepth})`,
      };
    };
  },
};

/* ============================================================
   3 · Bosque aleatorio
   ============================================================ */

type ForestConfig = {
  trees: number;
  maxDepth: number;
  minLeaf: number;
  /** Fracción de rasgos que ve cada corte. El «aleatorio» del nombre. */
  featureFrac: number;
  seed: number;
};

type ForestParams = {
  algorithm: "random_forest";
  config: ForestConfig;
  trees: TreeNode[];
};

/**
 * Bosque aleatorio: muchos árboles sobre remuestras, y la mediana de sus votos.
 *
 * Es el algoritmo que hace falta tener LISTO antes de necesitarlo. Con los 412
 * casos de hoy va a perder contra la mediana por grupo —y el backtest lo dirá
 * sin que nadie tenga que opinar—, pero el día que una empresa acumule miles de
 * servicios, o que el lago junte los de varios inquilinos que consintieron, el
 * candidato ya está inscrito y gana solo.
 *
 * Dos decisiones propias de este laboratorio:
 *
 * **La semilla es parte de la configuración**, no del reloj. Dos entrenamientos
 * sobre el mismo conjunto congelado tienen que dar exactamente lo mismo, o el
 * peritaje de reproducibilidad empezaría a fallar sin que nada estuviera roto.
 *
 * **Se agregan MEDIANAS, no medias.** Cada árbol vota con la mediana de su hoja
 * y el bosque toma la mediana de esos votos. Promediar traería de vuelta la
 * sensibilidad a los servicios de 28 horas que todo el sistema evita a
 * propósito.
 */
export const randomForest: Algorithm = {
  id: "random_forest",
  label: "Bosque aleatorio",
  // Un bosque necesita que cada árbol vea una remuestra con variedad. Por
  // debajo de 300 casos los árboles salen casi idénticos y el bosque es un
  // árbol caro.
  minSamples: 300,
  candidates: (ids) =>
    ids.length < 2
      ? []
      : ([
          { trees: 40, maxDepth: 4, minLeaf: 10, featureFrac: 0.7, seed: 20260815 },
          { trees: 80, maxDepth: 5, minLeaf: 8, featureFrac: 0.6, seed: 20260815 },
        ] satisfies ForestConfig[]),
  fit: (samples, config) => {
    const cfg = config as ForestConfig;
    const ids = [...new Set(samples.flatMap((s) => Object.keys(s.features)))].sort();
    const rand = rng(cfg.seed);
    const perSplit = Math.max(1, Math.round(ids.length * cfg.featureFrac));

    const trees: TreeNode[] = [];
    for (let b = 0; b < cfg.trees; b++) {
      // Remuestra con reemplazo (bagging).
      const boot: Sample[] = [];
      for (let i = 0; i < samples.length; i++) {
        boot.push(samples[Math.floor(rand() * samples.length)]);
      }
      // Subconjunto de rasgos para ESTE árbol. Barajado con la misma semilla,
      // así que el bosque entero es función determinista del conjunto.
      const shuffled = [...ids];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      trees.push(
        growTree(
          boot,
          shuffled.slice(0, perSplit),
          { maxDepth: cfg.maxDepth, minLeaf: cfg.minLeaf },
          0,
        ),
      );
    }
    return { algorithm: "random_forest", config: cfg, trees } satisfies ForestParams;
  },
  load: (params) => {
    const p = params as ForestParams;
    if (!p || p.algorithm !== "random_forest" || !Array.isArray(p.trees)) return null;
    return (features) => {
      const votos: number[] = [];
      let soporte = 0;
      for (const t of p.trees) {
        const leaf = walk(t, features);
        votos.push(leaf.median);
        soporte += leaf.n;
      }
      const xs = votos.sort((a, b) => a - b);
      return {
        value: quantile(xs, 0.5),
        // La banda sale de la DISPERSIÓN ENTRE ÁRBOLES, que es lo que este
        // método sabe de su propia incertidumbre: cuando los árboles discrepan,
        // la banda se abre y la pantalla lo enseña.
        lower: quantile(xs, 0.25),
        upper: quantile(xs, 0.75),
        support: Math.round(soporte / Math.max(1, p.trees.length)),
        matched: `bosque(${p.trees.length} árboles)`,
      };
    };
  },
};

/* ============================================================
   Registro
   ============================================================ */

export const ALGORITHMS: Algorithm[] = [medianByGroup, regressionTree, randomForest];

export const algorithmById = (id: string) => ALGORITHMS.find((a) => a.id === id);

/**
 * Rehidrata un modelo guardado sin saber de antemano cuál es.
 *
 * Los modelos entrenados ANTES de que existiera el registro no llevan el
 * algoritmo dentro de `params`: son mediana por grupo y hay que tratarlos como
 * tal. Por eso el id viaja también en su columna, y esta función lo acepta.
 */
export function loadPredictor(algorithmId: string, params: unknown): Predictor | null {
  return algorithmById(algorithmId)?.load(params) ?? null;
}
