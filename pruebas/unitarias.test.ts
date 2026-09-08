/**
 * Las pruebas que no necesitan base de datos.
 *
 *   npm run test:unitarias
 *
 * Leen el código fuente y las hojas de estilo, o ejercitan funciones puras: que
 * ninguna tabla se salga del criterio común, que el modelo de permisos no le
 * cambie el acceso a nadie, que las rutas reservadas salgan de una sola lista.
 * Tardan segundos y no piden nada montado, así que son lo primero que corre en
 * cada PR — un rojo aquí no necesita ni que Postgres arranque.
 */
import { describe, it, expect } from "vitest";
import { UNITARIAS } from "./registro";
import { correr, resumenDeFallo } from "./probes";

describe("sin base de datos", () => {
  for (const archivo of UNITARIAS) {
    it(
      archivo,
      () => {
        const r = correr(archivo);
        // El mensaje del `expect` lleva las líneas del propio probe: quien mire
        // el registro de Actions tiene que poder saber QUÉ se rompió sin ir a
        // reproducirlo en su máquina.
        expect(r.ok, resumenDeFallo(r)).toBe(true);
      },
      120_000,
    );
  }
});
