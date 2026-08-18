import type { Insight } from "@/lib/ml/insights";

/**
 * Lo que cabe en el asistente, clasificado POR GRADO DE CERTEZA.
 *
 * El orden de los cuatro tipos no es estético: va de «haz algo hoy» a «entiende
 * el contexto», y de lo que se sabe a lo que se estima.
 *
 *   1. hallazgo    un hecho de ahora que pide acción
 *   2. proyección  lo ya comprometido, por calendario — aritmética sobre hechos
 *   3. tendencia   cómo viene evolucionando — historia real
 *   4. pronóstico  lo que estima un modelo — con banda y casos que lo sostienen
 *
 * La distinción entre 2 y 4 es la que más importa y la más fácil de perder.
 * «Vencen 213 600 el día 24» va a ocurrir: sale de vencimientos ya pactados.
 * «Esta visita llevará 5 h» puede fallar. Presentarlos igual enseña a tratarlos
 * igual, y el día que un pronóstico se equivoque se lleva por delante la
 * credibilidad del calendario, que no tenía culpa.
 *
 * Por eso la regla vive en los TIPOS y no en un comentario:
 *
 *   · `forecast` EXIGE `band` y `support`. No se puede construir un pronóstico
 *     sin decir entre qué valores se mueve y cuántos casos lo sostienen.
 *   · `projection` NO ADMITE banda. Si alguien quiere ponerle una, el
 *     compilador le dice que lo que tiene entre manos es un pronóstico.
 *
 * Es el mismo criterio que ya usa `Insight.support`: `null` para un hecho
 * medido, un número para una estimación.
 */

export type BlockKind = "finding" | "projection" | "trend" | "forecast";

/** Una barra de una serie temporal o categórica. */
export type Bar = {
  key: string;
  label: string;
  value: number;
  /** Segunda magnitud apilada, cuando la barra se compone de dos cosas. */
  stacked?: number;
  /** Marca el tramo como estado —vencido, en falta— y no como serie. */
  alert?: boolean;
};

/** 1 · Un hecho de ahora que pide acción. */
export type FindingBlock = {
  kind: "finding";
  insight: Insight;
};

/**
 * 2 · Lo ya comprometido, por calendario.
 *
 * Sin banda a propósito: no hay incertidumbre que declarar. Un vencimiento
 * pactado no es una estimación.
 */
export type ProjectionBlock = {
  kind: "projection";
  id: string;
  title: string;
  /** Por qué se afirma. Mismo papel que `because` en un hallazgo. */
  note: string;
  bars: Bar[];
  currency?: string;
  total?: number;
  href?: string;
};

/** 3 · Cómo viene evolucionando. Historia real, nunca extrapolada. */
export type TrendBlock = {
  kind: "trend";
  id: string;
  title: string;
  note: string;
  bars: Bar[];
  currency?: string;
  /** Nombres de las dos series cuando las barras van apiladas. */
  legend?: [string, string];
  href?: string;
};

/**
 * 4 · Lo que estima un modelo.
 *
 * `band` y `support` son obligatorios y esa es toda la intención del tipo. Un
 * número sin banda invita a creerle de más; sin `support` no se puede saber si
 * lo sostienen doce casos o dos.
 */
export type ForecastBlock = {
  kind: "forecast";
  id: string;
  title: string;
  note: string;
  value: number;
  unit: string;
  /** Entre qué valores se mueve la estimación. Obligatorio. */
  band: { lower: number; upper: number };
  /** Casos históricos que la sostienen. Obligatorio. */
  support: number;
  /** Qué modelo la produjo, para poder ir a verlo. */
  model: { template: string; version: number };
  href?: string;
  /**
   * La estimación completa, periodo a periodo, cuando lo que se pronostica es
   * una SERIE y no un caso.
   *
   * Extiende `forecast` en vez de ser un quinto tipo, y la decisión es
   * deliberada: los cuatro tipos se dividen por GRADO DE CERTEZA, no por forma.
   * «Lo que se va a facturar los próximos seis meses» es exactamente la misma
   * clase de afirmación que «esta visita llevará 5 h» —una estimación de un
   * modelo, con banda y casos que la sostienen— y meterla en un tipo aparte
   * habría partido la taxonomía por un motivo de dibujo.
   *
   * `value` y `band` siguen siendo obligatorios y siguen significando lo mismo:
   * el PRIMER periodo, que es el que alguien va a leer si no mira la gráfica. La
   * serie es el detalle, no el sustituto.
   */
  series?: Array<{ at: string; value: number; lower: number; upper: number }>;
  /**
   * Lo ya ocurrido, para dibujarlo junto a la estimación.
   *
   * Sin esto la gráfica sale sin frontera entre lo que se sabe y lo que se
   * estima, y una serie continua invita a leer los últimos puntos como datos:
   * el malentendido más caro que puede producir un pronóstico en pantalla.
   */
  history?: Array<{ at: string; value: number }>;
};

export type Block =
  | FindingBlock
  | ProjectionBlock
  | TrendBlock
  | ForecastBlock;

/** Encabezados del panel. En el orden en que se presentan. */
export const BLOCK_ORDER: BlockKind[] = [
  "finding",
  "projection",
  "trend",
  "forecast",
];

export const BLOCK_LABEL: Record<BlockKind, string> = {
  finding: "Requiere atención",
  projection: "Lo que viene",
  trend: "Cómo viene",
  forecast: "Lo que estima el modelo",
};

/**
 * Qué se enseña en el panel compacto.
 *
 * La regla de antes era «solo hallazgos», con este razonamiento: las gráficas
 * necesitan ancho y encogerlas hasta que quepan las vuelve adorno. La primera
 * mitad sigue siendo cierta; la conclusión estaba mal.
 *
 * Lo que no cabe en 26 rem es LA GRÁFICA, no el bloque. Un pronóstico se lee
 * perfectamente en una línea —«837.348 MXN, entre 743.000 y 932.000»— y de
 * hecho esa línea es lo que alguien va a mirar; la serie es el detalle. Un
 * calendario de pagos tiene su total. Excluir el tipo entero por su gráfica
 * dejaba el panel VACÍO en cualquier pantalla cuyo único análisis fuera un
 * pronóstico, con el título puesto y nada debajo — y un panel vacío enseña a no
 * volver a abrirlo, que es la lección que este componente existe para evitar.
 *
 * La tendencia sigue fuera, y por un motivo distinto: su contenido ES la forma
 * de las barras. Un valor suelto no la resume, y no hay línea que la sustituya.
 * Para eso está el aviso de «hay más» y el botón de agrandar.
 */
export const COMPACT_KINDS: BlockKind[] = ["finding", "forecast", "projection"];
