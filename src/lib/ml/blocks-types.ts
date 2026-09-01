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
  /**
   * A dónde lleva CLICAR esta marca. La lista de detrás de este dato.
   *
   * ── POR QUÉ POR BARRA Y NO POR BLOQUE ─────────────────────────────────────
   *
   * El bloque ya tiene su `href` —«Ver a detalle»— y va al listado entero. Lo
   * que falta es lo otro: ver «Juan P. · 14 servicios», querer esos catorce, y
   * tener que ir al listado y filtrar a mano por Juan. La barra SABE de quién
   * es; el enlace es esa respuesta.
   *
   * Opcional a propósito. Una barra sin `href` no es clicable y no lo finge:
   * un cursor de mano que no lleva a ningún sitio enseña a no volver a probar.
   */
  href?: string;
};

/**
 * Qué hay en el eje de las categorías: el tiempo, o entidades con nombre.
 *
 * ── POR QUÉ SE DECLARA Y NO SE ADIVINA ─────────────────────────────────────
 *
 * Porque decide la FORMA del dibujo, y adivinarlo desde el texto de la etiqueta
 * —buscar «ene», «sem 12», un patrón de fecha— es una regla que falla en
 * silencio el día que un cliente se llame «Marzo» o una refacción «S-2024».
 * Quien construye el bloque sabe con certeza lo que tiene entre manos; que lo
 * diga cuesta una línea.
 *
 * ── AUSENTE SIGNIFICA CATEGÓRICO, Y ES EL DEFECTO CORRECTO ─────────────────
 *
 * De los 24 bloques con barras del catálogo, 18 son rankings de entidades
 * —técnicos, refacciones, clientes, motivos de pérdida— y solo 6 son tiempo.
 * El defecto cubre la mayoría, y los seis que no lo son se marcan a mano.
 *
 * Si alguien añade un bloque temporal y olvida marcarlo, saldrá como ranking:
 * se ve raro —los meses ordenados de mayor a menor— pero se ve, y el error es
 * evidente en pantalla en vez de quedar escondido.
 */
export type Axis = "time";

/*
 * Cómo se DIBUJA un bloque —qué formas admite, cuál se le recomienda y por qué
 * una no le sirve— vive en `@/lib/ml/formas`. Aquí solo está lo que un bloque
 * ES; allí, lo que se puede hacer con él.
 */

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
  /** Ver `Axis`. Ausente = ranking de entidades. */
  axis?: Axis;
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
  /** Ver `Axis`. Ausente = ranking de entidades. */
  axis?: Axis;
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
