/**
 * EL INVENTARIO: SU CARGA DESDE EL ERP ANTERIOR Y LO QUE LO MANTIENE LIGERO.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-inventario.mts
 *
 * Sin base. Dos cosas:
 *
 * ── 1. EL LECTOR DEL REPORTE «EXISTENCIAS Y COSTOS ACTUALES» ───────────────
 *
 * Sobre un reporte INVENTADO que reproduce las rarezas medidas en el real: la
 * descripción que cambia de columna entre páginas, el total que cae una columna
 * a la izquierda cuando el número es largo, códigos repetidos idénticos y
 * distintos, un código con apóstrofo, descripciones cortadas a 40 caracteres y
 * el pie con los totales. Datos de fantasía a propósito: este repositorio es
 * público, y el reporte real trae costos de la empresa.
 *
 * ── 2. NINGUNA PANTALLA VUELVE A CARGAR EL CATÁLOGO ENTERO ─────────────────
 *
 * Con las 6 609 refacciones del ERP anterior, el inventario pesaba 10 MB y un
 * ticket 1.2 MB. Se comprueba sobre el código que las pantallas pidan una
 * página o una búsqueda, y que la exportación sea la única que pide todo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { parseCsvFilas } from "./src/lib/import/csv.ts";
import {
  consolidar,
  cuadrar,
  fechaDelReporte,
  leerReporteExistencias,
} from "./src/lib/import/reporte-existencias.ts";

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

/* ───────────────────────── 1. el lector ───────────────────────── */

const fila = (celdas: Record<number, string>) => {
  const r = Array.from({ length: 15 }, () => "");
  for (const [i, v] of Object.entries(celdas)) r[Number(i)] = v;
  return r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
};
const DESC40 = "Filtro de prueba para columna ficticia A"; // 40 exactos
const reporte = [
  fila({ 6: "EMPRESA DE PRUEBA" }),
  fila({ 3: "Existencias y costos actuales" }),
  fila({ 1: "Productos:", 3: "Todos" }),
  // Página 1: la descripción en la columna 3.
  fila({ 1: "Producto", 3: "Descripción", 6: "Costeo", 7: "Últ. Comp", 8: "Últ.Costo", 9: "Costo prom.", 11: "Existencia", 12: "Costo total" }),
  fila({ 1: "'ZZ-001", 3: "Pieza con apóstrofo", 6: "Promedio", 8: "0.00", 9: "0.00", 11: "0", 14: "0.00" }),
  fila({ 1: "ZZ-002", 3: "Pieza repetida igual", 6: "Promedio", 7: "15/Ene/2020", 8: "10.00", 9: "10.00", 11: "0", 14: "0.00" }),
  fila({ 1: "zz-003", 3: "Pieza repetida distinta", 6: "Promedio", 7: "02/Mar/2024", 8: "50.00", 9: "40.00", 11: "0", 13: "0.00" }),
  fila({ 1: "Los montos se encuentran expresados en: Pesos con el tipo de cambio: 1.000000" }),
  fila({ 1: "Usuario", 2: "Alguien", 6: "|    Fecha y hora:", 8: "01/02/2025  10:30", 12: "Pág.", 13: "1" }),
  // Página 2: la descripción en la columna 2, y un total largo en la 12.
  fila({ 1: "Producto", 2: "Descripción", 6: "Costeo", 7: "Últ. Comp", 8: "Últ.Costo", 9: "Costo prom.", 11: "Existencia", 12: "Costo total" }),
  fila({ 1: "ZZ-002", 2: "Pieza repetida igual", 6: "Promedio", 7: "15/Ene/2020", 8: "10.00", 9: "10.00", 11: "0", 14: "0.00" }),
  fila({ 1: "ZZ-003", 2: "Pieza repetida distinta, bis", 6: "Promedio", 7: "11/Abr/2025", 8: "812.50", 9: "812.50", 11: "4", 13: "3,250.00" }),
  fila({ 1: "ZZ-004", 2: DESC40, 6: "Promedio", 7: "20/Feb/2025", 8: "2,100.00", 9: "1,950.25", 11: "239", 12: "466,109.75" }),
  fila({ 1: "ZZ-005", 6: "Promedio", 8: "0.00", 9: "0.00", 11: "2", 13: "0.00" }),
  fila({ 1: "Total de registros impresos:", 3: "7", 9: "Total:", 11: "245", 13: "469,359.75" }),
  fila({ 1: "Usuario", 2: "Alguien", 6: "|    Fecha y hora:", 8: "01/02/2025  10:30", 12: "Pág.", 13: "2" }),
].join("\n");

const rep = leerReporteExistencias(parseCsvFilas(reporte));
console.log("── el lector del reporte ──");
ok("lee los siete productos y nada del membrete ni de los pies", rep.productos.length === 7, `${rep.productos.length}`);
ok("saca moneda, tipo de cambio y fecha del reporte",
  rep.moneda === "Pesos" && rep.tipoDeCambio === 1 && rep.fechaHora === "01/02/2025 10:30");
ok("la descripción, venga en la columna 2 o en la 3",
  rep.productos.find((p) => p.fila === 6)?.descripcion === "Pieza repetida igual" &&
  rep.productos.find((p) => p.fila === 11)?.descripcion === "Pieza repetida igual");
ok("el total que cae en la columna 12 también se lee",
  rep.productos.find((p) => p.codigo === "ZZ-004")?.costoTotal === 466109.75);
ok("el apóstrofo se quita, y se avisa",
  rep.productos[0].codigo === "ZZ-001" && rep.incidencias.some((i) => i.tipo === "código con apóstrofo"));
ok("el código se normaliza a mayúsculas", rep.productos.some((p) => p.codigoOriginal === "zz-003" && p.codigo === "ZZ-003"));
ok("fechas del reporte: «15/Ene/2020» → 2020-01-15, y lo inválido es null",
  fechaDelReporte("15/Ene/2020") === "2020-01-15" && fechaDelReporte("31/Feb/2020") === null && fechaDelReporte("x") === null);
ok("cuadra con su pie", cuadrar(rep).length === 0, cuadrar(rep).join("; "));

const conOtroPie = leerReporteExistencias(parseCsvFilas(reporte.replace(',7,', ',8,')));
ok("…y si el pie dice otro número de registros, NO cuadra", cuadrar(conOtroPie).some((e) => /registros/.test(e)));
const enDolares = leerReporteExistencias(parseCsvFilas(reporte.replace("en: Pesos", "en: Dólares")));
ok("…ni si los importes no vienen en pesos", cuadrar(enDolares).some((e) => /pesos/.test(e)));
const sinPie = leerReporteExistencias(parseCsvFilas(reporte.split("\n").filter((l) => !l.includes("Total de registros")).join("\n")));
ok("…ni si falta el pie: un archivo cortado no se carga", cuadrar(sinPie).some((e) => /incompleto/.test(e)));

const { partes, incidencias } = consolidar(rep.productos);
const por = (c: string) => partes.find((p) => p.codigo === c)!;
console.log("── una refacción por código ──");
ok("siete filas, cinco refacciones", partes.length === 5, `${partes.length}`);
ok("repetido idéntico: una sola vez, sin duplicar existencia",
  por("ZZ-002").existencia === 0 && incidencias.some((i) => i.codigo === "ZZ-002" && /idénticas/.test(i.tipo)));
ok("repetido distinto: se suma la existencia y costo/descr. salen de la fila con piezas",
  por("ZZ-003").existencia === 4 && por("ZZ-003").costoMxn === "812.50" &&
  por("ZZ-003").descripcion === "Pieza repetida distinta, bis" &&
  incidencias.some((i) => i.codigo === "ZZ-003" && /distintos/.test(i.tipo)));
ok("costo 0 en el reporte es costo DESCONOCIDO (null), no cero", por("ZZ-001").costoMxn === null);
ok("sin descripción: se carga «Sin descripción» y se avisa",
  por("ZZ-005").descripcion === "Sin descripción" && incidencias.some((i) => i.codigo === "ZZ-005" && i.tipo === "sin descripción"));
ok("…y con piezas sin costo, también se avisa",
  incidencias.some((i) => i.codigo === "ZZ-005" && i.tipo === "existencia sin costo"));
ok("una descripción de 40 exactos se marca como posiblemente cortada",
  incidencias.some((i) => i.codigo === "ZZ-004" && /cortada/.test(i.tipo)));
ok("las piezas totales se conservan al consolidar",
  partes.reduce((s, p) => s + p.existencia, 0) === 245);

/* ──────────────── 2. ninguna pantalla carga el catálogo ──────────────── */

const src = (f: string) => readFileSync(f, "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const archivos: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const r = `${d}/${e}`;
    if (statSync(r).isDirectory()) walk(r);
    else if (/\.tsx?$/.test(e)) archivos.push(r);
  }
})("src");

console.log("── ninguna pantalla carga el catálogo entero ──");
const llamanTodo = archivos.filter(
  (f) => /getSpareParts\(/.test(sinComentarios(src(f))) && !f.endsWith("data/parts.ts"),
);
ok("solo la exportación pide el catálogo entero (`getSpareParts`)",
  llamanTodo.length === 1 && llamanTodo[0].endsWith("export/datasets.ts"), llamanTodo.join(", "));
ok("`partsForPicker` no volvió", !archivos.some((f) => /partsForPicker/.test(src(f))));
ok("el catálogo del negocio no lleva refacciones",
  !/spareParts/.test(sinComentarios(src("src/lib/data/crm-insights.ts")).split("export async function getCatalogOptions")[1]?.split("export ")[0] ?? "x"));
ok("el buscador de la bitácora busca, no recibe una lista",
  /buscar: \(q: string\) => Promise<PartOption\[\]>/.test(src("src/components/portal/parts-picker.tsx")) &&
  !/\bparts: PartOption\[\]/.test(src("src/components/portal/parts-picker.tsx")));
const inventario = sinComentarios(src("src/app/[locale]/[tenant]/(app)/admin/refacciones/page.tsx"));
ok("el inventario pide una página y la pagina", /listarRefacciones\(/.test(inventario) && /<Pagination/.test(inventario));
const accion = sinComentarios(src("src/lib/actions/parts.ts"));
ok("la búsqueda es solo para el personal: el catálogo lleva costos",
  /export async function buscarRefaccionesAccion[\s\S]*?isInternal\(await currentRole\(\)\)/.test(accion));
ok("la búsqueda tiene tope de resultados", /\.limit\(Math\.min\(/.test(src("src/lib/data/parts.ts")));
ok("crear una orden lee solo SUS refacciones, no el catálogo",
  /\.from\(spareParts\)\s*\.where\(inArray\(spareParts\.id/.test(src("src/lib/actions/purchasing.ts")));

console.log("── los buscadores no pierden el prefijo de la empresa ──");
// Un `<form method="get" action="/admin/…">` crudo perdía `/evoelution/` en
// producción y mandaba a un 404 (pasó en Clientes). Se va por `FormularioGet`.
const formsCrudos = archivos.filter(
  (f) => !f.endsWith("formulario-get.tsx") && /<form[^>]*method="get"/.test(src(f)),
);
ok("ningún formulario GET crudo fuera de `FormularioGet`", formsCrudos.length === 0, formsCrudos.join(", "));
ok("`FormularioGet` resuelve el prefijo como `Link`",
  /tenantHref\(action/.test(src("src/components/portal/formulario-get.tsx")) &&
  /useRouter\(\)/.test(src("src/components/portal/formulario-get.tsx")));

if (fallos) {
  console.error(`\n❌ ${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\n✓ todo en orden");
