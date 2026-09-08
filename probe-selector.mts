/**
 * EL SELECTOR ELIGE LA FORMA CORRECTA, Y BUSCA COMO SE TECLEA EN MÉXICO.
 *
 * Lo que se comprueba NO es que pinte: es que la decisión —nativo o buscador—
 * caiga del lado correcto, y que el filtro encuentre lo que una persona escribe
 * de verdad. Las dos cosas se pueden equivocar en silencio: un umbral mal puesto
 * deja una lista de 600 tickets como `<select>`, y un filtro que respeta acentos
 * deja «merida» sin resultados sobre una lista que sí tiene Mérida.
 *
 * La normalización y el filtro se replican aquí a mano, contra el archivo, y no
 * se importan: el componente es `use client` y arrastra React. Lo que se compara
 * es que la regla escrita en el probe y la del componente sean la MISMA cadena
 * —se lee del propio fuente— así que no pueden separarse sin que esto falle.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-selector.mts
 */
import { readFileSync } from "node:fs";

let fallos = 0;
const ok = (l: string, c: boolean, e = "", soloAlFallar = false) => {
  if (!c) fallos++;
  const detalle = e && (!soloAlFallar || !c) ? ` — ${e}` : "";
  console.log(`${c ? "✓" : "✗"} ${l}${detalle}`);
};

const fuente = readFileSync("src/components/ui/selector.tsx", "utf8");

/* ── 1 · El umbral está donde dice la documentación ── */
console.log("\nLA DECISIÓN: NATIVO O BUSCADOR");
const umbral = Number(/umbral = (\d+)/.exec(fuente)?.[1]);
ok(`el umbral por omisión es 12 (leído del fuente: ${umbral})`, umbral === 12);
ok(
  "la lista corta cae al `<select>` nativo",
  /if \(opciones\.length <= umbral\)/.test(fuente),
);
ok(
  "y el nativo lleva el `name`, así que envía valor sin JavaScript",
  /<select[\s\S]{0,200}name=\{name\}/.test(fuente),
);
ok(
  "la lista larga lleva un input oculto con el valor",
  /<input type="hidden" name=\{name\} value=\{valor\}/.test(fuente),
);

/* ── 2 · Las piezas de accesibilidad que no son decorativas ── */
console.log("\nLO QUE NO SE PUEDE PERDER AL SALIRSE DE LO NATIVO");
for (const [q, pieza] of [
  ['role="combobox"', "el campo se anuncia como combobox"],
  ["aria-expanded", "dice si la lista está abierta"],
  ["aria-activedescendant", "el foco NO se va a la lista"],
  ['role="listbox"', "la lista se anuncia como lista"],
  ['role="option"', "cada renglón es una opción"],
  ["aria-selected", "se anuncia cuál está elegida"],
  ['aria-live="polite"', "se dice cuántos resultados quedan"],
  ['aria-autocomplete="list"', "se anuncia que filtra"],
] as const) {
  ok(pieza, fuente.includes(q), `falta ${q}`, true);
}

console.log("\nEL TECLADO COMPLETO");
for (const t of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape", "Tab"]) {
  ok(`responde a ${t}`, fuente.includes(`"${t}"`));
}
// Esc tiene dos gestos: limpiar el filtro y cerrar. Si se colapsan, hay que
// cerrar y reabrir para corregir una letra.
ok(
  "Esc limpia el filtro antes de cerrar",
  /if \(filtro\) setFiltro\(""\);\s*\n\s*else cerrar\(\);/.test(fuente),
);
// El clic llega después del blur: con `onClick` la lista ya se cerró.
ok("elige con `mousedown`, no con `click`", fuente.includes("onMouseDown"));

/* ── 3 · El filtro, con la MISMA regla que el componente ── */
console.log("\nLA BÚSQUEDA");
const rango = /\.replace\((\/\[[^\]]*\]\/g)/.exec(fuente)?.[1];
ok(`quita los diacríticos con ${rango}`, rango === "/[\\u0300-\\u036f]/g");

const normalizar = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const casa = (o: { label: string; detalle?: string; buscar?: string }, q: string) => {
  const heno = normalizar(`${o.label} ${o.detalle ?? ""} ${o.buscar ?? ""}`);
  return normalizar(q.trim())
    .split(/\s+/)
    .every((p) => heno.includes(p));
};

const contrato = { label: "CO1622894", detalle: "Laboratorios Ñuño", buscar: "Mérida, Yucatán" };
ok("«merida» encuentra «Mérida» (sin acento)", casa(contrato, "merida"));
ok("«MÉRIDA» también (mayúsculas y acento)", casa(contrato, "MÉRIDA"));
ok("«nuno» encuentra «Ñuño»", casa(contrato, "nuno"));
ok("«1622894» encuentra por folio", casa(contrato, "1622894"));
ok(
  "«yucatan nuno» casa en cualquier orden y entre campos distintos",
  casa(contrato, "yucatan nuno"),
);
ok("«guadalajara» NO casa", !casa(contrato, "guadalajara"));
// Que la comparación pueda fallar: sin este aserto, un `casa()` que devolviera
// siempre true pasaría los cinco de arriba.
ok("y el filtro sabe decir que no", !casa(contrato, "xyz"));

/* ── 4 · El caso de la captura: folios con prefijo común ── */
console.log("\nEL CASO QUE LO ORIGINÓ");
const folios = Array.from({ length: 54 }, (_, i) => ({
  label: `CO16${String(228 + i).padStart(5, "0")}`,
  detalle: i === 30 ? "Laboratorios del Bajío" : `Cliente ${i}`,
}));
ok(
  `54 contratos superan el umbral de ${umbral} → buscador`,
  folios.length > umbral,
);
const porCliente = folios.filter((f) => casa(f, "bajio"));
ok(
  `se llega por el nombre del cliente, no solo por el folio (${porCliente.length} de 54)`,
  porCliente.length === 1,
);
// Lo que el tecleo del navegador NO puede hacer: casar por el medio del folio.
const porMedio = folios.filter((f) => casa(f, "00250"));
ok(
  `y por un trozo DEL MEDIO del folio (00250), que el tecleo del navegador no alcanza (${porMedio.length})`,
  porMedio.length === 1,
);

/* ── 5 · No se pintan seiscientas opciones para enseñar ocho ── */
console.log("\nLO QUE SE PINTA");
const tope = Number(/TOPE_PINTADO = (\d+)/.exec(fuente)?.[1]);
ok(`hay un tope de opciones pintadas (${tope})`, tope === 100);
ok(
  "la navegación se queda dentro de lo pintado",
  fuente.includes("pintadas.length - 1") && fuente.includes("const o = pintadas[activo]"),
  "con `activo` fuera del tope, Enter no elegiría nada",
  true,
);
ok(
  "lo recortado se DICE al pie, no se esconde",
  /y \{ocultas\} más/.test(fuente),
);
ok(
  "y el pie no es una opción navegable",
  /role="presentation"/.test(fuente),
  'sin esto las flechas se paran sobre algo que no se puede elegir',
  true,
);
ok(
  "la región viva avisa de que la lista está recortada",
  /se muestran los primeros/.test(fuente),
);

console.log(fallos ? `\n❌ ${fallos} fallo(s)\n` : "\n✅ el selector decide y busca como debe\n");
process.exit(fallos ? 1 : 0);
