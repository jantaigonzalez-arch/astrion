import "server-only";
import { unstable_cache } from "next/cache";
import type { DbOrTx } from "@/lib/db";
import { requireTenant, tenantDbFor } from "@/lib/tenancy/context";

/**
 * Caché de datos POR INQUILINO, entre peticiones.
 *
 * ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
 *
 * De todo el portal, una sola lectura tenía caché de datos: la marca de la
 * empresa. Todo lo demás vuelve a Postgres en cada navegación, incluidas cosas
 * que solo cambian cuando alguien entra a configuración. Medido: el menú
 * lateral pedía 4 consultas y ~15 ms en CADA una de las 68 pantallas, para
 * pintar una sección que cambia cuando se publica un tablero.
 *
 * ── POR QUÉ EL INQUILINO VA EN LA CLAVE Y NO SOLO EN LA ETIQUETA ───────────
 *
 * Porque la documentación de `unstable_cache` lo dice con todas las letras:
 * «tags … Next.js will not use this to uniquely identify the function». La
 * clave sale de los argumentos y de `keyParts`; la etiqueta solo sirve para
 * invalidar. Una caché de inquilino cuya clave no lleve el inquilino le sirve
 * a la segunda empresa lo que leyó la primera — la misma fuga que tenían los
 * cachés de variable de módulo, con más alcance porque esto sí persiste.
 *
 * Va el ESQUEMA y no el slug: es lo que identifica los datos. Dos empresas no
 * pueden compartir esquema, y renombrar un slug no debe servir un caché ajeno.
 *
 * ── POR QUÉ LA CONEXIÓN SE ABRE ADENTRO Y EL INQUILINO SE RESUELVE AFUERA ──
 *
 * Dentro de un ámbito cacheado no se pueden leer `cookies()` ni `headers()`, y
 * `tenantDb()` resuelve la empresa justamente por la cookie. De ahí la forma:
 * `requireTenant()` corre FUERA —memoizado por petición, así que es gratis— y
 * adentro se abre la conexión por esquema explícito con `tenantDbFor`.
 *
 * Es la misma razón por la que las funciones de datos aceptan la conexión por
 * parámetro. Sin eso, nada de esto se podría cachear.
 *
 * ── LA INVALIDACIÓN ES EXPLÍCITA, CON UN PISO DE SEGURIDAD ─────────────────
 *
 * Quien escribe llama a `updateTag(tenantTag(slug, que))` desde su acción, que
 * expira la entrada al instante: quien acaba de guardar ve lo que guardó, no lo
 * de antes. `revalidateTenant()` NO alcanza aquí —refresca la ruta, y los datos
 * etiquetados siguen sirviéndose hasta que se invalide su etiqueta—, así que la
 * llamada tiene que estar puesta a mano.
 *
 * Y por eso hay un `revalidate` por omisión: una etiqueta que alguien se olvide
 * de invalidar deja datos viejos MINUTOS, no para siempre. Es la diferencia
 * entre un despiste molesto y uno que nadie encuentra.
 */

/** La etiqueta de un cacheado: por empresa y por cosa. */
export const tenantTag = (slug: string, que: string) => `tenant:${slug}:${que}`;

/**
 * Envuelve una lectura de inquilino en caché de datos.
 *
 * Devuelve una función con la MISMA forma que la original —sin argumentos— para
 * que sustituirla en las pantallas no sea un cambio de firma. Lo que recibe es
 * la conexión ya abierta contra el esquema correcto.
 *
 *   export const getAjustes = tenantCache("ajustes", (db) => getSettings(db));
 *
 * `segundos` es el piso, no el objetivo: la invalidación de verdad la hace
 * `updateTag` desde la acción que escribe.
 */
export function tenantCache<T>(
  que: string,
  leer: (db: DbOrTx) => Promise<T>,
  segundos = 300,
): () => Promise<T> {
  return async () => {
    // Fuera del ámbito cacheado a propósito: aquí sí se pueden leer cookies.
    const ctx = await requireTenant();

    return unstable_cache(
      () => leer(tenantDbFor(ctx.schemaName)),
      // El esquema en la clave. Ver la cabecera: sin esto, se filtra.
      ["tenant", ctx.schemaName, que],
      { tags: [tenantTag(ctx.slug, que)], revalidate: segundos },
    )();
  };
}
