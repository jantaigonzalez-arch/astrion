import { setRequestLocale } from "next-intl/server";
import { CalendarCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { getActivities } from "@/lib/data/crm";
import { ACTIVITY_LABELS, ACTIVITY_STYLES, label } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { ActivityToggle } from "@/components/portal/crm/deal-panels";
import { puedeEn } from "@/lib/tenancy/context";

export default async function ActivitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scope?: string; filtro?: string }>;
}) {
  const { locale } = await params;
  const { scope, filtro } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  const admin = await puedeEn("ventas", "administrar");
  const ownerId = admin ? (scope === "mine" ? session!.user.id : undefined) : session!.user.id;
  const onlyPending = filtro !== "todas";

  const activities = await getActivities({ ownerId, onlyPending });
  const intl = locale === "en" ? "en-US" : "es-MX";
  const fmt = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" }) : "Sin fecha";
  const isOverdue = (d: Date | null, done: boolean) =>
    !done && d != null && new Date(d) < new Date();

  const overdueCount = activities.filter((a) => isOverdue(a.dueAt, a.done)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Actividades</h1>
          <p className="text-sm text-muted-foreground">
            {activities.length} actividad(es)
            {overdueCount > 0 && (
              <span className="text-destructive"> · {overdueCount} vencida(s)</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant={onlyPending ? "secondary" : "ghost"}>
            <Link href={`/admin/crm/actividades${scope === "mine" ? "?scope=mine" : ""}`}>
              Pendientes
            </Link>
          </Button>
          <Button asChild size="sm" variant={!onlyPending ? "secondary" : "ghost"}>
            <Link
              href={`/admin/crm/actividades?filtro=todas${scope === "mine" ? "&scope=mine" : ""}`}
            >
              Todas
            </Link>
          </Button>
          {admin && (
            <Button asChild size="sm" variant={scope === "mine" ? "secondary" : "ghost"}>
              <Link
                href={
                  scope === "mine"
                    ? `/admin/crm/actividades${onlyPending ? "" : "?filtro=todas"}`
                    : `/admin/crm/actividades?scope=mine${onlyPending ? "" : "&filtro=todas"}`
                }
              >
                Solo mías
              </Link>
            </Button>
          )}
        </div>
      </div>

      {activities.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <CalendarCheck className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            No hay actividades pendientes. Agenda el siguiente paso desde la ficha
            de un negocio.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-wrap items-start gap-3 p-4">
                <ActivityToggle id={a.id} done={a.done} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={ACTIVITY_STYLES[a.type]}>
                      {label(ACTIVITY_LABELS, a.type, locale)}
                    </Badge>
                    <span
                      className={`text-sm font-medium ${a.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {a.subject}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span
                      className={
                        isOverdue(a.dueAt, a.done) ? "font-medium text-destructive" : ""
                      }
                    >
                      {isOverdue(a.dueAt, a.done) ? "Vencida: " : ""}
                      {fmt(a.dueAt)}
                    </span>
                    {a.deal && (
                      <Link
                        href={`/admin/crm/negocios/${a.deal.id}`}
                        className="hover:text-primary"
                      >
                        {a.deal.title}
                      </Link>
                    )}
                    {a.organization && (
                      <Link
                        href={`/admin/organizaciones/${a.organization.id}`}
                        className="hover:text-primary"
                      >
                        {a.organization.name}
                      </Link>
                    )}
                    {a.contact && <span>{a.contact.name}</span>}
                    <span>{a.owner?.name ?? a.owner?.email ?? "Sin dueño"}</span>
                  </div>

                  {a.notes && (
                    <p className="mt-1.5 text-sm text-muted-foreground">{a.notes}</p>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
