/**
 * Sustituto de `next/cache` para los probes.
 *
 * ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────
 *
 * `unstable_cache` no es una función normal: se apoya en el `incrementalCache`
 * que Next monta al atender una petición. Fuera de un servidor no existe, y lo
 * que se ve es «Invariant: incrementalCache missing in unstable_cache» —un
 * mensaje que no menciona a `tenant-cache.ts`, que es quien la llama, ni al
 * probe, que solo quería medir una consulta.
 *
 * ── LO QUE HACE ESTE STUB, Y POR QUÉ ES LO CORRECTO ────────────────────────
 *
 * Ejecuta la función y ya: NO cachea. Y no es una limitación, es lo que se
 * quiere. Un probe que mide cuánto cuesta una consulta tiene que verla ir a
 * Postgres; con caché de por medio, la segunda llamada daría cero y el número
 * sería mentira. Lo mismo para los que comprueban aislamiento entre empresas:
 * una respuesta servida de caché no prueba que la consulta filtre bien.
 *
 * `revalidatePath` y `updateTag` no hacen nada, que es exactamente su efecto
 * cuando no hay nada que invalidar.
 */

import { soloEnPruebas } from "./_stub-guardia";

soloEnPruebas(
  "_stub-cache",
  "No cachea nada y `revalidatePath()` no invalida: la aplicación pagaría\n"
    + "  cada consulta en cada petición y serviría datos que creía frescos.",
);

/**
 * Devuelve la función tal cual, envuelta para respetar la firma.
 *
 * Los `keyParts` y las opciones se ignoran a propósito: son la identidad de la
 * entrada en la caché, y aquí no hay caché a la que dar identidad.
 */
/* eslint-disable @typescript-eslint/no-unused-vars --
   Los parámetros se conservan porque la firma tiene que coincidir con la real:
   quien llama sigue pasándolos, y quitarlos escondería que aquí se ignoran. Es
   el mismo criterio que en `_stub-tenancy`. */
export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  _keyParts?: string[],
  _opciones?: { tags?: string[]; revalidate?: number | false },
): T {
  return fn;
}

export function revalidatePath(_ruta: string, _tipo?: "layout" | "page"): void {}

export function updateTag(_etiqueta: string): void {}

export function revalidateTag(_etiqueta: string): void {}
