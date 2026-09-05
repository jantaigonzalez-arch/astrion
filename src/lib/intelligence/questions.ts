import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { DbOrTx } from "@/lib/db";
import { mlForecasts, mlModels, mlTemplates } from "@/lib/db/schema";
import * as intel from "./client";
import type { Question, TrainResult } from "./contracts";

/**
 * Las preguntas configuradas de una empresa, y sus modelos.
 *
 * Este archivo es el lado ERP de la capa: guarda lo que el servicio de
 * inteligencia produce y lo lee para la pantalla. El servicio no persiste nada
 * —ver `client.ts`— así que todo lo que sobrevive a un reinicio pasa por aquí.
 *
 * Dos reglas que gobiernan lo que se escribe:
 *
 * 1 · UN MODELO NO SE PROMUEVE POR DECISIÓN DE UNA PERSONA. Se promueve porque
 *     le ganó a la respuesta ingenua en un backtest temporal. La persona puede
 *     negarse a promoverlo, nunca forzarlo. Es la única defensa contra el sesgo
 *     de haber invertido esfuerzo en construirlo.
 *
 * 2 · REENTRENAR NO PISA. Cada entrenamiento crea una versión nueva, porque hay
 *     pronósticos emitidos apuntando a la anterior y borrarla dejaría huérfano
 *     el historial con el que se mide si el modelo se está degradando.
 */

/* ------------------------- Lectura ------------------------- */

export type QuestionRow = {
  slug: string;
  module: string;
  label: string;
  question: string;
  task: string;
  subject: string;
  target: string;
  horizon: number;
  grain: string;
  tolerance: number;
  toleranceKind: "absolute" | "relative";
  unit: string;
  algorithm: string | null;
  builtin: boolean;
};

export type ModelRow = {
  id: string;
  version: number;
  status: "backtested" | "production" | "retired" | "rejected";
  algorithm: string;
  note: string | null;
  trainedAt: Date;
  trainedUpTo: Date | null;
  beatsBaseline: boolean;
  /** Métricas del backtest. */
  metrics: Record<string, unknown>;
  /** La configuración ganadora y la tabla de la competencia. */
  params: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  hasBlob: boolean;
  forecasts: number;
};

export async function listQuestions(): Promise<QuestionRow[]> {
  const db = await tenantDb();
  const rows = await db.select().from(mlTemplates).orderBy(asc(mlTemplates.module), asc(mlTemplates.createdAt));
  return rows.map(toQuestion);
}

export async function questionBySlug(slug: string): Promise<QuestionRow | null> {
  const db = await tenantDb();
  const [r] = await db.select().from(mlTemplates).where(eq(mlTemplates.slug, slug)).limit(1);
  return r ? toQuestion(r) : null;
}

function toQuestion(r: typeof mlTemplates.$inferSelect): QuestionRow {
  return {
    slug: r.slug,
    module: r.module,
    label: r.label,
    question: r.question,
    task: r.task,
    subject: r.subject,
    target: r.target,
    horizon: r.horizon,
    grain: r.grain,
    tolerance: Number(r.tolerance),
    toleranceKind: r.toleranceKind === "absolute" ? "absolute" : "relative",
    unit: r.unit,
    algorithm: r.algorithm,
    builtin: r.builtin,
  };
}

export async function modelsFor(slug: string): Promise<ModelRow[]> {
  const db = await tenantDb();
  const rows = await db
    .select({
      id: mlModels.id,
      version: mlModels.version,
      status: mlModels.status,
      algorithm: mlModels.algorithm,
      note: mlModels.note,
      trainedAt: mlModels.trainedAt,
      trainedUpTo: mlModels.trainedUpTo,
      beatsBaseline: mlModels.beatsBaseline,
      metrics: mlModels.metrics,
      params: mlModels.params,
      profile: mlModels.dataProfile,
      // Solo si EXISTE, no el contenido: son decenas de kilobytes por fila y la
      // pantalla nunca los necesita. Traerlos para pintar una lista de
      // versiones sería mover megabytes para no usarlos.
      hasBlob: sql<boolean>`${mlModels.modelBlob} is not null`,
      forecasts: sql<number>`(
        select count(*)::int from ${mlForecasts}
         where ${mlForecasts}.model_id = ${mlModels}.id
      )`,
    })
    .from(mlModels)
    .where(eq(mlModels.template, slug))
    .orderBy(desc(mlModels.version));

  return rows.map((r) => ({
    ...r,
    metrics: (r.metrics ?? {}) as Record<string, unknown>,
    params: (r.params ?? {}) as Record<string, unknown>,
    profile: (r.profile ?? null) as Record<string, unknown> | null,
  }));
}

/** El modelo en producción de una pregunta, con su blob. Para pronosticar. */
export async function productionModel(slug: string) {
  const db = await tenantDb();
  const [r] = await db
    .select({
      id: mlModels.id,
      version: mlModels.version,
      algorithm: mlModels.algorithm,
      blob: mlModels.modelBlob,
      metrics: mlModels.metrics,
    })
    .from(mlModels)
    .where(and(eq(mlModels.template, slug), eq(mlModels.status, "production")))
    .limit(1);
  return r ?? null;
}

/* ------------------------- Escritura ------------------------- */

/**
 * Crea una pregunta. El slug se deriva del módulo y del objetivo.
 *
 * Derivado y no libre para que el usuario no tenga que inventar un
 * identificador, y sobre todo para que dos preguntas del mismo módulo sobre lo
 * mismo con distinto horizonte no colisionen — el horizonte entra en el slug
 * porque son dos modelos distintos, no dos nombres del mismo.
 */
export async function createQuestion(input: {
  module: string;
  label: string;
  question: string;
  task: string;
  subject: string;
  target: string;
  horizon: number;
  grain: string;
  tolerance: number;
  toleranceKind: "absolute" | "relative";
  unit: string;
  algorithm: string | null;
  createdById: string | null;
}): Promise<{ ok: true; slug: string } | { ok: false; reason: string }> {
  const db = await tenantDb();
  const slug = `${input.module}.${input.subject}.h${input.horizon}`
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");

  const [existe] = await db
    .select({ slug: mlTemplates.slug })
    .from(mlTemplates)
    .where(eq(mlTemplates.slug, slug))
    .limit(1);
  if (existe) {
    return {
      ok: false,
      reason:
        `Ya existe una pregunta sobre eso con horizonte ${input.horizon}. ` +
        `Cámbiale el horizonte o edita la que ya está.`,
    };
  }

  await db.insert(mlTemplates).values({
    slug,
    module: input.module,
    label: input.label,
    question: input.question,
    task: input.task,
    subject: input.subject,
    target: input.target,
    features: [],
    horizon: input.horizon,
    grain: input.grain,
    tolerance: String(input.tolerance),
    toleranceKind: input.toleranceKind,
    unit: input.unit,
    algorithm: input.algorithm,
    builtin: false,
    createdById: input.createdById,
  });

  return { ok: true, slug };
}

export async function deleteQuestion(
  slug: string,
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();
  const [conModelos] = await db
    .select({ id: mlModels.id })
    .from(mlModels)
    .where(eq(mlModels.template, slug))
    .limit(1);

  if (conModelos) {
    return {
      ok: false,
      reason:
        "Esta pregunta ya tiene modelos entrenados, y sus pronósticos son el " +
        "único registro de qué se prometió y qué pasó. Borrarla dejaría esas " +
        "filas apuntando a algo que ya nadie puede explicar.",
    };
  }

  await db.delete(mlTemplates).where(eq(mlTemplates.slug, slug));
  return { ok: true };
}

/**
 * Entrena una pregunta y GUARDA el resultado, gane o pierda.
 *
 * Los rechazos se guardan igual que los aprobados. Saber que sobre los datos de
 * esta empresa una pregunta no se puede responder es información valiosa: evita
 * que alguien lo reintente en seis meses y, cuando el histórico crezca, permite
 * comparar contra el intento anterior.
 */
export async function trainQuestion(
  slug: string,
  trainedById: string | null,
): Promise<{ ok: true; result: TrainResult; modelId: string } | { ok: false; reason: string }> {
  const q = await questionBySlug(slug);
  if (!q) return { ok: false, reason: "Esa pregunta no existe." };

  const payload: Question = {
    slug: q.slug,
    module: q.module,
    label: q.label,
    question: q.question,
    task: q.task as Question["task"],
    subject: q.subject,
    target: q.target,
    horizon: q.horizon,
    grain: q.grain as Question["grain"],
    tolerance: q.tolerance,
    tolerance_kind: q.toleranceKind,
    algorithm: q.algorithm,
  };

  const r = await intel.entrenar(payload);
  if (!r.ok) return { ok: false, reason: r.reason };
  const res = r.value;

  const db = await tenantDb();

  const saved = await db.transaction(async (tx) => {
    // Leer el máximo y escribir máximo+1 en dos pasos es una carrera: dos
    // administradores entrenando la misma pregunta a la vez leen el mismo
    // número y el segundo INSERT muere contra el índice único. El lock es de
    // transacción y va sembrado con `current_schema()` para que dos EMPRESAS
    // entrenando la misma pregunta no se esperen entre sí.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(current_schema() || ':intel:' || ${slug}))`,
    );

    const [prev] = await tx
      .select({ v: mlModels.version })
      .from(mlModels)
      .where(eq(mlModels.template, slug))
      .orderBy(desc(mlModels.version))
      .limit(1);

    const [row] = await tx
      .insert(mlModels)
      .values({
        template: slug,
        version: (prev?.v ?? 0) + 1,
        status: res.verdict.approved ? "backtested" : "rejected",
        algorithm: res.winner?.algorithm ?? "ninguno",
        // La configuración ganadora, legible. El blob va aparte.
        params: {
          winner: res.winner ?? null,
          leaderboard: res.leaderboard,
          seed: res.seed,
        } as Record<string, unknown>,
        metrics: (res.backtest ?? {}) as unknown as Record<string, unknown>,
        beatsBaseline: (res.backtest?.improvement_pct ?? 0) >= 5,
        trainedUpTo: res.trained_up_to ? new Date(res.trained_up_to) : null,
        trainedById,
        note: res.verdict.reason,
        modelBlob: res.model_blob,
        dataProfile: res.profile as unknown as Record<string, unknown>,
      })
      .returning({ id: mlModels.id });

    return row;
  });

  return { ok: true, result: res, modelId: saved.id };
}

/**
 * Pone un modelo a servir.
 *
 * Retira al anterior de la misma pregunta EN LA MISMA transacción: si dos
 * quedaran en producción a la vez, los pronósticos saldrían de uno u otro según
 * el orden de la consulta y nadie podría explicar de dónde salió un número.
 */
export async function promoteModel(
  modelId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();
  const [m] = await db
    .select({
      id: mlModels.id,
      template: mlModels.template,
      status: mlModels.status,
      note: mlModels.note,
      blob: sql<boolean>`${mlModels.modelBlob} is not null`,
    })
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!m) return { ok: false, reason: "Ese modelo no existe." };

  // La compuerta. Ver la regla 1 de la cabecera.
  if (m.status === "rejected") {
    return {
      ok: false,
      reason:
        "Este modelo quedó rechazado en su evaluación, así que no puede " +
        "promoverse. No es una restricción de permisos: es que no aporta. " +
        (m.note ?? ""),
    };
  }
  if (!m.blob) {
    return {
      ok: false,
      reason:
        "Este modelo no tiene artefacto guardado, así que no podría emitir un " +
        "pronóstico aunque se promoviera. Vuelve a entrenar.",
    };
  }
  if (m.status === "production") return { ok: true };

  await db.transaction(async (tx) => {
    await tx
      .update(mlModels)
      .set({ status: "retired", retiredAt: new Date() })
      .where(and(eq(mlModels.template, m.template), eq(mlModels.status, "production")));
    await tx
      .update(mlModels)
      .set({ status: "production", promotedAt: new Date() })
      .where(eq(mlModels.id, modelId));
  });

  return { ok: true };
}

export async function retireModel(modelId: string): Promise<{ ok: boolean }> {
  const db = await tenantDb();
  await db
    .update(mlModels)
    .set({ status: "retired", retiredAt: new Date() })
    .where(eq(mlModels.id, modelId));
  return { ok: true };
}

/**
 * BORRA UN ENTRENAMIENTO. Retirar y borrar no son lo mismo.
 *
 * Retirar apaga un modelo que está sirviendo y deja la fila: es un cambio de
 * estado, reversible, y el registro de que ese modelo existió sigue ahí. Borrar
 * lo quita del todo.
 *
 * Hacía falta porque entrenar es barato y rechazar es lo normal: se prueba, sale
 * rechazado, se ajusta, se vuelve a probar. Sin esto la lista de versiones de una
 * pregunta crecía para siempre con intentos que ya no le dicen nada a nadie, y no
 * había ninguna forma de limpiarla salvo borrar la pregunta entera.
 *
 * ── LO QUE ESTÁ SIRVIENDO NO SE BORRA ─────────────────────────────────────
 *
 * Se rechaza con un motivo en vez de borrarlo y ya. Borrar el modelo en
 * producción se lleva por delante sus pronósticos —la clave foránea es
 * `on delete cascade`— y deja la pregunta anunciando números que nadie puede
 * volver a calcular. Quien de verdad quiera quitarlo lo retira primero, que es
 * un paso deliberado y reversible.
 *
 * ── LOS PRONÓSTICOS SE VAN CON ÉL, Y ESO ES CORRECTO ──────────────────────
 *
 * Un pronóstico sin el modelo que lo emitió no se puede explicar ni reproducir:
 * conservarlo sería guardar un número sin autor. La cascada ya estaba declarada
 * en el esquema; esto solo la usa.
 *
 * ── LA CONEXIÓN ENTRA POR PARÁMETRO PARA PODER PROBARLO ───────────────────
 *
 * `tenantDb()` lee la sesión de la petición y fuera de Next no existe, así que
 * una función que solo sabe llamarla no se puede ejercitar contra la base. Es el
 * mismo par que `payablesSummaryFrom` y por el mismo motivo: esto borra filas, y
 * lo que borra hay que poder comprobarlo corriéndolo, no leyéndolo.
 */
export async function deleteModel(
  modelId: string,
  conexion?: DbOrTx,
): Promise<{ ok: boolean; reason?: string }> {
  const db = conexion ?? (await tenantDb());
  const [m] = await db
    .select({ status: mlModels.status, version: mlModels.version })
    .from(mlModels)
    .where(eq(mlModels.id, modelId))
    .limit(1);

  if (!m) return { ok: false, reason: "Ese entrenamiento ya no existe." };
  if (m.status === "production") {
    return {
      ok: false,
      reason:
        "Está sirviendo. Retíralo primero: borrarlo se llevaría sus pronósticos " +
        "y la pregunta se quedaría sin nada que responder.",
    };
  }

  await db.delete(mlModels).where(eq(mlModels.id, modelId));
  return { ok: true };
}

/**
 * Borra DE UNA VEZ todos los entrenamientos rechazados de una pregunta.
 *
 * Es el mismo borrado de arriba, en lote, y existe porque el desperdicio se
 * produce en lote: nadie acumula un rechazado, se acumulan seis seguidos
 * afinando la misma pregunta. Quitarlos de uno en uno es exactamente la molestia
 * que hace que nadie los quite.
 *
 * Solo toca los rechazados. Un modelo retirado fue bueno en su momento y su
 * versión puede ser la explicación de un número que alguien archivó; uno
 * rechazado no llegó a emitir nada por definición.
 */
export async function deleteRejectedModels(
  slug: string,
  conexion?: DbOrTx,
): Promise<{ ok: boolean; borrados: number }> {
  const db = conexion ?? (await tenantDb());
  const borradas = await db
    .delete(mlModels)
    .where(and(eq(mlModels.template, slug), eq(mlModels.status, "rejected")))
    .returning({ id: mlModels.id });
  return { ok: true, borrados: borradas.length };
}

/**
 * Emite el pronóstico del modelo en producción y lo GUARDA.
 *
 * Se guarda en vez de calcularse al pintar la pantalla, y es la misma regla que
 * ya rige la capa de Análisis: una pantalla que depende de un cálculo hereda su
 * latencia y su fallo, y devuelve un número distinto en cada recarga — con lo
 * que deja de ser auditable. Aquí además importa más: sin la fila escrita no se
 * puede comparar lo que se dijo con lo que pasó, y sin esa comparación no hay
 * forma de saber si el modelo se está degradando.
 */
export async function issueForecast(
  slug: string,
  periods = 6,
): Promise<{ ok: boolean; reason?: string; points?: number }> {
  const m = await productionModel(slug);
  if (!m?.blob) {
    return { ok: false, reason: "No hay modelo en producción para esta pregunta." };
  }

  const q = await questionBySlug(slug);
  if (!q) return { ok: false, reason: "Esa pregunta no existe." };

  const mae = Number((m.metrics as { mae?: number } | null)?.mae ?? 0);
  const r = await intel.pronosticar({
    serieId: q.subject,
    modelBlob: m.blob,
    periods,
    mae,
  });
  if (!r.ok) return { ok: false, reason: r.reason };

  const db = await tenantDb();

  /*
    La COLA OBSERVADA se guarda con el modelo, no se recalcula al pintar.

    El bloque de análisis que sale en la pantalla de trabajo necesita la historia
    para dibujar la frontera entre lo que se sabe y lo que se estima. Pedirla en
    ese momento significaría cruzar la red al servicio de Python para pintar la
    cola de tickets, y la regla de la capa de análisis es justo la contraria: se
    lee lo ya escrito.

    Va dentro de `data_profile` y no en columna propia porque es exactamente eso
    —el perfil de los datos de ESTE modelo— y porque así viaja y caduca con él:
    cuando se promueve otra versión, su cola es la que vale.
  */
  const cola = r.value.history.map((h) => ({ at: h.at, value: h.value }));
  if (cola.length > 0) {
    await db.execute(sql`
      update ml_models
         set data_profile = coalesce(data_profile, '{}'::jsonb)
                            || jsonb_build_object('tail', ${JSON.stringify(cola)}::jsonb)
       where id = ${m.id}
    `);
  }
  const filas = r.value.points.map((p) => ({
    modelId: m.id,
    period: p.at,
    value: p.value.toFixed(2),
    lower: p.lower.toFixed(2),
    upper: p.upper.toFixed(2),
  }));

  if (filas.length === 0) return { ok: true, points: 0 };

  // `onConflictDoUpdate` y no `doNothing`: reemitir el pronóstico del mismo
  // periodo con el mismo modelo es reemplazar una estimación por otra mejor
  // informada, no duplicarla. Lo que NO se toca es `issued_at` de versiones
  // anteriores: eso vive en otras filas, con otro `model_id`.
  await db
    .insert(mlForecasts)
    .values(filas)
    .onConflictDoUpdate({
      target: [mlForecasts.modelId, mlForecasts.period, mlForecasts.subjectKey],
      set: {
        value: sql`excluded.value`,
        lower: sql`excluded.lower`,
        upper: sql`excluded.upper`,
        issuedAt: sql`now()`,
      },
    });

  await settleForecasts(slug);
  return { ok: true, points: filas.length };
}

/**
 * Escribe QUÉ PASÓ DE VERDAD en los periodos que ya cerraron.
 *
 * Es lo que cierra el lazo, y hasta aquí no lo hacía nadie: la columna `actual`
 * existía desde el primer día y llegaba siempre vacía. Un sistema que promete y
 * nunca comprueba no es un sistema de pronóstico, es un generador de cifras — y
 * lo peor es que se ve idéntico a uno bueno hasta que alguien pregunta si acierta.
 *
 * El valor observado sale de la COLA que devuelve el perfilado, que ya lee la
 * serie completa: no hay una segunda consulta ni una segunda definición de lo
 * que significa «lo que se facturó ese mes». Que la verdad y la promesa salgan
 * de la misma consulta es lo que hace comparable la comparación.
 *
 * Se liquida al REEMITIR, y eso tiene una consecuencia honesta: un pronóstico
 * que nadie recalcula nunca se liquida. Es aceptable mientras recalcular sea un
 * botón —el mismo que se pulsa para refrescar el número—, y el día que esto
 * corra solo, aquí es donde se engancha.
 *
 * Nunca sobrescribe un desenlace ya escrito: `actual is null` en el `where`. Una
 * predicción es un hecho de su momento y su resultado también; reescribirlo
 * borraría la única evidencia de si el modelo se está degradando.
 */
export async function settleForecasts(slug: string): Promise<number> {
  const q = await questionBySlug(slug);
  if (!q) return 0;

  const perfil = await intel.perfilar(q.subject);
  if (!perfil.ok || perfil.value.tail.length === 0) return 0;

  const db = await tenantDb();
  let escritos = 0;

  for (const observado of perfil.value.tail) {
    const r = await db.execute(sql`
      update ml_forecasts f
         set actual = ${observado.value}, settled_at = now()
        from ml_models m
       where m.id = f.model_id
         and m.template = ${slug}
         and f.period = ${observado.at}::date
         and f.actual is null
    `);
    escritos += (r as unknown as { count?: number }).count ?? 0;
  }

  return escritos;
}

/** Lo pronosticado por el modelo en producción, para la pantalla. */
export async function forecastFor(slug: string) {
  const db = await tenantDb();
  const rows = await db
    .select({
      period: mlForecasts.period,
      value: mlForecasts.value,
      lower: mlForecasts.lower,
      upper: mlForecasts.upper,
      actual: mlForecasts.actual,
      issuedAt: mlForecasts.issuedAt,
    })
    .from(mlForecasts)
    .innerJoin(mlModels, eq(mlModels.id, mlForecasts.modelId))
    .where(and(eq(mlModels.template, slug), eq(mlModels.status, "production")))
    .orderBy(asc(mlForecasts.period));

  return rows.map((r) => ({
    period: r.period,
    value: Number(r.value),
    lower: r.lower === null ? null : Number(r.lower),
    upper: r.upper === null ? null : Number(r.upper),
    actual: r.actual === null ? null : Number(r.actual),
    issuedAt: r.issuedAt.toISOString(),
  }));
}
