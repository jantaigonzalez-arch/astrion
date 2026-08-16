"use server";

import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import {
  trainTemplate,
  promoteModel,
  retireModel,
  createTemplate,
  deleteTemplate,
  mlTag,
} from "@/lib/ml/lab";
import { backfillOpenPredictions } from "@/lib/ml/serve";
import { revalidateTenant } from "@/lib/revalidate";
import { updateTag } from "next/cache";
import { currentRole, requireTenant } from "@/lib/tenancy/context";

/**
 * Acciones del laboratorio.
 *
 * Solo administrador: entrenar recorre el histórico completo de la empresa, y
 * promover decide qué número se le va a mostrar a todo el equipo como si fuera
 * cierto. Ninguna de las dos es una operación de trabajo diario.
 */

export type MlState = { ok: boolean; message?: string; error?: string };

/**
 * Refresca la pantalla Y la caché de suficiencia (ver `cachedReadiness`).
 *
 * Se usa en las acciones que pueden cambiar lo que el laboratorio cuenta: alta
 * y baja de plantillas —una plantilla nueva pregunta otra cosa, y un slug
 * reutilizado apuntaría a la entrada vieja— y entrenamiento, donde el
 * administrador acaba de esperar una operación cara y merece ver números
 * frescos y no los de hace un rato.
 */
async function refreshLab() {
  const ctx = await requireTenant();
  updateTag(mlTag(ctx.schemaName));
  revalidateTenant();
}

export async function trainAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  const session = await auth();
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador entrena modelos." };
  }

  const templateId = String(formData.get("template") ?? "");
  try {
    const r = await trainTemplate(templateId, session!.user.id);
    await refreshLab();

    if (!r.ok) return { ok: false, error: r.reason };

    // Un modelo rechazado NO es un error de la operación: es el laboratorio
    // haciendo su trabajo. Se informa como resultado, no como fallo, porque
    // saber que algo no funciona con estos datos es en sí una respuesta.
    return {
      ok: true,
      message: r.approved
        ? `Modelo entrenado y aprobado. ${r.reason}`
        : `Modelo entrenado y RECHAZADO. ${r.reason}`,
    };
  } catch (e) {
    console.error("[ml] train error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

export async function promoteAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador promueve modelos." };
  }

  try {
    const r = await promoteModel(String(formData.get("modelId") ?? ""), {
      reason: String(formData.get("reason") ?? ""),
    });
    revalidateTenant();
    return r.ok
      ? {
          ok: true,
          // Dice lo que de verdad va a pasar y CUÁNDO. La versión anterior
          // —"ya emite predicciones"— era falsa dos veces: no había nada que
          // emitiera predicciones, y aunque lo hubiera, no se emiten al
          // promover sino cuando entra el próximo ticket.
          message:
            "Modelo en producción. Va a predecir sobre los tickets que entren " +
            "a partir de ahora; los que ya existen no se tocan.",
        }
      : { ok: false, error: r.reason };
  } catch (e) {
    console.error("[ml] promote error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

export async function retireAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador retira modelos." };
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) {
    // El motivo es obligatorio: dentro de un año, "por qué dejamos de usar
    // esto" es la única pregunta que va a importar.
    return { ok: false, error: "Escribe por qué lo retiras. Queda en el historial." };
  }

  try {
    await retireModel(String(formData.get("modelId") ?? ""), note);
    revalidateTenant();
    return { ok: true, message: "Modelo retirado. Deja de emitir predicciones." };
  } catch (e) {
    console.error("[ml] retire error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/* ------------------------- Crear y borrar preguntas ------------------------- */

/**
 * Da de alta una pregunta desde el constructor.
 *
 * No valida nada aquí a propósito: la validación contra el catálogo de bloques
 * vive en `createTemplate`, que es la frontera real del módulo. Duplicarla en
 * la acción crearía dos criterios que se desincronizan, y el que importa es el
 * que está pegado al SQL.
 */
export async function createTemplateAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  const session = await auth();
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador crea preguntas." };
  }

  try {
    const r = await createTemplate(
      {
        label: String(formData.get("label") ?? ""),
        subject: String(formData.get("subject") ?? ""),
        target: String(formData.get("target") ?? ""),
        features: formData.getAll("features").map(String),
        tolerance: Number(formData.get("tolerance") ?? 0),
      },
      session!.user.id,
    );
    await refreshLab();

    if (!r.ok) return { ok: false, error: r.reason };
    return {
      ok: true,
      message:
        "Pregunta creada. Todavía no hay modelo: pulsa «Entrenar» para " +
        "averiguar si se puede responder con tus datos.",
    };
  } catch (e) {
    console.error("[ml] create template error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

export async function deleteTemplateAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador borra preguntas." };
  }

  try {
    const r = await deleteTemplate(String(formData.get("template") ?? ""));
    await refreshLab();
    return r.ok
      ? { ok: true, message: "Pregunta borrada." }
      : { ok: false, error: r.reason };
  } catch (e) {
    console.error("[ml] delete template error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/**
 * Genera las estimaciones que faltan sobre los servicios todavía abiertos.
 *
 * Es la acción de arranque de la capa de análisis: sin ella, el día que se
 * promueve el primer modelo las pantallas de trabajo siguen mudas hasta que
 * entre un ticket nuevo. Solo toca sujetos abiertos — ver
 * `backfillOpenPredictions` para por qué eso es lo que la hace honesta.
 */
export async function backfillAction(
  _prev: MlState,
  formData: FormData,
): Promise<MlState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador genera estimaciones." };
  }

  try {
    const r = await backfillOpenPredictions(String(formData.get("template") ?? ""));
    revalidateTenant();

    if (!r.ok) return { ok: false, error: r.reason };
    return {
      ok: true,
      message:
        r.issued === 0
          ? "Todos los servicios abiertos ya tenían estimación."
          : `${r.issued} servicios abiertos ya tienen estimación. ` +
            "Aparece en el detalle del ticket y en el análisis de la cola.",
    };
  } catch (e) {
    console.error("[ml] backfill error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}
