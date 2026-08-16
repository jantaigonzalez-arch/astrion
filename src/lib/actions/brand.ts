"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants, FOLIO_PREFIX_RE } from "@/lib/db/platform";
import { isAdminRole } from "@/lib/roles";
import { requireTenant, currentRole } from "@/lib/tenancy/context";
import { saveImage } from "@/lib/uploads";
import { updateTag } from "next/cache";
import { brandTag } from "@/lib/data/platform";
import { revalidateTenant } from "@/lib/revalidate";

/**
 * Marca de la empresa: la configura ELLA, no la plataforma.
 *
 * Escribe en `public.tenants`, que es plano de control, así que el permiso se
 * comprueba con especial cuidado: el inquilino sale de `requireTenant()` —o
 * sea, de la URL— y nunca de un campo del formulario. Aceptar un `slug` del
 * cliente aquí dejaría que el administrador de una empresa cambiara el logo de
 * otra con una petición a mano.
 */

export type BrandState = { ok: boolean; error?: string; message?: string };

export async function updateTenantBrand(
  _prev: BrandState,
  formData: FormData,
): Promise<BrandState> {
  if (!isAdminRole(await currentRole())) {
    return { ok: false, error: "Solo un administrador cambia la marca." };
  }

  // De la URL, no del formulario. Ver la nota de arriba.
  const ctx = await requireTenant();

  const brandName = String(formData.get("brandName") ?? "").trim().slice(0, 60);
  const quitar = formData.get("removeLogo") === "1";

  // El prefijo se valida contra el mismo formato que exige el folio. Se
  // rechaza en vez de corregirse en silencio: un prefijo distinto del que la
  // empresa creyó escribir queda grabado en documentos que ya no se reescriben.
  const prefijo = String(formData.get("folioPrefix") ?? "").trim().toUpperCase();
  if (prefijo && !FOLIO_PREFIX_RE.test(prefijo)) {
    return {
      ok: false,
      error:
        "El prefijo de folio debe tener de 2 a 8 caracteres, empezar por letra y usar solo letras y dígitos (ej. EVO, ACME).",
    };
  }

  try {
    let logoUrl: string | null | undefined;

    if (quitar) {
      logoUrl = null;
    } else {
      // `saveImage` devuelve null si no se adjuntó nada: en ese caso se deja
      // el logo que ya había en vez de borrarlo sin querer al guardar solo el
      // nombre.
      const saved = await saveImage(formData.get("logo"), "brand");
      if (saved) logoUrl = saved;
    }

    await getDb()
      .update(tenants)
      .set({
        brandName: brandName || null,
        // Vacío = no se toca. Un prefijo en null haría nacer folios
        // `null-000001`, así que nunca se borra: solo se reemplaza.
        ...(prefijo ? { folioPrefix: prefijo } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    // La marca está en caché de servidor porque la lee el layout en cada
    // navegación (ver `getTenantBrand`). Sin esta línea, el administrador
    // guardaría el logo nuevo y seguiría viendo el viejo hasta una hora —el
    // fallo más desconcertante posible: "no se guardó", cuando sí se guardó.
    updateTag(brandTag(ctx.slug));
    revalidateTenant();
    return {
      ok: true,
      message: quitar ? "Logo quitado." : "Marca actualizada.",
    };
  } catch (e) {
    console.error("[brand] update error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}
