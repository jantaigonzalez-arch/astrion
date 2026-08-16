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
 * Solo los hallazgos: son lo accionable y lo único que se lee bien en 26 rem.
 * Las gráficas necesitan ancho, y encogerlas hasta que quepan las vuelve
 * adorno — que es peor que no enseñarlas.
 */
export const COMPACT_KINDS: BlockKind[] = ["finding"];
