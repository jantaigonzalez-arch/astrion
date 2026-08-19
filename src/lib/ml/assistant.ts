import "server-only";
import type { Block } from "@/lib/ml/blocks-types";
import {
  SCREENS,
  resolveAnalysis,
  type AnalysisContext,
  type Screen,
} from "@/lib/ml/analyses";
import { placementsFor } from "@/lib/ml/placements";

/**
 * El asistente de análisis: qué se dice en cada pantalla.
 *
 * Antes este archivo ERA el catálogo — una lista de ámbitos con sus resolutores
 * dentro, agrupados por pantalla y clavados en código. Ahora es solo el
 * enrutador: el vocabulario vive en `analyses.ts` y la colocación en
 * `placements.ts`, que es una tabla.
 *
 * La separación importa porque las dos mitades cambian por razones distintas.
 * Qué PUEDE decir el sistema es una decisión de producto que se revisa al
 * escribir código; DÓNDE lo dice es una preferencia de cada empresa, y hasta hoy
 * exigía un despliegue para cambiarla. Que la segunda estuviera atrapada dentro
 * de la primera es lo que hacía que las preguntas de ML fueran configurables y
 * los análisis no.
 *
 * `watching` sobrevive a la mudanza y sigue siendo tan importante como
 * `resolve`. Cuando una pantalla no encuentra nada que decir, el asistente
 * enseña esa lista en vez de una caja vacía: quien abre aprende qué le está
 * cubriendo el sistema. Una caja vacía enseña lo contrario —que no vale la pena
 * volver a abrir—, y esa lección no se revierte.
 */

export type { AnalysisContext as ScopeContext } from "@/lib/ml/analyses";

export type ResolvedScope = {
  screen: Screen;
  label: string;
  /** Qué se vigila aquí, ya reunido de los análisis colocados. */
  watching: string[];
  /** Si algún análisis colocado aquí exige administración. */
  adminOnly: boolean;
  resolve: (ctx: AnalysisContext) => Promise<Block[]>;
};

/**
 * Qué pantalla corresponde a una ruta ya normalizada —sin idioma ni inquilino,
 * como la devuelve `usePathname()` de `lib/nav.tsx`—.
 */
export function screenFor(route: string): Screen | null {
  const limpia = route.split("?")[0].replace(/\/+$/, "") || "/";
  return (
    SCREENS.find((s) =>
      // Un prefijo terminado en barra exige que haya algo DESPUÉS: `…/proveedores/`
      // cubre la ficha de uno, no el listado. Sin esta distinción el listado caía
      // en el ámbito de ficha, que sin id no tiene nada que decir — y el panel
      // enseñaba «vigilando los días de pago de este proveedor» sin proveedor.
      s.prefix.endsWith("/")
        ? limpia.startsWith(s.prefix)
        : limpia === s.prefix || limpia.startsWith(`${s.prefix}/`),
    ) ?? null
  );
}

/**
 * El ámbito de una ruta, ya resuelto contra la configuración del inquilino.
 *
 * `isAdmin` entra aquí y no después a propósito: un análisis que exige
 * administración no se filtra al PINTAR, se filtra antes de CONSULTAR. Filtrar
 * al final significa haber leído ya los saldos de proveedores para tirarlos, y
 * basta un error de renderizado para que se vean. Lo que no se consulta no se
 * puede filtrar mal.
 */
export async function scopeFor(
  route: string,
  opts: { isAdmin: boolean },
): Promise<ResolvedScope | null> {
  const screen = screenFor(route);
  if (!screen) return null;

  const todas = await placementsFor(screen.prefix);
  const visibles = todas.filter(
    (p) => p.active && (opts.isAdmin || !p.analysis.adminOnly),
  );

  if (visibles.length === 0) return null;

  return {
    screen,
    label: screen.label,
    watching: visibles.flatMap((p) => p.analysis.watching),
    adminOnly: visibles.some((p) => p.analysis.adminOnly),
    resolve: async (ctx) => {
      // En paralelo y con `allSettled`: si la tendencia falla, los hallazgos
      // siguen saliendo. Un bloque roto no puede callar a los demás — y ahora
      // que la lista la arma el usuario, esa garantía cubre también el caso de
      // haber colocado un análisis que en esta pantalla no encuentra nada.
      const hechos = await Promise.allSettled(
        visibles.map((p) => resolveAnalysis(p.analysis, ctx)),
      );
      return hechos.flatMap((h, i) => {
        if (h.status === "fulfilled") return h.value;
        console.error("[asistente] falló", visibles[i].analysis.id, h.reason);
        return [];
      });
    },
  };
}

/**
 * El identificador de la URL, cuando el análisis lo necesita.
 *
 * Se valida como UUID en vez de tomar el último segmento a ciegas: `…/nueva` y
 * `…/importar` también son últimos segmentos, y pasarlos como id haría que el
 * resolutor consultara por un proveedor que no existe en cada listado.
 */
export function idFrom(route: string): string | undefined {
  const seg = route.split("?")[0].replace(/\/+$/, "").split("/").pop() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
    ? seg
    : undefined;
}

/*
  El contrato NO está en el catálogo, y no es un olvido.

  `contractInsights` recibe lo que la pantalla ya calculó —valor contratado,
  equipos amparados, costo consumido, tarifa— porque la garantía 3 de
  `insights.ts` prohíbe que un resolutor repita el trabajo de la página. El
  asistente corre en OTRA petición y no tiene nada de eso; traerlo aquí
  significaría volver a cargar el contrato entero solo para el panel, que es
  exactamente lo que esa garantía existe para impedir.

  Por eso esa pantalla conserva su tira en el cuerpo: es el caso en que el
  análisis depende del contexto que la página ya tiene en la mano. Un análisis
  solo puede vivir en el catálogo si su resolutor se basta a sí mismo — y ésa
  sigue siendo la condición para colocarlo desde la configuración.
*/
