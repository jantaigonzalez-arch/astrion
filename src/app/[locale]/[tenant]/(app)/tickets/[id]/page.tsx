import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  Boxes,
  Building2,
  Clock,
  FileText,
  Hourglass,
  Lock,
  Package,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isSupport, ROLE_LABELS } from "@/lib/roles";
import { getTicketById, getAgents } from "@/lib/data/tickets";
import { rolesByUser } from "@/lib/data/people";
import { getEquipmentTree } from "@/lib/data/equipment";
import { getSpareParts } from "@/lib/data/parts";
import { getSettings } from "@/lib/data/settings";
import { computeProfit } from "@/lib/profit";
import { ProfitCard } from "@/components/portal/profit-card";
import { Link } from "@/lib/nav";
import { latestPredictionFor } from "@/lib/ml/serve";
import { templateById } from "@/lib/ml/templates";
import { PredictionCard } from "@/components/portal/prediction-card";
import { updateTicketStatus } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import { ServiceSheet } from "@/components/portal/service-sheet";
import { CommentForm } from "@/components/portal/comment-form";
import { ReviewPanel } from "@/components/portal/review-panel";
import { AssignPanel } from "@/components/portal/assign-panel";
import { Badge } from "@/components/ui/badge";
import { currentRole } from "@/lib/tenancy/context";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STAFF_SETTABLE_STATUSES,
  TYPE_LABELS,
  TYPE_STYLES,
  label,
  type TicketPriorityValue,
  type TicketStatusValue,
  type TicketTypeValue,
} from "@/lib/tickets";

const selectCls =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const role = (await currentRole());
  const isStaff = isSupport(role);

  const ticket = await getTicketById(id);
  if (!ticket) notFound();
  // Lista de agentes solo para el staff (para el panel de asignación).
  const agents = isStaff ? await getAgents() : [];
  // Inventario del laboratorio dueño del ticket, para referenciar la actividad.
  // Catálogo de refacciones (solo el staff registra consumos).
  const partOptions = isStaff
    ? (await getSpareParts(true)).map((p) => ({
        id: p.id,
        partNumber: p.partNumber,
        description: p.description,
        costMxn: p.costMxn,
        stock: p.stock,
      }))
    : [];
  // Utilidad del servicio: ingresos (venta refacciones + horas×tarifa)
  // menos costos (costo refacciones + horas×costo interno).
  const appSettings = await getSettings();
  const profit = computeProfit({
    hours: ticket.comments.reduce((a, c) => a + Number(c.hours ?? 0), 0),
    parts: ticket.comments.flatMap((c) => c.parts),
    laborCostPerHour: appSettings.laborCostPerHour,
    laborRatePerHour: appSettings.laborRatePerHour,
  });

  // La estimación del modelo: se LEE, no se calcula. La fila ya se escribió
  // cuando el ticket entró a la cola, que es cuando el número servía para algo.
  // Es información interna de planificación, así que sigue la misma regla que
  // la utilidad: solo staff.
  const prediction = isStaff
    ? await latestPredictionFor("service_hours", ticket.id)
    : null;
  // La tolerancia sale de la plantilla, no de una constante: el administrador
  // puede haberla ajustado, y la tarjeta tiene que juzgar el acierto con el
  // mismo margen con el que se juzgó el modelo.
  // Y el TIPO de margen viaja con el número: leer uno sin el otro haría que la
  // tarjeta dijera «dentro» donde el modelo contó «fuera».
  const plantillaHoras = prediction ? await templateById("service_hours") : undefined;
  const hoursTolerance = plantillaHoras?.tolerance || 2;
  const hoursToleranceKind = plantillaHoras?.toleranceKind;

  const tree = await getEquipmentTree(ticket.createdById);
  const commentEquipment = tree.map((eq) => ({
    id: eq.id,
    brand: eq.brand,
    name: eq.name,
    model: eq.model,
    modules: eq.modules.map((m) => ({
      id: m.id,
      name: m.name,
      serialNumber: m.serialNumber,
      submodules: m.submodules.map((s) => ({
        id: s.id,
        name: s.name,
        serialNumber: s.serialNumber,
      })),
    })),
  }));
  // El cliente solo puede ver sus propios tickets.
  if (!isStaff && ticket.createdById !== session!.user.id) notFound();

  // El rol del autor es su papel en ESTA empresa, así que se resuelve por
  // membresía y no viene pegado al comentario.
  const authorRoles = await rolesByUser(ticket.comments.map((c) => c.author.id));

  const visibleComments = ticket.comments.filter(
    (c) => isStaff || !c.internal,
  );

  /*
    Lo que el cliente ve de la bitácora.

    El staff sigue viendo el cuaderno completo. Al cliente no se le enseña el
    texto libre —trae viáticos con importe, notas internas y hasta el nombre de
    otros clientes— pero sí los HECHOS, que están en columnas: fecha, equipo,
    horas y refacciones. Ver `ServiceSheet`.

    Sin esto, un cliente entraba a su ticket y no veía nada en absoluto: los 534
    comentarios traídos del sistema anterior están marcados como internos, así
    que `visibleComments` quedaba vacío en TODOS los tickets.
  */
  const serviceActivities = isStaff ? [] : ticket.comments;

  const fmt = (d: Date | string | null) =>
    d ? new Date(d).toLocaleString(locale === "en" ? "en-US" : "es-MX") : "—";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{ticket.reference}</span>
            <StatusBadge status={ticket.status as TicketStatusValue} locale={locale} />
            <PriorityBadge priority={ticket.priority as TicketPriorityValue} locale={locale} />
            <Badge className={TYPE_STYLES[ticket.type as TicketTypeValue]}>
              {label(TYPE_LABELS, ticket.type, locale)}
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isStaff && (
            <Button asChild variant="accent" size="sm">
              {/* `Link` de @/lib/nav y no un `<a>` crudo: el ancla se saltaba
                  el prefijo de empresa y en modo path apuntaba a
                  `astraion.com/tickets/…`, que es 404. El componente resuelve
                  los dos modos y el idioma de una vez. */}
              <Link href={`/tickets/${ticket.id}/reporte`}>
                <FileText className="size-4" /> Reporte de servicio
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/tickets">← Volver</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Hilo */}
        <div className="space-y-4">
          {ticket.status === "rejected" && (
            <Card className="border-destructive/40 bg-destructive/5 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <XCircle className="size-4" /> Solicitud rechazada
              </h3>
              <p className="mt-1.5 text-sm">{ticket.rejectionReason}</p>
            </Card>
          )}
          {ticket.status === "pending_review" && !isStaff && (
            <Card className="border-warning/40 bg-warning/5 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
                <Hourglass className="size-4" /> En revisión
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Tu solicitud fue recibida y está siendo revisada por nuestro equipo.
                Te notificaremos en cuanto sea aprobada.
              </p>
            </Card>
          )}

          <Card className="p-5">
            <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
          </Card>

          {/* Cliente: hoja de servicio derivada, sin texto libre ni importes. */}
          {!isStaff && (
            <ServiceSheet activities={serviceActivities} locale={locale} />
          )}

          <div className="space-y-3">
            {visibleComments.map((c) => (
              <Card
                key={c.id}
                className={c.internal ? "border-warning/30 bg-warning/5 p-4" : "p-4"}
              >
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {c.author.name ?? c.author.email}
                  </span>
                  {authorRoles.get(c.author.id) && (
                    <span>· {ROLE_LABELS[authorRoles.get(c.author.id)!]}</span>
                  )}
                  {c.internal && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <Lock className="size-3" /> interna
                    </span>
                  )}
                  {c.hours && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      <Clock className="size-3" /> {Number(c.hours)} h
                    </span>
                  )}
                  <span className="ml-auto">{fmt(c.createdAt)}</span>
                </div>
                {c.equipment && (
                  <p className="mb-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-secondary/70 px-2 py-1 text-xs text-muted-foreground">
                    <Wrench className="size-3 text-primary" />
                    <span className="font-medium text-foreground">
                      {c.equipment.brand} {c.equipment.name}
                    </span>
                    {c.module && (
                      <>
                        <span>›</span>
                        <span>{c.module.name}</span>
                        {c.module.serialNumber && (
                          <span className="font-mono">S/N {c.module.serialNumber}</span>
                        )}
                      </>
                    )}
                    {c.submodule && (
                      <>
                        <span>›</span>
                        <span>{c.submodule.name}</span>
                        {c.submodule.serialNumber && (
                          <span className="font-mono">S/N {c.submodule.serialNumber}</span>
                        )}
                      </>
                    )}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                {c.parts.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {c.parts.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                      >
                        <Package className="size-3 text-primary" />
                        <span className="font-mono font-medium">{p.partNumber}</span>
                        <span className="min-w-0 flex-1 truncate">{p.description}</span>
                        <span>×{p.quantity}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
            {visibleComments.length === 0 && isStaff && (
              <p className="px-1 text-sm text-muted-foreground">Sin respuestas todavía.</p>
            )}
          </div>

          <Card className="p-4">
            <CommentForm
              ticketId={ticket.id}
              canMarkInternal={isStaff}
              equipment={commentEquipment}
              parts={partOptions}
              defaultEquipmentId={ticket.equipmentId ?? ""}
              defaultModuleId={ticket.moduleId ?? ""}
            />
          </Card>
        </div>

        {/* Panel lateral */}
        <div className="space-y-4">
          <Card className="p-5 text-sm">
            <h3 className="mb-3 font-semibold">Detalles</h3>
            <dl className="space-y-3 text-muted-foreground">
              <div className="flex items-center gap-2">
                <User className="size-4" />
                <span>{ticket.createdBy.name ?? ticket.createdBy.email}</span>
              </div>
              {ticket.createdBy.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="size-4" />
                  <span>{ticket.createdBy.company}</span>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide">Categoría</dt>
                <dd className="text-foreground">{label(CATEGORY_LABELS, ticket.category, locale)}</dd>
              </div>
              {ticket.equipment && (
                <div>
                  <dt className="text-xs uppercase tracking-wide">Equipo</dt>
                  <dd className="flex items-start gap-2 text-foreground">
                    <Boxes className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      {ticket.equipment.brand} {ticket.equipment.name}
                      {ticket.equipment.model ? ` · ${ticket.equipment.model}` : ""}
                      {ticket.module && (
                        <span className="block text-xs text-muted-foreground">
                          Módulo: {ticket.module.name}
                          {ticket.module.serialNumber
                            ? ` · S/N ${ticket.module.serialNumber}`
                            : ""}
                        </span>
                      )}
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide">Creado</dt>
                <dd className="text-foreground">{fmt(ticket.createdAt)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="size-4" />
                <div>
                  <dt className="text-xs uppercase tracking-wide">SLA respuesta</dt>
                  <dd className="text-foreground">{fmt(ticket.slaDueAt)}</dd>
                </div>
              </div>
            </dl>
          </Card>

          {/* Estimación del modelo, antes que la utilidad: sirve para decidir
              (cotizar, agendar), mientras que la utilidad describe lo ya hecho. */}
          {prediction && (
            <PredictionCard
              p={{
                ...prediction,
                tolerance: hoursTolerance,
                toleranceKind: hoursToleranceKind,
              }}
            />
          )}

          {/* Rentabilidad del servicio (solo staff) */}
          {isStaff && (profit.revenue > 0 || profit.cost > 0) && (
            <ProfitCard p={profit} />
          )}

          {/* Aprobación de solicitudes del cliente */}
          {isStaff && ticket.status === "pending_review" && (
            <ReviewPanel ticketId={ticket.id} />
          )}

          {/* Asignación de agente (una vez que el ticket procede) */}
          {isStaff && ticket.status !== "pending_review" && ticket.status !== "rejected" && (
            <AssignPanel
              ticketId={ticket.id}
              agents={agents}
              currentAssigneeId={ticket.assignedToId}
              currentUserId={session!.user.id}
            />
          )}

          {isStaff && ticket.status !== "pending_review" && ticket.status !== "rejected" && (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Cambiar estado</h3>
              <form action={updateTicketStatus} className="flex gap-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <select name="status" defaultValue={ticket.status} className={`${selectCls} flex-1`}>
                  {STAFF_SETTABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>{label(STATUS_LABELS, s, locale)}</option>
                  ))}
                </select>
                <Button type="submit" size="sm">Guardar</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
