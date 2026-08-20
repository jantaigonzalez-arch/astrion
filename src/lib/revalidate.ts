import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { requireTenant } from "@/lib/tenancy/context";
import { tenantTag } from "@/lib/tenant-cache";
import { TABLEROS_CACHE } from "@/lib/ml/dashboards";

/**
 * Invalida el subárbol de la empresa activa.
 *
 * Reemplaza a las ~70 llamadas puntuales que había (`revalidatePath("/admin/crm")`
 * y compañía). Dejaron de servir cuando el inquilino pasó a la URL: la ruta real
 * es `/evoelution/admin/crm`, y la vieja no coincidía con nada — fallando en
 * silencio, que es la peor forma de fallar en una caché.
 *
 * Se usa la forma de PATRÓN y no una ruta concreta a propósito. Un patrón
 * cubre los dos idiomas y cualquier inquilino de una vez, mientras que la
 * ruta concreta obligaría a repetir cada llamada para `/es` y `/en` —que es
 * lo que ya pasaba, mal, con los `revalidatePath("/en/…")` duplicados—.
 *
 * El costo es que invalida de más. En una aplicación con casi todo dinámico y
 * detrás de sesión, eso solo limpia la caché de navegación del cliente: mucho
 * más barato que servir un dato que el usuario acaba de cambiar.
 */
export function revalidateTenant() {
  revalidatePath("/[locale]/[tenant]", "layout");
}

/**
 * Lo mismo, y además la sección de tableros del menú lateral.
 *
 * Existe porque `revalidateTenant()` NO alcanza a la caché de datos: refresca
 * la ruta, y lo etiquetado se sigue sirviendo hasta que se invalide su etiqueta
 * —está escrito así en la documentación de `revalidatePath`—. El menú lateral
 * lee los tableros de una caché por inquilino (ver `tenantCache`), así que sin
 * esta llamada alguien publicaría un tablero y no lo vería aparecer en su menú
 * hasta cinco minutos después. Y sería desconcertante, porque la pantalla del
 * tablero SÍ enseñaría el cambio.
 *
 * `updateTag` y no `revalidateTag`: expira al instante en vez de marcar como
 * viejo, que es lo que hace falta cuando quien invalida es la misma persona que
 * acaba de guardar. Solo se puede llamar desde una acción de servidor.
 *
 * La usan las cuatro familias de acciones que pueden cambiar lo que el menú
 * enseña: componer un tablero, mover una colocación, aceptar una recomendación
 * y publicar una pregunta. En una función y no copiada en cada una: la lista de
 * lo que hay que invalidar crece, y cuatro copias divergen.
 */
export async function revalidateDashboards() {
  const ctx = await requireTenant();
  updateTag(tenantTag(ctx.slug, TABLEROS_CACHE));
  revalidateTenant();
}
