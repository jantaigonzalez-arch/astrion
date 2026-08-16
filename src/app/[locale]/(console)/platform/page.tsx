import { setRequestLocale } from "next-intl/server";
import { Building2, Database, LogIn, History } from "lucide-react";
import { auth } from "@/lib/auth";
import { getTenants, getPlatformEvents, getSignups } from "@/lib/data/platform";
import { getTenantContext } from "@/lib/tenancy/context";
import { enterTenant, setMlContribution } from "@/lib/actions/platform";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewTenantForm } from "@/components/portal/new-tenant-form";
import { SignupInbox } from "@/components/portal/signup-inbox";
import { cn } from "@/lib/utils";

/**
 * Consola de plataforma.
 *
 * Es la capa que está POR DEBAJO de los inquilinos: aquí el equipo que opera el
 * SaaS ve todas las empresas y puede entrar a cualquiera. Deliberadamente
 * separada del área /admin, que es "administro MI empresa".
 */
export default async function PlatformPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El layout de la consola ya exigió `platformRole`, pero su `redirect()` NO
  // impide que esta página se ejecute: en Next, layout y página se renderizan
  // en paralelo. La aserción `session!` reventaba en cada visita sin sesión —el
  // usuario veía la redirección correcta y el servidor registraba un TypeError
  // por petición—. La comprobación propia cuesta una línea y no depende de en
  // qué orden corran las cosas.
  const session = await auth();
  if (!session?.user) return null;
  const isSuper = session.user.platformRole === "superadmin";

  const [rows, events, active, signups] = await Promise.all([
    getTenants(),
    getPlatformEvents(25),
    getTenantContext(),
    getSignups(),
  ]);
  const pendingSignups = signups.filter((s) => s.status === "pending").length;

  const totals = rows.reduce(
    (a, r) => ({
      tickets: a.tickets + (r.stats?.tickets ?? 0),
      orgs: a.orgs + (r.stats?.organizations ?? 0),
      members: a.members + r.members,
    }),
    { tickets: 0, orgs: 0, members: 0 },
  );

  const fmt = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX");
  const when = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(d))
      : "—";

  const statusTone: Record<string, string> = {
    active: "bg-success/15 text-success ring-success/25",
    trial: "bg-primary/15 text-primary ring-primary/25",
    suspended: "bg-warning/15 text-warning ring-warning/25",
    cancelled: "bg-muted text-muted-foreground ring-border",
  };
  const statusLabel: Record<string, string> = {
    active: "Activa",
    trial: "Prueba",
    suspended: "Suspendida",
    cancelled: "Cancelada",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
            {pendingSignups > 0 && (
              <Badge className="bg-warning/15 text-warning ring-1 ring-warning/25">
                {pendingSignups} solicitud(es) por revisar
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} empresa(s) · {fmt.format(totals.tickets)} ticket(s) ·{" "}
            {fmt.format(totals.orgs)} cliente(s) · {totals.members} usuario(s)
          </p>
        </div>
      </div>

      {active && (
        <Card className="border-warning/40 bg-warning/5 p-4">
          <p className="text-sm">
            Tienes abierta la empresa{" "}
            <span className="font-semibold">{active.name}</span>
            {active.impersonated
              ? " como personal de plataforma. Este acceso quedó registrado."
              : " con tu propia membresía."}
          </p>
        </Card>
      )}

      {/* Bandeja de solicitudes: va ANTES de las empresas porque es lo único
          de esta pantalla que espera una decisión. */}
      {isSuper && <SignupInbox rows={signups} />}

      {/* Empresas */}
      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((t) => {
          const here = active?.slug === t.slug;
          return (
            <Card key={t.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Building2 className="size-4 shrink-0 text-primary" />
                    <span className="font-medium">{t.name}</span>
                    <Badge className={cn("ring-1", statusTone[t.status])}>
                      {statusLabel[t.status] ?? t.status}
                    </Badge>
                    {here && (
                      <Badge className="bg-primary/15 text-primary ring-primary/25">
                        Estás aquí
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {t.slug} · plan {t.plan} · {t.members} usuario(s)
                  </p>
                </div>

                {t.schemaName && (
                  <form action={enterTenant}>
                    <input type="hidden" name="slug" value={t.slug} />
                    <input type="hidden" name="locale" value={locale} />
                    <Button
                      type="submit"
                      variant={here ? "default" : "outline"}
                      size="sm"
                    >
                      <LogIn className="size-4" /> {here ? "Volver a entrar" : "Entrar"}
                    </Button>
                  </form>
                )}
              </div>

              {/* Cifras del inquilino, leídas de SU esquema */}
              {t.stats ? (
                <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
                  <Metric label="Tickets" value={fmt.format(t.stats.tickets)} />
                  <Metric
                    label="Abiertos"
                    value={fmt.format(t.stats.openTickets)}
                    tone={t.stats.openTickets > 0 ? "warn" : undefined}
                  />
                  <Metric label="Clientes" value={fmt.format(t.stats.organizations)} />
                  <Metric label="Equipos" value={fmt.format(t.stats.equipment)} />
                  <Metric label="Contratos" value={fmt.format(t.stats.contracts)} />
                  <Metric label="Eventos" value={fmt.format(t.stats.events)} />
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  {t.schemaName
                    ? "El esquema existe pero aún no responde: puede estar a medio aprovisionar."
                    : "Sin esquema aprovisionado."}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <Database className="size-3.5" />
                  {t.schemaName ?? "—"}
                  {t.migratedVersion && <span>· {t.migratedVersion}</span>}
                </div>

                {/* Consentimiento de datos para modelos globales */}
                {isSuper && (
                  <form action={setMlContribution} className="flex items-center gap-2">
                    <input type="hidden" name="slug" value={t.slug} />
                    <input type="hidden" name="grant" value={t.mlContribution ? "0" : "1"} />
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        t.mlContribution ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      Aporta a modelos globales: {t.mlContribution ? "sí" : "no"}
                    </span>
                    <Button type="submit" variant="ghost" size="sm">
                      {t.mlContribution ? "Revocar" : "Otorgar"}
                    </Button>
                  </form>
                )}
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                Última actividad: {when(t.stats?.lastActivity ?? null)} · alta{" "}
                {when(t.createdAt)}
              </p>
            </Card>
          );
        })}
      </div>

      {isSuper && <NewTenantForm />}

      {/* Bitácora de la plataforma */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <h2 className="font-semibold">Bitácora de la plataforma</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Altas de empresa, accesos del equipo y cambios de consentimiento. Es la
          respuesta a «quién vio los datos de mi empresa y cuándo».
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Cuándo</th>
                <th className="py-2 pr-4 font-medium">Evento</th>
                <th className="py-2 pr-4 font-medium">Empresa</th>
                <th className="py-2 font-medium">Quién</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    Sin movimientos registrados.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(e.occurredAt))}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={cn(
                        "font-mono text-xs",
                        e.eventType === "tenant.accessed_by_platform" && "text-warning",
                      )}
                    >
                      {e.eventType}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {e.tenantName ?? "—"}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {e.actorName ?? e.actorEmail ?? "sistema"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "block font-mono text-base font-semibold tabular-nums",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </span>
    </div>
  );
}
