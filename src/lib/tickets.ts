// Constantes y helpers de tickets — seguros para cliente y servidor (sin DB).

export const TICKET_STATUSES = [
  "pending_review",
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
  "rejected",
] as const;
export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

// Estados que cuentan como trabajo VIVO: lo que todavía le debe algo a alguien.
// Se declara aquí, junto al resto de las constantes de ticket, porque el panel
// y las consultas de datos tienen que estar de acuerdo en qué es "pendiente";
// cuando la lista vivía escrita a mano en el JSX del panel, el conteo de la
// insignia y el contenido de la lista podían discrepar.
export const ACTIVE_STATUSES = [
  "pending_review",
  "open",
  "in_progress",
  "waiting",
] as const;

// La cola atendible: lo vivo MENOS lo que espera aprobación. Un ticket sin
// revisar no está "sin asignar", está sin aceptar, y mezclarlos hacía que la
// bandeja de pendientes contara dos veces el mismo trabajo.
export const QUEUE_STATUSES = ["open", "in_progress", "waiting"] as const;

// Estados que el staff puede fijar manualmente (la aprobación/rechazo tiene
// su propio flujo, por eso pending_review y rejected no están aquí).
export const STAFF_SETTABLE_STATUSES = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
] as const;

// Tipo de ticket: solicitud del cliente (requiere aprobación) vs
// levantamiento de servicio hecho por el staff (entra directo a la cola).
export const TICKET_TYPES = ["request", "service"] as const;
export type TicketTypeValue = (typeof TICKET_TYPES)[number];

export const TYPE_LABELS: Record<TicketTypeValue, { es: string; en: string }> = {
  request: { es: "Solicitud del cliente", en: "Client request" },
  service: { es: "Levantamiento de servicio", en: "Service order" },
};

export const TYPE_STYLES: Record<TicketTypeValue, string> = {
  request: "bg-muted text-muted-foreground ring-border",
  service: "bg-primary/10 text-primary ring-primary/20",
};

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TicketPriorityValue = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = [
  "maintenance",
  "validation",
  "training",
  "calibration",
  "support",
  "sales",
  "other",
] as const;
export type TicketCategoryValue = (typeof TICKET_CATEGORIES)[number];

export const STATUS_LABELS: Record<TicketStatusValue, { es: string; en: string }> = {
  pending_review: { es: "Pendiente de revisión", en: "Pending review" },
  open: { es: "Abierto", en: "Open" },
  in_progress: { es: "En progreso", en: "In progress" },
  waiting: { es: "En espera", en: "Waiting" },
  resolved: { es: "Resuelto", en: "Resolved" },
  closed: { es: "Cerrado", en: "Closed" },
  rejected: { es: "Rechazado", en: "Rejected" },
};

export const PRIORITY_LABELS: Record<TicketPriorityValue, { es: string; en: string }> = {
  low: { es: "Baja", en: "Low" },
  medium: { es: "Media", en: "Medium" },
  high: { es: "Alta", en: "High" },
  urgent: { es: "Urgente", en: "Urgent" },
};

export const CATEGORY_LABELS: Record<TicketCategoryValue, { es: string; en: string }> = {
  maintenance: { es: "Mantenimiento", en: "Maintenance" },
  validation: { es: "Validación", en: "Validation" },
  training: { es: "Capacitación", en: "Training" },
  calibration: { es: "Calibración", en: "Calibration" },
  support: { es: "Soporte", en: "Support" },
  sales: { es: "Ventas", en: "Sales" },
  other: { es: "Otro", en: "Other" },
};

// Clases Tailwind por estado/prioridad (badges).
export const STATUS_STYLES: Record<TicketStatusValue, string> = {
  pending_review: "bg-warning/15 text-warning ring-warning/30",
  rejected: "bg-destructive/12 text-destructive ring-destructive/25",
  open: "bg-primary/12 text-primary ring-primary/20",
  in_progress: "bg-signal/15 text-signal-bright ring-signal/25",
  waiting: "bg-warning/15 text-warning ring-warning/25",
  resolved: "bg-success/15 text-success ring-success/25",
  closed: "bg-muted text-muted-foreground ring-border",
};

export const PRIORITY_STYLES: Record<TicketPriorityValue, string> = {
  low: "bg-muted text-muted-foreground ring-border",
  medium: "bg-primary/10 text-primary ring-primary/20",
  high: "bg-warning/15 text-warning ring-warning/25",
  urgent: "bg-destructive/12 text-destructive ring-destructive/25",
};

/**
 * El plazo de primera respuesta POR OMISIÓN, en horas.
 *
 * Es el que promete el sitio público, y el que rige para todo cliente que no
 * haya pactado el suyo. Un cliente puede tener otro —ver `crmOrganizations.slaHours`—
 * y entonces manda el suyo.
 *
 * Sigue siendo una constante y no un ajuste de la empresa: es la promesa
 * comercial de base, no una preferencia. El día que dos inquilinos prometan
 * cosas distintas, el sitio es `settings`.
 */
export const SLA_HOURS = 2;

/** Lo que se admite al pactar un plazo propio: de una hora a treinta días. */
export const SLA_HORAS_MIN = 1;
export const SLA_HORAS_MAX = 720;

/**
 * ¿Es un plazo pactable? Lista blanca del lado del dominio.
 *
 * Cero no se admite y no es un descuido: un SLA de cero horas nace vencido
 * siempre, así que sería una forma silenciosa de apagar el compromiso. Para no
 * pactar nada está el campo vacío, que significa «el general».
 */
export function slaHorasValidas(h: unknown): h is number {
  return (
    typeof h === "number" &&
    Number.isInteger(h) &&
    h >= SLA_HORAS_MIN &&
    h <= SLA_HORAS_MAX
  );
}

/* ------------------------- Estado del SLA ------------------------- */
/**
 * En qué punto está el compromiso de primera respuesta de un ticket.
 *
 * El SLA estaba a medias: la fecha límite se calculaba al crear el ticket y se
 * mostraba en la ficha, pero nada la comparaba nunca contra nada. Medido sobre
 * estos datos, 260 tickets tenían plazo y **cero** tenían primera respuesta
 * registrada. Un compromiso que no se mide es peor que no tenerlo, porque
 * aparenta existir.
 *
 * `sin-reloj` no es un estado de incumplimiento sino de ignorancia, y merece
 * decirse aparte: son los tickets traídos del sistema anterior, que nacieron
 * sin plazo. Pintarlos junto a los vencidos mezclaría «llegamos tarde» con «no
 * sabemos», que es justo la confusión que hace que nadie confíe en un tablero.
 */
export type SlaState = "sin-reloj" | "cumplido" | "a-tiempo" | "por-vencer" | "vencido";

/** Margen en el que el plazo ya aprieta pero todavía se puede cumplir. */
const SLA_WARN_MINUTES = 30;

export function slaState(t: {
  slaDueAt: Date | string | null;
  firstRespondedAt: Date | string | null;
  status: string;
  /** Ahora. Se pasa para que el servidor y el cliente no discrepen al hidratar. */
  now?: Date;
}): SlaState {
  if (!t.slaDueAt) return "sin-reloj";

  const due = new Date(t.slaDueAt).getTime();

  // Respondido: el reloj paró. Que fuera tarde ya es historia, no trabajo
  // pendiente, y esta función existe para decidir a qué hay que correr hoy.
  if (t.firstRespondedAt) return "cumplido";

  // Cerrado sin haber respondido nunca: tampoco hay nada que hacer. Se informa
  // como falta de reloj y no como vencido, porque nadie puede ya cumplirlo.
  if (["resolved", "closed", "rejected"].includes(t.status)) return "sin-reloj";

  const ahora = (t.now ?? new Date()).getTime();
  if (ahora > due) return "vencido";
  if (due - ahora <= SLA_WARN_MINUTES * 60_000) return "por-vencer";
  return "a-tiempo";
}

export const SLA_LABELS: Record<SlaState, { es: string; en: string }> = {
  "sin-reloj": { es: "Sin SLA", en: "No SLA" },
  cumplido: { es: "Respondido", en: "Answered" },
  "a-tiempo": { es: "En plazo", en: "On time" },
  "por-vencer": { es: "Por vencer", en: "Due soon" },
  vencido: { es: "SLA vencido", en: "SLA breached" },
};

export const SLA_STYLES: Record<SlaState, string> = {
  "sin-reloj": "bg-muted text-muted-foreground ring-border",
  cumplido: "bg-success/15 text-success ring-success/25",
  "a-tiempo": "bg-secondary text-muted-foreground ring-border",
  "por-vencer": "bg-warning/15 text-warning ring-warning/30",
  vencido: "bg-destructive/12 text-destructive ring-destructive/25",
};

/**
 * Cuándo vence la primera respuesta de un ticket.
 *
 * `horas` es lo pactado con el cliente. Nulo o inválido cae al plazo general:
 * la caída es deliberada y no se avisa, porque un número raro en la ficha de un
 * cliente no puede dejar un ticket sin compromiso — eso convertiría un dato mal
 * capturado en una promesa apagada.
 *
 * Cuenta en horas CORRIDAS, no hábiles. Es lo que había y se conserva a
 * propósito: cambiarlo aquí, de paso, movería el vencimiento de los 260 tickets
 * que ya tienen plazo. Cuando se decida el horario laboral, este es el único
 * sitio que hay que tocar.
 */
export function slaDueFrom(createdAt: Date, horas?: number | null): Date {
  const h = slaHorasValidas(horas) ? horas : SLA_HOURS;
  return new Date(createdAt.getTime() + h * 60 * 60 * 1000);
}

export function label(
  map: Record<string, { es: string; en: string }>,
  key: string,
  locale: string,
): string {
  const entry = map[key];
  if (!entry) return key;
  return locale === "en" ? entry.en : entry.es;
}
