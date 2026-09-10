/**
 * Las rutas de primer nivel y los slugs reservados salen de UNA lista.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-rutas.mts
 */
import { readdirSync, readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.local" });

const { RUTAS_DE_PRIMER_NIVEL, esRutaDePlataforma } = await import("./src/lib/tenancy/host.ts");
const { RESERVED_SLUGS } = await import("./src/lib/db/platform.ts");

/*
  CUENTA los fallos. Antes solo los imprimía, y el `process.exit(0)` del final
  corría igual hubiera cruces o no: una comprobación roja salía con éxito y el
  CI la daba por buena. Se midió inyectando un fallo deliberado — salida 0.
*/
let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

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
/* ── LAS DOS PUERTAS DEL PORTAL PREGUNTAN LO MISMO ───────────────────────── */
/*
  EL BUCLE QUE ESTO VIGILA, Y QUE OCURRIÓ DE VERDAD.

  `/acceso` redirige al panel cuando hay sesión. El layout de `(app)` echa al
  usuario a `/acceso` cuando hay sesión pero NO hay contexto de inquilino. La
  segunda condición es más fuerte que la primera, así que una sesión sin ninguna
  empresa cumplía la de ida y fallaba la de vuelta: ERR_TOO_MANY_REDIRECTS.

  Medido antes de arreglarlo: 20 saltos, que era el tope del cliente. Después: 0.

  Le pasa a cualquiera que tenga el portal abierto y corra `npm run sync:prod`,
  porque la copia de producción reemplaza la base y la sesión del navegador
  sobrevive apuntando a un usuario que ya no está.

  Se comprueba leyendo el fuente y no navegando, porque esto tiene que poder
  ponerse rojo en el trabajo rápido del CI, sin levantar la aplicación. Lo que se
  exige es lo mínimo que impide el bucle: que la puerta de entrada resuelva el
  MISMO contexto que va a exigir el layout.
*/
const acceso = readFileSync("src/app/[locale]/[tenant]/acceso/page.tsx", "utf8");
const layout = readFileSync("src/app/[locale]/[tenant]/(app)/layout.tsx", "utf8");

ok(
  "el layout de (app) exige contexto de inquilino, no solo sesión",
  /getTenantContext\(\)/.test(layout),
);
ok(
  "…y /acceso resuelve ESE MISMO contexto antes de redirigir al panel",
  /getTenantContext\(\)/.test(acceso),
  "sin esto, una sesión sin empresa rebota entre las dos para siempre",
);
ok(
  "…y una sesión sin ninguna empresa se queda en el formulario",
  // El `redirect` al panel tiene que estar DENTRO de la comprobación de
  // contexto. Si vuelve a colgar solo de la sesión, el bucle está de vuelta.
  /if \(ctx\)[\s\S]{0,160}redirect\(/.test(acceso),
  "el redirect al panel debe depender del contexto, no de la sesión",
);

console.log(fallos ? `\n❌ ${fallos} comprobación(es) fallaron\n` : "");
process.exit(fallos ? 1 : 0);
