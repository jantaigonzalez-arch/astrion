/**
 * LAS NOVEDADES: BIEN ESCRITAS Y APUNTANDO A SITIOS QUE EXISTEN.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-novedades.mts
 *
 * La lista se escribe a mano en cada despliegue (`lib/novedades.ts`), y lo que
 * se escribe a mano se equivoca en silencio: un id repetido deja una novedad
 * sin punto para siempre, un «Ir» a una ruta que no existe manda a un 404 justo
 * desde el aviso que presume lo nuevo, y un texto largo convierte un aviso
 * discreto en un muro.
 */
import { existsSync } from "node:fs";
import { NOVEDADES, VIGENCIA_DIAS } from "./src/lib/novedades.ts";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const ids = NOVEDADES.map((n) => n.id);
ok("cada novedad tiene un id único (es lo que se recuerda como «visto»)", new Set(ids).size === ids.length);
ok("las fechas son AAAA-MM-DD y reales",
  NOVEDADES.every((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.fecha) && !Number.isNaN(Date.parse(n.fecha))));
ok("la más nueva va arriba", NOVEDADES.every((n, i) => i === 0 || NOVEDADES[i - 1].fecha >= n.fecha));
const largos = NOVEDADES.filter((n) => n.titulo.length > 40 || n.texto.length > 200);
ok("discretas: título de hasta 40 caracteres y texto de hasta 200", largos.length === 0, largos.map((n) => n.id).join(", "));
const RAIZ = "src/app/[locale]/[tenant]/(app)";
const rotas = NOVEDADES.filter((n) => n.href && !existsSync(`${RAIZ}${n.href}/page.tsx`));
ok("cada «Ir» apunta a una pantalla que existe", rotas.length === 0, rotas.map((n) => n.href).join(", "));
ok(`se retiran solas a los ${VIGENCIA_DIAS} días`, VIGENCIA_DIAS > 0 && VIGENCIA_DIAS <= 14);

if (fallos) {
  console.error(`\n❌ ${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\n✓ todo en orden");
