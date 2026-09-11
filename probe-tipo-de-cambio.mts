/**
 * EL TIPO DE CAMBIO: QUÉ VALE EN CADA FECHA, Y DE DÓNDE SALE.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-tipo-de-cambio.mts
 *
 * Sin base ni red. La cuenta de fechas es donde un error no se ve: un día de
 * desfase da una cifra perfectamente creíble —el dólar de ayer se parece mucho
 * al de hoy— y se estampa en cada negocio en dólares que se guarde. Así que se
 * prueba con un calendario inventado que tiene lo difícil: fin de semana, un
 * festivo a media semana y el último FIX, que todavía no se ha publicado.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  SERIES,
  fechaDelSie,
  hoyEnMexico,
  paraOperacionesDel,
  publicadoAl,
  siguienteDiaHabil,
} from "./src/lib/tipo-de-cambio.ts";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

// Septiembre de 2026: el 12 y 13 son fin de semana y el 16 es festivo (no hay
// FIX). Valores inventados, uno distinto por día para que un desfase se note.
const serie = [
  { fecha: "2026-09-08", valor: 8 },
  { fecha: "2026-09-09", valor: 9 },
  { fecha: "2026-09-10", valor: 10 },
  { fecha: "2026-09-11", valor: 11 },
  { fecha: "2026-09-14", valor: 14 },
  { fecha: "2026-09-15", valor: 15 },
  { fecha: "2026-09-17", valor: 17 },
];
const val = (v: { valor: number } | null) => v?.valor ?? null;

console.log("── qué FIX vale para una operación (art. 20 del CFF: el publicado el día anterior) ──");
ok("jueves 10: el publicado el miércoles 9, que es el FIX del martes 8", val(paraOperacionesDel(serie, "2026-09-10")) === 8);
ok("sábado 12: el publicado el viernes 11 → FIX del jueves 10", val(paraOperacionesDel(serie, "2026-09-12")) === 10);
ok("lunes 14: el domingo no se publica, vale el del viernes → FIX del jueves 10",
  val(paraOperacionesDel(serie, "2026-09-14")) === 10);
ok("martes 15: el publicado el lunes 14 → FIX del viernes 11", val(paraOperacionesDel(serie, "2026-09-15")) === 11);
ok("jueves 17, tras el festivo: el 16 no hubo DOF, vale el del 15 → FIX del lunes 14",
  val(paraOperacionesDel(serie, "2026-09-17")) === 14);
ok("sin datos, no se inventa: null", paraOperacionesDel([], "2026-09-10") === null);
ok("antes del primer FIX publicado, tampoco", paraOperacionesDel(serie, "2026-09-08") === null);

console.log("── cuándo se publica cada FIX ──");
const pub = publicadoAl(serie, "2026-09-18");
ok("el FIX del 15 se publica el 17: el festivo no cuenta", publicadoAl(serie, "2026-09-17")?.publicado === "2026-09-17" && val(publicadoAl(serie, "2026-09-17")) === 15);
ok("el último FIX (17) todavía no tiene «siguiente»: se supone el viernes 18", pub?.publicado === "2026-09-18" && pub.valor === 17);
ok("el siguiente día hábil de un viernes es el lunes", siguienteDiaHabil("2026-09-11") === "2026-09-14");
ok("y el de un sábado, también", siguienteDiaHabil("2026-09-12") === "2026-09-14");

console.log("── lo que llega del SIE ──");
ok("«10/09/2026» → 2026-09-10", fechaDelSie("10/09/2026") === "2026-09-10");
ok("fechas imposibles o mal formadas → null", fechaDelSie("31/02/2026") === null && fechaDelSie("2026-09-10") === null && fechaDelSie("N/E") === null);
ok("«hoy» es el de la Ciudad de México, no el UTC",
  hoyEnMexico(new Date("2026-09-11T03:30:00Z")) === "2026-09-10");

console.log("── de dónde sale ──");
ok("el dólar es SF43718 (FIX por fecha de determinación), no SF60653 (liquidación)",
  SERIES.USD === "SF43718" && SERIES.EUR === "SF46410");
const src = (f: string) => readFileSync(f, "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const datos = sinComentarios(src("src/lib/data/tipo-de-cambio.ts"));
ok("se lee una vez para toda la plataforma (`referenciaCacheCon` sobre `getDb`)",
  /referenciaCacheCon\(/.test(datos) && /getDb\(\)/.test(datos) && !/tenantDb|requireTenant/.test(datos));
ok("el negocio en dólares estampa lo que decide `tipoDeCambioDeLaEmpresa`, no `usdRate` a secas",
  /tipoDeCambioDeLaEmpresa\(db/.test(sinComentarios(src("src/lib/actions/crm.ts"))) &&
  !/settings\.usdRate/.test(sinComentarios(src("src/lib/actions/crm.ts"))));
const empresa = sinComentarios(src("src/lib/data/settings.ts"));
ok("sin dato de Banxico cae al manual, y sin manual no inventa (`null`)",
  /paraHoy\)/.test(empresa) && /s\.usdRate \? \{ valor: s\.usdRate, fuente: "manual" \} : null/.test(empresa));
ok("el cargador valida el rango y no escribe si algo no se entiende",
  /RANGO/.test(src("scripts/tipo-de-cambio.ts")) && /No se escribe nada/.test(src("scripts/tipo-de-cambio.ts")));

console.log("── el token no está en el repositorio ──");
const compose = src("docker-compose.prod.yml");
ok("el servicio diario existe, con --aplicar y el token por variable",
  /tipo-de-cambio:\n/.test(compose) && /tipo-de-cambio\.ts --aplicar/.test(compose) && /BANXICO_TOKEN: \$\{BANXICO_TOKEN:-\}/.test(compose));
ok("la plantilla de deploy/.env lo deja vacío", /^BANXICO_TOKEN=$/m.test(src("deploy/.env.example")));
const versionados = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
ok("ningún .env con valores está versionado", !versionados.some((f) => /(^|\/)\.env(\.local|\.production)?$/.test(f)));
const conToken = versionados.filter((f) => {
  try {
    return /BANXICO_TOKEN\s*[=:]\s*["']?[0-9a-f]{32,}/i.test(readFileSync(f, "utf8"));
  } catch {
    return false;
  }
});
ok("ningún archivo versionado trae un token de Banxico escrito", conToken.length === 0, conToken.join(", "));

if (fallos) {
  console.error(`\n❌ ${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\n✓ todo en orden");
