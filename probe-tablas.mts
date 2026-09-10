/**
 * Las tablas del ERP tienen un solo criterio.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-tablas.mts
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const { densidadGuardada, DENSIDADES } = await import("./src/lib/densidad.ts");
const { reglasDeAncho, firmaDeColumnas } = await import("./src/components/portal/anchos-de-columna.tsx");
const { reglasDeColumnas } = await import("./src/components/portal/columnas-visibles.tsx");

let fallos = 0;
const check = (l: string, c: boolean, e = "") => { if (!c) fallos++; console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`); };
const sh = (c: string) => execSync(c, { encoding: "utf8" }).trim();

console.log("── ninguna tabla se queda fuera del criterio común ──");
// `<table` real: el que abre un atributo o cierra en la misma línea. El de un
// comentario de documentación no cuenta, y contarlo daría un fallo eterno.
const todas = sh(`grep -rhoE '<table( [^>]*)?>' src/app src/components --include='*.tsx' || true`)
  .split("\n").filter((t) => t.includes("className"));
const sinMarcar = todas.filter((t) => !t.includes("tabla-erp"));
check(`las ${todas.length} tablas llevan la clase compartida`, sinMarcar.length === 0,
  sinMarcar.slice(0, 3).join(" ") || "");

console.log("\n── el estilo está donde puede ganar ──");
const css = readFileSync("src/app/globals.css", "utf8");
check("el relleno sale de la densidad, no de cada celda",
  /\.tabla-erp th,\s*\n?\s*\.tabla-erp td \{[^}]*var\(--fila-y\)/.test(css));
check("el encabezado acompaña al desplazamiento",
  /\.tabla-erp thead th \{[^}]*position: sticky/.test(css));
check("y con fondo OPACO, o las filas se leerían por debajo",
  /\.tabla-erp thead th \{[^}]*background: var\(--color-secondary\)/.test(css));
check("la fila bajo el cursor se marca", /\.tabla-erp tbody tr:hover/.test(css));
check("los números van a la derecha y con cifras de ancho fijo",
  /\.tabla-erp \[data-num\][^}]*tabular-nums/.test(css));
for (const d of DENSIDADES) {
  check(`la densidad «${d}» define sus medidas`,
    new RegExp(`\\[data-densidad="${d}"\\]\\s*\\{[^}]*--fila-y`).test(css));
}

console.log("\n── la preferencia se sanea ──");
check("una cookie válida se respeta", densidadGuardada("compacta") === "compacta");
check("una inventada cae a normal", densidadGuardada("gigante") === "normal");
check("y la ausencia también", densidadGuardada(undefined) === "normal" && densidadGuardada(null) === "normal");

console.log("\n── las columnas numéricas están marcadas ──");
const marcadas = Number(sh(`grep -rho 'data-num' src/app src/components --include='*.tsx' | wc -l`));
check("hay columnas numéricas declaradas", marcadas > 50, `${marcadas} celdas`);
const derechaSinMarcar = Number(sh(
  `grep -rho '<t[hd] className="[^"]*text-right[^"]*"' src/app src/components --include='*.tsx' | wc -l`));
check("ninguna celda alineada a la derecha quedó sin marcar",
  derechaSinMarcar === 0, `${derechaSinMarcar} sin marcar`);

console.log("\n── el ordenamiento llega a las pantallas de trabajo ──");
/*
  Se comprueba sobre el CÓDIGO y no sobre una lista escrita a mano: lo que
  importa es que la pantalla use el mecanismo común —`ThOrden` alimentado por
  `parseOrden`— y no que exista un archivo con cierto nombre. Una pantalla que
  vuelva a ordenar por su cuenta no aparecería aquí, y aparecer es el punto.
*/
const CON_ORDEN = [
  ["cola de tickets", "admin/tickets/page.tsx"],
  ["equipos", "admin/equipos/page.tsx"],
  ["contratos", "admin/contratos/page.tsx"],
  ["proveedores", "admin/compras/proveedores/page.tsx"],
  ["órdenes de compra", "admin/compras/page.tsx"],
  ["contactos", "admin/crm/contactos/page.tsx"],
  ["usuarios", "admin/configuracion/usuarios/page.tsx"],
] as const;
const RAIZ = "src/app/[locale]/[tenant]/(app)/";
for (const [nombre, rel] of CON_ORDEN) {
  const src = readFileSync(RAIZ + rel, "utf8");
  // `ThOrden` en las tablas y `OrdenFichas` en las que se dibujan como
  // tarjetas —contratos, pedidos—: son el mismo mecanismo con dos formas, y
  // exigir la de tabla dejaría fuera a las que no la pueden usar.
  const control = src.includes("ThOrden") || src.includes("OrdenFichas");
  check(`${nombre}: ordena con el mecanismo común`,
    src.includes("parseOrden") && control);
}

console.log("\n── y el ORDER BY no se escribe a mano ──");
const orden = readFileSync("src/lib/data/orden.ts", "utf8");
check("lo vacío va al final en las dos direcciones", orden.includes("nulls last"));
check("y hay desempate estable, o la paginación repite filas",
  /desempate/.test(orden) && /desc`/.test(orden));
/*
  Las consultas ANTERIORES a este ayudante escriben su `nulls last` a mano y
  están bien: no se tocan por tocar. Lo que se comprueba es que las que se
  añadieron ahora pasen por el ayudante, que es donde vive el desempate estable
  —el detalle que nadie recuerda y que hace que una fila salga en dos páginas.
*/
for (const f of ["purchasing", "people", "crm"]) {
  const src = readFileSync(`src/lib/data/${f}.ts`, "utf8");
  check(`data/${f}.ts ordena con el ayudante`, src.includes("ordenarPor("));
}

console.log("\n── los filtros de columna llegan a las pantallas de trabajo ──");
const CON_FILTRO = [
  ["cola de tickets", "admin/tickets/page.tsx"],
  ["equipos", "admin/equipos/page.tsx"],
  ["proveedores", "admin/compras/proveedores/page.tsx"],
  ["órdenes de compra", "admin/compras/page.tsx"],
  ["usuarios", "admin/configuracion/usuarios/page.tsx"],
] as const;
for (const [nombre, rel] of CON_FILTRO) {
  const src = readFileSync(RAIZ + rel, "utf8");
  check(`${nombre}: filtra por columna`,
    src.includes("FiltroColumna") && src.includes("parseFiltro"));
  // Sin `queryLimpia` los filtros y el orden se pisan: pulsar una columna
  // perdería el embudo puesto, que es peor que no poder ordenar.
  check(`${nombre}: el orden conserva los filtros`, src.includes("queryLimpia"));
  // Y sin resumen no se ve POR QUÉ la tabla enseña cuatro filas y no cuarenta.
  check(`${nombre}: dice qué está filtrado`, src.includes("ResumenFiltros"));
}

console.log("\n── cuando la tabla no cabe ──");
check("la primera columna se queda al desplazar en horizontal",
  /\.tabla-erp tbody td:first-child[^}]*position: sticky/s.test(css) ||
  /td:first-child,\s*\n?\s*\.tabla-erp thead th:first-child \{[^}]*position: sticky/s.test(css));
check("y es OPACA, o las demás se leerían por debajo",
  /\.tabla-erp tbody td:first-child \{[^}]*background: var\(--color-card\)/s.test(css));
check("el encabezado de esa columna gana en los dos ejes",
  /\.tabla-erp thead th:first-child \{[^}]*z-index: 2/s.test(css));
check("y la fila realzada realza también su ancla",
  /tr:hover td:first-child/.test(css));
check("se ve que hay más contenido a los lados",
  /\.tabla-caja \{[^}]*background-attachment: local/s.test(css));
// La barra NO se esconde: un desplazamiento invisible es una capacidad que
// solo descubre quien ya sabía que estaba.
check("la barra de desplazamiento no se oculta",
  !/\.tabla-caja[^}]*scrollbar-width:\s*none/s.test(css) &&
  !/tabla-caja::-webkit-scrollbar[^}]*display:\s*none/s.test(css));

console.log("\n── el ancho de columna ──");
const anchos = readFileSync("src/components/portal/anchos-de-columna.tsx", "utf8");
check("se guarda por tabla y por persona", anchos.includes("evo:anchos:"));
check("hay un mínimo, o una columna se arrastra hasta desaparecer",
  /MINIMO = \d+/.test(anchos) && anchos.includes("Math.max(MINIMO"));
check("se fija el reparto, o el ancho sería una sugerencia",
  anchos.includes("table-layout:fixed"));
check("un gesto cancelado no deja la tabla pegada al puntero",
  anchos.includes("pointercancel"));
check("y el almacenamiento bloqueado no rompe la tabla",
  (anchos.match(/catch/g) ?? []).length >= 2);

/*
  LO QUE COSTÓ UN ERROR DE HIDRATACIÓN, y por eso se comprueba.

  La primera versión inyectaba un `<span>` dentro de cada `<th>` y le escribía
  el `style`. Ese DOM lo gobierna React: al reconciliar encontraba nodos que su
  árbol no tenía y regeneraba la rama entera. Ahora el tirador es un
  pseudo-elemento y los anchos viajan en una hoja propia.
*/
check("no inyecta nodos en el árbol de React",
  !anchos.includes("createElement(\"span\")") && !anchos.includes("appendChild(tirador)"));
check("ni escribe `style` en elementos que React gobierna",
  !/th\.style\./.test(anchos) && !/tabla\.style\./.test(anchos));
check("el tirador es un pseudo-elemento, no un nodo",
  /\.tabla-erp\[data-tabla\] thead th::after/.test(css));
check("los anchos van en una hoja propia dentro de head",
  anchos.includes("document.head.appendChild"));

/*
  ESTRECHAR TIENE QUE RECORTAR, NO DESBORDAR.

  Casi todas las celdas llevan `whitespace-nowrap`, y una celda que no parte el
  texto ni lo recorta lo DERRAMA: al estrechar la columna, el nombre largo de un
  laboratorio se pintaba encima del correo de al lado. Se comprueba sobre el CSS
  que produce la función, no sobre el archivo, porque ahí vive la decisión.
*/
const css3 = reglasDeAncho("tickets", { 0: 200, 2: 90 });
check("con anchos puestos se fija el reparto", css3.includes("table-layout:fixed"));
check("y el contenido que no cabe se recorta", css3.includes("overflow:hidden"));
/*
  La primera columna queda FUERA del recorte: está fijada a la izquierda y
  `overflow` sobre una celda fijada no hace falta —su techo lo pone `max-width`—
  y es el primer sospechoso de que la cabecera no se fije como sí lo hace la
  celda del cuerpo.
*/
check("pero la primera columna, no: está fijada al desplazarse",
  css3.includes("th:not(:first-child)") && css3.includes("td:not(:first-child)"));
check("con puntos suspensivos, o un nombre cortado parece corto",
  css3.includes("text-overflow:ellipsis"));
check("los anchos salen por columna", css3.includes("nth-child(1){width:200px}") && css3.includes("nth-child(3){width:90px}"));
check("y sin anchos NO se recorta nada: la columna crece con su contenido",
  reglasDeAncho("tickets", {}) === "");
check("un nombre de tabla que no es un identificador no produce selector",
  reglasDeAncho('x"] , body {display:none} [z="', { 0: 100 }) === "");
const conTirador = sh(
  `grep -rho 'data-tabla="[a-z]*"' src/app --include='*.tsx' | sort -u | wc -l`);
check("las tablas de trabajo lo piden", Number(conTirador) >= 8, `${conTirador} tablas`);

/* ── Nada pisa la posición pegajosa de las cabeceras ───────────────────── */
/*
  EL FALLO QUE ESTO CIERRA, Y QUE COSTÓ SEIS RONDAS ENCONTRAR.

  El tirador para arrastrar columnas es un `::after`, y para colocarlo se le
  había puesto `position: relative` al `th`:

    .tabla-erp[data-tabla] thead th { position: relative }   (0,2,2)
    .tabla-erp thead th:first-child { position: sticky  }    (0,2,2)

  MISMA ESPECIFICIDAD, y la primera escrita después. Ganaba por orden de archivo
  y sustituía `sticky` por `relative` en TODAS las cabeceras de TODAS las tablas
  con tirador. Ni el encabezado se quedaba al bajar, ni la primera columna al
  desplazarse en horizontal.

  Y el síntoma no se parecía a la causa: en el CUERPO la primera celda sí seguía
  fija —a ella no la alcanza esa regla—, así que los nombres se quedaban quietos
  mientras la cabecera se iba, y «Estado fiscal» acababa encima de la columna del
  cliente. Se reportó tres veces como «las columnas están desalineadas» y una
  como «parece que hay un hold».

  El `relative` ni siquiera hacía falta: `sticky` ya establece bloque contenedor
  para un hijo absoluto.

  Se comprueba sobre el CSS: ninguna regla que termine en `thead th` puede
  declarar `position` distinto de `sticky`.
*/
console.log("\n── nada pisa la posición pegajosa de las cabeceras ──");

/*
  Se leen los bloques `selector { ... }` y se miran los que apuntan a una celda
  de cabecera. Un análisis a ojo sobre el texto entero daría falsos positivos con
  los comentarios, que en este archivo son largos y hablan justamente de esto.
*/
const bloques = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), cuerpo: m[2] }))
  // Fuera los comentarios: solo interesa el selector de verdad.
  .map((b) => ({ ...b, sel: b.sel.replace(/\/\*[\s\S]*?\*\//g, "").trim() }))
  .filter((b) => /thead\s+th\s*$/.test(b.sel) || /thead\s+th:[a-z-]+\s*$/.test(b.sel));

check(`hay reglas de cabecera que revisar (${bloques.length})`, bloques.length >= 2);

const pisadas = bloques.filter((b) => {
  const m = /position\s*:\s*([a-z-]+)/.exec(b.cuerpo);
  return m !== null && m[1] !== "sticky";
});

check(
  "ninguna regla sobre `thead th` declara una posición que no sea sticky",
  pisadas.length === 0,
  pisadas.map((b) => `${b.sel} → ${/position\s*:\s*([a-z-]+)/.exec(b.cuerpo)?.[1]}`).join(" · "),
);

check(
  "y la cabecera sigue declarándose pegajosa",
  bloques.some((b) => /position\s*:\s*sticky/.test(b.cuerpo)),
);

/* ── Los anchos caducan cuando la tabla cambia ─────────────────────────── */
/*
  EL FALLO QUE ESTO CIERRA.

  Los anchos se guardan por POSICIÓN, que es lo único que entiende un selector
  de CSS. Al añadirle dos columnas a Clientes, cada ancho guardado pasó a
  gobernar una columna distinta de aquella en la que se midió, y la última se
  quedó sin ninguno. Con `table-layout: fixed`, una columna sin ancho declarado
  se reparte lo que sobra e ignora su contenido: «General» se veía como «Ge…».

  Nada avisaba. El recuerdo seguía siendo válido para el navegador y absurdo
  para la tabla, y vivía en `localStorage`, donde nadie mira.
*/
console.log("\n── los anchos guardados caducan si cambian las columnas ──");

const antes = ["Cliente", "Teléfono", "Contactos"];
const despues = ["Cliente", "Estado fiscal", "RFC", "Teléfono", "Contactos"];

check("una tabla con las mismas columnas da la misma firma",
  firmaDeColumnas(antes) === firmaDeColumnas(["Cliente", "Teléfono", "Contactos"]));
check("añadir una columna cambia la firma",
  firmaDeColumnas(antes) !== firmaDeColumnas(despues));
check("reordenarlas también, aunque sean las mismas",
  firmaDeColumnas(["Cliente", "Teléfono"]) !== firmaDeColumnas(["Teléfono", "Cliente"]));
check("y el número de columnas entra en la firma",
  firmaDeColumnas(antes).startsWith("3:"));
check("los espacios de más no cuentan: no invalidan por un cambio de maquetado",
  firmaDeColumnas([" Cliente ", "Teléfono"]) === firmaDeColumnas(["Cliente", "Teléfono"]));

/* ── Elegir columnas ───────────────────────────────────────────────────── */
/*
  Se comprueba sobre el CSS que produce la función, no sobre el archivo, por la
  misma razón que los anchos: ahí vive la decisión y se puede ejercitar sin DOM.

  El `nth-child` es 1-basado y el índice de columna 0-basado. Equivocarse en ese
  desfase oculta la columna DE AL LADO, que es un fallo silencioso: la tabla se
  ve bien, solo que falta otra cosa.
*/
console.log("\n── elegir qué columnas se ven ──");
const cols = reglasDeColumnas("clientes", [2, 5]);
check("la columna 2 se oculta como nth-child(3)", cols.includes("th:nth-child(3)"));
check("y también su celda", cols.includes("td:nth-child(3)"));
check("la columna 5 se oculta como nth-child(6)", cols.includes("th:nth-child(6)"));
check("se oculta con display:none", cols.includes("display:none"));
check("sin columnas ocultas no se produce ninguna regla",
  reglasDeColumnas("clientes", []) === "");
check("la primera columna nunca entra: es la identidad de la fila",
  !reglasDeColumnas("clientes", [1, 2]).includes("nth-child(1)"));
check("un nombre de tabla que no es un identificador no produce selector",
  reglasDeColumnas('x"] , body {display:none} [z="', [1]) === "");

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
