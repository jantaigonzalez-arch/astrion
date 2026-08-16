// Constantes y helpers del CRM — seguros para cliente y servidor (sin DB).

export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export type DealStatusValue = (typeof DEAL_STATUSES)[number];

export const DEAL_STATUS_LABELS: Record<DealStatusValue, { es: string; en: string }> = {
  open: { es: "Abierto", en: "Open" },
  won: { es: "Ganado", en: "Won" },
  lost: { es: "Perdido", en: "Lost" },
};

export const DEAL_STATUS_STYLES: Record<DealStatusValue, string> = {
  open: "bg-primary/10 text-primary ring-primary/20",
  won: "bg-success/15 text-success ring-success/25",
  lost: "bg-destructive/12 text-destructive ring-destructive/25",
};

export const ACTIVITY_TYPES = [
  "call",
  "meeting",
  "email",
  "task",
  "demo",
  "visit",
] as const;
export type ActivityTypeValue = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityTypeValue, { es: string; en: string }> = {
  call: { es: "Llamada", en: "Call" },
  meeting: { es: "Reunión", en: "Meeting" },
  email: { es: "Correo", en: "Email" },
  task: { es: "Tarea", en: "Task" },
  demo: { es: "Demostración", en: "Demo" },
  visit: { es: "Visita al laboratorio", en: "Lab visit" },
};

export const ACTIVITY_STYLES: Record<ActivityTypeValue, string> = {
  call: "bg-primary/10 text-primary ring-primary/20",
  meeting: "bg-signal/15 text-signal-bright ring-signal/25",
  email: "bg-muted text-muted-foreground ring-border",
  task: "bg-warning/15 text-warning ring-warning/25",
  demo: "bg-brand-400/15 text-primary ring-brand-400/25",
  visit: "bg-success/15 text-success ring-success/25",
};

/** Etapas por defecto al crear el embudo inicial (ciclo de venta analítica). */
export const DEFAULT_STAGES: { name: string; probability: number }[] = [
  { name: "Prospección", probability: 10 },
  { name: "Contacto establecido", probability: 25 },
  { name: "Necesidad detectada", probability: 45 },
  { name: "Cotización enviada", probability: 65 },
  { name: "Negociación", probability: 85 },
];

export const DEFAULT_PIPELINE_NAME = "Ventas Evoelution";

/** Fuentes típicas de un negocio (lista abierta: el campo es texto libre). */
export const DEAL_SOURCES = [
  "web_contact",
  "referido",
  "campaña",
  "cliente_existente",
  "visita_comercial",
  "congreso",
  "otro",
] as const;

export const SOURCE_LABELS: Record<string, { es: string; en: string }> = {
  web_contact: { es: "Formulario web", en: "Web form" },
  referido: { es: "Referido", en: "Referral" },
  campaña: { es: "Campaña", en: "Campaign" },
  cliente_existente: { es: "Cliente existente", en: "Existing client" },
  visita_comercial: { es: "Visita comercial", en: "Sales visit" },
  congreso: { es: "Congreso / feria", en: "Conference" },
  otro: { es: "Otro", en: "Other" },
};

/* ------------------------- Cliente o lead ------------------------- */
/**
 * En qué punto del ciclo está una organización: ya compró, o todavía no.
 *
 * El tipo vive aquí —y no en `data/crm.ts`— porque lo necesitan los formularios,
 * que son componentes de cliente. `data/crm.ts` es `server-only`, así que
 * importar de ahí ataría el navegador a un módulo que nunca debe cruzar.
 * La REGLA que decide cuál es cuál sí vive allá, en `ES_CLIENTE`: es una
 * consulta, y esa sí es cosa del servidor.
 */
export type OrgKind = "client" | "lead";

export const ORG_KIND_LABELS: Record<OrgKind, { es: string; en: string }> = {
  client: { es: "Cliente", en: "Client" },
  lead: { es: "Lead", en: "Lead" },
};

export const ORG_KIND_STYLES: Record<OrgKind, string> = {
  client: "bg-success/15 text-success ring-success/25",
  lead: "bg-muted text-muted-foreground ring-border",
};

/** Toma la etiqueta en el idioma activo, con respaldo al valor crudo. */
export function label<T extends string>(
  dict: Record<T, { es: string; en: string }>,
  key: T,
  locale: string,
): string {
  const entry = dict[key];
  if (!entry) return key;
  return locale === "en" ? entry.en : entry.es;
}

/** Formatea un monto guardado como numeric (string) de Postgres. */
export function money(
  v: string | null | undefined,
  currency: "MXN" | "USD",
  locale: string,
) {
  if (!v) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Valor ponderado del embudo: monto × probabilidad de la etapa.
 * Es el "forecast" clásico de Pipedrive: cuánto se espera cerrar de verdad.
 */
export function weightedValue(amount: string | null, probability: number) {
  const n = Number(amount ?? 0);
  if (Number.isNaN(n)) return 0;
  return (n * probability) / 100;
}

/* ------------------------- Etiquetas ------------------------- */
export const LABEL_COLORS = [
  "primary",
  "signal",
  "success",
  "warning",
  "destructive",
  "muted",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const LABEL_STYLES: Record<string, string> = {
  primary: "bg-primary/12 text-primary ring-primary/25",
  signal: "bg-signal/15 text-signal-bright ring-signal/25",
  success: "bg-success/15 text-success ring-success/25",
  warning: "bg-warning/15 text-warning ring-warning/25",
  destructive: "bg-destructive/12 text-destructive ring-destructive/25",
  muted: "bg-muted text-muted-foreground ring-border",
};

export const LABEL_COLOR_NAMES: Record<string, string> = {
  primary: "Azul",
  signal: "Cian",
  success: "Verde",
  warning: "Ámbar",
  destructive: "Rojo",
  muted: "Gris",
};

/* ------------------------- Estancamiento ------------------------- */
/**
 * Días sin movimiento de un negocio. Pipedrive lo llama "rotting": si supera
 * el límite de la etapa, la tarjeta se marca en rojo para que nadie la olvide.
 */
export function daysIdle(updatedAt: Date | string) {
  const ms = Date.now() - new Date(updatedAt).getTime();
  return Math.floor(ms / 86_400_000);
}

export function isRotting(updatedAt: Date | string, rottingDays: number) {
  return rottingDays > 0 && daysIdle(updatedAt) >= rottingDays;
}

/* ------------------------- Líneas de producto ------------------------- */
/** Importe de una línea: cantidad × precio − descuento%. */
export function lineTotal(item: {
  quantity: string | number;
  unitPriceMxn: string | number;
  discountPct: string | number;
}) {
  const q = Number(item.quantity ?? 0);
  const p = Number(item.unitPriceMxn ?? 0);
  const d = Number(item.discountPct ?? 0);
  if ([q, p, d].some(Number.isNaN)) return 0;
  return q * p * (1 - d / 100);
}

/* ------------------------- Plantillas de correo ------------------------- */
export const TEMPLATE_PLACEHOLDERS = [
  { key: "{{contacto}}", desc: "Nombre del contacto" },
  { key: "{{organizacion}}", desc: "Nombre de la organización" },
  { key: "{{negocio}}", desc: "Título del negocio" },
  { key: "{{valor}}", desc: "Valor del negocio en MXN" },
  { key: "{{yo}}", desc: "Tu nombre" },
] as const;

/** Sustituye los marcadores de una plantilla con los datos del negocio. */
export function renderTemplate(
  text: string,
  vars: {
    contacto?: string | null;
    organizacion?: string | null;
    negocio?: string | null;
    valor?: string | null;
    yo?: string | null;
  },
) {
  return text
    .replaceAll("{{contacto}}", vars.contacto ?? "")
    .replaceAll("{{organizacion}}", vars.organizacion ?? "")
    .replaceAll("{{negocio}}", vars.negocio ?? "")
    .replaceAll("{{valor}}", vars.valor ?? "")
    .replaceAll("{{yo}}", vars.yo ?? "");
}

/* ------------------------- Objetivos ------------------------- */
export const GOAL_METRICS = ["revenue", "count"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_METRIC_LABELS: Record<GoalMetric, { es: string; en: string }> = {
  revenue: { es: "Ingresos ganados (MXN)", en: "Won revenue (MXN)" },
  count: { es: "Negocios ganados", en: "Deals won" },
};
