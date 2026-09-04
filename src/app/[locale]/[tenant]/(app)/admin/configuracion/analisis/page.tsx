import { setRequestLocale } from "next-intl/server";
import { Telescope } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { placementMap, recommendations } from "@/lib/ml/placements";
import { AnalysisSettings } from "@/components/portal/analysis-settings";

/**
 * Qué se analiza en cada pantalla.
 *
 * Va en Configuración y no en Análisis siguiendo el criterio que ya usa la
 * barra lateral: el laboratorio está en Análisis porque es una herramienta que
 * se consulta para decidir; esto es un ajuste que se deja puesto.
 *
 * Existe para romper una asimetría que llevaba tiempo en el producto. Las
 * PREGUNTAS de ML siempre fueron del usuario —se crean desde el constructor,
 * sin tocar código— y los ANÁLISIS eran nuestros, clavados en una lista que
 * solo cambiaba con un despliegue. Dos mitades de la misma capa con dos reglas
 * opuestas, y la mitad cerrada era justo la que el usuario ve todos los días.
 */
export default async function AnalysisSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [map, recs] = await Promise.all([placementMap(), recommendations()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Telescope className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Qué se analiza</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada pantalla de trabajo puede llevar análisis en el panel del
          asistente. Aquí decides cuáles. Lo que apagues deja de verlo{" "}
          <em>todo el equipo</em>, no solo tú.
        </p>
      </div>

      <AnalysisSettings
        screens={map.map(({ screen, placements }) => ({
          prefix: screen.prefix,
          label: screen.label,
          items: placements.map((p) => ({
            id: p.analysis.id,
            label: p.analysis.label,
            kind: p.analysis.kind,
            watching: p.analysis.watching,
            adminOnly: p.analysis.adminOnly ?? false,
            active: p.active,
            source: p.source,
          })),
        }))}
        recommendations={recs.map((r) => ({
          analysis: r.analysis.id,
          label: r.analysis.label,
          screen: r.screen.prefix,
          screenLabel: r.screen.label,
          because: r.because,
        }))}
      />
    </div>
  );
}
