"use server";

import { auth } from "@/lib/auth";
import { isAdminRole, isSupport } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { idFrom, scopeFor } from "@/lib/ml/assistant";
import type { Block } from "@/lib/ml/blocks-types";

/**
 * El asistente, del lado del servidor.
 *
 * Se llama desde el botón de la barra y NO desde el render de la página. Esa
 * separación es la garantía 2 llevada a la arquitectura: por muy lento que sea
 * un resolutor, no puede retrasar el contenido, porque va en otra petición.
 * `guarded()` sigue protegiendo dentro; esto protege fuera.
 */

export type AssistantResult = {
  /** Nombre de la pantalla. `null` = aquí no se analiza nada. */
  label: string | null;
  blocks: Block[];
  /** Qué vigila este ámbito. Es lo que se enseña cuando no hay hallazgos. */
  watching: string[];
};

const VACIO: AssistantResult = { label: null, blocks: [], watching: [] };

export async function analyzeRoute(route: string): Promise<AssistantResult> {
  const session = await auth();
  if (!session?.user) return VACIO;

  const role = await currentRole();
  // Soporte es el piso: un cliente del portal no ve análisis de la operación.
  if (!isSupport(role)) return VACIO;

  // El rol entra en la resolución, no se aplica después: los análisis de
  // administración se descartan antes de consultarse. Y ya no basta con mirar
  // la pantalla —como se hacía cuando el ámbito era fijo— porque el usuario
  // puede colocar un análisis de saldos en una pantalla que soporte sí ve. El
  // permiso viaja con el dato.
  const scope = await scopeFor(route, { isAdmin: isAdminRole(role) });
  if (!scope) return VACIO;

  try {
    const blocks = await scope.resolve({ id: idFrom(route) });
    return { label: scope.label, blocks, watching: scope.watching };
  } catch (e) {
    // `guarded()` ya absorbe el fallo de cada resolutor; esto cubre lo que pase
    // fuera de él. El asistente calla, nunca revienta.
    console.error("[asistente] falló la pantalla", scope.screen.prefix, e);
    return { label: scope.label, blocks: [], watching: scope.watching };
  }
}
