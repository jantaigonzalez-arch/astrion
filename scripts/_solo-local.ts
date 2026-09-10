/**
 * Imprime, por cada probe que corre solo en local, su archivo y su orden.
 *
 * Una línea por probe:  `archivo<TAB>orden completa`
 *
 * ── POR QUÉ TAMBIÉN LA ORDEN ───────────────────────────────────────────────
 *
 * Porque el shell no la puede adivinar, y adivinarla fue un fallo real: el
 * runner aplicaba `--tsconfig tsconfig.scripts.json` a todo lo de `scripts/`, y
 * con esa configuración los probes que usan stubs cargan el módulo de inquilino
 * de verdad y mueren pidiendo las cookies de una petición. Se veía como «este
 * probe está roto» cuando lo roto era la orden.
 *
 * La orden sale de `invocacion()`, la misma que usa Vitest. Una sola fuente.
 */
import { SOLO_LOCAL } from "../pruebas/registro";
import { invocacion } from "../pruebas/probes";

/*
  Ya NO incluye `CON_STUBS`. Esas catorce se fueron al CI el día que los stubs
  entraron al repositorio: corren en cada PR contra la base sembrada, y
  repetirlas aquí sería correrlas dos veces para saber lo mismo.

  Aquí quedan solo las que el CI no puede correr porque miran datos reales.
*/
for (const archivo of Object.keys(SOLO_LOCAL)) {
  console.log(`${archivo}\t${invocacion(archivo)}`);
}
