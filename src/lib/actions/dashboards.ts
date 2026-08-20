"use server";

import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { revalidateDashboards } from "@/lib/revalidate";
import {
  createDashboard,
  setDashboardModules,
  publishDashboard,
  renameDashboard,
  reorderDashboard,
  unpublishDashboard,
} from "@/lib/ml/dashboards";

/**
 * Acciones del compositor de tableros.
 *
 * Solo administrador. Componer un tablero decide qué mira el equipo entero al
 * entrar a un módulo, publicarlo decide cuándo empieza a mirarlo, y dónde sale
 * decide por dónde llega. No es una restricción de comodidad: es que la
 * decisión se toma una vez y la ve todo el mundo.
 */

export type DashState = { ok: boolean; message?: string; error?: string };

async function soloAdmin(): Promise<string | null> {
  return isAdminRole(await currentRole())
    ? null
    : "Solo un administrador compone los tableros.";
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

  const slug = String(form.get("slug") ?? "");
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

  const r = await reorderDashboard(slug, orden);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Guardado." };
}

export async function publishDashboardAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const session = await auth();
  const r = await publishDashboard(
    String(form.get("slug") ?? ""),
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

  await unpublishDashboard(String(form.get("slug") ?? ""));
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
    String(form.get("slug") ?? ""),
    String(form.get("title") ?? ""),
  );
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, message: "Nombre actualizado." };
}

/**
 * Crea un tablero vacío con el nombre que le den.
 *
 * Devuelve el slug para que la pantalla sepa a dónde ir. No redirige desde
 * aquí: quien llama es un formulario de una página, y esa página decide qué
 * hacer con el resultado —hoy, mandar al compositor—.
 */
export async function createDashboardAction(
  _prev: DashState & { slug?: string },
  form: FormData,
): Promise<DashState & { slug?: string }> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const r = await createDashboard(String(form.get("title") ?? ""));
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return { ok: true, slug: r.slug, message: "Tablero creado." };
}

/**
 * Decide en qué módulos sale el tablero.
 *
 * La lista llega separada por comas en un campo oculto, no como casillas con el
 * mismo nombre: el ORDEN importa —el primero es el que abre el botón flotante—
 * y `FormData.getAll` devuelve las casillas en el orden del DOM, no en el que
 * la persona las fue eligiendo.
 */
export async function setDashboardModulesAction(
  _prev: DashState,
  form: FormData,
): Promise<DashState> {
  const no = await soloAdmin();
  if (no) return { ok: false, error: no };

  const modulos = String(form.get("modulos") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const r = await setDashboardModules(String(form.get("slug") ?? ""), modulos);
  if (!r.ok) return { ok: false, error: r.reason };

  await revalidateDashboards();
  return {
    ok: true,
    message:
      modulos.length === 0
        ? "Ya no sale en ningún módulo; se llega por el menú."
        : `Sale en ${modulos.length} módulo${modulos.length === 1 ? "" : "s"}.`,
  };
}
