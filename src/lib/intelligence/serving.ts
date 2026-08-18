import "server-only";
import { asc, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import { mlForecasts } from "@/lib/db/schema";

/**
 * LA FRONTERA entre Inteligencia y Análisis.
 *
 * ── LAS DOS CAPAS ──────────────────────────────────────────────────────────
 *
 *   INTELIGENCIA produce.   Clasifica la intención, busca el modelo, lo mide
 *                           contra el futuro y emite el pronóstico. Vive en
 *                           `lib/intelligence/*` y en el servicio de Python.
 *
 *   ANÁLISIS sirve.         Coloca lo producido donde alguien decide, con la
 *                           certeza que le corresponde. Vive en `lib/ml/
 *                           analyses.ts`, `placements.ts` e `insights.ts`.
 *
 * Este archivo es lo único que las une, y existe para que la unión sea un
 * contrato y no un conjunto de consultas repartidas. Antes, `published.ts`
 * entraba directo a las tablas de modelos y armaba bloques; funcionaba, y dejaba
 * la relación implícita — cada vez que hiciera falta un dato nuevo del modelo,
 * otra consulta más metida en otro sitio.
 *
 * ── LO QUE HACE A UNA CAPA «QUE SIRVE» Y NO «QUE MUESTRA» ──────────────────
 *
 * Tres cosas, y las tres estaban a medias:
 *
 *  1 · SIRVE EN TODOS LOS ESTADOS, no solo cuando hay respuesta. Una pregunta
 *      recién creada, una que no alcanza datos y una rechazada también tienen
 *      algo que decir, y lo que dicen es útil: «esto que pediste todavía no se
 *      puede contestar, y faltan ocho meses de historia». Callar hasta tener un
 *      número convierte la capa en un adorno que aparece de vez en cuando.
 *
 *  2 · SABE SI LO QUE SIRVE SIGUE VIGENTE. Un pronóstico emitido en marzo sobre
 *      abril es basura en junio, y hasta ahora nada lo comprobaba: la pantalla
 *      habría enseñado con la misma cara un número de la semana pasada y uno de
 *      hace un año.
 *
 *  3 · CIERRA EL LAZO. `ml_forecasts.actual` existía desde el primer día y no lo
 *      llenaba nadie. Un sistema que promete y nunca comprueba no es un sistema
 *      de pronóstico: es un generador de cifras. Ver `settled` y la liquidación
 *      en `questions.ts`.
 *
 * ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
 *
 * No dibuja, no decide dónde va nada y no habla con el servicio de Python.
 * Lee del esquema de la empresa y devuelve hechos. Quien los convierte en
 * bloques es `published.ts`; quien decide en qué pantalla salen, `placements`.
 */

/* ------------------------- El estado de una pregunta ------------------------- */

/**
 * En qué punto está una pregunta configurada.
 *
 * El orden de la unión no es casual: va de «no hay nada» a «hay algo y sirve», y
 * cada estado tiene un remedio distinto. Distinguirlos es la mitad del valor —
 * «no se puede contestar» y «todavía no se ha intentado» piden cosas opuestas
 * de quien lee.
 */
export type EstadoPregunta =
  /** Creada y nunca entrenada. El remedio es entrenar. */
  | "sin-entrenar"
  /**
   * Se intentó y no se pudo NI EVALUAR: falta historia, o el valor es
   * constante. El remedio es esperar o arreglar la captura, nunca otro modelo.
   */
  | "sin-datos"
  /**
   * Se evaluó y el modelo NO aporta sobre la respuesta ingenua. El remedio es
   * distinto: probar otras señales, otro horizonte, u otra pregunta.
   */
  | "no-responde"
  /** Aprobada y sin promover. Espera una decisión, no más trabajo. */
  | "lista"
  /** En producción con pronóstico vigente. */
  | "sirviendo"
  /**
   * En producción y el pronóstico ya caducó: su primer periodo quedó atrás.
   * El remedio es recalcular, y decirlo importa más que el número viejo.
   */
  | "vencido";

export type PuntoServido = {
  period: string;
  value: number;
  lower: number | null;
  upper: number | null;
  /** Lo que pasó de verdad. Nulo mientras el periodo no cierre. */
  actual: number | null;
};

export type PreguntaServida = {
  slug: string;
  module: string;
  label: string;
  question: string;
  unit: string;
  horizon: number;
  tolerance: number;
  toleranceKind: "absolute" | "relative";

  estado: EstadoPregunta;
  /** La frase que explica el estado, en el lenguaje del negocio. */
  porque: string;

  /** El modelo del que se está hablando: el de producción, o el último. */
  model: { id: string; version: number; algorithm: string } | null;
  metrics: {
    mae?: number;
    baseline_mae?: number;
    baseline_name?: string;
    improvement_pct?: number;
    within_tolerance_pct?: number;
    baseline_within_tolerance_pct?: number;
    n_train?: number;
  } | null;
  /** Periodos de historia con los que se entrenó, y cuántos hacían falta. */
  historia: { periodos: number; avisos: string[] } | null;

  /** El pronóstico vigente. Vacío en todos los estados menos los dos últimos. */
  puntos: PuntoServido[];
  /** Los últimos periodos observados, para dibujar la frontera. */
  cola: Array<{ at: string; value: number }>;
  /** Cuándo se emitió. Es lo que permite saber si sigue vigente. */
  emitido: Date | null;

  /**
   * Los periodos ya liquidados: qué se estimó y qué llegó.
   *
   * Es la única evidencia de si el modelo cumple. Sin esto, la capa promete
   * indefinidamente y nadie puede decir si acierta.
   */
  cumplimiento: { medidos: number; dentro: number } | null;
};

/* ------------------------- La lectura ------------------------- */

type FilaModelo = {
  slug: string;
  module: string;
  label: string;
  question: string;
  unit: string;
  horizon: number;
  tolerance: string;
  toleranceKind: string;
  modelId: string | null;
  version: number | null;
  status: string | null;
  algorithm: string | null;
  note: string | null;
  metrics: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
};

/**
 * Todas las preguntas de la empresa, con su estado y lo que sirven.
 *
 * Una consulta para las preguntas y su modelo relevante, y una segunda para los
 * pronósticos de todas juntas. Dos y no dos por pregunta: esto se llama al
 * resolver CADA pantalla que admite análisis, así que un N+1 aquí se paga en
 * todas las pantallas del sistema.
 */
export async function servedQuestions(conexion?: DbOrTx): Promise<PreguntaServida[]> {
  const db = conexion ?? (await tenantDb());

  /*
    El modelo RELEVANTE de cada pregunta: el que está en producción y, si no
    hay, el último entrenado.

    Un `left join lateral` con `limit 1` lo resuelve en una pasada, y el `left`
    importa: una pregunta SIN modelo tiene que salir igual —es el estado
    «sin entrenar», que ahora también se publica—. Con un join normal
    desaparecería justo la pregunta recién creada, que es la que el usuario
    acaba de configurar y espera ver.

    La alternativa —traer todas las versiones y elegir en JavaScript— movería
    el historial completo de cada pregunta para quedarse con una fila de cada.
  */
  const filas = (await db.execute(sql`
    select t.slug, t.module, t.label, t.question, t.unit, t.horizon,
           t.tolerance, t.tolerance_kind as "toleranceKind",
           m.id as "modelId", m.version, m.status::text as status,
           m.algorithm, m.note, m.metrics, m.data_profile as profile
      from ml_templates t
      left join lateral (
        select * from ml_models mm
         where mm.template = t.slug
         order by (mm.status = 'production') desc, mm.version desc
         limit 1
      ) m on true
     order by t.module, t.label
  `)) as unknown as FilaModelo[];

  if (filas.length === 0) return [];

  const conModelo = filas.filter((f) => f.modelId !== null);
  const puntosPorModelo = new Map<string, PuntoServido[]>();
  const emitidoPorModelo = new Map<string, Date>();

  if (conModelo.length > 0) {
    const rows = await db
      .select({
        modelId: mlForecasts.modelId,
        period: mlForecasts.period,
        value: mlForecasts.value,
        lower: mlForecasts.lower,
        upper: mlForecasts.upper,
        actual: mlForecasts.actual,
        issuedAt: mlForecasts.issuedAt,
      })
      .from(mlForecasts)
      .where(
        sql`${mlForecasts.modelId} in ${sql.raw(
          `(${conModelo.map((f) => `'${f.modelId}'`).join(",")})`,
        )}`,
      )
      .orderBy(asc(mlForecasts.period));

    for (const r of rows) {
      const lista = puntosPorModelo.get(r.modelId) ?? [];
      lista.push({
        period: r.period,
        value: Number(r.value),
        lower: r.lower === null ? null : Number(r.lower),
        upper: r.upper === null ? null : Number(r.upper),
        actual: r.actual === null ? null : Number(r.actual),
      });
      puntosPorModelo.set(r.modelId, lista);
      const prev = emitidoPorModelo.get(r.modelId);
      if (!prev || r.issuedAt > prev) emitidoPorModelo.set(r.modelId, r.issuedAt);
    }
  }

  const inicioDelMes = primerDiaDelMes(new Date());

  return filas.map((f) => {
    const puntos = f.modelId ? (puntosPorModelo.get(f.modelId) ?? []) : [];
    const emitido = f.modelId ? (emitidoPorModelo.get(f.modelId) ?? null) : null;
    const metrics = (f.metrics ?? {}) as PreguntaServida["metrics"];
    const profile = (f.profile ?? {}) as {
      rows?: number;
      warnings?: string[];
      tail?: Array<{ at: string; value: number }>;
    };

    const { estado, porque } = estadoDe(f, puntos, inicioDelMes, metrics);

    // Cumplimiento: de los periodos ya liquidados, cuántos cayeron dentro del
    // margen que la propia pregunta declaró.
    const liquidados = puntos.filter((p) => p.actual !== null);
    const tol = Number(f.tolerance);
    const dentro = liquidados.filter((p) =>
      f.toleranceKind === "relative"
        ? Math.abs(p.value - p.actual!) <= Math.abs(p.actual!) * (tol / 100)
        : Math.abs(p.value - p.actual!) <= tol,
    ).length;

    return {
      slug: f.slug,
      module: f.module,
      label: f.label,
      question: f.question,
      unit: f.unit,
      horizon: f.horizon,
      tolerance: tol,
      toleranceKind: f.toleranceKind === "absolute" ? "absolute" : "relative",
      estado,
      porque,
      model: f.modelId
        ? { id: f.modelId, version: f.version ?? 0, algorithm: f.algorithm ?? "" }
        : null,
      metrics: f.modelId ? metrics : null,
      historia: f.modelId
        ? { periodos: Number(profile.rows ?? 0), avisos: profile.warnings ?? [] }
        : null,
      puntos,
      cola: profile.tail ?? [],
      emitido,
      cumplimiento:
        liquidados.length > 0 ? { medidos: liquidados.length, dentro } : null,
    };
  });
}

/**
 * De qué estado es una pregunta, y por qué.
 *
 * La distinción entre «sin-datos» y «no-responde» sale de una señal ESTRUCTURAL
 * y no de leer la prosa del veredicto: cuando el histórico no alcanza para
 * partirlo en tres, el servicio devuelve el resultado SIN backtest, así que
 * `metrics` llega vacío. Con backtest y rechazo, el modelo sí compitió y perdió.
 * Interpretar el texto del motivo habría funcionado hasta el día que alguien lo
 * reescriba.
 */
function estadoDe(
  f: FilaModelo,
  puntos: PuntoServido[],
  inicioDelMes: string,
  metrics: PreguntaServida["metrics"],
): { estado: EstadoPregunta; porque: string } {
  if (!f.modelId) {
    return {
      estado: "sin-entrenar",
      porque:
        "Está configurada y todavía no se ha entrenado. Hasta que se entrene y " +
        "se apruebe, aquí no va a aparecer ningún número.",
    };
  }

  const evaluado = metrics !== null && metrics.mae !== undefined;

  if (f.status === "rejected") {
    return evaluado
      ? {
          estado: "no-responde",
          porque:
            f.note ??
            "Se entrenó y el modelo no le gana a la respuesta ingenua, así que " +
              "no se promueve.",
        }
      : {
          estado: "sin-datos",
          porque:
            f.note ??
            "No hay suficiente historia para evaluarla. No es un problema del " +
              "modelo: es que todavía no hay con qué medirlo.",
        };
  }

  if (f.status !== "production") {
    return {
      estado: "lista",
      porque:
        "Se entrenó, se aprobó y espera a que alguien la ponga a servir. " +
        "Mientras tanto no publica ningún número.",
    };
  }

  if (puntos.length === 0) {
    return {
      estado: "vencido",
      porque:
        "Está sirviendo y no tiene pronóstico emitido. Recalcúlalo desde la " +
        "pantalla de inteligencia.",
    };
  }

  // Vigente = su primer periodo es este mes o posterior. Si el primero ya
  // quedó atrás, lo que se está enseñando es el pronóstico de un mes que ya
  // ocurrió, y eso no se puede presentar como si fuera del que viene.
  const primero = puntos[0].period;
  if (primero < inicioDelMes) {
    return {
      estado: "vencido",
      porque:
        `El pronóstico se emitió para ${primero.slice(0, 7)} y ese periodo ya ` +
        `pasó. Recalcúlalo para que vuelva a hablar del futuro.`,
    };
  }

  return { estado: "sirviendo", porque: f.note ?? "" };
}

function primerDiaDelMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** ¿Este estado tiene un número que enseñar? Ver `published.ts`. */
export function tieneCifra(e: EstadoPregunta): boolean {
  return e === "sirviendo" || e === "vencido";
}
