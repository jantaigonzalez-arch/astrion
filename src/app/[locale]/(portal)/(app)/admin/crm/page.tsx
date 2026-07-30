import { setRequestLocale } from "next-intl/server";
import { Handshake, Plus, Target, TrendingUp, Trophy } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import {
  ensureDefaultPipeline,
  getClosedDeals,
  getCrmStats,
  getPipelineBoard,
  getPipelines,
} from "@/lib/data/crm";
import { money } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { PipelineBoard } from "@/components/portal/crm/pipeline-board";

export default async function CrmBoardPage({
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
  const admin = isAdminRole(session?.user.role);

  // El vendedor ve su cartera; el admin ve todo y puede filtrar a la suya.
  const ownerId = admin ? (scope === "mine" ? session!.user.id : undefined) : session!.user.id;

  await ensureDefaultPipeline();
  const pipelines = await getPipelines();
  const active =
    pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];

  const [columns, stats, closed] = await Promise.all([
    getPipelineBoard(active.id, ownerId),
    getCrmStats(active.id, ownerId),
    getClosedDeals(active.id, ownerId),
  ]);

  const kpis = [
    {
      label: "Negocios abiertos",
      value: String(stats.openCount),
      hint: money(stats.openValue, "MXN", locale),
      Icon: Handshake,
    },
    {
      label: "Ganados",
      value: String(stats.wonCount),
      hint: money(stats.wonValue, "MXN", locale),
      Icon: Trophy,
    },
    {
      label: "Tasa de cierre",
      value: stats.winRate != null ? `${stats.winRate}%` : "—",
      hint: `${stats.lostCount} perdido(s)`,
      Icon: TrendingUp,
    },
    {
      label: "Actividades vencidas",
      value: String(stats.overdueActivities),
      hint: "Requieren seguimiento",
      Icon: Target,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Embudo comercial</h1>
          <p className="text-sm text-muted-foreground">
            Arrastra los negocios entre etapas para actualizar su avance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 1 &&
            pipelines.map((p) => (
              <Button
                key={p.id}
                asChild
                size="sm"
                variant={p.id === active.id ? "secondary" : "ghost"}
              >
                <Link href={`/admin/crm?pipeline=${p.id}`}>{p.name}</Link>
              </Button>
            ))}
          {admin && (
            <Button asChild size="sm" variant={scope === "mine" ? "secondary" : "ghost"}>
              <Link
                href={
                  scope === "mine"
                    ? `/admin/crm?pipeline=${active.id}`
                    : `/admin/crm?pipeline=${active.id}&scope=mine`
                }
              >
                {scope === "mine" ? "Viendo: mis negocios" : "Ver solo los míos"}
              </Link>
            </Button>
          )}
          <Button asChild variant="accent">
            <Link href="/admin/crm/negocios/nuevo">
              <Plus className="size-4" /> Nuevo negocio
            </Link>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, hint, Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <Icon className="size-4 text-primary" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>

      {/* Tablero */}
      {columns.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Handshake className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Este embudo aún no tiene etapas.
          </p>
          {admin && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/crm/configuracion">Configurar etapas</Link>
            </Button>
          )}
        </Card>
      ) : (
        <PipelineBoard columns={columns} locale={locale} />
      )}

      {/* Cerrados recientes */}
      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Cerrados recientemente
          </h2>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Negocio</th>
                    <th className="px-4 py-3 font-medium">Organización</th>
                    <th className="px-4 py-3 font-medium">Etapa</th>
                    <th className="px-4 py-3 font-medium">Valor</th>
                    <th className="px-4 py-3 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {closed.map((d) => (
                    <tr key={d.id} className="transition-colors hover:bg-secondary/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/crm/negocios/${d.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {d.title}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {d.reference}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {d.organization?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {d.stage?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {money(d.valueMxn, "MXN", locale)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            d.status === "won"
                              ? "bg-success/15 text-success ring-success/25"
                              : "bg-destructive/12 text-destructive ring-destructive/25"
                          }
                        >
                          {d.status === "won" ? "Ganado" : "Perdido"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
