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

// SLA de primera respuesta: la web promete < 2 h.
export const SLA_HOURS = 2;

export function slaDueFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_HOURS * 60 * 60 * 1000);
}

export function generateReference(seq: number): string {
  return `EVO-${String(seq).padStart(6, "0")}`;
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
