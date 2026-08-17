/**
 * El contrato con la capa de inteligencia, en TypeScript.
 *
 * Espejo de `services/intelligence/app/contracts.py`. Si cambia uno, cambia el
 * otro: están enfrentados a propósito para que la divergencia se vea al leerlos
 * en paralelo, porque no hay compilador que la atrape.
 *
 * Nada de lo que hay aquí se valida por sí solo — el borde que valida es
 * Pydantic, del otro lado. Estos tipos sirven para que el ERP se equivoque al
 * compilar en vez de en producción, que es la mitad del problema; la otra
 * mitad, un campo que el servicio renombró, la atrapa `client.ts` al leer.
 */

/* ------------------------- La taxonomía ------------------------- */

/** Las ocho intenciones. Cerrado a propósito: ver `intents.py`. */
export type Intent =
  | "QUERY"
  | "DIAGNOSIS"
  | "FORECAST"
  | "ANOMALY"
  | "RECOMMENDATION"
  | "OPTIMIZATION"
  | "SIMULATION"
  | "ACTION";

/**
 * El escalón de método, de lo determinista a lo caro.
 *
 * Es la jerarquía que impide que se use ML por tenerlo disponible: un método de
 * nivel 3 solo se elige cuando el 1 y el 2 no pueden contestar la pregunta.
 */
export type Level =
  | "L1_DETERMINISTIC"
  | "L2_STATISTICAL"
  | "L3_MACHINE_LEARNING"
  | "L4_OPTIMIZATION"
  | "L5_SIMULATION"
  | "L6_ERP_ACTION";

export type Horizon = "past" | "now" | "short_term" | "medium_term" | "long_term";

export type Classification = {
  primary_intent: Intent;
  secondary_intents: Intent[];
  business_domain: string[];
  entities: string[];
  time_horizon: Horizon;
  required_data: string[];
  analytical_method: string;
  recommended_model: string | null;
  level: Level;
  requires_ml: boolean;
  requires_erp_action: boolean;
  confidence: number;
  clarification_required: boolean;
  clarification_question: string | null;
  /**
   * ¿Sabe la capa EJECUTAR esto hoy?
   *
   * Distinto de `confidence`, y confundirlos miente en las dos direcciones:
   * entender perfectamente una pregunta de optimización que todavía no se sabe
   * resolver no es baja confianza, es una capacidad que falta.
   */
  supported: boolean;
  unsupported_reason: string | null;
  /** Las señales que dispararon. Se ENSEÑA: una clasificación sin motivo no se
   *  puede discutir, y esta decide si se entrena un modelo o se corre un SELECT. */
  why: string[];
};

/* ------------------------- El catálogo ------------------------- */

export type TaskKind = "forecast" | "regression" | "classification" | "anomaly";

export type SerieView = {
  id: string;
  label: string;
  question: string;
  unit: string;
  grain: "day" | "week" | "month";
  task: "forecast";
  tolerance: number;
  tolerance_kind: "absolute" | "relative";
  min_periods: number;
  por_entidad: boolean;
};

export type TargetView = {
  id: string;
  label: string;
  unit: string;
  task: TaskKind;
  tolerance: number;
  tolerance_kind: "absolute" | "relative";
};

export type SignalView = {
  id: string;
  label: string;
  /** Por qué es legítima. Se muestra al lado de la señal en la pantalla. */
  safe_because: string;
};

export type SujetoView = {
  id: string;
  label: string;
  repeats: boolean;
  targets: TargetView[];
  signals: SignalView[];
};

export type ModuloView = {
  id: string;
  label: string;
  series: SerieView[];
  sujetos: SujetoView[];
};

export type FamiliaView = {
  id: string;
  label: string;
  /** ¿Puede salir del rango histórico? Los árboles no. Ver `registry.py`. */
  extrapola: boolean;
  explicable: boolean;
  minimo: number;
};

export type Catalogo = { modulos: ModuloView[]; familias: FamiliaView[] };

/* ------------------------- Preguntas y entrenamiento ------------------------- */

export type Question = {
  slug: string;
  module: string;
  label: string;
  question: string;
  task: TaskKind;
  subject: string;
  target: string;
  features?: string[];
  horizon?: number;
  grain?: "day" | "week" | "month";
  tolerance: number;
  tolerance_kind?: "absolute" | "relative";
  /** Familia forzada, o ausente para que el AutoML elija. */
  algorithm?: string | null;
};

export type ColumnProfile = {
  name: string;
  dtype: string;
  nulls: number;
  distinct: number;
  is_constant: boolean;
  sample: string[];
};

export type DataProfile = {
  rows: number;
  from_at: string | null;
  to_at: string | null;
  target_distinct: number;
  target_constant: boolean;
  entities: number | null;
  columns: ColumnProfile[];
  /** Lo que hay que decirle al usuario aunque no lo haya pedido. */
  warnings: string[];
};

export type Candidate = {
  algorithm: string;
  label: string;
  params: Record<string, unknown>;
  val_error: number;
  fitted: boolean;
  skipped_reason: string | null;
};

export type Backtest = {
  mae: number;
  baseline_mae: number;
  /** Cuál fue la respuesta ingenua a batir. Se muestra: sin ella la mejora no
   *  se puede interpretar. */
  baseline_name: string;
  improvement_pct: number;
  within_tolerance_pct: number;
  baseline_within_tolerance_pct: number;
  n_train: number;
  n_val: number;
  n_test: number;
  cutoff: string;
  horizon: number;
};

export type Verdict = { approved: boolean; reason: string };

export type TrainResult = {
  slug: string;
  profile: DataProfile;
  winner: Candidate | null;
  leaderboard: Candidate[];
  backtest: Backtest | null;
  verdict: Verdict;
  /** El modelo serializado. Se guarda en el esquema del INQUILINO, no en el
   *  servicio: ver la cabecera de `main.py`. */
  model_blob: string | null;
  trained_up_to: string | null;
  seed: number;
};

/* ------------------------- Pronóstico ------------------------- */

export type ForecastPoint = {
  at: string;
  value: number;
  lower: number;
  upper: number;
};

export type ForecastResult = {
  slug: string;
  subject_key: string | null;
  points: ForecastPoint[];
  /** Lo ya ocurrido, para dibujarlo junto al pronóstico. Sin banda: es un
   *  hecho, no una estimación, y ahí `lower` y `upper` valen lo mismo. */
  history: ForecastPoint[];
  model: string;
  trained_up_to: string | null;
};
