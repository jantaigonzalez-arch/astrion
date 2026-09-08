/**
 * Imprime la lista de probes que solo corren contra datos reales.
 *
 * Existe como archivo y no como un `-e` dentro del script de shell porque el
 * registro es TypeScript y hay que importarlo: la lista tiene que salir de
 * `pruebas/registro.ts` y no repetirse en el shell, o serían dos listas que
 * mantener y una de las dos se quedaría vieja.
 *
 * Lo usa `scripts/probes-locales.sh`.
 */
import { SOLO_LOCAL } from "../pruebas/registro";

for (const archivo of Object.keys(SOLO_LOCAL)) console.log(archivo);
