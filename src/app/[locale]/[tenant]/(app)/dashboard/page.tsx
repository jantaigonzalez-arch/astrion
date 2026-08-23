import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Ticket, Clock, Loader, CheckCircle2, UserCheck, UserX, Undo2 } from "lucide-react";
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
import { currentRole, getTenantContext } from "@/lib/tenancy/context";
import { exitTenant } from "@/lib/actions/platform";
import { cn } from "@/lib/utils";
import { CompanySummary } from "@/components/portal/company-summary";
import { pantallasDelRol } from "@/lib/portal/menu";
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

  // Personal de Astraion dentro de la empresa de un cliente. El panel es un
  // resumen del trabajo DE UNO, y un operador no tiene ninguno aquí: su
  // identidad vive en `platform_users` y ninguna fila de este esquema puede
  // apuntarle. Sin esto, la pantalla de llegada le saludaba por su nombre y le
  // ofrecía «Asignados a mí» — un cero que no puede dejar de serlo.
  const ctx = await getTenantContext();
  const deAstraion = Boolean(ctx?.impersonated);

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
            {/* De visita no se saluda por el nombre de uno: lo que hay que saber
                es DÓNDE se está. El nombre de quien mira ya está arriba a la
                derecha, y repetirlo aquí gasta el renglón más visible de la
                pantalla en el único dato que el operador no necesita. */}
            {deAstraion ? ctx!.name : `Hola, ${session!.user.name ?? session!.user.email}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {deAstraion
              ? "Estás dentro como personal de Astraion. Puedes mirarlo todo y no cambiar nada; el acceso quedó registrado."
              : isClient
                ? "Resumen de tus solicitudes."
                : "Resumen operativo de soporte."}
          </p>
        </div>
        {isClient && (
          <Button asChild variant="accent">
            <Link href="/tickets/new">Nuevo ticket</Link>
          </Button>
        )}
        {deAstraion && (
          // La salida, en la pantalla de llegada. Sin esto, volver a la consola
          // desde dentro de una empresa exigía saberse la dirección: el menú
          // lateral es el de la empresa y no tiene un renglón para irse de ella.
          <form action={exitTenant} data-permitido>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="outline" size="sm">
              <Undo2 className="size-4" /> Volver a la consola
            </Button>
          </form>
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
      {/* La empresa por áreas. Va ANTES que los tickets porque es lo general:
          antes se entraba a una pantalla que hablaba solo de servicio y hacía
          leer la empresa entera como una cola de tickets. Un cliente no lo ve
          —su portal es el de SUS solicitudes, no el del negocio ajeno—. */}
      {!isClient && (
        <Suspense fallback={<StatCardsSkeleton />}>
          <CompanySummary pantallas={pantallasDelRol(role)} locale={locale} />
        </Suspense>
      )}

      <Suspense fallback={<StatCardsSkeleton />}>
        <StatCards role={role} userId={session!.user.id} />
      </Suspense>

      {!isClient && (
        <Suspense
          fallback={
            <div className={cn("grid gap-5", !deAstraion && "lg:grid-cols-2")}>
              <ListSkeleton rows={4} />
              {!deAstraion && <ListSkeleton rows={4} />}
            </div>
          }
        >
          <Workload
            userId={session!.user.id}
            locale={locale}
            soloSinAsignar={deAstraion}
          />
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

/**
 * Carga de trabajo del agente: lo suyo y lo que no es de nadie.
 *
 * `soloSinAsignar` deja fuera la mitad personal. Lo usa el panel cuando quien
 * mira es personal de Astraion: su identidad no existe en esta empresa —vive en
 * `platform_users`, y ninguna fila de este esquema puede apuntarle— así que
 * «Asignados a mí» no es que esté vacío hoy, es que no puede llenarse nunca.
 * Enseñar un cero permanente y llamarlo carga de trabajo es peor que no
 * enseñarlo.
 */
async function Workload({
  userId,
  locale,
  soloSinAsignar = false,
}: {
  userId: string;
  locale: string;
  soloSinAsignar?: boolean;
}) {
  // Las dos consultas son independientes: en paralelo cuestan la más lenta y
  // no la suma. Van juntas en un solo límite de Suspense porque comparten
  // fila en la retícula y enseñarlas por separado haría saltar la maqueta.
  const [mine, unassigned] = await Promise.all([
    soloSinAsignar
      ? Promise.resolve({ rows: [], total: 0 })
      : getMyActiveTickets(userId),
    getUnassignedTickets(),
  ]);

  return (
    <div className={cn("grid gap-5", !soloSinAsignar && "lg:grid-cols-2")}>
      {!soloSinAsignar && (
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
      )}

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
