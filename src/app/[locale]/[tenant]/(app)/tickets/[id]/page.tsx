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
import { hayRefacciones } from "@/lib/data/parts";
import { getSettings } from "@/lib/data/settings";
import { computeProfit } from "@/lib/profit";
import { ProfitCard } from "@/components/portal/profit-card";
import { Link } from "@/lib/nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PriorityBadge } from "@/components/portal/badges";
import { ServiceSheet } from "@/components/portal/service-sheet";
import { CommentForm } from "@/components/portal/comment-form";
import { ReviewPanel } from "@/components/portal/review-panel";
import { AssignPanel } from "@/components/portal/assign-panel";
import { StatusPanel } from "@/components/portal/status-panel";
import { Badge } from "@/components/ui/badge";
import { currentRole } from "@/lib/tenancy/context";
import {
  CATEGORY_LABELS,
  TYPE_LABELS,
  TYPE_STYLES,
  label,
  type TicketPriorityValue,
  type TicketStatusValue,
  type TicketTypeValue,
} from "@/lib/tickets";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [session, role] = await Promise.all([auth(), currentRole()]);
  const isStaff = isSupport(role);

  /*
    Las cuatro lecturas de arranque, en una tanda.

    Iban una detrás de otra, y ninguna dependía de la anterior: el ticket, la
    lista de agentes, el catálogo de refacciones y los ajustes. En una máquina
    donde la base está al lado apenas se nota —medido, 11,5 ms contra 6,2— pero
    la cascada cobra una LATENCIA por escalón, así que con la base al otro lado
    de una red son cinco esperas en serie en vez de una.

    Es la pantalla más abierta del sistema, y por eso es la que más rinde.
  */
  const [ticket, agents, hayCatalogo, appSettings] = await Promise.all([
    getTicketById(id),
    // Solo el staff asigna y registra consumos; para un cliente no hay nada que
    // pedir y la lista se queda vacía sin tocar la base.
    isStaff ? getAgents() : Promise.resolve([]),
    // Solo SI hay catálogo, no el catálogo: el buscador de la bitácora lo
    // pide al teclear. Traerlo entero eran 1.2 MB por ticket con 6 609
    // refacciones. Ver `PartsPicker`.
    isStaff ? hayRefacciones() : Promise.resolve(false),
    getSettings(),
  ]);

  if (!ticket) notFound();

  /*
    El cliente solo puede ver sus propios tickets.

    La comprobación sube AQUÍ, junto al ticket que la habilita. Estaba treinta
    líneas más abajo, después de leer el árbol de equipos del dueño — o sea que
    quien no tenía derecho a ver el ticket provocaba igual esa lectura antes de
    recibir su «no existe». Nunca vio los datos, pero los pedía.
  */
  if (!isStaff && ticket.createdById !== session!.user.id) notFound();

  // Utilidad del servicio: ingresos (venta refacciones + horas×tarifa)
  // menos costos (costo refacciones + horas×costo interno).
  const profit = computeProfit({
    hours: ticket.comments.reduce((a, c) => a + Number(c.hours ?? 0), 0),
    parts: ticket.comments.flatMap((c) => c.parts),
    laborCostPerHour: appSettings.laborCostPerHour,
    laborRatePerHour: appSettings.laborRatePerHour,
  });

  // La estimación del modelo vuelve aquí cuando la capa nueva sepa emitirla.
  // Se quita entera en vez de dejarla en `null`: una tarjeta que nunca aparece
  // es código que nadie ejecuta y que la siguiente persona tiene que descifrar.

  // Las dos que SÍ dependen del ticket, también juntas: el parque instalado de
  // su dueño y el papel de cada autor de comentario en esta empresa.
  const [tree, authorRoles] = await Promise.all([
    getEquipmentTree(ticket.createdById),
    // El rol del autor es su papel en ESTA empresa, así que se resuelve por
    // membresía y no viene pegado al comentario.
    rolesByUser(ticket.comments.map((c) => c.author.id)),
  ]);

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
              hayCatalogo={hayCatalogo}
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
              /* El `key` es lo que re-sincroniza el selector cuando el
                 asignado cambia. Ver la cabecera de `AssignPanel`. */
              key={ticket.assignedToId ?? "sin-asignar"}
              ticketId={ticket.id}
              agents={agents}
              currentAssigneeId={ticket.assignedToId}
              currentUserId={session!.user.id}
            />
          )}

          {isStaff && ticket.status !== "pending_review" && ticket.status !== "rejected" && (
            <StatusPanel
              /* El `key` es lo que re-sincroniza el selector cuando el estado
                 cambia por otra vía. Ver la cabecera de `StatusPanel`. */
              key={ticket.status}
              ticketId={ticket.id}
              status={ticket.status}
              locale={locale}
            />
          )}
        </div>
      </div>
    </div>
  );
}
