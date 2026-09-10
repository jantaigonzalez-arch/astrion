/**
 * Sustituto de `@/lib/auth` para los probes bajo la condición `react-server`.
 *
 * next-auth arrastra el `next/navigation` de cliente, que llama a
 * `createContext` — y esa función no existe en la versión `react-server` de
 * React, que es justamente la única donde `cache` memoiza. Como ningún probe
 * mide sesiones, cortar aquí es más limpio que remendar la cadena entera.
 *
 * Devuelve `null` en vez de una sesión falsa: lo que se mide son consultas de
 * datos, y una sesión inventada solo serviría para que algo pasara por un
 * camino que en el probe no se ejercita.
 */
import { soloEnPruebas } from "./_stub-guardia";

soloEnPruebas(
  "_stub-auth",
  "Corta la sesión a `null`: la aplicación trataría a todo el mundo como\n"
    + "  no autenticado, o peor, saltaría comprobaciones que esperan una sesión.",
);

export async function auth(): Promise<null> {
  return null;
}
