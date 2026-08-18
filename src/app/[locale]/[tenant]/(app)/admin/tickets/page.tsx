import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AlarmClock, ClipboardPlus, Hourglass } from "lucide-react";
import {
  getPendingReviewTickets,
  getQueueCounts,
  getQueuePage,
} from "@/lib/data/tickets";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import {
  AnalysisSection,
  AnalysisSectionSkeleton,
} from "@/components/portal/analysis-section";
import {
  CATEGORY_LABELS,
  SLA_LABELS,
  SLA_STYLES,
  TYPE_LABELS,
  TYPE_STYLES,
  label,
  slaState,
  type TicketPriorityValue,
  type TicketStatusValue,
  type TicketTypeValue,
} from "@/lib/tickets";

type Row = Awaited<ReturnType<typeof getQueuePage>>[number];

function TicketsTable({ rows, locale }: { rows: Row[]; locale: string }) {
  /*
    `now` se calcula UNA vez para toda la tabla.

    Si cada fila preguntara la hora por su cuenta, dos tickets con el mismo
    plazo podrían salir con distinto estado —uno «por vencer» y el siguiente
    «vencido»— por los milisegundos que hay entre una fila y otra. Es raro y es
    justo el tipo de incoherencia que hace dudar de todo el tablero.
  */
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Folio</th>
            <th className="px-4 py-3 font-medium">Asunto</th>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <th className="px-4 py-3 font-medium">Prioridad</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">SLA</th>
            <th className="px-4 py-3 font-medium">Asignado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((tk) => (
            <tr key={tk.id} className="transition-colors hover:bg-secondary/40">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                <Link href={`/tickets/${tk.id}`} className="text-primary hover:underline">
                  {tk.reference}
                </Link>
              </td>
              <td className="max-w-xs truncate px-4 py-3 font-medium">
                <Link href={`/tickets/${tk.id}`} className="hover:underline">{tk.subject}</Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {tk.createdBy?.company ?? tk.createdBy?.name ?? tk.createdBy?.email}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge className={TYPE_STYLES[tk.type as TicketTypeValue]}>
                  {label(TYPE_LABELS, tk.type, locale)}
                </Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {label(CATEGORY_LABELS, tk.category, locale)}
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={tk.priority as TicketPriorityValue} locale={locale} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={tk.status as TicketStatusValue} locale={locale} />
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {(() => {
                  const sla = slaState({ ...tk, now });
                  // «Sin SLA» no se dibuja: son los tickets traídos del sistema
                  // anterior, que nacieron sin plazo. Una insignia gris en 119
                  // de 145 filas sería ruido puro, y además diría «sin SLA»
                  // como si fuera un estado del servicio y no de nuestros datos.
                  return sla === "sin-reloj" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge className={SLA_STYLES[sla]}>
                      {label(SLA_LABELS, sla, locale)}
                    </Badge>
                  );
                })()}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {tk.assignedTo?.name ?? tk.assignedTo?.email ?? "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                No hay tickets.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; por?: string; sla?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const pageParams = parsePage(sp);
  const onlyBreached = sp.sla === "vencido";

  // Los conteos del encabezado hablan de TODA la empresa, así que se preguntan
  // aparte: derivarlos de la página que se está viendo diría "25 en total".
  const [counts, pending, rows] = await Promise.all([
    getQueueCounts(),
    getPendingReviewTickets(),
    getQueuePage({
      limit: pageParams.perPage,
      offset: pageParams.offset,
      onlyBreached,
    }),
  ]);

  // El total de la tabla paginada excluye las pendientes, que tienen su propia
  // sección: si no se restaran, la última página saldría vacía.
  const queueTotal = onlyBreached ? counts.slaBreached : counts.total - counts.pending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cola de tickets</h1>
          <p className="text-sm text-muted-foreground">
            {counts.total} en total · {counts.pending} pendiente(s) de revisión ·{" "}
            {counts.unassigned} sin asignar.
          </p>
          {/*
            El incumplimiento de SLA solo se anuncia cuando lo hay. Un contador
            en cero permanente enseña a ignorar el sitio donde aparece, y el día
            que marque uno nadie lo va a ver.
          */}
          {counts.slaBreached > 0 && (
            <p className="mt-1.5">
              <Link
                href={
                  onlyBreached ? "/admin/tickets" : "/admin/tickets?sla=vencido"
                }
                className={
                  onlyBreached
                    ? "inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-xs font-medium text-white"
                    : "inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-3 py-1 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/25 transition-colors hover:bg-destructive/20"
                }
              >
                <AlarmClock className="size-3.5" />
                {counts.slaBreached} sin primera respuesta en plazo
                {onlyBreached && " · quitar filtro"}
              </Link>
            </p>
          )}
        </div>
        <Button asChild variant="accent">
          <Link href="/admin/tickets/new">
            <ClipboardPlus className="size-4" /> Nuevo levantamiento
          </Link>
        </Button>
      </div>

      {/* Solicitudes que esperan aprobación */}
      {pending.length > 0 && (
        <Card className="overflow-hidden border-warning/40">
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-3">
            <Hourglass className="size-4 text-warning" />
            <h2 className="text-sm font-semibold">
              Solicitudes pendientes de revisión ({counts.pending})
            </h2>
          </div>
          <TicketsTable rows={pending} locale={locale} />
          {counts.pending > pending.length && (
            <p className="border-t border-warning/30 px-5 py-3 text-xs text-muted-foreground">
              Se muestran las {pending.length} más recientes de {counts.pending}.
            </p>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        <TicketsTable rows={rows} locale={locale} />
        <Pagination
          {...pageParams}
          total={queueTotal}
          basePath="/admin/tickets"
          query={{ sla: onlyBreached ? "vencido" : undefined }}
        />
      </Card>
      {/* Debajo de la cola: primero lo que hay que atender hoy, después lo
          que el análisis dice del conjunto.

          En `Suspense` para que la tabla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/tickets" />
      </Suspense>

    </div>
  );
}
