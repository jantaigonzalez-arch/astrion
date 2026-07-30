import { setRequestLocale } from "next-intl/server";
import { Ticket, Clock, Loader, CheckCircle2, UserCheck, UserX } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getDashboardStats,
  getTicketsForUser,
  getAllTickets,
  getTicketsAssignedTo,
} from "@/lib/data/tickets";
import { getContracts } from "@/lib/data/contracts";
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

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const role = session!.user.role;
  const isClient = role === "client";

  // El vendedor tiene su propio panel comercial.
  if (role === "sales") {
    const mine = await getContracts(session!.user.id);
    const totalMxn = mine.reduce((a, c) => a + Number(c.amountMxn ?? 0), 0);
    const totalUsd = mine.reduce((a, c) => a + Number(c.amountUsd ?? 0), 0);
    const nf = (n: number, cur: "MXN" | "USD") =>
      new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
        style: "currency",
        currency: cur,
        maximumFractionDigits: 0,
      }).format(n);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hola, {session!.user.name ?? session!.user.email}
          </h1>
          <p className="text-sm text-muted-foreground">Tu cartera comercial.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <span className="text-sm text-muted-foreground">Contratos</span>
            <div className="mt-2 text-3xl font-semibold">{mine.length}</div>
          </Card>
          <Card className="p-5">
            <span className="text-sm text-muted-foreground">Valor total (MXN)</span>
            <div className="mt-2 text-3xl font-semibold">{nf(totalMxn, "MXN")}</div>
          </Card>
          <Card className="p-5">
            <span className="text-sm text-muted-foreground">Valor total (USD)</span>
            <div className="mt-2 text-3xl font-semibold">{nf(totalUsd, "USD")}</div>
          </Card>
        </div>

        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Mis contratos</h2>
            <Link href="/admin/contratos" className="text-sm font-medium text-primary hover:underline">
              Ver todos
            </Link>
          </div>
          {mine.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              Aún no tienes contratos asignados.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {mine.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center gap-4 px-5 py-4">
                  <span className="font-mono text-xs text-primary">{c.number}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {c.client.company ?? c.client.name ?? c.client.email}
                  </span>
                  <span className="text-sm font-medium">
                    {nf(Number(c.amountMxn ?? 0), "MXN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  const stats = await getDashboardStats(role, session!.user.id);
  const tickets = isClient
    ? await getTicketsForUser(session!.user.id)
    : await getAllTickets();
  const recent = tickets.slice(0, 6);

  // Carga de trabajo del agente / admin.
  const mine = isClient ? [] : await getTicketsAssignedTo(session!.user.id);
  const mineOpen = mine.filter(
    (t) => t.status !== "resolved" && t.status !== "closed" && t.status !== "rejected",
  );
  const unassigned = isClient
    ? []
    : tickets.filter(
        (t) =>
          !t.assignedToId &&
          t.status !== "resolved" &&
          t.status !== "closed" &&
          t.status !== "rejected" &&
          t.status !== "pending_review",
      );

  const cards = [
    { label: "Total", value: stats.total, Icon: Ticket, tone: "text-primary" },
    { label: "Abiertos", value: stats.open, Icon: Clock, tone: "text-signal-bright" },
    { label: "En progreso", value: stats.inProgress, Icon: Loader, tone: "text-warning" },
    { label: "Resueltos", value: stats.resolved, Icon: CheckCircle2, tone: "text-success" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hola, {session!.user.name ?? session!.user.email}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isClient ? "Resumen de tus solicitudes." : "Resumen operativo de soporte."}
          </p>
        </div>
        {isClient && (
          <Button asChild variant="accent">
            <Link href="/tickets/new">Nuevo ticket</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.Icon className={`size-5 ${c.tone}`} />
            </div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">{c.value}</div>
          </Card>
        ))}
      </div>

      {/* Carga de trabajo del agente */}
      {!isClient && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <UserCheck className="size-4 text-primary" /> Asignados a mí
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {mineOpen.length}
                </span>
              </h2>
            </div>
            {mineOpen.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No tienes tickets asignados.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {mineOpen.slice(0, 5).map((tk) => (
                  <li key={tk.id}>
                    <Link
                      href={`/tickets/${tk.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/50"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{tk.reference}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{tk.subject}</span>
                      <StatusBadge status={tk.status as TicketStatusValue} locale={locale} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <UserX className="size-4 text-warning" /> Sin asignar
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                  {unassigned.length}
                </span>
              </h2>
            </div>
            {unassigned.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                Todos los tickets activos están asignados. 🎉
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {unassigned.slice(0, 5).map((tk) => (
                  <li key={tk.id}>
                    <Link
                      href={`/tickets/${tk.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/50"
                    >
                      <span className="font-mono text-xs text-muted-foreground">{tk.reference}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{tk.subject}</span>
                      <PriorityBadge priority={tk.priority as TicketPriorityValue} locale={locale} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold">Tickets recientes</h2>
          <Link
            href={isClient ? "/tickets" : "/admin/tickets"}
            className="text-sm font-medium text-primary hover:underline"
          >
            Ver todos
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aún no hay tickets.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((tk) => (
              <li key={tk.id}>
                <Link
                  href={`/tickets/${tk.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50"
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
