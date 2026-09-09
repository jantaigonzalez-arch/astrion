"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants, FOLIO_PREFIX_RE } from "@/lib/db/platform";
import { requireTenant, puedeEn } from "@/lib/tenancy/context";
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
  if (!(await puedeEn("configuracion", "administrar"))) {
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

/**
 * EL MEMBRETE DE LOS DOCUMENTOS: lo que se imprime y se le entrega al cliente.
 *
 * Acción aparte de `updateTenantBrand` y no un campo más en ella, por la misma
 * razón por la que el logo es otro: son dos decisiones distintas que se toman
 * en momentos distintos. La marca se ajusta al montar la empresa y se mira en
 * pantalla; esto se ajusta cuando alguien imprime el primer reporte y descubre
 * que el pie no dice sus datos. Mezclarlas obligaría a volver a subir el logo
 * de la barra lateral cada vez que se corrige un teléfono.
 *
 * Los campos vacíos se guardan como NULL y la pantalla del reporte los omite.
 * No se inventa nada: ver la migración 0029.
 */
export async function updateDocumentBranding(
  _prev: BrandState,
  formData: FormData,
): Promise<BrandState> {
  if (!(await puedeEn("configuracion", "administrar"))) {
    return { ok: false, error: "Solo un administrador cambia el membrete." };
  }

  // De la URL, no del formulario. Misma cautela que arriba: esto escribe en el
  // plano de control, y aceptar un slug del cliente dejaría que el
  // administrador de una empresa cambiara el membrete de otra.
  const ctx = await requireTenant();

  /** Vacío = NULL, no cadena vacía: la pantalla decide con `si hay dato`. */
  const texto = (campo: string, tope: number) => {
    const v = String(formData.get(campo) ?? "").trim().slice(0, tope);
    return v || null;
  };

  const quitar = formData.get("removeDocumentLogo") === "1";

  try {
    let documentLogoUrl: string | null | undefined;
    if (quitar) {
      documentLogoUrl = null;
    } else {
      // Igual que en la marca: sin archivo adjunto se deja el que había, para
      // que corregir un teléfono no borre el logo.
      const saved = await saveImage(formData.get("documentLogo"), "brand");
      if (saved) documentLogoUrl = saved;
    }

    await getDb()
      .update(tenants)
      .set({
        tagline: texto("tagline", 120),
        contactAddress: texto("contactAddress", 200),
        contactPhone: texto("contactPhone", 40),
        contactEmail: texto("contactEmail", 160),
        ...(documentLogoUrl !== undefined ? { documentLogoUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    // El membrete viaja en la misma fila cacheada que la marca, así que se
    // invalida la misma etiqueta. Sin esto, quien acaba de corregir su
    // dirección seguiría imprimiendo la vieja hasta una hora después.
    updateTag(brandTag(ctx.slug));
    revalidateTenant();
    return {
      ok: true,
      message: quitar ? "Logo del documento quitado." : "Membrete actualizado.",
    };
  } catch (e) {
    console.error("[brand] membrete error:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error del servidor." };
  }
}
