import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AlarmClock, ClipboardPlus, Hourglass } from "lucide-react";
import {
  CAMPOS_ORDEN_COLA,
  ORDEN_COLA_DEFECTO,
  conteosCola,
  countQueue,
  getAgents,
  getPendingReviewTickets,
  getQueueCounts,
  getQueuePage,
  type CampoOrdenCola,
} from "@/lib/data/tickets";
import { parsePage } from "@/lib/pagination";
import {
  INICIAL,
  parseFiltro,
  parseOrden,
  queryLimpia,
  type Orden,
} from "@/lib/listado";
import { Pagination } from "@/components/portal/pagination";
import {
  BarraFiltros,
  FiltroFichas,
  ThOrden,
} from "@/components/portal/listado-controles";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import {
  AnalysisSection,
  AnalysisSectionSkeleton,
} from "@/components/portal/analysis-section";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STAFF_SETTABLE_STATUSES,
  STATUS_LABELS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
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

/**
 * Un encabezado de la cola: ordena SOLO cuando se le da el orden.
 *
 * La misma tabla sirve a dos listas: la cola paginada, que se ordena en la
 * base, y la bandeja de pendientes, que son las veinte más recientes y ya
 * vienen ordenadas. Poner enlaces en la segunda ofrecería ordenar veinte filas
 * de una lista recortada — el orden cambiaría lo que se ve pero no CUÁLES
 * veinte se ven, que es la clase de mentira que este componente no debe contar.
 *
 * Vive fuera del render de `TicketsTable` a propósito: definido dentro, React
 * ve un tipo de componente NUEVO en cada pasada y desmonta el subárbol en vez
 * de actualizarlo. Cuesta unas props más en cada llamada y ahorra un fallo que
 * solo se manifiesta como parpadeo.
 */
function ThCola({
  campo,
  children,
  orden,
  query,
  tipo = "texto",
}: {
  campo: CampoOrdenCola;
  children: React.ReactNode;
  orden?: Orden<CampoOrdenCola>;
  query?: Record<string, string | undefined>;
  tipo?: "texto" | "fecha" | "numero";
}) {
  if (!orden) return <th className="px-4 py-3 font-medium">{children}</th>;
  return (
    <ThOrden
      campo={campo}
      actual={orden}
      basePath="/admin/tickets"
      query={query}
      inicial={INICIAL[tipo]}
    >
      {children}
    </ThOrden>
  );
}

function TicketsTable({
  rows,
  locale,
  orden,
  query,
}: {
  rows: Row[];
  locale: string;
  /** Presente solo en la lista paginada. Ver la nota de `Th`. */
  orden?: Orden<CampoOrdenCola>;
  query?: Record<string, string | undefined>;
}) {
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
            <ThCola campo="folio" orden={orden} query={query}>Folio</ThCola>
            <ThCola campo="asunto" orden={orden} query={query}>Asunto</ThCola>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <ThCola campo="prioridad" tipo="numero" orden={orden} query={query}>Prioridad</ThCola>
            <ThCola campo="estado" orden={orden} query={query}>Estado</ThCola>
            <ThCola campo="sla" tipo="fecha" orden={orden} query={query}>SLA</ThCola>
            <th className="px-4 py-3 font-medium">Asignado</th>
            <ThCola campo="creado" tipo="fecha" orden={orden} query={query}>Creado</ThCola>
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
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground tabular-nums">
                {tk.createdAt.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
                  day: "2-digit",
                  month: "short",
                  year: "2-digit",
                })}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                No hay tickets con estos filtros.
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
  searchParams: Promise<{
    page?: string;
    por?: string;
    sla?: string;
    orden?: string;
    dir?: string;
    estado?: string;
    prioridad?: string;
    categoria?: string;
    tecnico?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const pageParams = parsePage(sp);
  const onlyBreached = sp.sla === "vencido";

  const orden = parseOrden(sp, CAMPOS_ORDEN_COLA, ORDEN_COLA_DEFECTO);
  const filtros = {
    estado: parseFiltro(sp.estado, STAFF_SETTABLE_STATUSES),
    prioridad: parseFiltro(sp.prioridad, TICKET_PRIORITIES),
    categoria: parseFiltro(sp.categoria, TICKET_CATEGORIES),
    tecnico: sp.tecnico,
    onlyBreached,
  };

  /*
    Lo que hay que arrastrar en cada enlace de la pantalla —paginador,
    encabezados y fichas— para no perder lo que el usuario eligió.

    Se arma UNA vez y se pasa a los tres. Construirlo en cada sitio es cómo se
    acaba con un paginador que conserva los filtros y unos encabezados que no,
    o al revés: el fallo aparece dos pantallas después y nadie lo relaciona.
  */
  const query = queryLimpia({
    sla: onlyBreached ? "vencido" : undefined,
    estado: filtros.estado,
    prioridad: filtros.prioridad,
    categoria: filtros.categoria,
    tecnico: filtros.tecnico,
    orden: orden.campo,
    dir: orden.dir,
    por: sp.por,
  });

  // Los conteos del encabezado hablan de TODA la empresa, así que se preguntan
  // aparte: derivarlos de la página que se está viendo diría "25 en total".
  //
  // El total del paginador, en cambio, tiene que respetar los filtros, y por eso
  // ahora sale de su propia consulta en vez de restarse a mano de los conteos
  // globales: con un filtro puesto, aquella resta daba el total sin filtrar y el
  // paginador ofrecía páginas vacías.
  const [counts, pending, rows, queueTotal, conteos, agentes] = await Promise.all([
    getQueueCounts(),
    getPendingReviewTickets(),
    getQueuePage({
      limit: pageParams.perPage,
      offset: pageParams.offset,
      orden,
      ...filtros,
    }),
    countQueue(filtros),
    conteosCola(filtros),
    getAgents(),
  ]);

  const hayFiltros =
    Boolean(filtros.estado || filtros.prioridad || filtros.categoria || filtros.tecnico) ||
    onlyBreached ||
    orden.campo !== ORDEN_COLA_DEFECTO.campo ||
    orden.dir !== ORDEN_COLA_DEFECTO.dir;

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
        {/*
          Los filtros van DENTRO de la tarjeta y pegados a la tabla, no sueltos
          arriba: pertenecen a esta lista y no a la pantalla —que además tiene
          otra tabla, la de pendientes, a la que no aplican—.
        */}
        <BarraFiltros hayFiltros={hayFiltros} basePath="/admin/tickets">
          <FiltroFichas
            titulo="Estado"
            clave="estado"
            activo={filtros.estado}
            basePath="/admin/tickets"
            query={query}
            opciones={[
              { label: "Todos" },
              ...STAFF_SETTABLE_STATUSES.map((v) => ({
                valor: v,
                label: label(STATUS_LABELS, v, locale),
                n: conteos.estado.get(v) ?? 0,
              })),
            ]}
          />
          <FiltroFichas
            titulo="Prioridad"
            clave="prioridad"
            activo={filtros.prioridad}
            basePath="/admin/tickets"
            query={query}
            opciones={[
              { label: "Todas" },
              ...TICKET_PRIORITIES.map((v) => ({
                valor: v,
                label: label(PRIORITY_LABELS, v, locale),
                n: conteos.prioridad.get(v) ?? 0,
              })),
            ]}
          />
          <FiltroFichas
            titulo="Categoría"
            clave="categoria"
            activo={filtros.categoria}
            basePath="/admin/tickets"
            query={query}
            opciones={[
              { label: "Todas" },
              // Las vacías las esconde `FiltroFichas`, con la misma regla para
              // los once listados.
              ...TICKET_CATEGORIES.map((v) => ({
                valor: v,
                label: label(CATEGORY_LABELS, v, locale),
                n: conteos.categoria.get(v) ?? 0,
              })),
            ]}
          />
          <FiltroFichas
            titulo="Técnico"
            clave="tecnico"
            activo={filtros.tecnico}
            basePath="/admin/tickets"
            query={query}
            opciones={[
              { label: "Todos" },
              ...agentes.map((a) => ({
                valor: a.id,
                // Solo el nombre de pila: seis fichas con el nombre completo no
                // caben en una línea, y en un equipo de seis nadie duda de quién
                // se habla.
                label: (a.name ?? a.email ?? "—").split(" ")[0],
                n: conteos.tecnico.get(a.id) ?? 0,
              })),
              { valor: "sin", label: "Sin asignar", n: conteos.tecnico.get("sin") ?? 0 },
            ]}
          />
        </BarraFiltros>
        <TicketsTable rows={rows} locale={locale} orden={orden} query={query} />
        <Pagination
          {...pageParams}
          total={queueTotal}
          basePath="/admin/tickets"
          query={query}
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


      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="servicio" />
      </Suspense>
    </div>
  );
}
