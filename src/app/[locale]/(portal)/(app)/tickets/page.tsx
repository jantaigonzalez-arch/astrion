import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getTicketsForUser } from "@/lib/data/tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import {
  CATEGORY_LABELS,
  label,
  type TicketPriorityValue,
  type TicketStatusValue,
} from "@/lib/tickets";

export default async function TicketsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const tickets = await getTicketsForUser(session!.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Mis tickets</h1>
        <Button asChild variant="accent">
          <Link href="/tickets/new">Nuevo ticket</Link>
        </Button>
      </div>

      <Card>
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-muted-foreground">No tienes tickets todavía.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/tickets/new">Crear el primero</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tickets.map((tk) => (
              <li key={tk.id}>
                <Link
                  href={`/tickets/${tk.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-secondary/50"
                >
                  <span className="font-mono text-xs text-muted-foreground">{tk.reference}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{tk.subject}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {label(CATEGORY_LABELS, tk.category, locale)}
                  </span>
                  <PriorityBadge priority={tk.priority as TicketPriorityValue} locale={locale} />
                  <StatusBadge status={tk.status as TicketStatusValue} locale={locale} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
