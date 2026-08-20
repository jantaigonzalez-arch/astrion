"use server";

import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { revalidateDashboards } from "@/lib/revalidate";
import { resetPlacement, setPlacement } from "@/lib/ml/placements";

/**
 * Acciones de la configuración de análisis.
 *
 * Solo administrador, y por el mismo motivo que el laboratorio: colocar un
 * análisis decide qué ve todo el equipo al abrir una pantalla, y apagarlo
 * decide qué DEJA de ver — que es la mitad peligrosa. Nadie debería poder
 * silenciar un aviso de saldo vencido para el resto de la empresa desde su
 * propia sesión.
 */

export type AnalysisState = { ok: boolean; message?: string; error?: string };

export async function togglePlacementAction(
  _prev: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador configura los análisis." };
  }

  const analysis = String(formData.get("analysis") ?? "");
  const screen = String(formData.get("screen") ?? "");
  const active = formData.get("active") === "1";

  try {
    const r = await setPlacement({ analysis, screen, active });
    if (!r.ok) return { ok: false, error: r.reason };

    await revalidateDashboards();
    return {
      ok: true,
      message: active
        ? "Se enseñará en esa pantalla a partir de ahora."
        : "Dejará de enseñarse. Puedes devolverlo a como venía cuando quieras.",
    };
  } catch (e) {
    console.error("[análisis] toggle:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/** Acepta una propuesta del sistema. Queda marcada como tal, no como decisión propia. */
export async function acceptRecommendationAction(
  _prev: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador configura los análisis." };
  }

  try {
    const r = await setPlacement({
      analysis: String(formData.get("analysis") ?? ""),
      screen: String(formData.get("screen") ?? ""),
      active: true,
      // `system` y no `user`: dentro de seis meses, «¿esto lo puse yo o me lo
      // propuso el sistema?» tiene que tener respuesta. Sin la distinción, cada
      // propuesta aceptada se disfraza de decisión propia.
      source: "system",
    });
    if (!r.ok) return { ok: false, error: r.reason };

    await revalidateDashboards();
    return { ok: true, message: "Listo: ya sale en esa pantalla." };
  } catch (e) {
    console.error("[análisis] aceptar recomendación:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}

/** Devuelve un análisis a como venía de fábrica. */
export async function resetPlacementAction(
  _prev: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador configura los análisis." };
  }

  try {
    await resetPlacement(
      String(formData.get("analysis") ?? ""),
      String(formData.get("screen") ?? ""),
    );
    await revalidateDashboards();
    return { ok: true, message: "Restaurado a como viene de fábrica." };
  } catch (e) {
    console.error("[análisis] restaurar:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}
