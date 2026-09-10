/**
 * Sustituto de `next/navigation` para los probes que corren bajo la condición
 * `react-server`.
 *
 * Hace falta por una razón mecánica: `cache` de React solo memoiza en la
 * versión `react-server` del paquete, que es la que carga el servidor de verdad;
 * y esa versión no tiene `createContext`, así que el `next/navigation` de
 * cliente —que next-auth arrastra— revienta al cargarse. Nada de lo que se mide
 * aquí navega, así que basta con que exista.
 *
 * Si un probe llega a llamarlas, es que está midiendo otra cosa: por eso lanzan
 * en vez de devolver algo plausible.
 */
import { soloEnPruebas } from "./_stub-guardia";

soloEnPruebas(
  "_stub-navigation",
  "Todas sus funciones lanzan: `redirect()` y `notFound()` dejarían de\n"
    + "  redirigir y de devolver 404, que es como se protegen rutas enteras.",
);

const fuera = (que: string) => () => {
  throw new Error(`${que}() no existe fuera de una petición; esto es un probe.`);
};

export const redirect = fuera("redirect");
export const permanentRedirect = fuera("permanentRedirect");
export const notFound = fuera("notFound");
export const forbidden = fuera("forbidden");
export const unauthorized = fuera("unauthorized");
export const useRouter = fuera("useRouter");
export const usePathname = fuera("usePathname");
export const useSearchParams = fuera("useSearchParams");
export const useParams = fuera("useParams");
export const useSelectedLayoutSegment = fuera("useSelectedLayoutSegment");
export const useSelectedLayoutSegments = fuera("useSelectedLayoutSegments");
export const useServerInsertedHTML = fuera("useServerInsertedHTML");
export enum RedirectType {
  push = "push",
  replace = "replace",
}
