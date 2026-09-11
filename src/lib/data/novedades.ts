import "server-only";
import { currentRole, puedeEn } from "@/lib/tenancy/context";
import { isInternal } from "@/lib/roles";
import { NOVEDADES, VIGENCIA_DIAS } from "@/lib/novedades";
import { hoyEnMexico, sumarDias } from "@/lib/tipo-de-cambio";
import type { NovedadVisible } from "@/components/portal/novedades";

/**
 * Las novedades que le tocan a quien entra: vigentes y de módulos que puede ver.
 *
 * Se filtra en el SERVIDOR y no en el navegador: una novedad de Configuración no
 * tiene por qué viajar a quien no entra ahí. Sin permiso en ninguno de sus
 * módulos, no se ve; sin `permisos`, la ve todo el equipo interno. Un cliente
 * del portal no ve ninguna.
 */
export async function novedadesParaMi(hoy = hoyEnMexico()): Promise<NovedadVisible[]> {
  if (!isInternal(await currentRole())) return [];
  const desde = sumarDias(hoy, -VIGENCIA_DIAS);
  const vigentes = NOVEDADES.filter((n) => n.fecha > desde && n.fecha <= hoy);
  const visibles = await Promise.all(
    vigentes.map(async (n) =>
      !n.permisos || (await Promise.all(n.permisos.map(([m, nv]) => puedeEn(m, nv)))).some(Boolean),
    ),
  );
  return vigentes
    .filter((_, i) => visibles[i])
    .map(({ id, titulo, texto, href }) => ({ id, titulo, texto, href }));
}
