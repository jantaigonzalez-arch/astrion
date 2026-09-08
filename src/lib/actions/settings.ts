"use server";

import { revalidateTenant } from "@/lib/revalidate";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { settings } from "@/lib/db/schema";

export type SettingsState = { ok: boolean; error?: string };

const money = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string") return null;
  const clean = v.replace(/[^0-9.]/g, "");
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

  const raw = String(formData.get("usdRate") ?? "").replace(/[^0-9.]/g, "");
  const n = Number(raw);
  // Vacío BORRA el tipo de cambio, y es deliberado: sin tipo de cambio la
  // empresa declara que no convierte, y los informes lo dicen en vez de
  // inventarse una paridad. Un cero o un negativo, en cambio, son errores de
  // captura — convertirían toda la cartera en dólares a cero pesos.
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

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!(await puedeEn("configuracion", "administrar"))) return { ok: false, error: "auth" };

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

/**
 * ¿La empresa paga viajes a quien todavía no es cliente?
 *
 * Acción propia y no un campo más en `updateSettings`. Las tarifas son una
 * cifra que se ajusta cada tanto; esto es una POLÍTICA, y mezclarlas en el
 * mismo formulario significa que apagar la práctica en toda la empresa se hace
 * de paso, al guardar unas tarifas — o peor, que se enciende sin querer al
 * guardar cualquier otra cosa, porque una casilla que no se marca llega como
 * ausente y no como `false`.
 *
 * Por eso el interruptor viaja explícito y se lee con `=== "on"`: lo que decide
 * es lo que dice el formulario, no lo que falta en él.
 */
export async function updateViaticosProspectos(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  if (!(await puedeEn("configuracion", "administrar"))) return { ok: false, error: "auth" };

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
    return { ok: true };
  } catch (e) {
    console.error("[settings] viaticos prospectos error:", e);
    return { ok: false, error: "server" };
  }
}
