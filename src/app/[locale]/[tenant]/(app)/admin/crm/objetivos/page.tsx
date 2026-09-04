import { setRequestLocale } from "next-intl/server";
import { Target, Trash2 } from "lucide-react";
import { getCrmOwners, getPipelines, ensureDefaultPipeline } from "@/lib/data/crm";
import { getGoalsWithProgress } from "@/lib/data/crm-insights";
import { createGoal, deleteGoal } from "@/lib/actions/crm-extras";
import { GOAL_METRICS, GOAL_METRIC_LABELS, label, money } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { GoalProgress } from "@/components/portal/crm/crm-charts";
import { puedeEn } from "@/lib/tenancy/context";

const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default async function GoalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await puedeEn("analisis", "administrar");

  await ensureDefaultPipeline();
  const [goals, owners, pipelines] = await Promise.all([
    getGoalsWithProgress(),
    getCrmOwners(),
    getPipelines(),
  ]);

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString(
      locale === "en" ? "en-US" : "es-MX",
      { dateStyle: "medium" },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Objetivos</h1>
        <p className="text-sm text-muted-foreground">
          Metas de ingresos o de negocios ganados por vendedor y periodo. El
          avance se calcula sobre los negocios marcados como ganados.
        </p>
      </div>

      {goals.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Target className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay objetivos definidos.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <Card key={g.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.owner?.name ?? g.owner?.email ?? "Todo el equipo"} ·{" "}
                    {fmtDate(g.periodStart)} → {fmtDate(g.periodEnd)}
                  </p>
                </div>
                {admin && (
                  <form action={deleteGoal}>
                    <input type="hidden" name="id" value={g.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar objetivo"
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </form>
                )}
              </div>

              <div className="mt-4">
                <GoalProgress
                  pct={g.pct}
                  achievedLabel={
                    g.metric === "count"
                      ? `${g.achieved} negocio(s)`
                      : money(String(g.achieved), "MXN", locale)
                  }
                  targetLabel={
                    g.metric === "count"
                      ? `${Number(g.target)} negocio(s)`
                      : money(g.target, "MXN", locale)
                  }
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Alta de objetivo */}
      {admin && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Nuevo objetivo
          </h2>
          <form action={createGoal} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="goal-name">Nombre</Label>
                <Input
                  id="goal-name"
                  name="name"
                  required
                  placeholder="Ej. Meta Q3 — Mariana"
                />
              </div>
              <div>
                <Label htmlFor="goal-owner">Vendedor</Label>
                <select id="goal-owner" name="ownerId" className={selectCls} defaultValue="">
                  <option value="">— Todo el equipo —</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name ?? o.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="goal-metric">Métrica</Label>
                <select
                  id="goal-metric"
                  name="metric"
                  className={selectCls}
                  defaultValue="revenue"
                >
                  {GOAL_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {label(GOAL_METRIC_LABELS, m, locale)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="goal-target">Meta</Label>
                <Input
                  id="goal-target"
                  name="target"
                  required
                  inputMode="decimal"
                  placeholder="500000"
                />
              </div>
              <div>
                <Label htmlFor="goal-pipeline">Embudo</Label>
                <select
                  id="goal-pipeline"
                  name="pipelineId"
                  className={selectCls}
                  defaultValue={pipelines[0]?.id ?? ""}
                >
                  <option value="">— Todos —</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="goal-start">Inicio del periodo</Label>
                <Input id="goal-start" name="periodStart" type="date" required />
              </div>
              <div>
                <Label htmlFor="goal-end">Fin del periodo</Label>
                <Input id="goal-end" name="periodEnd" type="date" required />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="accent">
                <Target className="size-4" /> Crear objetivo
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
