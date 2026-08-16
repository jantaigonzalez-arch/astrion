import "server-only";
import { revalidatePath } from "next/cache";

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
