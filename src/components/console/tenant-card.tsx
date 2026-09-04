import { Building2, Database, LogIn } from "lucide-react";
import type { TenantRow } from "@/lib/data/platform";
import { enterTenant, setMlContribution } from "@/lib/actions/platform";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SuscripcionPanel } from "@/components/console/suscripcion-panel";
import { cn } from "@/lib/utils";

/**
 * Una empresa, tal como se ve desde la consola.
 *
 * Vivía dentro de la página de la consola, que era UNA pantalla con todo
 * apilado. Al partirla en secciones esta tarjeta la necesitan dos —el listado y
 * el inicio, que enseña las que piden atención— y dejarla incrustada habría
 * significado copiarla, con lo que eso trae: el día que alguien arregle el
 * consentimiento de datos lo arregla en una de las dos.
 */

export const ESTADO_TONO: Record<string, string> = {
  active: "bg-success/15 text-success ring-success/25",
  trial: "bg-primary/15 text-primary ring-primary/25",
  suspended: "bg-warning/15 text-warning ring-warning/25",
  cancelled: "bg-muted text-muted-foreground ring-border",
};

export const ESTADO_ETIQUETA: Record<string, string> = {
  active: "Activa",
  trial: "Prueba",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

export function TenantCard({
  t,
  locale,
  aqui,
  isSuper,
  /**
   * Sin cifras ni pie: la versión para el inicio.
   *
   * El inicio enseña las empresas para ENTRAR a una, no para compararlas, y
   * seis métricas por tarjeta convertirían una bienvenida en el inventario del
   * que se la sacó.
   */
  compacta = false,
}: {
  t: TenantRow;
  locale: string;
  aqui: boolean;
  isSuper: boolean;
  compacta?: boolean;
}) {
  const fmt = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX");
  const when = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(d))
      : "—";

  return (
    <Card className={cn("p-5", aqui && "ring-1 ring-primary/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-4 shrink-0 text-primary" />
            <span className="font-medium">{t.name}</span>
            <Badge className={cn("ring-1", ESTADO_TONO[t.status])}>
              {ESTADO_ETIQUETA[t.status] ?? t.status}
            </Badge>
            {aqui && (
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
            <Button type="submit" variant={aqui ? "default" : "outline"} size="sm">
              <LogIn className="size-4" /> {aqui ? "Volver a entrar" : "Entrar"}
            </Button>
          </form>
        )}
      </div>

      {/* El reloj de la empresa. Solo para quien puede moverlo: enseñárselo a
          soporte, que no puede tocarlo, sería ofrecer botones apagados. Y no en
          la versión compacta, que es una bienvenida y no un panel. */}
      {!compacta && isSuper && (
        <SuscripcionPanel
          tenantId={t.id}
          status={t.status}
          trialEndsAt={t.trialEndsAt}
          plan={t.plan}
        />
      )}

      {compacta ? null : (
        <>
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
        </>
      )}
    </Card>
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
