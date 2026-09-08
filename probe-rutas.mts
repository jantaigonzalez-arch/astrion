/**
 * Las rutas de primer nivel y los slugs reservados salen de UNA lista.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-rutas.mts
 */
import { readdirSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const { RUTAS_DE_PRIMER_NIVEL, esRutaDePlataforma } = await import("./src/lib/tenancy/host.ts");
const { RESERVED_SLUGS } = await import("./src/lib/db/platform.ts");

const ok = (l: string, c: boolean, e = "") => console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);

// Las rutas REALES del árbol de `app`, leídas del disco: si mañana alguien
// agrega una sección de primer nivel y no la declara, esto lo dice.
const base = "src/app/[locale]";
const reales = readdirSync(base, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("(") )
  .flatMap((g) =>
    readdirSync(`${base}/${g.name}`, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => d.name),
  )
  .sort();

console.log(`  rutas de primer nivel en disco: ${reales.join(", ")}`);

// `evoelution` es la excepción declarada: es ruta pública Y slug de un cliente.
const esperadas = reales.filter((r) => r !== "evoelution");
const declaradas = [...RUTAS_DE_PRIMER_NIVEL].sort();

const faltan = esperadas.filter((r) => !declaradas.includes(r));
ok("ninguna ruta real queda sin declarar", faltan.length === 0, faltan.join(", ") || "todas declaradas");

const sobran = declaradas.filter((r) => !reales.includes(r));
ok("y ninguna declarada dejó de existir", sobran.length === 0, sobran.join(", ") || "todas existen");

ok("«consola» ya no se toma por una empresa", esRutaDePlataforma("consola"));
ok("y «consola» está reservada como slug", RESERVED_SLUGS.has("consola"));
ok("«evoelution» sigue resolviendo como empresa", !esRutaDePlataforma("evoelution"));
ok("y NO está reservada", !RESERVED_SLUGS.has("evoelution"));
ok("«evo-ai» se reserva en forma de slug", RESERVED_SLUGS.has("evo_ai"));
ok("los nombres de Postgres siguen reservados", RESERVED_SLUGS.has("public") && RESERVED_SLUGS.has("pg_catalog"));

// Las dos listas ya no pueden desalinearse: la de slugs deriva de la de rutas.
const sinReservar = declaradas.filter((r) => !RESERVED_SLUGS.has(r.replaceAll("-", "_")));
ok("toda ruta declarada tiene su slug reservado", sinReservar.length === 0, sinReservar.join(", ") || "");
process.exit(0);
