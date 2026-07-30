import { setRequestLocale } from "next-intl/server";
import { Trash2, Workflow, Zap } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { ensureDefaultPipeline, getPipelines } from "@/lib/data/crm";
import { getAutomations } from "@/lib/data/crm-insights";
import {
  createAutomation,
  deleteAutomation,
  toggleAutomation,
} from "@/lib/actions/crm-extras";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, label } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect({ href: "/admin/crm", locale });
  }

  await ensureDefaultPipeline();
  const [rules, pipelines] = await Promise.all([getAutomations(), getPipelines()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Automatizaciones
        </h1>
        <p className="text-sm text-muted-foreground">
          Cuando un negocio entra a una etapa, se crea automáticamente la
          actividad de seguimiento. Así ninguna oportunidad se queda sin
          siguiente paso.
        </p>
      </div>

      {rules.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Workflow className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay reglas configuradas.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-4 p-4">
              <Zap
                className={`size-5 shrink-0 ${r.active ? "text-primary" : "text-muted-foreground"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.name}</p>
                  <Badge
                    className={
                      r.active
                        ? "bg-success/15 text-success ring-success/25"
                        : "bg-muted text-muted-foreground ring-border"
                    }
                  >
                    {r.active ? "Activa" : "Pausada"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Al entrar a <strong>{r.triggerStage?.name}</strong> → crear{" "}
                  {label(ACTIVITY_LABELS, r.activityType, locale).toLowerCase()}{" "}
                  «{r.activitySubject}» con vencimiento en {r.dueInDays} día(s).
                </p>
              </div>
              <div className="flex items-center gap-1">
                <form action={toggleAutomation}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                  <Button type="submit" variant="outline" size="sm">
                    {r.active ? "Pausar" : "Activar"}
                  </Button>
                </form>
                <form action={deleteAutomation}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar regla"
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Nueva regla
        </h2>
        <form action={createAutomation} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="auto-name">Nombre de la regla</Label>
              <Input
                id="auto-name"
                name="name"
                required
                placeholder="Ej. Seguimiento tras cotizar"
              />
            </div>
            <div>
              <Label htmlFor="auto-stage">Cuando el negocio entre a…</Label>
              <select id="auto-stage" name="triggerStageId" required className={selectCls}>
                {pipelines.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="auto-type">Crear actividad de tipo</Label>
              <select id="auto-type" name="activityType" className={selectCls} defaultValue="call">
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(ACTIVITY_LABELS, t, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <Label htmlFor="auto-subject">Asunto</Label>
              <Input
                id="auto-subject"
                name="activitySubject"
                required
                placeholder="Llamar para confirmar recepción"
              />
            </div>
            <div>
              <Label htmlFor="auto-due">Vence en (días)</Label>
              <Input
                id="auto-due"
                name="dueInDays"
                type="number"
                min={0}
                max={365}
                defaultValue={2}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="accent">
              <Zap className="size-4" /> Crear regla
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
