/**
 * QUÉ PANTALLAS SON LA CAPA DE INTELIGENCIA.
 *
 * Dos: **Inteligencia** y los **Tableros**. Las dos producen números que nadie
 * capturó —una los estima con un modelo, la otra los saca cruzando los seis
 * módulos—, y eso las separa del resto del ERP, donde una pantalla enseña lo que
 * alguien escribió.
 *
 * De esta lista salen tres cosas a la vez, y por eso vive suelta y sin `"use
 * client"`: el aspecto propio de la capa, su aviso de beta y el grupo aparte del
 * menú. Tenerla en un sitio es lo que impide que la frontera visual, la
 * advertencia y la barra lateral acaben discrepando —que una pantalla se pinte
 * como capa y no avise, o al revés—.
 *
 * ── ES UNA LISTA, NO UNA REGLA DEDUCIDA ───────────────────────────────────
 *
 * Hubo una versión que lo sacaba del módulo `analisis`, que es la regla de
 * permisos. Salía gratis y arrastraba Rentabilidad, Informes y Objetivos, que
 * están en la misma sección y solo suman lo capturado. Lo que hace capa a estas
 * dos no es quién puede entrar: es qué clase de número producen.
 */
const RUTAS = [
  "/admin/inteligencia",
  // Todo lo de tableros: el compositor, cada tablero suelto y el alta.
  "/admin/dashboard",
];

/**
 * ¿Esta dirección pertenece a la capa?
 *
 * Compara por SEGMENTO y no por texto: `/dashboard` es el panel del portal y
 * `/admin/dashboard` son los tableros —uno no es prefijo del otro, pero un
 * `includes("dashboard")` los habría metido a los dos—, y una ruta futura como
 * `/admin/dashboards-viejos` no debe heredar la capa por empezar igual.
 *
 * Tolera el prefijo de idioma porque le llegan direcciones de dos sitios: las
 * del menú, escritas sin él, y la del navegador, que puede traer `/en`.
 */
export function esCapaDeInteligencia(href: string): boolean {
  const limpio = href.replace(/^\/(es|en)(?=\/|$)/, "");
  return RUTAS.some((r) => limpio === r || limpio.startsWith(`${r}/`));
}
