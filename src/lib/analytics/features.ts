import "server-only";
import pl from "nodejs-polars";
import type { Sample } from "@/lib/ml/core";

/**
 * Rasgos DERIVADOS: lo que resume el pasado de una entidad consigo misma.
 *
 * Es la primera vez que Polars entra al camino del aprendizaje, y conviene ser
 * exacto sobre por qué. NO entra por volumen —412 casos son microsegundos de
 * aritmética en cualquier lenguaje— sino por FORMA. Un rasgo como «la mediana
 * de los intervalos anteriores de esta misma pieza, contando solo hacia atrás»
 * en SQL correlacionado es una subconsulta con ventana dentro de otra, ilegible
 * y de costo cuadrático; aquí son tres llamadas encadenadas.
 *
 * Polars sigue sin tener un solo algoritmo de ML: prepara la matriz de rasgos y
 * se la pasa a `fit()`. Quien aprende sigue siendo `algorithms.ts`.
 *
 * ── Y NO ES MÁS RÁPIDO. MEDIDO ─────────────────────────────────────────────
 *
 * Conviene dejarlo por escrito antes de que alguien lo suponga. La misma
 * mediana rodante por entidad, contra una implementación en TypeScript plano de
 * unas treinta líneas que devuelve exactamente los mismos valores:
 *
 *      500 filas → TS 42× más rápido   (0,07 ms contra 2,8 ms)
 *    5.000 filas → TS  5,8×
 *   50.000 filas → TS  2,0×
 *  500.000 filas → TS  1,2×
 *
 * Polars pierde en todos los tamaños probados y el cruce ni se asoma. El motivo
 * es que aquí paga lo que peor se le da: construir el dataframe desde arrays de
 * JS y devolver los resultados a arrays de JS. Su terreno es el otro —parquet
 * dentro, parquet fuera, sin cruzar el puente— que es exactamente lo que hacen
 * `extract.ts` y `datasets.ts`.
 *
 * Se queda igual, y por lo que decía arriba: la expresión se lee. No hay que
 * mantener a mano el desplazamiento, la ventana y la agrupación por entidad,
 * que son las tres cosas que hay que hacer bien para no filtrar el futuro. A
 * 6 ms sobre el histórico completo, la legibilidad se paga sola. Lo que NO se
 * puede es defender esta elección diciendo que es más rápida.
 *
 * ── LA INVARIANTE ──────────────────────────────────────────────────────────
 *
 * Toda expresión de este archivo empieza por `.shift(1)`.
 *
 * Eso es lo único que separa un rasgo derivado legítimo de una fuga de
 * información con aspecto de genialidad. Sin el desplazamiento, «la mediana de
 * los intervalos de esta pieza» incluiría EL INTERVALO QUE SE QUIERE PREDECIR,
 * y el modelo saldría casi perfecto en el backtest para desplomarse el primer
 * día en producción. Es la fuga más difícil de ver de todas las que hay,
 * porque no hay ninguna columna sospechosa: el rasgo se calcula del propio
 * objetivo, correctamente, un instante demasiado tarde.
 *
 * Por eso hay una prueba dedicada a comprobarlo (`scripts/check-leakage.ts`) y
 * por eso las expresiones no se escriben a mano caso por caso: se declaran en
 * `DERIVED` y las arma una sola función.
 *
 * ── POR QUÉ SALEN COMO CATEGORÍAS ──────────────────────────────────────────
 *
 * Los tres algoritmos del laboratorio parten por igualdad sobre valores
 * categóricos. Un rasgo derivado es un número, así que se corta en bandas antes
 * de entrar — y la referencia del corte es la MEDIANA MÓVIL DEL PASADO, nunca
 * un umbral fijo. Un corte fijo («más de 60 días es lento») es cierto para esta
 * empresa este año y falso para la siguiente que use el sistema; una referencia
 * móvil se calibra sola en cada inquilino y no envejece.
 *
 * ── QUÉ DIO AL MEDIRLOS (16 ago 2026, datos de Evoelution) ─────────────────
 *
 * NO mejoran ninguna de las dos plantillas de producción, y por eso ninguna se
 * cambió. `scripts/measure-derived.ts` reproduce la tabla:
 *
 *   días hasta el próximo servicio (466 casos)
 *     como está hoy         −1,3 %  · rechazado
 *     hoy + ritmo propio    +4,5 %  · rechazado — mejor, pero no llega al 5 %
 *
 *   días hasta volver a usar una refacción (508 casos)
 *     como está hoy        +20,9 %  · APROBADO
 *     hoy + ritmo propio    −1,6 %  · rechazado
 *     solo ultimo_propio   +12,7 %  · rechazado
 *
 * Que un rasgo no ayude también es información, y esta es doble. En equipos
 * apunta en la dirección correcta desde un modelo que hoy pierde contra la
 * mediana: con más historia por equipo es el candidato a mirar. En refacciones
 * ESTORBA, y se entiende — 508 consumos repartidos en 75 piezas son ~7 casos
 * por pieza, y un resumen del pasado de una entidad con siete casos es ruido
 * con forma de rasgo. Añadirlo desplaza a `part_family`, que sí agrupa.
 *
 * Así que quedan en el catálogo, elegibles, sin ponerse en ninguna plantilla de
 * fábrica. Es la misma postura que con el bosque aleatorio: la capacidad
 * inscrita y esperando datos, no compitiendo antes de tiempo.
 *
 * Medirlos, además, destapó un fallo real del laboratorio: el árbol y el bosque
 * ignoraban la lista de rasgos elegida y partían por todas las columnas
 * presentes. Ver `TreeConfig` en `ml/algorithms.ts`.
 */

/* ------------------------- Vocabulario ------------------------- */

export type Derived = {
  id: string;
  /** Sujetos donde tiene sentido. Ver la nota de `deriveFeatures`. */
  subjects: string[];
  label: string;
  /** Por qué no mira el futuro. Mismo contrato que `Feature.safeBecause`. */
  safeBecause: string;
  /**
   * Qué se resume del pasado de la misma entidad.
   *
   * `target` — el valor que se quiso predecir en sus casos anteriores.
   * `count`  — cuántos casos anteriores tiene, sin mirar su valor.
   */
  source: "target" | "count";
  /**
   * Cuántos casos previos entran en la ventana.
   *
   * Por FILAS y no por tiempo, y no es una preferencia: el binding de Node de
   * Polars solo implementa ventanas por número de filas. Resulta ser lo
   * correcto igualmente — con 466 servicios repartidos en 31 meses, una
   * ventana de «90 días» sale vacía la mayoría de las veces y produce un rasgo
   * que no agrupa nada. «Las últimas 3 visitas» siempre tiene contenido.
   */
  window: number;
  /** Cómo se convierte el número en categoría. */
  cut: "vs-historia" | "conteo";
};

export const DERIVED: Derived[] = [
  {
    id: "ritmo_propio",
    subjects: ["equipment_service", "part_consumption"],
    label: "Ritmo propio de esta entidad",
    source: "target",
    window: 3,
    cut: "vs-historia",
    safeBecause:
      "Resume los intervalos YA CERRADOS de esa misma pieza o equipo. El " +
      "intervalo que se está prediciendo queda fuera por construcción: la " +
      "expresión empieza desplazando una fila.",
  },
  {
    id: "ultimo_propio",
    subjects: ["equipment_service", "part_consumption"],
    label: "Cómo salió la vez anterior",
    source: "target",
    window: 1,
    cut: "vs-historia",
    safeBecause:
      "Es el caso inmediatamente anterior de la misma entidad, que ya había " +
      "ocurrido y ya se conocía en el instante del ancla.",
  },
  {
    id: "historia_propia",
    subjects: ["equipment_service", "part_consumption"],
    label: "Cuánta historia tiene",
    source: "count",
    window: 0,
    cut: "conteo",
    safeBecause:
      "Cuenta los casos anteriores de esa entidad. No mira su valor, solo que " +
      "ocurrieron antes.",
  },
];

export const derivedById = (id: string) => DERIVED.find((d) => d.id === id);

/** Los que aplican a un sujeto. Ver la restricción en `deriveFeatures`. */
export function derivedFor(subjectId: string): Derived[] {
  return DERIVED.filter((d) => d.subjects.includes(subjectId));
}

/* ------------------------- Cálculo ------------------------- */

/** Márgenes de la banda, contra la referencia móvil. */
const ALTO = 1.25;
const BAJO = 0.75;

/** Casos previos mínimos para que la referencia global signifique algo. */
const MIN_REF = 20;

/**
 * Tope de la ventana de la referencia. `windowSize` es un i16 en el binding de
 * Rust, así que 32 767 es el máximo que acepta — pedirle más aborta con «failed
 * to convert i32 to i16», que es un error del puente y no del cálculo.
 *
 * Por debajo de ese tamaño la ventana cubre todo el histórico y la referencia
 * es exactamente expansiva. Un inquilino con más de 32 000 casos la vería
 * degradar a una ventana móvil de los últimos 32 000 — sigue sin ver el futuro,
 * que es lo que importa, pero deja de mirar el principio de su propia historia.
 */
const MAX_WINDOW = 32_000;

function bandOf(value: number | null, ref: number | null): string {
  if (value === null || !Number.isFinite(value)) return "sin-historia";
  if (ref === null || !Number.isFinite(ref) || ref <= 0) return "sin-referencia";
  if (value >= ALTO * ref) return "mas-lento";
  if (value <= BAJO * ref) return "mas-rapido";
  return "normal";
}

function countBandOf(n: number): string {
  if (n <= 0) return "primera-vez";
  if (n <= 2) return "pocos";
  if (n <= 5) return "varios";
  return "muchos";
}

/**
 * Añade los rasgos derivados a un histórico ya ordenado por fecha.
 *
 * **Solo tiene sentido cuando la entidad SE REPITE.** Con `subject: ticket` la
 * llave es el id del ticket, así que cada entidad aparece una sola vez y todo
 * lo derivado sale nulo — no es un fallo, es que la pregunta «¿cómo le fue a
 * esta entidad antes?» no existe cuando la entidad es nueva por definición. La
 * ontología ya lo declara: son los sujetos con `predictOnce: false`.
 *
 * Es la MISMA función para entrenar y para predecir, y eso no es comodidad: es
 * la única forma de garantizar que el número que ve el modelo al aprender y el
 * que ve al decidir salen del mismo cálculo. El camino de servicio le añade una
 * fila centinela al final —el caso vivo, todavía sin objetivo— y lee la última
 * fila; el desplazamiento hace que esa fila resuma exactamente su propio pasado
 * y nada más.
 */
export function deriveFeatures(samples: Sample[], specs: Derived[]): Sample[] {
  if (specs.length === 0 || samples.length === 0) return samples;

  // Sin identidad no hay historia que agrupar. Se devuelve el histórico intacto
  // en vez de inventar una llave: un rasgo derivado que agrupa todo junto no
  // resume «esta entidad», resume «la empresa», que es otra cosa.
  if (samples.some((s) => !s.key)) return samples;

  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());

  const df = pl.DataFrame({
    key: ordered.map((s) => s.key as string),
    at: ordered.map((s) => s.at),
    // El centinela del camino de servicio llega sin objetivo. Entra como 0 y
    // nunca se lee: toda expresión desplaza una fila, así que el valor de la
    // fila corriente no participa de su propio rasgo.
    target: ordered.map((s) => (Number.isFinite(s.target) ? s.target : 0)),
  });

  const cols = specs.map((d) => {
    const past = pl.col("target").shift(1);
    const expr =
      d.source === "count"
        ? past.cumCount().over("key")
        : d.window <= 1
          ? past.over("key")
          : past
              .rollingMedian({ windowSize: d.window, minPeriods: 1 })
              .over("key");
    return expr.alias(d.id);
  });

  /*
    La referencia del corte: la mediana de TODO el pasado del histórico, sin
    agrupar por entidad y también desplazada una fila.

    Es expansiva —la ventana es más grande que cualquier histórico real— así
    que en cada fila mira todo lo anterior y nada de lo posterior. Comparar
    contra la mediana global completa habría metido el futuro por la puerta de
    atrás: cada caso se estaría midiendo contra un promedio que lo incluye a él
    y a todo lo que vino después.
  */
  const withRef = df.withColumns(
    ...cols,
    pl
      .col("target")
      .shift(1)
      .rollingMedian({
        windowSize: Math.max(MIN_REF, Math.min(MAX_WINDOW, ordered.length)),
        minPeriods: MIN_REF,
      })
      .alias("__ref"),
  );

  const ref = withRef.getColumn("__ref").toArray() as Array<number | null>;
  const values = new Map<string, Array<number | null>>(
    specs.map((d) => [
      d.id,
      withRef.getColumn(d.id).toArray() as Array<number | null>,
    ]),
  );

  return ordered.map((s, i) => {
    const extra: Record<string, string> = {};
    for (const d of specs) {
      const v = values.get(d.id)![i];
      extra[d.id] =
        d.cut === "conteo" ? countBandOf(Number(v ?? 0)) : bandOf(v, ref[i]);
    }
    return { ...s, features: { ...s.features, ...extra } };
  });
}

/**
 * Los rasgos derivados del CASO VIVO, a partir de la historia de su entidad.
 *
 * Recibe el histórico completo del sujeto —el mismo que se usó para entrenar— y
 * la entidad sobre la que se va a predecir. Añade la fila centinela y devuelve
 * lo que le corresponde.
 *
 * Una entidad SIN historia —una pieza que se usa por primera vez— no es un caso
 * de error ni motivo para callar: sale `sin-historia`, que es una categoría del
 * catálogo y no un hueco. El modelo la aprendió como cualquier otra, porque en
 * el entrenamiento la primera aparición de cada entidad produce exactamente ese
 * valor. Y no hace falta ningún caso especial para conseguirlo: el centinela
 * queda solo en su grupo, el desplazamiento no encuentra nada detrás, y el
 * mismo cálculo de siempre devuelve lo correcto.
 */
export function deriveForLive(
  history: Sample[],
  entityKey: string,
  at: Date,
  specs: Derived[],
): Record<string, string> {
  if (specs.length === 0) return {};

  const sentinel: Sample = {
    at,
    key: entityKey,
    target: Number.NaN,
    features: {},
  };
  const enriched = deriveFeatures([...history, sentinel], specs);

  // El centinela es el ÚLTIMO de su entidad por fecha; se busca por identidad y
  // no por posición porque `deriveFeatures` reordena.
  const mine = enriched.filter((s) => s.key === entityKey);
  const last = mine[mine.length - 1];

  return Object.fromEntries(
    specs.map((d) => [d.id, last?.features[d.id] ?? "sin-historia"]),
  );
}
