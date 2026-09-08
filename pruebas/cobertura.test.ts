/**
 * LA PRUEBA QUE VIGILA A LAS DEMÁS.
 *
 * Todo probe del repositorio tiene que estar en una de las cinco listas del
 * registro, y en una sola. No es burocracia: es lo único que impide que la
 * historia se repita.
 *
 * Lo que pasó fue esto. Había 53 probes escritos con muy buen criterio y ningún
 * sitio donde constara cuáles seguían vivos. Catorce llevaban meses reventando
 * al arrancar y otros catorce no comprobaban nada; nadie lo sabía porque nadie
 * los corría en bloque. Un probe que se escribe, se abandona y no se declara
 * muerto es peor que ninguno: figura como cobertura y no cubre.
 *
 * Con esta prueba, añadir un probe obliga a decidir dónde vive. Es un renglón
 * en `registro.ts`, y a cambio ninguno vuelve a quedarse fuera en silencio.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { todosLosProbes, invocacion, RAIZ } from "./probes";
import {
  CLASIFICADOS,
  UNITARIAS,
  INTEGRACION,
  SOLO_LOCAL,
  ROTAS,
  DIAGNOSTICO,
} from "./registro";

describe("el registro cubre todos los probes", () => {
  it("ninguno se quedó sin clasificar", () => {
    const huerfanos = todosLosProbes().filter((f) => !CLASIFICADOS.has(f));
    expect(
      huerfanos,
      huerfanos.length
        ? `\nEstos probes no están en pruebas/registro.ts:\n  ${huerfanos.join("\n  ")}\n\n` +
            "Añadilo a la lista que le toque: UNITARIAS si no necesita base, " +
            "INTEGRACION si sí, SOLO_LOCAL si depende de los datos reales de " +
            "producción, y ROTAS o DIAGNOSTICO con su motivo si todavía no puede correr.\n"
        : undefined,
    ).toEqual([]);
  });

  it("ninguno está clasificado dos veces", () => {
    const todas = [
      ...UNITARIAS,
      ...INTEGRACION,
      ...Object.keys(SOLO_LOCAL),
      ...Object.keys(ROTAS),
      ...Object.keys(DIAGNOSTICO),
    ];
    const repetidos = todas.filter((f, i) => todas.indexOf(f) !== i);
    expect(repetidos, `\nEn más de una lista: ${repetidos.join(", ")}\n`).toEqual([]);
  });

  it("el registro no nombra probes que ya no existen", () => {
    const existen = new Set(todosLosProbes());
    const fantasmas = [...CLASIFICADOS].filter((f) => !existen.has(f));
    expect(
      fantasmas,
      `\nEl registro nombra archivos que no están en el repo: ${fantasmas.join(", ")}\n`,
    ).toEqual([]);
  });

  it("los probes que necesita el CI están versionados", () => {
    /*
      LA PRUEBA QUE FALTABA LA PRIMERA VEZ.

      Los probes están en `.gitignore` a propósito, y el flujo de Actions no lo
      sabía: `npm ci`, tipos y estilo pasaron, y las pruebas reventaron con
      «ENOENT: probe-suscripcion.mts» porque en el repositorio remoto no había
      un solo probe que ejecutar. El fallo no se parecía a la causa.

      Ahora, un probe en UNITARIAS o INTEGRACION que no esté en git rompe aquí
      —en tu máquina, antes del push— y con un mensaje que dice qué hacer.
    */
    const necesarios = [...UNITARIAS, ...INTEGRACION];
    const fuera = necesarios.filter((f) => {
      try {
        execFileSync("git", ["ls-files", "--error-unmatch", f], {
          cwd: RAIZ,
          stdio: ["ignore", "ignore", "ignore"],
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(
      fuera,
      fuera.length
        ? `\nEstos probes los necesita el CI y NO están en el repositorio:\n  ${fuera.join("\n  ")}\n\n` +
            "Agregá una excepción por cada uno en .gitignore (`!nombre.mts`) y " +
            "hacé `git add`. Sin eso, Actions falla con ENOENT y el motivo no se ve.\n"
        : undefined,
    ).toEqual([]);
  });

  it("cada probe declara cómo se corre, o hereda el de su carpeta", () => {
    // No puede quedar ninguno sin invocación resoluble: si `invocacion()`
    // devolviera algo vacío, el runner ejecutaría una orden en blanco y el
    // resultado sería un verde que no probó nada.
    for (const f of todosLosProbes()) {
      const cmd = invocacion(f);
      expect(cmd, `${f} no resuelve invocación`).toContain("npx tsx");
      expect(cmd, `la invocación de ${f} no lo menciona: ${cmd}`).toContain(
        f.replace(/^scripts\//, ""),
      );
    }
  });
});
