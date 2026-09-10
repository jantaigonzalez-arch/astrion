import "server-only";
import { unstable_cache } from "next/cache";

/**
 * DATOS DE REFERENCIA COMPARTIDOS: UNA COPIA PARA TODA LA PLATAFORMA.
 *
 * Es la contraparte de `tenant-cache`, y la diferencia entre las dos es la que
 * define esta capa entera:
 *
 *   tenantCache          el esquema del inquilino VA EN LA CLAVE. Sin él, la
 *                        segunda empresa lee lo que cargó la primera. Es una
 *                        fuga.
 *   referenciaCache      NO hay inquilino en la clave, y eso es el punto. El
 *                        dato es el mismo para todos, así que compartir la
 *                        entrada de caché no es una fuga: es el ahorro.
 *
 * ── QUÉ CALIFICA COMO DATO COMPARTIDO ──────────────────────────────────────
 *
 * Las tres condiciones, y las tres tienen que cumplirse:
 *
 *   1. NO DICE NADA DE NADIE. Ni de una empresa ni de una persona. Si una fila
 *      pudiera distinguir a un cliente de otro, no entra aquí ni en `public`.
 *   2. ES IDÉNTICO PARA TODOS. No hay versión «de Evoelution» del catálogo de
 *      códigos postales del SAT.
 *   3. CAMBIA POCAS VECES Y DESDE FUERA. Lo publica un tercero —el SAT, el
 *      Banco de México, el INEGI— y aquí solo se carga.
 *
 * El caso vivo son los catálogos del Anexo 20. Los candidatos naturales que
 * vendrán: el tipo de cambio del DOF, la lista 69-B, el catálogo de productos y
 * servicios. Todos cumplen las tres.
 *
 * ── LO QUE SE AHORRA, MEDIDO ───────────────────────────────────────────────
 *
 * Los catálogos del SAT ocupan 33 MB. Guardados por inquilino, con veinte
 * empresas serían 660 MB de filas idénticas que habría que volver a cargar una
 * por una cada vez que el SAT publica una versión. Compartidos, se cargan una
 * vez y los leen todos.
 *
 * Y leerlos cuesta 1,7 ms en la pantalla que más los usa. No es un problema, y
 * esta caché no está aquí porque lo fuera: está porque volver a Postgres a por
 * un dato que cambia dos veces al año es trabajo que no hace falta hacer, y
 * porque con veinte empresas ese trabajo se multiplica por veinte.
 *
 * ── POR QUÉ EL PLAZO Y NO UNA ETIQUETA ─────────────────────────────────────
 *
 * `tenantCache` invalida con `updateTag` desde la acción que escribe, porque
 * esa acción corre en el MISMO proceso que sirve las pantallas. Aquí no: los
 * catálogos los carga `npm run sat:catalogos` desde la imagen de scripts, que es
 * otro contenedor. Una etiqueta emitida ahí no llega al servidor web.
 *
 * Así que se usa un plazo, y por eso es largo: una hora de desfase después de
 * cargar un catálogo que cambia dos veces al año es intrascendente, y pretender
 * lo contrario exigiría un canal entre procesos que no compra nada.
 *
 * Quien necesite verlo al instante reinicia la aplicación, que es lo que ya hace
 * un despliegue.
 */

/** Una hora. Ver la nota sobre el plazo: estos datos cambian dos veces al año. */
const PLAZO = 3600;

/** La etiqueta, por si algún día la carga y el servidor comparten proceso. */
export const referenciaTag = (que: string) => `referencia:${que}`;

/**
 * Envuelve una lectura de datos compartidos en caché de plataforma.
 *
 *   export const catalogos = referenciaCache("sat:catalogos", leerCatalogos);
 *
 * Devuelve una función con la misma forma que la original, para que sustituirla
 * en las pantallas no sea un cambio de firma.
 *
 * ⚠ NO LA USES PARA NADA QUE DEPENDA DEL INQUILINO. No hay inquilino en la
 * clave: la primera empresa que llame llena la entrada y las demás leen esa. Si
 * el dato distinguiera a una empresa de otra, eso sería una fuga — y sería
 * silenciosa, que es lo peor. Para eso está `tenantCache`.
 */
export function referenciaCache<T>(
  que: string,
  leer: () => Promise<T>,
  segundos = PLAZO,
): () => Promise<T> {
  return unstable_cache(leer, ["referencia", que], {
    tags: [referenciaTag(que)],
    revalidate: segundos,
  });
}

/**
 * Lo mismo, para una lectura que depende de un argumento.
 *
 * El argumento entra en la clave —lo hace `unstable_cache` con los suyos—, así
 * que `usosPara("601")` y `usosPara("605")` son entradas distintas y ninguna
 * sirve por la otra.
 */
export function referenciaCacheCon<A extends string | null, T>(
  que: string,
  leer: (arg: A) => Promise<T>,
  segundos = PLAZO,
): (arg: A) => Promise<T> {
  return (arg: A) =>
    unstable_cache(() => leer(arg), ["referencia", que, String(arg)], {
      tags: [referenciaTag(que)],
      revalidate: segundos,
    })();
}
