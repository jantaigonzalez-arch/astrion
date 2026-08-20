import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Eye, LayoutDashboard } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { redirectInTenant } from "@/lib/nav-server";
import { Link } from "@/lib/nav";
import { dashboardFor } from "@/lib/ml/dashboards";
import { MODULOS, resolveAnalysis } from "@/lib/ml/analyses";
import type { Block } from "@/lib/ml/blocks-types";
import { Button } from "@/components/ui/button";
import {
  DashboardBuilder,
  type BloqueView,
} from "@/components/portal/dashboard-builder";

/**
 * Componer un tablero, sobre el tablero de verdad.
 *
 * ── SE COMPONE VIENDO EL RESULTADO ─────────────────────────────────────────
 *
 * La vista principal son los bloques RESUELTOS, con sus cifras y sus gráficas,
 * no una lista de nombres. Antes esta pantalla enseñaba configuración —qué
 * vigila cada bloque, de dónde salió— y el resultado había que ir a verlo a
 * otra pantalla; así, decidir si «Clientes más rentables» merece media fila
 * exigía imaginárselo.
 *
 * Eso obliga a resolver aquí TODO lo que se puede colocar, no solo lo colocado,
 * y es el precio de que arrastrar algo a la vista lo enseñe en el acto en vez
 * de dejar un hueco mientras se pide al servidor. Cada resolución corre aislada
 * y con presupuesto de tiempo (`resolveAnalysis`), así que uno lento o roto se
 * queda fuera y el resto aparece.
 *
 * ── LO QUE NO SE MEZCLÓ ────────────────────────────────────────────────────
 *
 * Sigue siendo una pantalla aparte de la vista del tablero, y no un modo de
 * edición dentro de ella. La vista es para leer y ésta para decidir: aquí hay
 * una caja de herramientas al costado, asas de arrastre y controles de ancho
 * que en la vista serían ruido permanente para quien solo viene a mirar.
 */
export default async function ComponerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ modulo?: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant(`/admin/dashboard/${slug}`, locale);
  }

  const d = await dashboardFor(slug);
  if (!d) notFound();

  const { modulo } = await searchParams;
  const sugerido = MODULOS.find((m) => m.id === modulo)?.id ?? null;

  /*
    Todo resuelto de una vez: lo colocado y lo que se puede colocar.

    En paralelo y con `allSettled` porque son veinte consultas y basta una rota
    para que no hubiera pantalla. La que falle se queda sin vista previa —el
    bloque sigue siendo colocable— en vez de tumbar el compositor.
  */
  const resueltos = await Promise.allSettled(
    [...d.bloques.map((b) => b.analysis), ...d.disponibles].map(async (a) => ({
      id: a.id,
      preview: await resolveAnalysis(a, {}),
    })),
  );

  const vista = new Map<string, Block[]>();
  for (const r of resueltos) {
    if (r.status === "fulfilled") vista.set(r.value.id, r.value.preview);
    else console.error("[componer] no se pudo resolver un bloque", r.reason);
  }

  const bloques: BloqueView[] = d.bloques.map((b) => ({
    analysis: b.analysis.id,
    label: b.analysis.label,
    kind: b.analysis.kind,
    watching: b.analysis.watching,
    active: b.active,
    width: b.width,
    source: b.source,
    preview: vista.get(b.analysis.id) ?? [],
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
          <Link href={`/admin/dashboard/${slug}`}>
            <Eye className="size-4" /> Ver el tablero
          </Link>
        </Button>
      </div>

      <DashboardBuilder
        slug={slug}
        titulo={d.title}
        // El módulo sugerido solo cuenta si el tablero todavía no sale en
        // ninguno: viene de haber entrado desde una pantalla sin tablero, y
        // pisar una elección ya hecha sería lo contrario de sugerir.
        modulos={
          d.modules.length === 0 && sugerido ? [sugerido] : d.modules
        }
        catalogo={MODULOS.map((m) => ({ id: m.id, label: m.label }))}
        publicado={d.publishedAt ? d.publishedAt.toISOString() : null}
        bloques={bloques}
        disponibles={d.disponibles.map((a) => ({
          id: a.id,
          label: a.label,
          kind: a.kind,
          watching: a.watching,
          preview: vista.get(a.id) ?? [],
        }))}
      />
    </div>
  );
}
