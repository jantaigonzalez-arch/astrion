import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { listRubros } from "@/lib/data/viaticos";
import { getSettings } from "@/lib/data/settings";
import {
  ProspectosCard,
  RubrosCard,
} from "@/components/portal/viaticos/config-viaticos";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN DE VIÁTICOS.
 *
 * ── LA ÚNICA PESTAÑA DEL ÁREA QUE NO PIDE `configuracion` ─────────────────
 *
 * Pide `viaticos: administrar`, así que la abren el administrador y el rol
 * General — que es quien administra el gasto y quien tiene, de fábrica,
 * `configuracion: ninguno`. Es la misma pregunta que contesta `RUTAS` en
 * `lib/permisos.ts`, escrita también aquí porque el guardia de una pantalla no
 * se delega: el layout ya solo comprueba que se pueda abrir ALGUNA pestaña.
 *
 * Hasta ahora lo único configurable de viáticos —el interruptor de
 * prospectos— vivía en «Marca y tarifas» y por lo tanto era invisible para
 * General. Que el módulo tenga su propia pestaña no es orden: es lo que hace
 * que la administre quien debe.
 */
export default async function ConfigViaticosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  // La lista COMPLETA, con los desactivados: esta pantalla es el único sitio
  // desde donde se reactivan, así que esconderlos los dejaría enterrados.
  const [ajustes, rubros] = await Promise.all([getSettings(), listRubros(false)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RubrosCard rubros={rubros} />
      <ProspectosCard activo={ajustes.viaticosProspectos} />
    </div>
  );
}
