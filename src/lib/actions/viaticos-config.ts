"use server";

import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { puedeEn, tenantDb } from "@/lib/tenancy/context";
import { revalidateTenant } from "@/lib/revalidate";
import { settings, viaticoExpenses, viaticoRubros } from "@/lib/db/schema";

/**
 * CONFIGURACIÓN DE VIÁTICOS: la política de gasto de la empresa.
 *
 * ── EL PERMISO ES `viaticos: administrar`, NO `configuracion` ──────────────
 *
 * Y es la decisión que sostiene este archivo. Quien decide cuánto se paga por
 * noche de hotel es quien administra el gasto —el rol General y el
 * administrador—, no quien administra el sistema. Con el guardia de
 * Configuración, General no podía ni abrir la pantalla: tiene
 * `configuracion: ninguno` de fábrica y `viaticos: administrar`.
 *
 * Eso ya pasaba con el interruptor de viáticos a prospectos, que nació en la
 * pantalla de Marca y tarifas y por lo tanto era invisible para el único rol
 * que existe para esto. Se mudó aquí de paso.
 *
 * Como en el resto del módulo, estas funciones comprueban el permiso, sanean la
 * entrada y escriben. Lo que NO hacen es decidir reglas de negocio: la de «este
 * rubro exige nota» vive en `domain/viaticos.ts`, que es por donde pasa todo lo
 * que captura un gasto.
 */

export type ConfigState = { ok: boolean; message?: string; error?: string };

const uuid = z.string().uuid();

async function puedeConfigurar() {
  return puedeEn("viaticos", "administrar");
}

/**
 * Importe por día. Vacío = SIN TOPE, y no es lo mismo que cero.
 *
 * Cero diría «este rubro no se paga» y marcaría en rojo todo gasto que lo use;
 * vacío dice «no lo hemos definido», que es donde empieza toda empresa. Por eso
 * el vacío devuelve `null` y el cero se rechaza en vez de guardarse.
 */
function presupuesto(v: FormDataEntryValue | null): number | null | "invalido" {
  const limpio = String(v ?? "").replace(/[$,\s]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n <= 0) return "invalido";
  return n;
}

/**
 * Una clave de máquina a partir del nombre: «Casetas y peajes» → `casetas-y-peajes`.
 *
 * Se genera y no se pide porque nadie que configura un catálogo de gastos
 * quiere pensar en identificadores. Es inmutable: renombrar el rubro después no
 * la toca, que es lo que permite que renombrar no rompa el histórico.
 */
function claveDesde(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `rubro-${Date.now()}`
  );
}

/* ─────────────────────── El interruptor de prospectos ─────────────────────── */

export async function guardarViaticosProspectos(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  if (!(await puedeConfigurar())) {
    return { ok: false, error: "No tienes permiso para configurar viáticos." };
  }

  // `=== "on"` y no «viene o no viene»: una casilla sin marcar no se envía, así
  // que lo que decide es lo que el formulario DICE, no lo que le falta.
  const viaticosProspectos = String(formData.get("viaticosProspectos") ?? "") === "on";

  try {
    const db = await tenantDb();
    await db
      .insert(settings)
      .values({ id: "global", viaticosProspectos })
      .onConflictDoUpdate({
        target: settings.id,
        set: { viaticosProspectos, updatedAt: new Date() },
      });
    revalidateTenant();
    return { ok: true, message: "Guardado." };
  } catch (e) {
    console.error("[viaticos-config] prospectos", e);
    return { ok: false, error: "No se pudo guardar." };
  }
}

/* ───────────────────────────── Rubros ───────────────────────────── */

export async function crearRubroAction(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  if (!(await puedeConfigurar())) {
    return { ok: false, error: "No tienes permiso para configurar viáticos." };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Ponle nombre al rubro." };

  const budget = presupuesto(formData.get("dailyBudgetMxn"));
  if (budget === "invalido") {
    return {
      ok: false,
      error: "El presupuesto por día tiene que ser mayor que cero, o déjalo vacío.",
    };
  }

  try {
    const db = await tenantDb();

    /*
      El choque de nombre se comprueba ANTES y sin distinguir mayúsculas.

      La unicidad de la base es sobre `key`, que se deriva del nombre, así que
      un duplicado saldría igual — pero como un error de restricción, que no
      dice qué pasó. Y «Hotel» junto a «hotel» en el mismo desplegable es
      exactamente lo que el catálogo cerrado viene a evitar.
    */
    const [choca] = await db
      .select({ id: viaticoRubros.id })
      .from(viaticoRubros)
      .where(sql`lower(btrim(${viaticoRubros.name})) = lower(${name})`)
      .limit(1);
    if (choca) return { ok: false, error: `Ya existe un rubro llamado «${name}».` };

    const [{ n }] = await db
      .select({ n: sql<number>`coalesce(max(${viaticoRubros.position}), 0)::int` })
      .from(viaticoRubros);

    await db.insert(viaticoRubros).values({
      key: claveDesde(name),
      name,
      dailyBudgetMxn: budget == null ? null : budget.toFixed(2),
      requiresNote: String(formData.get("requiresNote") ?? "") === "on",
      blocksOverBudget: String(formData.get("blocksOverBudget") ?? "") === "on",
      position: n + 1,
    });

    revalidateTenant();
    return { ok: true, message: `Rubro «${name}» creado.` };
  } catch (e) {
    console.error("[viaticos-config] crear rubro", e);
    return { ok: false, error: "No se pudo crear el rubro." };
  }
}

export async function guardarRubroAction(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  if (!(await puedeConfigurar())) {
    return { ok: false, error: "No tienes permiso para configurar viáticos." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Rubro inválido." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "El nombre no puede quedar vacío." };

  const budget = presupuesto(formData.get("dailyBudgetMxn"));
  if (budget === "invalido") {
    return {
      ok: false,
      error: "El presupuesto por día tiene que ser mayor que cero, o déjalo vacío.",
    };
  }

  try {
    const db = await tenantDb();

    const [choca] = await db
      .select({ id: viaticoRubros.id })
      .from(viaticoRubros)
      .where(
        and(
          sql`lower(btrim(${viaticoRubros.name})) = lower(${name})`,
          ne(viaticoRubros.id, id.data),
        ),
      )
      .limit(1);
    if (choca) return { ok: false, error: `Ya existe otro rubro llamado «${name}».` };

    /*
      `key` NO se toca al renombrar, y ahí está el diseño entero del catálogo:
      los gastos apuntan por `id`, el histórico conserva el nombre nuevo porque
      lo lee de esta fila, y la clave sigue sirviendo para reconocer los cinco
      de fábrica.
    */
    await db
      .update(viaticoRubros)
      .set({
        name,
        dailyBudgetMxn: budget == null ? null : budget.toFixed(2),
        requiresNote: String(formData.get("requiresNote") ?? "") === "on",
        blocksOverBudget: String(formData.get("blocksOverBudget") ?? "") === "on",
        active: String(formData.get("active") ?? "") === "on",
      })
      .where(eq(viaticoRubros.id, id.data));

    revalidateTenant();
    return { ok: true, message: "Rubro actualizado." };
  } catch (e) {
    console.error("[viaticos-config] guardar rubro", e);
    return { ok: false, error: "No se pudo guardar el rubro." };
  }
}

/**
 * Borrar un rubro: SOLO si nadie lo usó nunca.
 *
 * Con gastos encima, la llave foránea es `restrict` y la base lo impediría de
 * todas formas — pero con un error que no explica nada. Aquí se comprueba antes
 * para poder decir cuántos gastos lo sostienen y ofrecer la salida real, que es
 * desactivarlo: desaparece del formulario y el histórico conserva su nombre.
 */
export async function borrarRubroAction(
  _prev: ConfigState,
  formData: FormData,
): Promise<ConfigState> {
  if (!(await puedeConfigurar())) {
    return { ok: false, error: "No tienes permiso para configurar viáticos." };
  }

  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Rubro inválido." };

  try {
    const db = await tenantDb();
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(viaticoExpenses)
      .where(eq(viaticoExpenses.rubroId, id.data));

    if (n > 0) {
      return {
        ok: false,
        error: `No se puede borrar: ${n} gasto(s) ya lo usan. Desactívalo para retirarlo del formulario sin perder el histórico.`,
      };
    }

    await db.delete(viaticoRubros).where(eq(viaticoRubros.id, id.data));
    revalidateTenant();
    return { ok: true, message: "Rubro borrado." };
  } catch (e) {
    console.error("[viaticos-config] borrar rubro", e);
    return { ok: false, error: "No se pudo borrar el rubro." };
  }
}
