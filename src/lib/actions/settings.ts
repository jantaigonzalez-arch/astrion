"use server";

import { revalidateTenant } from "@/lib/revalidate";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";
import { limpiarImporte as limpiar } from "@/lib/importe";

export type SettingsState = { ok: boolean; error?: string };

/*
  Limpiaba con `[^0-9.]`, que también se lleva el signo: «-50» llegaba como 50 y
  la comprobación de negativos de abajo no se cumplía nunca. Ver `lib/importe.ts`.
*/
const money = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string") return null;
  const clean = limpiar(v);
  if (!clean) return null;
  const n = Number(clean);
  return Number.isNaN(n) || n < 0 ? null : n.toFixed(2);
};

/**
 * Tipo de cambio USD→MXN de la empresa.
 *
 * Vive aparte de las tarifas de mano de obra porque son dos decisiones de
 * negocio distintas, las toma gente distinta y se revisan con otra frecuencia:
 * la tarifa se pacta una vez al año, el tipo de cambio se mira cuando hay una
 * cotización en dólares sobre la mesa.
 *
 * Lo que se guarda aquí es el valor VIGENTE. Al guardar un negocio en dólares,
 * este número se copia al propio negocio junto con la fecha del día — ver
 * `stampFx` en `actions/crm.ts`—, así que subirlo mañana no cambia lo que ya
 * se informó de los meses cerrados. Es la diferencia entre un tipo de cambio y
 * una regla de conversión retroactiva, y solo la primera se puede auditar.
 */
export async function updateFxRate(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!(await puedeEn("configuracion", "administrar"))) return { ok: false, error: "auth" };

  const raw = limpiar(String(formData.get("usdRate") ?? ""));
  const n = Number(raw);
  // Vacío BORRA el tipo de cambio, y es deliberado: sin tipo de cambio la
  // empresa declara que no convierte, y los informes lo dicen en vez de
  // inventarse una paridad. Un cero o un negativo, en cambio, son errores de
  // captura — convertirían toda la cartera en dólares a cero pesos. Y texto
  // que no es un número también: con la limpieza de antes, «abc» quedaba en
  // vacío y BORRABA el tipo de cambio de la empresa por un error de dedo.
  const usdRate = raw === "" ? null : Number.isFinite(n) && n > 0 ? n.toFixed(4) : undefined;
  if (usdRate === undefined) {
    return { ok: false, error: "invalid" };
  }

  try {
    const db = await tenantDb();
    await db
      .insert(settings)
      .values({ id: "global", usdRate })
      .onConflictDoUpdate({
        target: settings.id,
        set: { usdRate, updatedAt: new Date() },
      });

    revalidateTenant();
    return { ok: true };
  } catch (e) {
    console.error("[settings] fx rate error:", e);
    return { ok: false, error: "server" };
  }
}

/**
 * Tipo de cambio automático (Banxico) o manual.
 *
 * Solo cambia de dónde sale el tipo de los negocios que se guarden A PARTIR DE
 * AHORA: los ya guardados conservan el suyo, estampado con su fecha. El manual
 * no se borra al encender el automático —ver `tipoDeCambioDeLaEmpresa`—.
 */
export async function updateTipoCambioAutomatico(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!(await puedeEn("configuracion", "administrar"))) return { ok: false, error: "auth" };

  // Casilla de verificación: presente es «sí», ausente es «no».
  const tipoCambioAutomatico = formData.get("automatico") === "on";
  try {
    const db = await tenantDb();
    await db
      .insert(settings)
      .values({ id: "global", tipoCambioAutomatico })
      .onConflictDoUpdate({
        target: settings.id,
        set: { tipoCambioAutomatico, updatedAt: new Date() },
      });
    revalidateTenant();
    return { ok: true };
  } catch (e) {
    console.error("[settings] tipo de cambio automático:", e);
    return { ok: false, error: "server" };
  }
}

/**
 * Tarifas de mano de obra: costo y cobro por hora de técnico.
 *
 * Las decide quien ADMINISTRA EL SERVICIO, no quien administra el sistema:
 * solo alimentan la utilidad de los tickets (`lib/profit.ts`). Pedían
 * `configuracion: administrar` cuando vivían en «Marca y tarifas»; desde que
 * tienen su pestaña (Configuración → Servicio), la guardia es la del módulo,
 * igual que la política de viáticos pide `viaticos: administrar`.
 */
export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!(await puedeEn("servicio", "administrar"))) return { ok: false, error: "auth" };

  const laborCostPerHour = money(formData.get("laborCostPerHour"));
  const laborRatePerHour = money(formData.get("laborRatePerHour"));

  try {
    const db = await tenantDb();
    await db
      .insert(settings)
      .values({ id: "global", laborCostPerHour, laborRatePerHour })
      .onConflictDoUpdate({
        target: settings.id,
        set: { laborCostPerHour, laborRatePerHour, updatedAt: new Date() },
      });

    revalidateTenant();
    return { ok: true };
  } catch (e) {
    console.error("[settings] update error:", e);
    return { ok: false, error: "server" };
  }
}
