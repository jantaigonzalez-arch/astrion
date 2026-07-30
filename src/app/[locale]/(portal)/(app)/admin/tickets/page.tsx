import { setRequestLocale } from "next-intl/server";
import { ClipboardPlus, Hourglass } from "lucide-react";
import { getAllTickets } from "@/lib/data/tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import {
  CATEGORY_LABELS,
  TYPE_LABELS,
  TYPE_STYLES,
  label,
  type TicketPriorityValue,
  type TicketStatusValue,
  type TicketTypeValue,
} from "@/lib/tickets";

type Row = Awaited<ReturnType<typeof getAllTickets>>[number];

function TicketsTable({ rows, locale }: { rows: Row[]; locale: string }) {
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
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {tk.assignedTo?.name ?? tk.assignedTo?.email ?? "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const all = await getAllTickets();

  const pending = all.filter((t) => t.status === "pending_review");
  const rest = all.filter((t) => t.status !== "pending_review");
  const unassigned = all.filter(
    (t) =>
      !t.assignedToId &&
      !["resolved", "closed", "rejected", "pending_review"].includes(t.status),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cola de tickets</h1>
          <p className="text-sm text-muted-foreground">
            {all.length} en total · {pending.length} pendiente(s) de revisión ·{" "}
            {unassigned} sin asignar.
          </p>
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
              Solicitudes pendientes de revisión ({pending.length})
            </h2>
          </div>
          <TicketsTable rows={pending} locale={locale} />
        </Card>
      )}

      <Card className="overflow-hidden">
        <TicketsTable rows={rest} locale={locale} />
      </Card>
    </div>
  );
}
