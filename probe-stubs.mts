/**
 * LOS STUBS ESTÁN EN EL REPOSITORIO. ESTA ES LA PRUEBA QUE LO HACE ACEPTABLE.
 *
 * ── QUÉ SE ESTÁ VIGILANDO ──────────────────────────────────────────────────
 *
 * `scripts/_stub-tenancy.ts` devuelve `role: "owner"` y un `puedeEn()` que
 * concede todo sin mirar módulo ni nivel. Mientras estuvo fuera de git, la
 * protección era que el archivo no existiera. Ahora existe, así que la
 * protección tiene que ser otra: que reviente si se carga donde no debe, y que
 * nada de `src/` pueda alcanzarlo.
 *
 * Eso es lo que se comprueba aquí. Si esta prueba se pone roja, no es un fallo
 * de pruebas: es que el camino entre un `puedeEn()` que dice que sí a todo y la
 * aplicación de verdad quedó abierto.
 *
 * ── POR QUÉ NO NECESITA BASE ───────────────────────────────────────────────
 *
 * Porque las cuatro cosas que mira son del código y del montaje: quién importa
 * a quién, qué mapea el tsconfig de la aplicación, si cada stub llama a la
 * guardia, y si la guardia lanza cuando le toca. Ninguna necesita Postgres, así
 * que corre en el trabajo rápido del CI y falla en segundos.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-stubs.mts
 */
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { soloEnPruebas } from "./scripts/_stub-guardia.ts";

let fallos = 0;
const ok = (l: string, c: boolean, e = "", soloAlFallar = false) => {
  if (!c) fallos++;
  const detalle = e && (!soloAlFallar || !c) ? ` — ${e}` : "";
  console.log(`${c ? "✓" : "✗"} ${l}${detalle}`);
};

/* ── 1 · Ningún archivo de la aplicación los nombra ─────────────────────── */
console.log("\nLA APLICACIÓN NO PUEDE ALCANZARLOS");

/*
  Se busca con `git grep` y no recorriendo `src/` a mano por una razón
  práctica: git ya sabe qué archivos están versionados y se salta `node_modules`
  y `.next` sin que haya que enumerarlos. `--fixed-strings` porque `_stub-` no
  tiene nada de expresión regular y escaparlo sería ruido.

  Se buscan las dos formas en que alguien podría llegar a ellos: por el nombre
  del archivo y por el de la función que exporta la guardia. La segunda importa
  porque un `import { soloEnPruebas }` dentro de `src/` sería el síntoma de que
  alguien copió el patrón al sitio equivocado.
*/
const buscar = (aguja: string, donde: string): string[] => {
  try {
    return execFileSync(
      "git",
      // `--untracked` porque el archivo peligroso es justo el que alguien acaba
      // de escribir y todavía no agregó: sin esto, el import que abre el agujero
      // pasa la prueba en la máquina donde se escribió y solo falla —si falla—
      // después del `git add`.
      ["grep", "-l", "--untracked", "--fixed-strings", aguja, "--", donde],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    // `git grep` sale con 1 cuando no encuentra nada. Aquí eso es el éxito.
    return [];
  }
};

for (const aguja of ["_stub-", "soloEnPruebas", "tsconfig.probe.json"]) {
  const encontrados = buscar(aguja, "src");
  ok(
    `ningún archivo de src/ nombra \`${aguja}\``,
    encontrados.length === 0,
    `lo nombran: ${encontrados.join(", ")}`,
    true,
  );
}

/*
  El tsconfig de la APLICACIÓN es el otro camino posible, y es más silencioso
  que un import: un `paths` mal puesto redirige el módulo entero sin que ningún
  archivo de `src/` cambie una línea. Por eso se mira aparte.
*/
const tsconfigApp = readFileSync("tsconfig.json", "utf8");
ok(
  "tsconfig.json (el de la aplicación) no mapea a ningún stub",
  !tsconfigApp.includes("_stub-"),
  "un `paths` a un stub redirige el módulo sin tocar src/",
  true,
);

/* ── 2 · Todo stub lleva la guardia ─────────────────────────────────────── */
console.log("\nNINGÚN STUB NACE SIN PROTECCIÓN");

/*
  Se listan del disco, no de una lista escrita aquí. Es la misma razón por la
  que `pruebas/registro.ts` obliga a clasificar cada probe: una lista a mano se
  desincroniza, y el síntoma sería el stub número cinco versionado sin guardia y
  nadie enterándose.
*/
const stubs = readdirSync("scripts")
  .filter((f) => /^_stub-.*\.ts$/.test(f) && f !== "_stub-guardia.ts")
  .sort();

ok(`se encontraron stubs que vigilar (${stubs.length})`, stubs.length > 0);

for (const f of stubs) {
  const fuente = readFileSync(path.join("scripts", f), "utf8");
  ok(`${f} llama a soloEnPruebas()`, /soloEnPruebas\(/.test(fuente));

  /*
    Y la llama ANTES de exportar nada. Un stub que se protegiera al final del
    archivo ya habría definido sus exportaciones cuando la guardia dispara, y
    en un módulo con efectos al cargar eso puede ser tarde.
  */
  const posGuardia = fuente.indexOf("soloEnPruebas(\n");
  const posExport = fuente.indexOf("\nexport ");
  ok(
    `  …y lo hace antes de su primera exportación`,
    posGuardia >= 0 && posExport >= 0 && posGuardia < posExport,
    "la guardia tiene que estar en la primera línea ejecutable",
    true,
  );
}

/* ── 3 · La guardia dispara de verdad ───────────────────────────────────── */
console.log("\nLA GUARDIA NO ES DECORATIVA");

/*
  Se ejercita la función, no se lee. Una guardia que nadie dispara es una
  guardia que puede llevar meses invertida sin que se note — que es exactamente
  la clase de fallo que este repositorio ya tuvo con catorce probes.
*/
const dispara = (montar: () => void, desmontar: () => void): boolean => {
  montar();
  try {
    soloEnPruebas("_stub-de-mentira", "riesgo de mentira");
    return false;
  } catch {
    return true;
  } finally {
    desmontar();
  }
};

const runtimeOriginal = process.env.NEXT_RUNTIME;
const entornoOriginal = process.env.NODE_ENV;

ok(
  "lanza con NEXT_RUNTIME definido (dentro del servidor de Next)",
  dispara(
    () => {
      process.env.NEXT_RUNTIME = "nodejs";
    },
    () => {
      if (runtimeOriginal === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = runtimeOriginal;
    },
  ),
);

ok(
  "lanza con NODE_ENV=production (cualquier proceso de producción)",
  dispara(
    () => {
      // `NODE_ENV` es de solo lectura para TypeScript; el proceso sí la deja
      // cambiar y es la única forma de comprobar la rama.
      (process.env as Record<string, string>).NODE_ENV = "production";
    },
    () => {
      if (entornoOriginal === undefined) delete process.env.NODE_ENV;
      else (process.env as Record<string, string>).NODE_ENV = entornoOriginal;
    },
  ),
);

ok(
  "y NO lanza en una prueba, que es donde tiene que dejar pasar",
  !dispara(
    () => {},
    () => {},
  ),
);

/*
  El mensaje también se comprueba. No es cosmética: quien se encuentre esto en
  un registro de producción a las tres de la mañana necesita saber en un
  vistazo cuál se cargó y qué concede de más, o va a tratar un agujero de
  permisos como un fallo de pruebas y lo va a "arreglar" quitando la guardia.
*/
let mensaje = "";
try {
  process.env.NEXT_RUNTIME = "nodejs";
  soloEnPruebas("_stub-tenancy", "Devuelve rol `owner`");
} catch (e) {
  mensaje = String((e as Error).message);
} finally {
  if (runtimeOriginal === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = runtimeOriginal;
}

ok("el mensaje nombra el stub que se cargó", mensaje.includes("_stub-tenancy"));
ok("el mensaje dice qué concede de más", mensaje.includes("owner"));
ok("el mensaje dice dónde se cargó", mensaje.includes("NEXT_RUNTIME=nodejs"));

console.log(
  fallos
    ? `\n❌ ${fallos} fallo(s) — los stubs están en el repositorio y su protección no responde\n`
    : "\n✅ los stubs están versionados y no pueden alcanzar la aplicación\n",
);
process.exit(fallos ? 1 : 0);
