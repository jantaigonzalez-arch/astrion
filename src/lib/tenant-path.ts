/**
 * Reglas de prefijo de inquilino. Sin "use client" ni "server-only" a
 * propósito: las usan tanto los enlaces del navegador como los redirects del
 * servidor, y tienen que dar exactamente el mismo resultado en los dos lados.
 */

/**
 * Rutas de primer nivel que NO viven dentro de una empresa.
 *
 * "Absolutas" significa dos cosas distintas según el despliegue, y esa
 * diferencia es la que se pasó por alto al mover el inquilino al subdominio:
 *
 *  · en modo path, "no le pongas el prefijo de empresa";
 *  · en modo subdominio, **"esto vive en OTRO HOST"** —el apex—, porque
 *    `evoelution.astraion.com/contacto` no existe: el proxy lo reescribe a
 *    `/evoelution/contacto` y sale 404.
 *
 * Medido antes de arreglarlo: desde el portal de un inquilino, `/contacto`,
 * `/platform` y `/login` devolvían 404 los tres. Todo enlace del portal hacia
 * el sitio público o hacia la consola estaba roto.
 *
 * Debe mantenerse en línea con `NOT_A_TENANT` de proxy.ts.
 */
export const ABSOLUTE_ROOTS = [
  "/platform",
  "/login",
  "/entrar",
  "/contacto",
  "/nosotros",
  "/productos",
  "/servicios",
  "/marcas",
  "/evo-ai",
  // Home del sitio público de Evoelution. Convive con el portal del inquilino
  // del mismo nombre: `/evoelution` es el sitio, `/evoelution/acceso` es el
  // portal. Lo resuelve Next porque el segmento estático gana al dinámico.
  "/evoelution",
];

export function isAbsolutePath(href: string): boolean {
  if (href === "/") return true;
  if (!href.startsWith("/")) return true; // anclas, mailto:, http…
  return ABSOLUTE_ROOTS.some((p) => href === p || href.startsWith(`${p}/`));
}

export type LinkContext = {
  /**
   * Empresa que hay que ESCRIBIR en el path, o null si no hace falta.
   * En modo subdominio siempre es null: el host ya la lleva.
   */
  tenant?: string | null;
  /**
   * Origen del apex (`https://astraion.com`), o null en modo path.
   *
   * Su presencia es lo que distingue los dos modos. Cuando está, las rutas de
   * `ABSOLUTE_ROOTS` se vuelven absolutas hacia él; cuando no, se dejan tal
   * cual, que es como funcionaban antes de que existieran los subdominios.
   */
  apex?: string | null;
};

/**
 * Resuelve un enlace del portal a la URL que de verdad hay que visitar.
 *
 *   modo path,       `/tickets`  + evoelution → `/evoelution/tickets`
 *   modo subdominio, `/tickets`               → `/tickets`
 *   modo subdominio, `/contacto`              → `https://astraion.com/contacto`
 */
export function tenantHref(href: string, ctx: LinkContext = {}): string {
  // Anclas, mailto:, tel:, http… no son nuestras y no se tocan.
  if (!href.startsWith("/")) return href;

  if (isAbsolutePath(href)) {
    if (!ctx.apex) return href;
    // `/` es el único caso en que concatenar dejaría una barra de más.
    return href === "/" ? ctx.apex : `${ctx.apex}${href}`;
  }

  return ctx.tenant ? `/${ctx.tenant}${href}` : href;
}
