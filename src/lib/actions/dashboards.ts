"use server";

import { auth } from "@/lib/auth";
import { puedeEn } from "@/lib/tenancy/context";
import { revalidateDashboards } from "@/lib/revalidate";
import { redirectAfterAction } from "@/lib/nav-server";
import { createDashboard, deleteDashboard, setDashboardModules, publishDashboard, renameDashboard, reorderDashboard, unpublishDashboard } from "@/lib/ml/dashboards";
import { caja, type Caja } from "@/lib/ml/placements";

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
  return (await puedeEn("analisis", "administrar"))
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
  let orden: Array<{
    analysis: string;
    caja: Caja;
    active: boolean;
    viz: string | null;
  }>;

  try {
    const crudo = JSON.parse(String(form.get("orden") ?? "[]")) as unknown;
    if (!Array.isArray(crudo)) throw new Error("no es una lista");
    orden = crudo.map((x) => {
      const o = x as Record<string, unknown>;
      if (typeof o.analysis !== "string" || !o.analysis) throw new Error("sin análisis");
      return {
        analysis: o.analysis,
        // Saneada y no validada: viene de un campo oculto, o sea de fuera. Un
        // valor imposible cae en el más cercano; fallar el guardado del tablero
        // entero por un número raro sería peor que recolocar un bloque.
        caja: caja({
          x: Number(o.x),
          y: Number(o.y),
          w: Number(o.w),
          h: Number(o.h),
        }),
        active: o.active !== false,
        // Se acepta cualquier cadena corta y NO se valida contra el catálogo de
        // formas: la aptitud depende de los datos del bloque, que aquí no están
        // resueltos, y comprobarla exigiría volver a ejecutar el análisis
        // entero en cada guardado. Un nombre desconocido degrada a
        // recomendación al dibujar —ver `formaEfectiva`—, que es el
        // comportamiento seguro. El límite de 16 es el de la columna: sin él,
        // una cadena larga tumbaría el guardado del tablero completo.
        viz:
          typeof o.viz === "string" && o.viz.length > 0 && o.viz.length <= 16
            ? o.viz
            : null,
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

  const r = await createDashboard(
    String(form.get("title") ?? ""),
    // El módulo viene del botón «Crear tablero» de una pantalla. `createDashboard`
    // lo valida contra el catálogo antes de sembrar nada.
    String(form.get("modulo") ?? "") || null,
  );
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

/**
 * Borra el tablero y lleva al portal.
 *
 * Redirige desde el servidor y no devuelve estado, al revés que las otras: si
 * el borrado salió bien, la pantalla en la que está la persona ya no existe.
 * Quedarse en ella para enseñar «borrado» sería dejarla mirando el compositor
 * de algo que no está.
 *
 * `redirectAfterAction` y no `redirect` a secas: la dirección lleva el prefijo
 * de la empresa, que depende de si el despliegue usa subdominio o path.
 */
export async function deleteDashboardAction(form: FormData): Promise<void> {
  if (await soloAdmin()) return;

  const session = await auth();
  const r = await deleteDashboard(
    String(form.get("slug") ?? ""),
    session?.user?.id ?? null,
  );
  if (!r.ok) return;

  await revalidateDashboards();
  await redirectAfterAction("/dashboard");
}
