"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { tenants, platformEvents } from "@/lib/db/platform";
import { auth } from "@/lib/auth";
import { currentPlatformRole } from "@/lib/platform-session";
import { DIAS_DE_PRUEBA } from "@/lib/suscripcion";

/**
 * Administrar la suscripción de una empresa, desde la consola de Astraion.
 *
 * ── SOLO SUPERADMINISTRADOR ───────────────────────────────────────────────
 *
 * Abrir o cerrar la puerta de una empresa entera es de la misma familia que
 * darla de alta: decide si un cliente puede trabajar hoy. Soporte entra a
 * diagnosticar, no a mover el estado comercial de nadie.
 *
 * El rol se lee de la BASE y no del token —ver `platform-session.ts`—, porque
 * con sesión JWT un operador degradado seguiría teniendo esta facultad durante
 * treinta días.
 *
 * ── TODO DEJA RASTRO ──────────────────────────────────────────────────────
 *
 * Cada cambio escribe en `platform_events`, que sobrevive incluso si el
 * inquilino se da de baja. «¿Quién le cerró el acceso a este cliente y cuándo?»
 * es una pregunta que se va a hacer, y la respuesta no puede ser «no lo
 * sabemos».
 */

export type SuscripcionState = { ok: boolean; error?: string; message?: string };

/**
 * Las tres reciben el estado previo porque la consola las llama con
 * `useActionState`: sin eso no habría dónde enseñar el error, y una acción que
 * rechaza en silencio es la misma trampa que el botón de probar el correo.
 */

async function soloSuper() {
  const [session, rol] = await Promise.all([auth(), currentPlatformRole()]);
  if (rol !== "superadmin" || !session?.user?.id) return null;
  return session.user.id;
}

async function registrar(
  tenantId: string,
  actorId: string,
  accion: string,
  detalle: Record<string, unknown>,
) {
  await getDb().insert(platformEvents).values({
    tenantId,
    eventType: "tenant.subscription_changed",
    actorId,
    payload: { accion, ...detalle },
  });
}

/**
 * Arranca —o reinicia— la prueba, con los días que se le den.
 *
 * Cuenta desde HOY y no desde el alta: una empresa puede llevar meses en
 * evaluación sin reloj, y lo que se quiere al pulsar esto es «tiene 30 días a
 * partir de ahora», no «tenía 30 desde que la dimos de alta y ya se pasaron».
 */
export async function iniciarPrueba(
  _prev: SuscripcionState,
  form: FormData,
): Promise<SuscripcionState> {
  const actorId = await soloSuper();
  if (!actorId) return { ok: false, error: "Solo un superadministrador." };

  const tenantId = String(form.get("tenantId") ?? "");
  const dias = Number(form.get("dias") ?? DIAS_DE_PRUEBA);
  if (!tenantId) return { ok: false, error: "Falta la empresa." };
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    return { ok: false, error: "Los días tienen que ser un entero entre 1 y 365." };
  }

  const hasta = new Date(Date.now() + dias * 86_400_000);
  await getDb()
    .update(tenants)
    .set({ status: "trial", trialEndsAt: hasta, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await registrar(tenantId, actorId, "prueba_iniciada", {
    dias,
    hasta: hasta.toISOString(),
  });
  revalidatePath("/[locale]/platform", "layout");
  return { ok: true, message: "Listo." };
}

/**
 * Deja la cuenta activa: pagada, sin fecha de corte.
 *
 * Limpia `trial_ends_at` a propósito. Dejarla puesta no cambiaría el acceso
 * —`estadoDe` solo la mira en `trial`— pero dejaría en la ficha una fecha
 * pasada junto a una cuenta al corriente, y cualquiera que la lea después va a
 * dudar de cuál de las dos manda.
 */
export async function activarSuscripcion(
  _prev: SuscripcionState,
  form: FormData,
): Promise<SuscripcionState> {
  const actorId = await soloSuper();
  if (!actorId) return { ok: false, error: "Solo un superadministrador." };

  const tenantId = String(form.get("tenantId") ?? "");
  if (!tenantId) return { ok: false, error: "Falta la empresa." };

  await getDb()
    .update(tenants)
    .set({ status: "active", trialEndsAt: null, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await registrar(tenantId, actorId, "activada", {});
  revalidatePath("/[locale]/platform", "layout");
  return { ok: true, message: "Listo." };
}

/**
 * Cierra el acceso por falta de pago.
 *
 * NO borra nada: el esquema, los tickets y los contratos siguen intactos, y la
 * pantalla que ve la empresa lo dice con esas palabras. Suspender es cerrar una
 * puerta, no vaciar la casa — y decirlo es lo que hace que el cliente pague en
 * vez de asustarse.
 */
export async function suspenderSuscripcion(
  _prev: SuscripcionState,
  form: FormData,
): Promise<SuscripcionState> {
  const actorId = await soloSuper();
  if (!actorId) return { ok: false, error: "Solo un superadministrador." };

  const tenantId = String(form.get("tenantId") ?? "");
  const motivo = String(form.get("motivo") ?? "").trim();
  if (!tenantId) return { ok: false, error: "Falta la empresa." };
  if (motivo.length < 3) {
    return { ok: false, error: "Escribe el motivo: es lo que explica el corte después." };
  }

  await getDb()
    .update(tenants)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await registrar(tenantId, actorId, "suspendida", { motivo });
  revalidatePath("/[locale]/platform", "layout");
  return { ok: true, message: "Listo." };
}
