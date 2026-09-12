"use server";

import { auth } from "@/lib/auth";
import { puedeEn } from "@/lib/tenancy/context";
import { revalidateDashboards } from "@/lib/revalidate";
import {
  createQuestion,
  deleteModel,
  deleteQuestion,
  deleteRejectedModels,
  issueForecast,
  promoteModel,
  retireModel,
  trainQuestion,
} from "@/lib/intelligence/questions";

/**
 * Acciones de la capa de inteligencia.
 *
 * Solo administrador, todas. Configurar una pregunta decide con qué números va
 * a trabajar el resto de la empresa, y promover un modelo decide qué cifra
 * aparece en la pantalla de quien compra. No es una restricción de comodidad:
 * es que estas decisiones se toman una vez y las sufre todo el equipo.
 *
 * Cada acción devuelve el motivo cuando falla, nunca un booleano pelado. Un
 * «no se pudo» sin causa sobre un entrenamiento de tres minutos es la peor
 * respuesta posible: no dice si faltan datos, si el servicio está caído o si el
 * modelo no aporta, que son tres cosas con tres remedios distintos.
 */

export type IntelState = { ok: boolean; message?: string; error?: string };

async function soloAdmin(): Promise<string | null> {
  if (!(await puedeEn("analisis", "administrar"))) {
    return "Solo un administrador configura la capa de inteligencia.";
  }
  return null;
}

/**
 * El id del modelo, o `null` si no tiene forma de UUID.
 *
 * Llega de un campo oculto, o sea de fuera. Se pasaba tal cual a un
 * `where id = …` y Postgres contestaba «invalid input syntax for type uuid»: la
 * acción LANZABA y la pantalla recibía un error de servidor, justo lo que la
 * cabecera promete no hacer. Lo encontró `_probe-acciones-inteligencia`.
 */
function idDeModelo(form: FormData): string | null {
  const id = String(form.get("modelId") ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
const SIN_MODELO = "Ese modelo no existe.";

export async function createQuestionAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const session = await auth();
  const num = (k: string, d: number) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) ? v : d;
  };

  // `moduleId` y no `module`: `module` es una variable reservada en el ámbito
  // de un módulo y Next lo rechaza —el bundler la usa para el sistema de
  // módulos de CommonJS y reasignarla rompe la carga en silencio—.
  const moduleId = String(form.get("module") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  const question = String(form.get("question") ?? "").trim();

  if (!moduleId || !subject || !label) {
    return { ok: false, error: "Falta el módulo, la serie o el nombre." };
  }

  const tolerance = num("tolerance", 0);
  if (tolerance <= 0) {
    return {
      ok: false,
      error:
        "El margen tiene que ser mayor que cero: es lo que define qué cuenta " +
        "como acierto, y sin él el veredicto no significa nada.",
    };
  }

  try {
    const r = await createQuestion({
      module: moduleId,
      label,
      question: question || label,
      task: String(form.get("task") ?? "forecast"),
      subject,
      target: String(form.get("target") ?? "value"),
      horizon: Math.max(1, Math.min(12, num("horizon", 1))),
      grain: String(form.get("grain") ?? "month"),
      tolerance,
      toleranceKind: form.get("toleranceKind") === "absolute" ? "absolute" : "relative",
      unit: String(form.get("unit") ?? "").trim().slice(0, 20),
      // Cadena vacía significa AutoML. Se normaliza a `null` aquí y no en la
      // base para que la columna signifique una sola cosa: «lo eligió el
      // usuario» o «lo elige la búsqueda», nunca «cadena vacía».
      algorithm: (String(form.get("algorithm") ?? "").trim() || null),
      createdById: session?.user?.id ?? null,
    });
    if (!r.ok) return { ok: false, error: r.reason };

    await revalidateDashboards();
    return { ok: true, message: "Pregunta creada. Ya puedes entrenarla." };
  } catch (e) {
    console.error("[intelligence] createQuestion falló", e);
    return { ok: false, error: "No se pudo crear la pregunta." };
  }
}

export async function deleteQuestionAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const r = await deleteQuestion(String(form.get("slug") ?? ""));
  if (!r.ok) return { ok: false, error: r.reason };
  await revalidateDashboards();
  return { ok: true, message: "Pregunta borrada." };
}

/**
 * Entrena. Es la acción larga de la aplicación: minutos, no segundos.
 *
 * No se corta ni se manda a una cola por ahora, y es una decisión con fecha de
 * caducidad: con seis series y cinco familias son decenas de segundos y la
 * pantalla lo aguanta con un indicador. El día que una empresa tenga cincuenta
 * preguntas, esto tiene que pasar a un trabajo en segundo plano — y el sitio
 * donde se notará primero es el presupuesto de tiempo de `client.ts`.
 */
export async function trainQuestionAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const session = await auth();
  const slug = String(form.get("slug") ?? "");

  const r = await trainQuestion(slug, session?.user?.id ?? null);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  const v = r.result.verdict;
  return {
    ok: true,
    // El veredicto se devuelve TAL CUAL, aprobado o no. Un entrenamiento
    // rechazado no es un fallo de la acción: es su resultado, y el motivo es la
    // parte útil.
    message: `${v.approved ? "Aprobado" : "Rechazado"} — ${v.reason}`,
  };
}

export async function promoteModelAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const modelId = idDeModelo(form);
  if (!modelId) return { ok: false, error: SIN_MODELO };
  const r = await promoteModel(modelId);
  if (!r.ok) return { ok: false, error: r.reason };

  // Se emite el pronóstico en el acto. Sin esto, promover deja la pantalla
  // anunciando un modelo en producción y ni un número debajo, que se lee como
  // que algo se rompió. Fuera de la promoción a propósito: si emitir falla, el
  // modelo YA está promovido y eso no debe deshacerse.
  const slug = String(form.get("slug") ?? "");
  const f = slug ? await issueForecast(slug) : { ok: false, reason: "sin pregunta" };

  await revalidateDashboards();
  return {
    ok: true,
    message: f.ok
      ? `En producción, con ${f.points ?? 0} periodos pronosticados.`
      : `En producción. El pronóstico no se pudo emitir todavía: ${f.reason}`,
  };
}

export async function retireModelAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const modelId = idDeModelo(form);
  if (!modelId) return { ok: false, error: SIN_MODELO };
  const r = await retireModel(modelId);
  if (!r.ok) return { ok: false, error: r.reason };
  await revalidateDashboards();
  return { ok: true, message: "Retirado. Deja de emitir pronósticos." };
}

/**
 * Borra un entrenamiento.
 *
 * Distinto de `retireModelAction`: aquel apaga un modelo que sirve y deja la
 * fila; esto la quita. El motivo de la negativa —cuando está en producción—
 * viaja tal cual a la pantalla, porque dice qué hacer antes.
 */
export async function deleteModelAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const modelId = idDeModelo(form);
  if (!modelId) return { ok: false, error: SIN_MODELO };
  const r = await deleteModel(modelId);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Entrenamiento borrado." };
}

/** Borra de una vez todos los rechazados de una pregunta. */
export async function cleanRejectedModelsAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const r = await deleteRejectedModels(String(form.get("slug") ?? ""));
  await revalidateDashboards();
  return {
    ok: true,
    message:
      r.borrados === 1
        ? "1 entrenamiento rechazado borrado."
        : `${r.borrados} entrenamientos rechazados borrados.`,
  };
}

export async function issueForecastAction(
  _prev: IntelState,
  form: FormData,
): Promise<IntelState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const periods = Math.max(1, Math.min(24, Number(form.get("periods") ?? 6) || 6));
  const r = await issueForecast(String(form.get("slug") ?? ""), periods);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: `${r.points ?? 0} periodos pronosticados.` };
}
