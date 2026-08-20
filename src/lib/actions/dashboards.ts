"use server";

import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { revalidateDashboards } from "@/lib/revalidate";
import {
  addToDashboard,
  publishDashboard,
  renameDashboard,
  reorderDashboard,
  unpublishDashboard,
} from "@/lib/ml/dashboards";

/**
 * Acciones del compositor de dashboards.
 *
 * Solo administrador. Componer un dashboard decide qué mira el equipo entero al
 * entrar a un módulo, y publicarlo decide cuándo empieza a mirarlo. No es una
 * restricción de comodidad: es que la decisión se toma una vez y la ve todo el
 * mundo.
 */

export type DashState = { ok: boolean; message?: string; error?: string };

async function soloAdmin(): Promise<string | null> {
  return isAdminRole(await currentRole())
    ? null
    : "Solo un administrador compone los dashboards.";
}


/**
 * Guarda el orden completo tras un arrastre.
 *
 * Recibe la lista entera serializada y no «mueve N a M»: ver el porqué en
 * `reorderDashboard`. Aquí se valida que lo que llega tenga la forma esperada
 * antes de tocar la base — viene de un `input` oculto que el navegador rellenó,
 * y eso es entrada de usuario aunque la haya escrito nuestro propio JavaScript.
 */
export async function reorderDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const modulo = String(form.get("modulo") ?? "");
  let orden: Array<{ analysis: string; width: "full" | "half"; active: boolean }>;

  try {
    const crudo = JSON.parse(String(form.get("orden") ?? "[]")) as unknown;
    if (!Array.isArray(crudo)) throw new Error("no es una lista");
    orden = crudo.map((x) => {
      const o = x as Record<string, unknown>;
      if (typeof o.analysis !== "string" || !o.analysis) throw new Error("sin análisis");
      return {
        analysis: o.analysis,
        width: o.width === "half" ? "half" : "full",
        active: o.active !== false,
      };
    });
  } catch {
    return { ok: false, error: "El orden llegó con una forma que no se entiende." };
  }

  const r = await reorderDashboard(modulo, orden);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Guardado." };
}

/** Añade un análisis al tablero. Ver `addToDashboard`. */
export async function addToDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const r = await addToDashboard(
    String(form.get("modulo") ?? ""),
    String(form.get("analysis") ?? ""),
  );
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Agregado al final del tablero." };
}

export async function publishDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const session = await auth();
  const r = await publishDashboard(
    String(form.get("modulo") ?? ""),
    session?.user?.id ?? null,
  );
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Publicado. Ya le aparece al equipo." };
}

export async function unpublishDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  await unpublishDashboard(String(form.get("modulo") ?? ""));
  await revalidateDashboards();
  // Se dice que NO se borró nada: el miedo razonable al despublicar es perder
  // el trabajo de acomodarlo.
  return { ok: true, message: "Retirado de la vista del equipo. Lo compuesto sigue ahí." };
}

export async function renameDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const r = await renameDashboard(
    String(form.get("modulo") ?? ""),
    String(form.get("title") ?? ""),
  );
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Nombre actualizado." };
}
