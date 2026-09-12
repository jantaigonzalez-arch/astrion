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
import { readFileSync } from "node:fs";
import path from "node:path";
import { todosLosProbes, invocacion, RAIZ } from "./probes";
import {
  CLASIFICADOS,
  UNITARIAS,
  INTEGRACION,
  SOLO_LOCAL,
  CON_STUBS,
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
            "INTEGRACION si sí, CON_STUBS si además necesita los stubs de sesión " +
            "e inquilino, SOLO_LOCAL si depende de los datos reales de producción, " +
            "y DIAGNOSTICO si solo informa.\n"
        : undefined,
    ).toEqual([]);
  });

  it("ninguno está clasificado dos veces", () => {
    const todas = [
      ...UNITARIAS,
      ...INTEGRACION,
      ...Object.keys(SOLO_LOCAL),
      ...CON_STUBS,
      ...Object.keys(DIAGNOSTICO),
    ];
    const repetidos = todas.filter((f, i) => todas.indexOf(f) !== i);
    expect(repetidos, `\nEn más de una lista: ${repetidos.join(", ")}\n`).toEqual([]);
  });

  it("el registro no nombra probes del CI que ya no existen", () => {
    /*
      SOLO sobre las tres listas del CI, y no sobre las cinco.

      `SOLO_LOCAL` y `DIAGNOSTICO` nombran archivos que siguen en `.gitignore` a
      propósito, así que en un clon de CI no existen: comprobarlos allí daba
      «fantasmas» que no eran tales, sino justo lo que se decidió no publicar.
      Aquí solo tiene sentido vigilar los que el repositorio SÍ debe tener.

      `CON_STUBS` entró a esta comprobación cuando pasó a correr en el CI. Es el
      cambio que la hace útil de nuevo: sus catorce archivos SÍ tienen que estar.
    */
    const existen = new Set(todosLosProbes());
    const fantasmas = [...UNITARIAS, ...INTEGRACION, ...CON_STUBS].filter(
      (f) => !existen.has(f),
    );
    expect(
      fantasmas,
      `\nEl registro los declara para el CI y no están en el repo: ${fantasmas.join(", ")}\n`,
    ).toEqual([]);
  });

  it("los probes que necesita el CI están versionados", () => {
    /*
      LA PRUEBA QUE FALTABA LA PRIMERA VEZ.

      Los probes están en `.gitignore` a propósito, y el flujo de Actions no lo
      sabía: `npm ci`, tipos y estilo pasaron, y las pruebas reventaron con
      «ENOENT: probe-suscripcion.mts» porque en el repositorio remoto no había
      un solo probe que ejecutar. El fallo no se parecía a la causa.

      Ahora, un probe de cualquiera de las tres listas del CI —UNITARIAS,
      INTEGRACION o CON_STUBS— que no esté en git rompe aquí, en tu máquina y
      antes del push, con un mensaje que dice qué hacer.
    */
    const necesarios = [...UNITARIAS, ...INTEGRACION, ...CON_STUBS];
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

  it("lo que los probes necesitan para arrancar también está versionado", () => {
    /*
      NO BASTA CON QUE ESTÉN LOS PROBES.

      `tsconfig.check.json` redirige `server-only` a un módulo vacío, porque los
      57 archivos de `src/` que abren con `import "server-only"` no se pueden
      cargar fuera de una petición de Next. Ese módulo vivía en `.probe/`, que
      estaba ignorado: en el clon del CI no existía y los diez probes de
      integración morían con un `MODULE_NOT_FOUND` que culpaba a
      `src/lib/mail/index.ts` —tres saltos más allá de donde estaba el problema.

      Fue la segunda vez en una tarde que el CI se cayó por un archivo que aquí
      está y allá no. Esta comprobación cierra la clase entera: todo destino de
      `paths` en CUALQUIERA de las configuraciones con las que corren los probes
      tiene que estar en git.

      Son dos, y la segunda entró el día que los stubs se versionaron:
      `tsconfig.probe.json` es con la que corren las catorce de `CON_STUBS` y
      apunta a cuatro `scripts/_stub-*.ts` que hasta entonces estaban ignorados
      —exactamente la forma de fallo que esto existe para atrapar—.
    */
    const CONFIGS = ["tsconfig.check.json", "tsconfig.probe.json"];
    const destinos = CONFIGS.flatMap((c) => {
      const cfg = readFileSync(path.join(RAIZ, c), "utf8");
      // El tsconfig lleva comentarios, así que no es JSON válido: se sacan los
      // destinos con una expresión en vez de intentar analizarlo.
      return [...cfg.matchAll(/\[\s*"(\.\/[^"]+)"\s*\]/g)].map((m) => m[1]);
    });
    expect(destinos.length, "no se encontró ningún `paths` en los tsconfig").toBeGreaterThan(0);

    /*
      Y lo que los probes del CI importan POR RUTA RELATIVA.

      Las pruebas de acciones importan `./_acciones-kit`, que no pasa por ningún
      `paths`: sin esto, olvidarlo en el commit daba verde aquí y un
      `MODULE_NOT_FOUND` en Actions — la misma forma de fallo de arriba, por otra
      puerta. Se resuelve relativo al probe y se prueba con y sin `.ts`.
    */
    for (const probe of [...UNITARIAS, ...INTEGRACION, ...CON_STUBS]) {
      const fuente = readFileSync(path.join(RAIZ, probe), "utf8");
      for (const [, rel] of fuente.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        const base = path.relative(RAIZ, path.resolve(RAIZ, path.dirname(probe), rel));
        destinos.push("./" + (/\.[mc]?ts$/.test(base) ? base : `${base}.ts`));
      }
    }

    const fuera = [...new Set(destinos)].filter((d) => {
      const rel = d.replace(/^\.\//, "");
      try {
        execFileSync("git", ["ls-files", "--error-unmatch", rel], {
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
        ? `\nLos tsconfig de pruebas o los probes del CI apuntan a archivos que no están en git:\n  ${fuera.join("\n  ")}\n\n` +
            "Sin ellos los probes no arrancan en un clon limpio. Agregá la excepción en .gitignore.\n"
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
