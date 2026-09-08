import { defineConfig } from "vitest/config";

/**
 * Vitest aquí no ejecuta pruebas: las ORQUESTA.
 *
 * Cada caso lanza un probe en su propio proceso y mira su código de salida. Eso
 * decide toda la configuración de abajo, que de otro modo parecería tímida.
 */
export default defineConfig({
  test: {
    include: ["pruebas/**/*.test.ts"],

    /*
      EN SERIE, Y A PROPÓSITO.

      Los probes de integración comparten una sola base: varios escribiendo a la
      vez se pisan y producen fallos que no se repiten dos veces igual. Una
      prueba que falla de forma intermitente se acaba ignorando, y entonces deja
      de proteger aunque siga ahí.

      No cuesta lo que parece: los probes ya lanzan sus propios procesos, así
      que la máquina no se queda ociosa mientras uno corre.
    */
    fileParallelism: false,
    sequence: { concurrent: false },

    /*
      Sin límite global de tiempo por caso: cada `it` declara el suyo, porque
      leer un archivo de estilos y recorrer catorce mil tickets no se parecen en
      nada. Un tope único obligaría a ponerlo tan alto que dejaría de avisar de
      lo que se atasca.
    */
    testTimeout: 300_000,
    hookTimeout: 120_000,

    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
});
