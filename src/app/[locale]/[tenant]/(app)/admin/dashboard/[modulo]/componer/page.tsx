import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Eye, LayoutDashboard } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { redirectInTenant } from "@/lib/nav-server";
import { Link } from "@/lib/nav";
import { dashboardFor } from "@/lib/ml/dashboards";
import { Button } from "@/components/ui/button";
import {
  DashboardBuilder,
  type BloqueView,
} from "@/components/portal/dashboard-builder";

/**
 * Componer el dashboard de un módulo.
 *
 * Separado de la vista y no un modo de edición dentro de ella, a propósito: el
 * tablero enseña resultados y el compositor enseña CONFIGURACIÓN —qué vigila
 * cada bloque, de dónde salió, qué está apagado—. Son dos lecturas distintas, y
 * meterlas en la misma pantalla con un interruptor obliga a que cada bloque
 * sepa dibujarse de dos maneras.
 */
export default async function ComponerPage({
  params,
}: {
  params: Promise<{ locale: string; modulo: string }>;
}) {
  const { locale, modulo } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant(`/admin/dashboard/${modulo}`, locale);
  }

  const d = await dashboardFor(modulo);
  if (!d) notFound();

  const bloques: BloqueView[] = d.bloques.map((b) => ({
    analysis: b.analysis.id,
    label: b.analysis.label,
    kind: b.analysis.kind,
    watching: b.analysis.watching,
    active: b.active,
    width: b.width,
    source: b.source,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="size-6 text-primary" /> Componer tablero
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Arrastra para ordenar, elige el ancho de cada bloque y enciende o
            apaga lo que quieras. Nada cambia para el equipo hasta que publiques.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/dashboard/${modulo}`}>
            <Eye className="size-4" /> Ver el tablero
          </Link>
        </Button>
      </div>

      <DashboardBuilder
        modulo={modulo}
        moduloLabel={d.modulo.label}
        titulo={d.title}
        publicado={d.publishedAt ? d.publishedAt.toISOString() : null}
        bloques={bloques}
        disponibles={d.disponibles.map((a) => ({
          id: a.id,
          label: a.label,
          kind: a.kind,
          watching: a.watching,
        }))}
      />
    </div>
  );
}
