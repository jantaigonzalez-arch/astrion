/**
 * LA CACHÉ COMPARTIDA NO PUEDE TOCAR DATOS DE UN INQUILINO.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-referencia.mts
 *
 * ── EL RIESGO QUE ESTO VIGILA ──────────────────────────────────────────────
 *
 * `referenciaCache` guarda una sola entrada para toda la plataforma: su clave NO
 * lleva inquilino, y eso es lo que la hace útil para los catálogos del SAT, que
 * son los mismos para todos.
 *
 * Y es exactamente lo que la haría una fuga si alguien envolviera con ella una
 * lectura de inquilino. La primera empresa que pidiera el dato llenaría la
 * entrada, y todas las demás leerían LO SUYO — sus clientes, sus contratos— sin
 * que nada fallara ni avisara. Es el peor tipo de fallo que tiene un sistema
 * multiempresa: uno que funciona.
 *
 * ── CÓMO SE COMPRUEBA ──────────────────────────────────────────────────────
 *
 * Leyendo el fuente, sin base: un archivo que usa `referenciaCache` no puede
 * resolver el contexto de inquilino. Si importa `tenantDb`, `requireTenant` o
 * `getTenantContext`, está a un paso de meter un dato de empresa en la caché
 * compartida, y eso se rechaza aquí antes de que llegue a producción.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const archivos: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const r = `${d}/${e}`;
    if (statSync(r).isDirectory()) {
      if (e !== "node_modules") walk(r);
      continue;
    }
    if (/\.tsx?$/.test(e)) archivos.push(r);
  }
})("src");

console.log("\nLA CACHÉ COMPARTIDA NO RESUELVE INQUILINO");

// Quién la usa, sin contar el archivo que la define.
const usuarios = archivos.filter((f) => {
  if (f.endsWith("referencia-compartida.ts")) return false;
  return /referenciaCache(Con)?\s*\(/.test(readFileSync(f, "utf8"));
});

ok(`hay usos que vigilar (${usuarios.length})`, usuarios.length >= 1);

const MARCAS_DE_INQUILINO = /\b(tenantDb|tenantDbFor|requireTenant|getTenantContext|currentRole)\b/;

/*
  SIN COMENTARIOS, y no es un detalle.

  La primera versión buscaba sobre el texto entero y se ponía roja con el
  archivo LIMPIO: el comentario de `sat.ts` explica que se usa «`getDb()` y no
  `tenantDb()`», y el guardia leía esa explicación como si fuera código. Un
  guardia que falla sobre el caso bueno enseña a desactivarlo, que es peor que
  no tenerlo.

  Se quitan los comentarios de bloque y de línea antes de buscar. Lo que queda
  es lo que el archivo HACE, no lo que cuenta.
*/
const sinComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const contaminados = usuarios.filter((f) =>
  MARCAS_DE_INQUILINO.test(sinComentarios(readFileSync(f, "utf8"))),
);

ok(
  "ningún archivo que usa referenciaCache resuelve el contexto de inquilino",
  contaminados.length === 0,
  contaminados.join(", "),
);

/*
  Y la definición misma tampoco puede meter al inquilino en la clave por la
  puerta de atrás. Si algún día alguien «arregla» esta caché añadiendo el
  esquema a la clave, deja de ser compartida — cada empresa tendría su copia y
  se perdería justo lo que la justifica. No es un fallo de seguridad, pero sí
  uno de diseño que se comprobaría tarde.
*/
const def = readFileSync("src/lib/referencia-compartida.ts", "utf8");
ok(
  "la clave de la caché compartida no lleva inquilino",
  !MARCAS_DE_INQUILINO.test(sinComentarios(def)),
);

/*
  Y lo que cachea son tablas de `public`. Se comprueba que los catálogos del SAT
  —el caso vivo— se lean con la conexión de PLATAFORMA (`getDb`), no con la de
  un inquilino: los catálogos viven una sola vez, en `public`.
*/
const sat = readFileSync("src/lib/data/sat.ts", "utf8");
ok("los catálogos del SAT se leen con la conexión de plataforma", /getDb\(\)/.test(sat));
ok("y pasan por la caché compartida", /referenciaCache\(/.test(sat));

console.log(
  fallos
    ? `\n❌ ${fallos} comprobación(es) fallaron\n`
    : "\n✅ la caché compartida no puede servir datos de una empresa a otra\n",
);
process.exit(fallos ? 1 : 0);
