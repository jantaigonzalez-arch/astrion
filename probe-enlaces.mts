/**
 * TODOS LOS ENLACES INTERNOS VAN A ALGÚN SITIO, Y AL SITIO CORRECTO.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-enlaces.mts
 *
 * ── DOS DEFECTOS DISTINTOS, Y EL SEGUNDO ES EL QUE DUELE ──────────────────
 *
 * 1. EL ENLACE ROTO. Apunta a una ruta que no existe: da 404. Molesto y fácil
 *    de ver — quien lo pulsa se entera al instante.
 *
 * 2. EL ENLACE MAL APUNTADO. Va a una ruta que SÍ existe, y por eso responde
 *    200 y nadie lo llama error. Este es el que se queda años.
 *
 * El segundo apareció de verdad: en la ficha de un cliente, los ocho tickets de
 * su historial enlazaban a `/admin/tickets` —la cola entera— en vez de a cada
 * ticket. Se pulsaba uno y había que volver a buscarlo en una lista de 633. El
 * enlace existía, respondía 200, y llevaba meses así.
 *
 * ── CÓMO SE HUELE EL SEGUNDO ──────────────────────────────────────────────
 *
 * Un enlace DENTRO de una lista que muestra un dato de la fila —el folio del
 * ticket, el nombre del cliente— pero cuyo destino no depende de esa fila. Si el
 * texto cambia con cada renglón y el destino no, los renglones llevan todos al
 * mismo sitio, que es justo lo que nadie espera de una lista.
 *
 * No es una regla universal: un «Ver todos» dentro de una lista es legítimo. Por
 * eso lo que se exige es que el enlace NO muestre un campo de la fila; si lo
 * muestra, promete llevar ahí.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const RAIZ = process.cwd();

/* ── Las rutas que existen ─────────────────────────────────────────────────── */
const rutas = new Set<string>();
(function recorrer(dir: string, prefijo: string) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (!statSync(p).isDirectory()) {
      if (e === "page.tsx" || e === "route.ts") rutas.add(prefijo || "/");
      continue;
    }
    if (e.startsWith("_")) continue;
    /*
      Los grupos `(app)` no salen en la URL. `[locale]` y `[tenant]` tampoco los
      escribe nadie a mano: los pone el proxy —el idioma por `as-needed` y el
      inquilino por subdominio o por el primer segmento—. Un enlace se escribe
      `/admin/tickets`, no `/es/evoelution/admin/tickets`.
    */
    if (/^\(.*\)$/.test(e) || e === "[locale]" || e === "[tenant]") {
      recorrer(p, prefijo);
      continue;
    }
    recorrer(p, `${prefijo}/${e}`);
  }
})(path.join(RAIZ, "src/app"), "");

const patrones = [...rutas].map((r) => ({
  ruta: r,
  re: new RegExp(
    "^" + r.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "$",
  ),
}));

/* ── Los archivos donde se escriben ────────────────────────────────────────── */
const archivos: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules") walk(p);
      continue;
    }
    if (/\.tsx$/.test(e)) archivos.push(p);
  }
})(path.join(RAIZ, "src"));

const HREF = /href=(?:"([^"]+)"|\{`([^`]+)`\}|\{"([^"]+)"\})/g;
const rel = (f: string) => f.replace(RAIZ + "/", "");

/* ── 1 · Ninguno apunta a una ruta que no existe ───────────────────────────── */
console.log("\nTODO ENLACE INTERNO RESUELVE A UNA RUTA REAL");

const rotos: string[] = [];
let revisados = 0;

for (const f of archivos) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(HREF)) {
    const crudo = m[1] ?? m[2] ?? m[3];
    if (!crudo.startsWith("/")) continue;
    if (/^\/(api|uploads|_next)\//.test(crudo)) continue;

    /*
      Se limpia antes de comparar:
        · lo interpolado (`${t.id}`) es un segmento cualquiera;
        · una interpolación que mete una CONSULTA (`${x ? "?a=1" : ""}`) no es
          un segmento: se quita entera. Sin esto, `/actividades${…?scope}` se
          leía como una ruta llamada «actividadesX» y salía como rota.
    */
    let normal = crudo
      .replace(/\$\{[^}]*\?[^}]*\}/g, "")
      .replace(/\$\{[^}]*\}/g, "X")
      .split("?")[0]
      .split("#")[0]
      .replace(/\/$/, "");
    if (!normal) normal = "/";

    /*
      El inquilino en la ruta. En modo `una-empresa` el portal vive bajo
      `/evoelution/...`, y el sitio público enlaza así a propósito. Se prueba
      también sin el primer segmento antes de darlo por roto.

      SOLO si quedan al menos dos segmentos. La primera versión hacía
      `replace(/^\/[^/]+/)` a secas, y sobre una ruta de un solo segmento eso
      deja la cadena vacía, que se leía como `/` — la portada, que existe. O sea
      que CUALQUIER ruta inventada de un segmento pasaba la comprobación. Se
      descubrió probando el propio probe con una ruta falsa: la cazó la otra
      comprobación y no ésta, que era la que debía.
    */
    const partes = normal.split("/").filter(Boolean);
    const sinInquilino = partes.length >= 2 ? `/${partes.slice(1).join("/")}` : null;
    revisados++;
    if (
      !patrones.some(
        (p) => p.re.test(normal) || (sinInquilino !== null && p.re.test(sinInquilino)),
      )
    ) {
      rotos.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length} → ${crudo}`);
    }
  }
}

ok(`hay rutas que comprobar (${rutas.size}) y enlaces que revisar (${revisados})`, rutas.size > 20 && revisados > 50);
ok(
  "ninguno apunta a una ruta inexistente",
  rotos.length === 0,
  rotos.slice(0, 6).join(" · "),
);

/* ── 2 · Ninguno promete una fila y lleva a otro sitio ─────────────────────── */
console.log("\nUN ENLACE QUE MUESTRA UNA FILA LLEVA A ESA FILA");

const malApuntados: string[] = [];
for (const f of archivos) {
  const lineas = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lineas.length; i++) {
    if (!/\.map\(\s*\(?\w/.test(lineas[i])) continue;
    const trozo = lineas.slice(i, i + 40).join("\n");
    const fin = trozo.indexOf("))}");
    const cuerpo = fin > 0 ? trozo.slice(0, fin) : trozo;

    for (const m of cuerpo.matchAll(HREF)) {
      const href = m[1] ?? m[2] ?? m[3];
      if (!href.startsWith("/") || href.includes("${")) continue;

      const desde = cuerpo.slice(m.index);
      const cierre = desde.indexOf("</Link>");
      const dentro = cierre > 0 ? desde.slice(0, cierre) : desde.slice(0, 300);

      // ¿Lo que se ve dentro del enlace es un campo de la fila?
      if (/\{\s*\w+\.\w+/.test(dentro)) {
        const linea = i + 1 + cuerpo.slice(0, m.index).split("\n").length - 1;
        malApuntados.push(`${rel(f)}:${linea} → ${href}`);
      }
    }
  }
}

ok(
  "ninguna lista enlaza sus filas a un destino fijo",
  malApuntados.length === 0,
  malApuntados.slice(0, 6).join(" · "),
);

console.log(
  fallos
    ? `\n❌ ${fallos} comprobación(es) fallaron\n`
    : "\n✅ los enlaces internos existen y apuntan a donde dicen\n",
);
process.exit(fallos ? 1 : 0);
