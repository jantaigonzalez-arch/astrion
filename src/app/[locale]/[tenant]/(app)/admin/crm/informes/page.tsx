import { setRequestLocale } from "next-intl/server";
import { AlertTriangle, Clock, Download, Percent, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { ensureDefaultPipeline, getCrmStats, getPipelines } from "@/lib/data/crm";
import { getAvgCycleDays, getForecastByMonth, getFunnelByStage, getLostReasons, getMonthlyClosed, getOwnerRanking, getRottingDeals, getSourceBreakdown } from "@/lib/data/crm-insights";
import { SOURCE_LABELS, label, money } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { RankBars } from "@/components/portal/charts";
import { ClosedByMonth, FunnelChart } from "@/components/portal/crm/crm-charts";
import { puedeEn } from "@/lib/tenancy/context";

export default async function CrmInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pipeline?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { pipeline: pipelineParam, scope } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  const admin = await puedeEn("analisis", "administrar");
  const ownerId = admin
    ? scope === "mine"
      ? session!.user.id
      : undefined
    : session!.user.id;

  await ensureDefaultPipeline();
  const pipelines = await getPipelines();
  const active = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];

  const [funnel, monthly, forecast, ranking, lost, sources, cycle, rotting, stats] =
    await Promise.all([
      getFunnelByStage(active.id, ownerId),
      getMonthlyClosed(active.id, ownerId),
      getForecastByMonth(active.id, ownerId),
      getOwnerRanking(active.id),
      getLostReasons(active.id, ownerId),
      getSourceBreakdown(active.id),
      getAvgCycleDays(active.id, ownerId),
      getRottingDeals(active.id, ownerId),
      getCrmStats(active.id, ownerId),
    ]);

  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-");
    return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString(
      locale === "en" ? "en-US" : "es-MX",
      { month: "long", year: "numeric" },
    );
  };

  const forecastTotal = forecast.reduce((a, f) => a + Number(f.weighted), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Informes y análisis
          </h1>
          <p className="text-sm text-muted-foreground">
            Embudo <strong>{active.name}</strong>
            {ownerId ? " · tu cartera" : " · todo el equipo"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Button asChild size="sm" variant={scope === "mine" ? "secondary" : "ghost"}>
              <Link
                href={
                  scope === "mine"
                    ? "/admin/crm/informes"
                    : "/admin/crm/informes?scope=mine"
                }
              >
                {scope === "mine" ? "Viendo: mis datos" : "Ver solo los míos"}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            {/* Descarga de archivo: debe ser un <a> real. Con <Link> Next haría
                navegación de cliente y el navegador no dispararía la descarga. */}
            <a href="/api/crm/export?tipo=negocios" download>
              <Download className="size-4" /> Exportar CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Indicadores clave */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Pronóstico ponderado",
            value: money(String(forecastTotal), "MXN", locale),
            hint: "Negocios abiertos con fecha de cierre",
            Icon: Wallet,
          },
          {
            label: "Tasa de cierre",
            value: stats.winRate != null ? `${stats.winRate}%` : "—",
            hint: `${stats.wonCount} ganados / ${stats.lostCount} perdidos`,
            Icon: Percent,
          },
          {
            label: "Ciclo de venta",
            value: cycle > 0 ? `${cycle} d` : "—",
            hint: "Promedio de creación a cierre",
            Icon: Clock,
          },
          {
            label: "Negocios estancados",
            value: String(rotting.length),
            hint: "Superaron el límite de su etapa",
            Icon: AlertTriangle,
          },
        ].map(({ label: l, value, hint, Icon }) => (
          <Card key={l} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {l}
              </p>
              <Icon className="size-4 text-primary" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Embudo */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Embudo por etapa
          </h2>
          <FunnelChart rows={funnel} />
        </Card>

        {/* Cerrados por mes */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ganado por mes (12 meses)
          </h2>
          <ClosedByMonth data={monthly} />
        </Card>

        {/* Ranking de vendedores */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ranking por monto ganado
          </h2>
          <RankBars
            rows={ranking.map((r) => ({
              label: r.name ?? r.email ?? "Sin responsable",
              sub: `${r.wonCount} ganados · ${r.openCount} abiertos · ${r.lostCount} perdidos`,
              value: Number(r.wonValue),
            }))}
            emptyText="Sin negocios registrados."
          />
        </Card>

        {/* Pronóstico por mes */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pronóstico por mes de cierre
          </h2>
          <RankBars
            rows={forecast.map((f) => ({
              label: monthLabel(f.month),
              sub: `${f.count} negocio(s) · total ${money(f.value, "MXN", locale)}`,
              value: Number(f.weighted),
            }))}
            emptyText="Ningún negocio abierto tiene fecha de cierre estimada."
          />
        </Card>

        {/* Motivos de pérdida */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Motivos de pérdida
          </h2>
          <RankBars
            rows={lost.map((l) => ({
              label: l.reason ?? "Sin motivo",
              sub: `${l.count} negocio(s)`,
              value: Number(l.value),
            }))}
            emptyText="Aún no hay negocios perdidos con motivo registrado."
          />
        </Card>

        {/* Origen */}
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Origen de las oportunidades
          </h2>
          <RankBars
            rows={sources.map((s) => ({
              label: s.source
                ? label(SOURCE_LABELS, s.source, locale)
                : "Sin especificar",
              sub: `${s.count} negocio(s)`,
              value: Number(s.value),
            }))}
            emptyText="Sin datos de origen."
          />
        </Card>
      </div>

      {/* Estancados */}
      {rotting.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-destructive">
            <AlertTriangle className="size-4" /> Negocios estancados
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Sin movimiento por más días de los permitidos en su etapa.
          </p>
          <ul className="space-y-2">
            {rotting.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/crm/negocios/${d.id}`}
                    className="text-sm font-medium hover:text-primary"
                  >
                    {d.title}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {d.reference} · {d.stageName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">
                    {money(d.valueMxn, "MXN", locale)}
                  </p>
                  <p className="text-xs font-medium text-destructive">
                    {d.idleDays} días sin movimiento (límite {d.rottingDays})
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
