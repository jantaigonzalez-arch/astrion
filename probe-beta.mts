/**
 * QUÉ PANTALLAS SON LA CAPA DE INTELIGENCIA, Y CUÁLES NO.
 *
 * Son dos: Inteligencia y los Tableros. Lo que esta prueba fija no es tanto la
 * lista como su BORDE, que es donde se rompe: Rentabilidad, Informes y Objetivos
 * están en la misma sección del menú y NO lo son, y `/admin/crm/informes` y
 * `/admin/crm` comparten carpeta y son cosas distintas.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-beta.mts
 */
const { esCapaDeInteligencia } = await import("./src/lib/capa.ts");
const { navFor } = await import("./src/lib/portal/menu.ts");

let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const esBeta = esCapaDeInteligencia;

console.log("── lo que SÍ lleva la marca ──");
for (const r of [
  "/admin/inteligencia",
  "/admin/dashboard",
  "/admin/dashboard/nuevo",
  "/admin/dashboard/comercial",
  "/en/admin/inteligencia",
]) {
  ok(r, esBeta(r));
}

console.log("\n── lo que NO ──");
for (const r of [
  // Las TRES de Análisis que no lo son. Es el borde que importa: están en la
  // misma sección del menú, a un renglón de Inteligencia.
  "/admin/rentabilidad",
  "/admin/crm/informes",
  "/admin/crm/objetivos",
  // Y el panel del portal, que se llama «dashboard» y no es un tablero.
  "/dashboard",
  "/admin/tickets",
  "/admin/clientes",
  "/admin/organizaciones",
  "/admin/crm",
  "/admin/crm/prospectos",
  "/admin/compras",
  "/admin/compras/cuentas-por-pagar/analisis",
  "/admin/configuracion",
]) {
  ok(r, !esBeta(r), esBeta(r) ? "marcada y no debería" : "");
}

/*
  EL PREFIJO SE COMPARA POR SEGMENTO, NO POR TEXTO.

  `/dashboard` es el panel del portal y `/admin/dashboard` son los tableros: uno
  no es prefijo del otro, pero un `includes("dashboard")` los habría metido a los
  dos. Y una ruta futura como `/admin/dashboards-viejos` no debe heredar la marca
  por empezar igual.
*/
ok("el panel del portal no es un tablero", !esBeta("/dashboard"));
ok("un prefijo a medias no cuenta", !esBeta("/admin/dashboards-viejos"));
ok("pero un tablero suelto sí", esBeta("/admin/dashboard/lo-que-sea"));

console.log("\n── las secciones del menú que quedan marcadas ──");
const enBeta = (items: Array<{ href: string }>) =>
  items.length > 0 && items.every((i) => esBeta(i.href));

for (const rol of ["owner", "admin", "sales", "agent", "client"] as const) {
  const grupos = navFor(rol, [], {}, false);
  const marcadas = grupos.filter((g) => enBeta(g.items)).map((g) => g.section ?? "(panel)");
  console.log(`   ${rol.padEnd(6)} → ${marcadas.join(", ") || "ninguna"}`);
  // Análisis NO puede quedar marcada entera: tres de sus cuatro renglones son
  // estables. Es la corrección que motivó todo esto.
  // Análisis NO puede quedar marcada: sus tres renglones suman lo capturado.
  // Es la corrección que motivó todo esto.
  ok(`${rol}: solo el grupo de Inteligencia queda marcado`,
    marcadas.every((m) => m === "Inteligencia"),
    marcadas.join(", ") || "ninguna");
}

/*
  INTELIGENCIA Y TABLEROS, EN UN SOLO GRUPO Y AL FINAL.

  Se comprueba con un tablero real porque los tableros no son rutas fijas: son
  datos, y cuántos aparecen depende de quién mire. Lo que se fija aquí es la
  forma del grupo —quién lo encabeza, qué lleva dentro y dónde queda—, que es lo
  que dice al usuario que cruzó a otra capa antes de pulsar nada.
*/
{
  const grupos = navFor("admin", [
    { slug: "comercial", title: "Comercial", publicado: true, bloquesPublicos: 2, homes: ["/dashboard"] },
  ] as never, {}, false);
  const capa = grupos.find((g) => g.section === "Inteligencia");
  const analisis = grupos.find((g) => g.section === "Análisis");
  ok("Análisis se queda con sus tres, sin Inteligencia",
    Boolean(analisis) &&
      !analisis!.items.some((i) => i.href === "/admin/inteligencia") &&
      analisis!.items.length === 3,
    analisis ? analisis.items.map((i) => i.label).join(" · ") : "no hay");

  ok("el grupo Inteligencia existe, lo encabeza ella y lleva los tableros dentro",
    Boolean(capa) &&
      capa!.items[0].href === "/admin/inteligencia" &&
      capa!.items.some((i) => i.href.startsWith("/admin/dashboard/")) &&
      enBeta(capa!.items),
    capa ? capa.items.map((i) => i.href).join(", ") : "no hay grupo Inteligencia");

  ok("y va AL FINAL del menú: es una capa encima, no un paso del circuito",
    grupos[grupos.length - 1]?.section === "Inteligencia",
    grupos.map((g) => g.section ?? "(panel)").join(" → "));
}

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
