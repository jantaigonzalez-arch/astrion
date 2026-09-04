import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getSpareParts } from "@/lib/data/parts";
import { getIncomingByPart } from "@/lib/data/purchasing";
import { AddPartForm } from "@/components/portal/part-forms";
import { PartsInventory } from "@/components/portal/parts-inventory";
import { puedeEn } from "@/lib/tenancy/context";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { AnalysisSection, AnalysisSectionSkeleton } from "@/components/portal/analysis-section";

export default async function SparePartsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("inventario", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  // Las dos mitades de la misma pregunta: qué hay y qué viene en camino.
  const [parts, incoming] = await Promise.all([
    getSpareParts(),
    getIncomingByPart(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Inventario de refacciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Busca por número de parte, descripción o marca.
          </p>
        </div>
        <AddPartForm />
      </div>

      <PartsInventory
        parts={parts.map((p) => ({
          id: p.id,
          partNumber: p.partNumber,
          description: p.description,
          brand: p.brand,
          costMxn: p.costMxn,
          costUsd: p.costUsd,
          priceMxn: p.priceMxn,
          priceUsd: p.priceUsd,
          stock: p.stock,
          active: p.active,
          incoming: incoming.get(p.id) ?? null,
        }))}
      />
      {/* Debajo del listado: lo que hay que reponer se decide mirando primero lo
          que hay.

          En `Suspense` para que la pantalla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/refacciones" />
      </Suspense>


      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="refacciones" />
      </Suspense>
    </div>
  );
}
