import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Ticket, Clock, Loader, CheckCircle2, UserCheck, UserX } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getDashboardStats,
  getRecentTickets,
  getMyActiveTickets,
  getUnassignedTickets,
} from "@/lib/data/tickets";
import { getContracts } from "@/lib/data/contracts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import { ListSkeleton, StatCardsSkeleton } from "@/components/portal/skeletons";
import { currentRole } from "@/lib/tenancy/context";
import type { MembershipRole } from "@/lib/db/platform";
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
  // Igual que en la consola: el guardia del layout no frena esta página, así
  // que sin sesión `session!.user` lanzaba. Devolver null deja que gane la
  // redirección del layout, sin ruido en los registros.
  const session = await auth();
  if (!session?.user) return null;
  // Sin rol no hay empresa activa, y el panel no tiene de qué informar. Mismo
  // criterio que arriba: callar y dejar que redirija el layout.
  const role = await currentRole();
  if (!role) return null;
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

      {/*
        Tres límites en vez de uno.

        El saludo se pinta de inmediato porque solo necesita la sesión, que ya
        está resuelta. Cada bloque de abajo espera su propia consulta y llega
        cuando puede: los indicadores son una agregación y suelen ganar la
        carrera; las listas tardan un poco más. Con un único `await` arriba, la
        pantalla entera esperaba a la consulta más lenta para enseñar hasta el
        nombre del usuario.
      */}
      <Suspense fallback={<StatCardsSkeleton />}>
        <StatCards role={role} userId={session!.user.id} />
      </Suspense>

      {!isClient && (
        <Suspense
          fallback={
            <div className="grid gap-5 lg:grid-cols-2">
              <ListSkeleton rows={4} />
              <ListSkeleton rows={4} />
            </div>
          }
        >
          <Workload userId={session!.user.id} locale={locale} />
        </Suspense>
      )}

      <Suspense fallback={<ListSkeleton rows={6} />}>
        <RecentTickets
          ownerId={isClient ? session!.user.id : undefined}
          isClient={isClient}
          locale={locale}
        />
      </Suspense>
    </div>
  );
}

/* ============================================================
   Bloques del panel
   ============================================================
   Cada uno hace su consulta y se dibuja solo. Son componentes de servidor: lo
   que viaja al navegador es el HTML ya resuelto, no la consulta ni los datos. */

async function StatCards({
  role,
  userId,
}: {
  role: MembershipRole;
  userId: string;
}) {
  const stats = await getDashboardStats(role, userId);
  const cards = [
    { label: "Total", value: stats.total, Icon: Ticket, tone: "text-primary" },
    { label: "Abiertos", value: stats.open, Icon: Clock, tone: "text-signal-bright" },
    { label: "En progreso", value: stats.inProgress, Icon: Loader, tone: "text-warning" },
    { label: "Resueltos", value: stats.resolved, Icon: CheckCircle2, tone: "text-success" },
  ];

  return (
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
  );
}

/** Carga de trabajo del agente: lo suyo y lo que no es de nadie. */
async function Workload({ userId, locale }: { userId: string; locale: string }) {
  // Las dos consultas son independientes: en paralelo cuestan la más lenta y
  // no la suma. Van juntas en un solo límite de Suspense porque comparten
  // fila en la retícula y enseñarlas por separado haría saltar la maqueta.
  const [mine, unassigned] = await Promise.all([
    getMyActiveTickets(userId),
    getUnassignedTickets(),
  ]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <UserCheck className="size-4 text-primary" /> Asignados a mí
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {mine.total}
            </span>
          </h2>
        </div>
        {mine.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No tienes tickets asignados.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {mine.rows.map((tk) => (
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
              {unassigned.total}
            </span>
          </h2>
        </div>
        {unassigned.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Todos los tickets activos están asignados. 🎉
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {unassigned.rows.map((tk) => (
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
  );
}

async function RecentTickets({
  ownerId,
  isClient,
  locale,
}: {
  ownerId?: string;
  isClient: boolean;
  locale: string;
}) {
  const recent = await getRecentTickets({ ownerId });

  return (
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
  );
}
