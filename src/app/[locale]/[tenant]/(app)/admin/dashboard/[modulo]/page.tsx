import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LayoutDashboard, Pencil, Undo2 } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { currentRole } from "@/lib/tenancy/context";
import { Link } from "@/lib/nav";
import { dashboardFor } from "@/lib/ml/dashboards";
import { resolveAnalysis } from "@/lib/ml/analyses";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightItem } from "@/components/portal/insight-strip";
import {
  ForecastCard,
  ProjectionCard,
  TrendCard,
} from "@/components/portal/assistant-blocks";
import type { Block } from "@/lib/ml/blocks-types";
import { cn } from "@/lib/utils";

/**
 * El dashboard de un módulo, tal como quedó compuesto.
 *
 * Se resuelve BLOQUE A BLOQUE y en paralelo, con `allSettled` para que uno que
 * falle no calle a los demás, y con el presupuesto de tiempo de
 * `resolveAnalysis` para que uno LENTO tampoco. Aquí pesa más que en ninguna
 * otra pantalla: un tablero son seis u ocho consultas y, sin presupuesto,
 * bastaba la más lenta para decidir cuánto tarda en aparecer todo lo demás.
 *
 * Sin publicar, solo lo ve quien puede componerlo. Nadie debería encontrarse un
 * tablero a medio ordenar porque alguien salió a comer.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string; modulo: string }>;
}) {
  const { locale, modulo } = await params;
  setRequestLocale(locale);

  const admin = isAdminRole(await currentRole());
  const d = await dashboardFor(modulo);
  if (!d) notFound();
  if (!d.publishedAt && !admin) notFound();

  const encendidos = d.bloques.filter((b) => b.active);
  const visibles = encendidos.filter((b) => admin || !b.analysis.adminOnly);

  const resueltos = await Promise.allSettled(
    visibles.map(async (b) => ({
      width: b.width,
      id: b.analysis.id,
      bloques: await resolveAnalysis(b.analysis, {}),
    })),
  );

  const piezas = resueltos.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    console.error("[dashboard] falló", visibles[i].analysis.id, r.reason);
    return [];
  });

  const conContenido = piezas.filter((p) => p.bloques.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="size-6 text-primary" />
            {d.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {conContenido.length} de {visibles.length} análisis con algo que decir.
            {!d.publishedAt && (
              <Badge className="border-warning/40 bg-warning/10 text-warning">
                Sin publicar · solo lo ves tú
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={d.modulo.home}>
              <Undo2 className="size-4" /> Volver a {d.modulo.label}
            </Link>
          </Button>
          {admin && (
            <Button asChild size="sm">
              <Link href={`/admin/dashboard/${modulo}/componer`}>
                <Pencil className="size-4" /> Componer
              </Link>
            </Button>
          )}
        </div>
      </div>

      {conContenido.length === 0 ? (
        <Card className="border-dashed p-8">
          <p className="text-sm text-muted-foreground">
            {visibles.length === 0
              ? "Este tablero no tiene ningún análisis encendido."
              : // La distinción importa: «no hay nada configurado» y «hoy no hay
                // nada que reportar» piden cosas opuestas de quien lee.
                "Los análisis de este tablero no encontraron nada que reportar hoy. Siguen vigilando:"}
          </p>
          {visibles.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {visibles.flatMap((b) =>
                b.analysis.watching.map((w) => <li key={`${b.analysis.id}-${w}`}>· {w}</li>),
              )}
            </ul>
          )}
        </Card>
      ) : (
        // Rejilla de dos columnas: los de media fila caben de a dos y los de
        // fila completa la ocupan entera. Es todo lo que hace falta para que el
        // ancho signifique algo, sin un motor de rejilla.
        <div className="grid gap-4 lg:grid-cols-2">
          {conContenido.map((p) => (
            <div
              key={p.id}
              className={cn("space-y-3", p.width === "full" && "lg:col-span-2")}
            >
              {p.bloques.map((b) => (
                <Pieza key={llave(b)} block={b} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pieza({ block }: { block: Block }) {
  switch (block.kind) {
    case "finding":
      return <InsightItem insight={block.insight} />;
    case "projection":
      return <ProjectionCard block={block} />;
    case "trend":
      return <TrendCard block={block} />;
    case "forecast":
      return <ForecastCard block={block} />;
  }
}

function llave(b: Block): string {
  return b.kind === "finding" ? b.insight.id : b.id;
}
