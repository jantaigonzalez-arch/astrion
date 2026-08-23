import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { Building2, Inbox, History, ArrowRight, DoorOpen } from "lucide-react";
import { auth } from "@/lib/auth";
import { getTenants, getPlatformEvents, getSignups } from "@/lib/data/platform";
import { getTenantContext } from "@/lib/tenancy/context";
import { exitTenant } from "@/lib/actions/platform";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TenantCard } from "@/components/console/tenant-card";
import { cn } from "@/lib/utils";

/**
 * La bienvenida de la consola de Astraion.
 *
 * ── QUÉ ERA ANTES, Y POR QUÉ NO SERVÍA ─────────────────────────────────────
 *
 * Era la consola ENTERA en un scroll: el título decía «Empresas» y debajo
 * venían la bandeja de solicitudes, todas las empresas con seis métricas cada
 * una, el formulario de alta y la bitácora completa. Nada recibía a nadie; se
 * abría en mitad del inventario. Y al ser una sola pantalla, todo competía por
 * el mismo sitio: lo que espera una decisión —una solicitud de alta— quedaba
 * encima de una lista que crece con cada cliente.
 *
 * ── QUÉ ES AHORA ──────────────────────────────────────────────────────────
 *
 * Orienta y reparte, en el orden en que importa:
 *
 *   1. dónde estás parado   si tienes abierta la empresa de un cliente, eso es
 *                           lo primero, porque es lo único con consecuencias
 *   2. qué espera decisión   solicitudes pendientes; si no hay, no ocupa nada
 *   3. cómo va la plataforma cuatro cifras, no seis por empresa
 *   4. por dónde seguir      las tres secciones, y las empresas para entrar
 *
 * Las cifras de cada empresa NO están aquí a propósito: comparar empresas es
 * trabajo de la sección de Empresas. Una bienvenida que las trae vuelve a ser
 * el inventario del que se la sacó, solo que con un saludo encima.
 */
export default async function ConsolaInicioPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El layout ya exigió sesión de plataforma, pero en Next layout y página se
  // renderizan EN PARALELO: su `redirect()` no impide que esto corra.
  const session = await auth();
  if (!session?.user) return null;
  const isSuper = session.user.platformRole === "superadmin";
  const prefijo = locale === "en" ? "/en" : "";

  const [rows, active, signups, events] = await Promise.all([
    getTenants(),
    getTenantContext(),
    isSuper ? getSignups() : Promise.resolve([]),
    getPlatformEvents(5),
  ]);

  const pendientes = signups.filter((s) => s.status === "pending").length;
  const fmt = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX");
  const totals = rows.reduce(
    (a, r) => ({
      tickets: a.tickets + (r.stats?.tickets ?? 0),
      orgs: a.orgs + (r.stats?.organizations ?? 0),
      members: a.members + r.members,
    }),
    { tickets: 0, orgs: 0, members: 0 },
  );

  const nombre = (session.user.name ?? session.user.email ?? "").split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {nombre ? `Hola, ${nombre}` : "Hola"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Estás en el plano de Astraion, por debajo de todas las empresas. Desde
          aquí se dan de alta, se entra a cualquiera para diagnosticar y queda
          registrado quién lo hizo.
        </p>
      </div>

      {/* 1 · Dónde estás parado. Va primero porque es lo único de esta pantalla
             que tiene consecuencias ahora mismo: estar dentro de la empresa de
             un cliente y no darse cuenta es el error que esta consola no puede
             permitir. Con salida a la vista, que antes no existía. */}
      {active && (
        <Card
          className={cn(
            "flex flex-wrap items-center justify-between gap-4 p-4",
            active.impersonated
              ? "border-warning/40 bg-warning/5"
              : "border-primary/30 bg-primary/5",
          )}
        >
          <div className="flex items-start gap-3">
            <DoorOpen
              className={cn(
                "mt-0.5 size-5 shrink-0",
                active.impersonated ? "text-warning" : "text-primary",
              )}
            />
            <p className="text-sm">
              Tienes abierta <span className="font-semibold">{active.name}</span>
              {active.impersonated ? (
                <>
                  {" "}
                  como personal de Astraion. El acceso quedó registrado, y dentro
                  solo puedes <span className="font-medium">leer</span>.
                </>
              ) : (
                " con tu propia membresía."
              )}
            </p>
          </div>
          <form action={exitTenant}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="outline" size="sm">
              Salir de la empresa
            </Button>
          </form>
        </Card>
      )}

      {/* 2 · Lo que espera una decisión. Si no hay nada, no ocupa ni una línea:
             una tarjeta que dice «0 pendientes» es ruido con buena intención. */}
      {isSuper && pendientes > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-warning/40 bg-warning/5 p-4">
          <div className="flex items-start gap-3">
            <Inbox className="mt-0.5 size-5 shrink-0 text-warning" />
            <p className="text-sm">
              <span className="font-semibold">
                {pendientes} solicitud{pendientes === 1 ? "" : "es"} de alta
              </span>{" "}
              esperando tu decisión.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`${prefijo}/platform/solicitudes`}>
              Revisar <ArrowRight className="size-4" />
            </Link>
          </Button>
        </Card>
      )}

      {/* 3 · Cómo va la plataforma. Cuatro cifras del conjunto, que es la
             pregunta de esta pantalla; el desglose por empresa es de la otra. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Cifra etiqueta="Empresas" valor={fmt.format(rows.length)} />
        <Cifra etiqueta="Tickets" valor={fmt.format(totals.tickets)} />
        <Cifra etiqueta="Clientes" valor={fmt.format(totals.orgs)} />
        <Cifra etiqueta="Usuarios" valor={fmt.format(totals.members)} />
      </div>

      {/* 4 · Por dónde seguir. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              <h2 className="font-semibold">Entrar a una empresa</h2>
            </div>
            {rows.length > 4 && (
              <Link
                href={`${prefijo}/platform/empresas`}
                className="text-xs font-medium text-primary hover:underline"
              >
                ver las {rows.length}
              </Link>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Todavía no hay ninguna empresa dada de alta.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {/* Las cuatro más recientes: en una bienvenida, la lista completa
                  es la otra sección. Compactas — aquí se viene a ENTRAR. */}
              {rows.slice(0, 4).map((t) => (
                <TenantCard
                  key={t.id}
                  t={t}
                  locale={locale}
                  aqui={active?.slug === t.slug}
                  isSuper={isSuper}
                  compacta
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-primary" />
              <h2 className="font-semibold">Últimos movimientos</h2>
            </div>
            <Link
              href={`${prefijo}/platform/bitacora`}
              className="text-xs font-medium text-primary hover:underline"
            >
              ver la bitácora
            </Link>
          </div>

          {events.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Sin movimientos registrados.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span
                    className={cn(
                      "font-mono text-xs",
                      e.eventType === "tenant.accessed_by_platform" && "text-warning",
                    )}
                  >
                    {e.eventType}
                  </span>
                  <span className="text-muted-foreground">
                    {e.tenantName ?? "—"} · {e.actorName ?? e.actorEmail ?? "sistema"}
                  </span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(e.occurredAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {etiqueta}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{valor}</div>
    </Card>
  );
}
