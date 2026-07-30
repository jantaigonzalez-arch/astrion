import {
  pgTable,
  pgEnum,
  pgSequence,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  bigserial,
  jsonb,
  numeric,
  date,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* ------------------------- Enums ------------------------- */
export const userRole = pgEnum("user_role", [
  "admin",
  "agent",
  "client",
  "sales", // vendedor: responsable comercial de contratos
]);
export const ticketStatus = pgEnum("ticket_status", [
  "pending_review", // solicitud del cliente esperando aprobación del admin
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
  "rejected", // el admin determinó que no procede
]);

// Origen del ticket: solicitud del cliente vs levantamiento hecho por el staff.
export const ticketType = pgEnum("ticket_type", ["request", "service"]);
export const ticketPriority = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);
export const ticketCategory = pgEnum("ticket_category", [
  "maintenance",
  "validation",
  "training",
  "calibration",
  "support",
  "sales",
  "other",
]);
/* CRM: estado de un negocio dentro del embudo. */
export const crmDealStatus = pgEnum("crm_deal_status", ["open", "won", "lost"]);
/* CRM: tipo de actividad agendada (llamada, visita al laboratorio…). */
export const crmActivityType = pgEnum("crm_activity_type", [
  "call",
  "meeting",
  "email",
  "task",
  "demo",
  "visit",
]);

export const leadStatus = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
]);

/* Inventario: naturaleza de un movimiento de existencias.
 * opening      saldo inicial al migrar el catálogo al ledger
 * consumption  refacción usada en una actividad de la bitácora (salida)
 * purchase     entrada por compra a proveedor
 * return       devolución al inventario (entrada)
 * adjustment   corrección manual tras conteo físico */
export const inventoryMovementKind = pgEnum("inventory_movement_kind", [
  "opening",
  "consumption",
  "purchase",
  "return",
  "adjustment",
]);

/* ------------------------- Users ------------------------- */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  role: userRole("role").notNull().default("client"),
  company: varchar("company", { length: 200 }),
  phone: varchar("phone", { length: 40 }),
  active: boolean("active").notNull().default(true),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Tickets ------------------------- */
export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Folio legible: EVO-000123 (generado en la app).
  reference: varchar("reference", { length: 20 }).notNull().unique(),
  subject: varchar("subject", { length: 240 }).notNull(),
  description: text("description").notNull(),
  status: ticketStatus("status").notNull().default("open"),
  type: ticketType("type").notNull().default("request"),
  priority: ticketPriority("priority").notNull().default("medium"),
  category: ticketCategory("category").notNull().default("support"),
  // Revisión del admin (solo aplica a solicitudes de cliente).
  reviewedById: uuid("reviewed_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  // Predicción ML (fase 2): prioridad y categoría sugeridas + confianza.
  mlSuggested: jsonb("ml_suggested"),
  // Equipo / módulo del laboratorio al que se refiere el ticket (opcional).
  // Referencias perezosas: las tablas se declaran más abajo en este archivo.
  equipmentId: uuid("equipment_id").references(() => equipment.id, {
    onDelete: "set null",
  }),
  moduleId: uuid("module_id").references(() => equipmentModules.id, {
    onDelete: "set null",
  }),
  createdById: uuid("created_by_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedToId: uuid("assigned_to_id").references(() => users.id, {
    onDelete: "set null",
  }),
  companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
    onDelete: "set null",
  }),
  // SLA: fecha límite de primera respuesta (< 2 h desde creación).
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketComments = pgTable("ticket_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  // Nota interna (solo visible para agentes/admin) vs respuesta al cliente.
  internal: boolean("internal").notNull().default(false),
  // A qué componente se refiere la actividad (trazabilidad en la bitácora).
  // Referencias perezosas: las tablas se declaran más abajo.
  equipmentId: uuid("equipment_id").references(() => equipment.id, {
    onDelete: "set null",
  }),
  moduleId: uuid("module_id").references(() => equipmentModules.id, {
    onDelete: "set null",
  }),
  submoduleId: uuid("submodule_id").references(() => equipmentSubmodules.id, {
    onDelete: "set null",
  }),
  // Horas de servicio invertidas en esta actividad (p. ej. 1.50).
  hours: numeric("hours", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Leads (contacto) ------------------------- */
export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  company: varchar("company", { length: 200 }),
  message: text("message").notNull(),
  status: leadStatus("status").notNull().default("new"),
  // Scoring ML (fase 2): 0–100.
  score: integer("score"),
  source: varchar("source", { length: 80 }).default("web_contact"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Catálogo (CMS admin) ------------------------- */
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  titleEs: varchar("title_es", { length: 200 }).notNull(),
  titleEn: varchar("title_en", { length: 200 }).notNull(),
  descEs: text("desc_es"),
  descEn: text("desc_en"),
  icon: varchar("icon", { length: 60 }),
  order: integer("order").notNull().default(0),
  published: boolean("published").notNull().default(true),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  nameEs: varchar("name_es", { length: 200 }).notNull(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  descEs: text("desc_es"),
  descEn: text("desc_en"),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  image: text("image"),
  published: boolean("published").notNull().default(true),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  logo: text("logo"),
  website: text("website"),
  order: integer("order").notNull().default(0),
});

/* ------------------------- Equipos del laboratorio ------------------------- */
// Inventario jerárquico por cuenta: Equipo → Módulos → Submódulos.
// La marca es texto validado en la app (lista extensible: Waters/Jasco/Shimadzu…).
export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brand: varchar("brand", { length: 80 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(), // nombre / tipo del equipo
  model: varchar("model", { length: 160 }),
  photo: text("photo"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equipmentModules = pgTable("equipment_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentId: uuid("equipment_id")
    .notNull()
    .references(() => equipment.id, { onDelete: "cascade" }),
  brand: varchar("brand", { length: 80 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(), // nombre / modelo del módulo
  serialNumber: varchar("serial_number", { length: 120 }),
  photo: text("photo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equipmentSubmodules = pgTable("equipment_submodules", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => equipmentModules.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(), // submodelo
  serialNumber: varchar("serial_number", { length: 120 }),
  photo: text("photo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Inventario de refacciones ------------------------- */
export const spareParts = pgTable("spare_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  partNumber: varchar("part_number", { length: 80 }).notNull().unique(),
  description: varchar("description", { length: 300 }).notNull(),
  brand: varchar("brand", { length: 80 }),
  // Costo = lo que le cuesta a Evoelution. Precio = lo que se cobra al cliente.
  costMxn: numeric("cost_mxn", { precision: 12, scale: 2 }),
  costUsd: numeric("cost_usd", { precision: 12, scale: 2 }),
  priceMxn: numeric("price_mxn", { precision: 12, scale: 2 }),
  priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
  // CACHÉ MATERIALIZADO, no fuente de verdad: es la suma de
  // inventory_movements para esta refacción. Se actualiza únicamente al
  // insertar un movimiento, en la misma transacción. No hacer UPDATE directo.
  // Puede quedar NEGATIVO: un sobregiro real se registra tal cual y se alerta
  // en el panel, en vez de silenciarse con greatest(0, …) como antes.
  stock: integer("stock").notNull().default(0),
  companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
    onDelete: "set null",
  }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Refacciones usadas en una actividad de la bitácora.
// Guarda copia del número de parte, descripción y costo al momento de usarla,
// para que el histórico no cambie si el catálogo se actualiza después.
export const commentParts = pgTable("ticket_comment_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id")
    .notNull()
    .references(() => ticketComments.id, { onDelete: "cascade" }),
  partId: uuid("part_id").references(() => spareParts.id, {
    onDelete: "set null",
  }),
  partNumber: varchar("part_number", { length: 80 }).notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitCostMxn: numeric("unit_cost_mxn", { precision: 12, scale: 2 }),
  unitCostUsd: numeric("unit_cost_usd", { precision: 12, scale: 2 }),
  unitPriceMxn: numeric("unit_price_mxn", { precision: 12, scale: 2 }),
  unitPriceUsd: numeric("unit_price_usd", { precision: 12, scale: 2 }),
});

/* ------------------------- Configuración global ------------------------- */
// Fila única ('global'): tarifas de mano de obra usadas para calcular utilidad.
export const settings = pgTable("settings", {
  id: varchar("id", { length: 20 }).primaryKey().default("global"),
  laborCostPerHour: numeric("labor_cost_per_hour", { precision: 12, scale: 2 }),
  laborRatePerHour: numeric("labor_rate_per_hour", { precision: 12, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Contratos ------------------------- */
// Contrato comercial de un laboratorio: monto en MXN y USD, vendedor
// responsable y los equipos que ampara.
export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: varchar("number", { length: 60 }).notNull().unique(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  salesRepId: uuid("sales_rep_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // Negocio del CRM que originó este contrato (cierra el ciclo comercial:
  // lead → negocio → contrato → equipos → tickets). Se declara con referencia
  // perezosa porque crmDeals se define más abajo en este archivo.
  dealId: uuid("deal_id").references((): AnyPgColumn => crmDeals.id, {
    onDelete: "set null",
  }),
  amountMxn: numeric("amount_mxn", { precision: 14, scale: 2 }),
  amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }),
  // Ver nota de moneda en crmDeals: mismo camino de migración.
  currency: varchar("currency", { length: 3 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  fxDate: date("fx_date"),
  companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
    onDelete: "set null",
  }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Equipos amparados por el contrato (un equipo puede estar en varios).
export const contractEquipment = pgTable(
  "contract_equipment",
  {
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.equipmentId] })],
);

/* ------------------------- CRM comercial ------------------------- */
// Embudo de ventas configurable: Pipeline → Etapas → Negocios.
// Un negocio siempre vive en una etapa de un pipeline; al ganarse/perderse
// conserva la etapa donde estaba para poder analizar dónde se cierra.

export const crmPipelines = pgTable("crm_pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  order: integer("order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmStages = pgTable("crm_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id")
    .notNull()
    .references(() => crmPipelines.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  // Probabilidad típica de cierre en esta etapa (0–100): alimenta el forecast.
  probability: integer("probability").notNull().default(50),
  order: integer("order").notNull().default(0),
  // Días sin actividad tras los cuales el negocio se marca "estancado"
  // (equivalente al "rotting" de Pipedrive). 0 = desactivado.
  rottingDays: integer("rotting_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Organización = laboratorio/empresa. Puede existir antes de ser cliente;
// al firmar se enlaza con la cuenta de portal (users) vía clientId.
export const crmOrganizations = pgTable("crm_organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 120 }),
  website: varchar("website", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  address: text("address"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  clientId: uuid("client_id").references(() => users.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmContacts = pgTable("crm_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => crmOrganizations.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  position: varchar("position", { length: 140 }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmDeals = pgTable("crm_deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Folio legible: EVO-D-000123 (generado en la app).
  reference: varchar("reference", { length: 20 }).notNull().unique(),
  title: varchar("title", { length: 240 }).notNull(),
  pipelineId: uuid("pipeline_id")
    .notNull()
    .references(() => crmPipelines.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => crmStages.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => crmOrganizations.id, {
    onDelete: "set null",
  }),
  contactId: uuid("contact_id").references(() => crmContacts.id, {
    onDelete: "set null",
  }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  valueMxn: numeric("value_mxn", { precision: 14, scale: 2 }),
  valueUsd: numeric("value_usd", { precision: 14, scale: 2 }),
  // Modelo de moneda al que migra el par mxn/usd: importe + moneda + tipo de
  // cambio fechado. Nullable mientras las columnas de arriba siguen vigentes;
  // ningún lector usa esto todavía (ver Fase 2 en docs/ARQUITECTURA.md).
  currency: varchar("currency", { length: 3 }),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  fxDate: date("fx_date"),
  companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
    onDelete: "set null",
  }),
  status: crmDealStatus("status").notNull().default("open"),
  lostReason: text("lost_reason"),
  expectedCloseDate: date("expected_close_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  source: varchar("source", { length: 80 }),
  // Lead del formulario web que originó el negocio (si aplica).
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  // Posición dentro de la columna del tablero (orden manual del kanban).
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Actividades agendadas: llamadas, visitas, demos. Se cuelgan de un negocio,
// contacto u organización (al menos uno).
export const crmActivities = pgTable("crm_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: crmActivityType("type").notNull().default("call"),
  subject: varchar("subject", { length: 240 }).notNull(),
  notes: text("notes"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  done: boolean("done").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true }),
  dealId: uuid("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => crmContacts.id, {
    onDelete: "set null",
  }),
  organizationId: uuid("organization_id").references(() => crmOrganizations.id, {
    onDelete: "set null",
  }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmNotes = pgTable("crm_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => crmContacts.id, {
    onDelete: "cascade",
  }),
  organizationId: uuid("organization_id").references(() => crmOrganizations.id, {
    onDelete: "cascade",
  }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Productos del negocio (líneas de cotización) ---------- */
// Equivalente a los "products" de Pipedrive: el valor del negocio se calcula
// como la suma de sus líneas. Guarda copia del nombre y precio para que el
// histórico no cambie si el catálogo se actualiza después.
export const crmDealProducts = pgTable("crm_deal_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => crmDeals.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, {
    onDelete: "set null",
  }),
  partId: uuid("part_id").references(() => spareParts.id, { onDelete: "set null" }),
  name: varchar("name", { length: 300 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unitPriceMxn: numeric("unit_price_mxn", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  // Descuento porcentual aplicado a la línea (0–100).
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Etiquetas ---------- */
export const crmLabels = pgTable("crm_labels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull(),
  // Clave de color de la paleta de la marca (ver LABEL_COLORS en lib/crm.ts).
  color: varchar("color", { length: 20 }).notNull().default("primary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crmDealLabels = pgTable(
  "crm_deal_labels",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => crmLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.labelId] })],
);

/* ---------- Objetivos comerciales ---------- */
// Meta de ingresos o de número de negocios ganados, por vendedor y periodo.
export const crmGoals = pgTable("crm_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").references(() => crmPipelines.id, {
    onDelete: "cascade",
  }),
  // "revenue" = monto ganado en MXN; "count" = número de negocios ganados.
  metric: varchar("metric", { length: 20 }).notNull().default("revenue"),
  target: numeric("target", { precision: 14, scale: 2 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Plantillas de correo ---------- */
// Cuerpos reutilizables con marcadores {{contacto}}, {{organizacion}},
// {{negocio}}, {{valor}}, {{yo}}. Se abren en el cliente de correo (mailto).
export const crmEmailTemplates = pgTable("crm_email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  subject: varchar("subject", { length: 300 }).notNull(),
  body: text("body").notNull(),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Automatizaciones ---------- */
// Regla simple: "cuando un negocio entra a la etapa X, crea la actividad Y".
// Es el subconjunto del workflow automation de Pipedrive que no requiere
// servicios externos (correo, webhooks).
export const crmAutomations = pgTable("crm_automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  triggerStageId: uuid("trigger_stage_id")
    .notNull()
    .references(() => crmStages.id, { onDelete: "cascade" }),
  activityType: crmActivityType("activity_type").notNull().default("call"),
  activitySubject: varchar("activity_subject", { length: 240 }).notNull(),
  // Días a partir de hoy para el vencimiento de la actividad creada.
  dueInDays: integer("due_in_days").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Bitácora de movimientos del negocio: cambios de etapa y cierre.
// Permite medir tiempo por etapa y auditar el avance comercial.
export const crmDealEvents = pgTable("crm_deal_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => crmDeals.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").references(() => crmStages.id, {
    onDelete: "set null",
  }),
  toStageId: uuid("to_stage_id").references(() => crmStages.id, {
    onDelete: "set null",
  }),
  status: crmDealStatus("status"),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Relations ------------------------- */
export const usersRelations = relations(users, ({ many }) => ({
  createdTickets: many(tickets, { relationName: "createdBy" }),
  assignedTickets: many(tickets, { relationName: "assignedTo" }),
  comments: many(ticketComments),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [tickets.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
  assignedTo: one(users, {
    fields: [tickets.assignedToId],
    references: [users.id],
    relationName: "assignedTo",
  }),
  equipment: one(equipment, {
    fields: [tickets.equipmentId],
    references: [equipment.id],
  }),
  module: one(equipmentModules, {
    fields: [tickets.moduleId],
    references: [equipmentModules.id],
  }),
  comments: many(ticketComments),
}));

export const ticketCommentsRelations = relations(ticketComments, ({ one, many }) => ({
  ticket: one(tickets, {
    fields: [ticketComments.ticketId],
    references: [tickets.id],
  }),
  author: one(users, {
    fields: [ticketComments.authorId],
    references: [users.id],
  }),
  equipment: one(equipment, {
    fields: [ticketComments.equipmentId],
    references: [equipment.id],
  }),
  module: one(equipmentModules, {
    fields: [ticketComments.moduleId],
    references: [equipmentModules.id],
  }),
  submodule: one(equipmentSubmodules, {
    fields: [ticketComments.submoduleId],
    references: [equipmentSubmodules.id],
  }),
  parts: many(commentParts),
}));

export const commentPartsRelations = relations(commentParts, ({ one }) => ({
  comment: one(ticketComments, {
    fields: [commentParts.commentId],
    references: [ticketComments.id],
  }),
  part: one(spareParts, {
    fields: [commentParts.partId],
    references: [spareParts.id],
  }),
}));

export const productsRelations = relations(products, ({ one }) => ({
  brand: one(brands, {
    fields: [products.brandId],
    references: [brands.id],
  }),
}));

export const usersEquipmentRelations = relations(users, ({ many }) => ({
  equipment: many(equipment),
}));

export const equipmentRelations = relations(equipment, ({ one, many }) => ({
  owner: one(users, {
    fields: [equipment.ownerId],
    references: [users.id],
  }),
  modules: many(equipmentModules),
  tickets: many(tickets),
  contractLinks: many(contractEquipment),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  client: one(users, {
    fields: [contracts.clientId],
    references: [users.id],
    relationName: "contractClient",
  }),
  salesRep: one(users, {
    fields: [contracts.salesRepId],
    references: [users.id],
    relationName: "contractSalesRep",
  }),
  deal: one(crmDeals, {
    fields: [contracts.dealId],
    references: [crmDeals.id],
  }),
  equipmentLinks: many(contractEquipment),
}));

export const contractEquipmentRelations = relations(
  contractEquipment,
  ({ one }) => ({
    contract: one(contracts, {
      fields: [contractEquipment.contractId],
      references: [contracts.id],
    }),
    equipment: one(equipment, {
      fields: [contractEquipment.equipmentId],
      references: [equipment.id],
    }),
  }),
);

export const equipmentModulesRelations = relations(
  equipmentModules,
  ({ one, many }) => ({
    equipment: one(equipment, {
      fields: [equipmentModules.equipmentId],
      references: [equipment.id],
    }),
    submodules: many(equipmentSubmodules),
  }),
);

export const equipmentSubmodulesRelations = relations(
  equipmentSubmodules,
  ({ one }) => ({
    module: one(equipmentModules, {
      fields: [equipmentSubmodules.moduleId],
      references: [equipmentModules.id],
    }),
  }),
);

/* ------------------------- CRM relations ------------------------- */
export const crmPipelinesRelations = relations(crmPipelines, ({ many }) => ({
  stages: many(crmStages),
  deals: many(crmDeals),
}));

export const crmStagesRelations = relations(crmStages, ({ one, many }) => ({
  pipeline: one(crmPipelines, {
    fields: [crmStages.pipelineId],
    references: [crmPipelines.id],
  }),
  deals: many(crmDeals),
}));

export const crmOrganizationsRelations = relations(
  crmOrganizations,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [crmOrganizations.ownerId],
      references: [users.id],
      relationName: "orgOwner",
    }),
    client: one(users, {
      fields: [crmOrganizations.clientId],
      references: [users.id],
      relationName: "orgClient",
    }),
    contacts: many(crmContacts),
    deals: many(crmDeals),
    activities: many(crmActivities),
    notes: many(crmNotes),
  }),
);

export const crmContactsRelations = relations(crmContacts, ({ one, many }) => ({
  organization: one(crmOrganizations, {
    fields: [crmContacts.organizationId],
    references: [crmOrganizations.id],
  }),
  owner: one(users, {
    fields: [crmContacts.ownerId],
    references: [users.id],
    relationName: "contactOwner",
  }),
  deals: many(crmDeals),
  activities: many(crmActivities),
  notes: many(crmNotes),
}));

export const crmDealsRelations = relations(crmDeals, ({ one, many }) => ({
  pipeline: one(crmPipelines, {
    fields: [crmDeals.pipelineId],
    references: [crmPipelines.id],
  }),
  stage: one(crmStages, {
    fields: [crmDeals.stageId],
    references: [crmStages.id],
  }),
  organization: one(crmOrganizations, {
    fields: [crmDeals.organizationId],
    references: [crmOrganizations.id],
  }),
  contact: one(crmContacts, {
    fields: [crmDeals.contactId],
    references: [crmContacts.id],
  }),
  owner: one(users, {
    fields: [crmDeals.ownerId],
    references: [users.id],
    relationName: "dealOwner",
  }),
  lead: one(leads, {
    fields: [crmDeals.leadId],
    references: [leads.id],
  }),
  activities: many(crmActivities),
  notes: many(crmNotes),
  events: many(crmDealEvents),
  items: many(crmDealProducts),
  labelLinks: many(crmDealLabels),
  contracts: many(contracts),
}));

export const crmDealProductsRelations = relations(crmDealProducts, ({ one }) => ({
  deal: one(crmDeals, {
    fields: [crmDealProducts.dealId],
    references: [crmDeals.id],
  }),
  product: one(products, {
    fields: [crmDealProducts.productId],
    references: [products.id],
  }),
  part: one(spareParts, {
    fields: [crmDealProducts.partId],
    references: [spareParts.id],
  }),
}));

export const crmLabelsRelations = relations(crmLabels, ({ many }) => ({
  dealLinks: many(crmDealLabels),
}));

export const crmDealLabelsRelations = relations(crmDealLabels, ({ one }) => ({
  deal: one(crmDeals, {
    fields: [crmDealLabels.dealId],
    references: [crmDeals.id],
  }),
  label: one(crmLabels, {
    fields: [crmDealLabels.labelId],
    references: [crmLabels.id],
  }),
}));

export const crmGoalsRelations = relations(crmGoals, ({ one }) => ({
  owner: one(users, {
    fields: [crmGoals.ownerId],
    references: [users.id],
    relationName: "goalOwner",
  }),
  pipeline: one(crmPipelines, {
    fields: [crmGoals.pipelineId],
    references: [crmPipelines.id],
  }),
}));

export const crmAutomationsRelations = relations(crmAutomations, ({ one }) => ({
  triggerStage: one(crmStages, {
    fields: [crmAutomations.triggerStageId],
    references: [crmStages.id],
    relationName: "automationStage",
  }),
}));

export const crmActivitiesRelations = relations(crmActivities, ({ one }) => ({
  deal: one(crmDeals, {
    fields: [crmActivities.dealId],
    references: [crmDeals.id],
  }),
  contact: one(crmContacts, {
    fields: [crmActivities.contactId],
    references: [crmContacts.id],
  }),
  organization: one(crmOrganizations, {
    fields: [crmActivities.organizationId],
    references: [crmOrganizations.id],
  }),
  owner: one(users, {
    fields: [crmActivities.ownerId],
    references: [users.id],
    relationName: "activityOwner",
  }),
}));

export const crmNotesRelations = relations(crmNotes, ({ one }) => ({
  deal: one(crmDeals, { fields: [crmNotes.dealId], references: [crmDeals.id] }),
  contact: one(crmContacts, {
    fields: [crmNotes.contactId],
    references: [crmContacts.id],
  }),
  organization: one(crmOrganizations, {
    fields: [crmNotes.organizationId],
    references: [crmOrganizations.id],
  }),
  author: one(users, {
    fields: [crmNotes.authorId],
    references: [users.id],
    relationName: "noteAuthor",
  }),
}));

export const crmDealEventsRelations = relations(crmDealEvents, ({ one }) => ({
  deal: one(crmDeals, {
    fields: [crmDealEvents.dealId],
    references: [crmDeals.id],
  }),
  fromStage: one(crmStages, {
    fields: [crmDealEvents.fromStageId],
    references: [crmStages.id],
    relationName: "eventFromStage",
  }),
  toStage: one(crmStages, {
    fields: [crmDealEvents.toStageId],
    references: [crmStages.id],
    relationName: "eventToStage",
  }),
  author: one(users, {
    fields: [crmDealEvents.authorId],
    references: [users.id],
    relationName: "eventAuthor",
  }),
}));

/* ============== Núcleo transaccional (camino a ERP + ML) ==============
 * Piezas transversales que no pertenecen a un módulo sino a la plataforma:
 *
 *  · secuencias de folio — reemplazan a count(*)+1, que reutilizaba números
 *    al borrar filas y colisionaba entre inserciones concurrentes.
 *  · companies — dimensión de empresa/entidad legal. Nullable por ahora: se
 *    agrega con 37 tablas en el schema y no con 80.
 *  · domainEvents — bitácora append-only. Cumple dos necesidades con un solo
 *    registro: la auditoría que exige un ERP, y la historia que necesita ML.
 *    Las tablas de negocio guardan estado MUTABLE, así que sin esto cada
 *    UPDATE borra el pasado y no hay features "as-of" que entrenar.
 *  · inventoryMovements — existencias como ledger. spare_parts.stock pasa a
 *    ser caché materializado (la suma de los movimientos), no la verdad.
 *  · fxRates — tipo de cambio fechado, para que la utilidad de un contrato
 *    de 2024 no se recalcule con el dólar de hoy.
 */

export const ticketReferenceSeq = pgSequence("ticket_reference_seq", {
  startWith: 1,
  increment: 1,
});
export const dealReferenceSeq = pgSequence("crm_deal_reference_seq", {
  startWith: 1,
  increment: 1,
});

// Entidad legal que emite documentos. Un solo registro hoy ('Evoelution'),
// pero las tablas raíz ya cuelgan de aquí para no re-migrarlas después.
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  legalName: varchar("legal_name", { length: 240 }),
  // RFC en México. Requisito para timbrado CFDI cuando llegue facturación.
  taxId: varchar("tax_id", { length: 20 }),
  // Moneda funcional: en la que se llevan los libros de esta empresa.
  functionalCurrency: varchar("functional_currency", { length: 3 })
    .notNull()
    .default("MXN"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// APPEND-ONLY. Nunca se hace UPDATE ni DELETE sobre esta tabla: es la única
// copia del pasado que tiene el sistema. Se escribe dentro de la misma
// transacción que el cambio que describe, así que o quedan ambos o ninguno.
export const domainEvents = pgTable(
  "domain_events",
  {
    // Serial y no uuid: da orden total de escritura, que es lo que necesita
    // un consumidor incremental (CDC → parquet) para saber por dónde iba.
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Agregado afectado: 'deal' | 'ticket' | 'spare_part' | 'lead' | 'contract'
    aggregateType: varchar("aggregate_type", { length: 60 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    // Verbo en pasado y con namespace: 'deal.created', 'part.consumed'.
    eventType: varchar("event_type", { length: 80 }).notNull(),
    // Datos del cambio. Deliberadamente laxo: el consumidor analítico decide
    // qué campos promueve a columnas cuando el evento se estabiliza.
    payload: jsonb("payload").notNull().default({}),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Reconstruir la línea de tiempo de un agregado (auditoría, features as-of).
    index("domain_events_aggregate_idx").on(
      t.aggregateType,
      t.aggregateId,
      t.occurredAt,
    ),
    // Barrer un tipo de evento en una ventana (extracción analítica).
    index("domain_events_type_idx").on(t.eventType, t.occurredAt),
  ],
);

// Ledger de existencias. quantity es SIGNADO: negativo = salida.
// El stock nunca se "setea": se inserta un movimiento y el saldo se recalcula.
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // restrict, no cascade: el histórico de consumo debe sobrevivir al
    // catálogo. Las refacciones se desactivan (active=false), no se borran.
    partId: uuid("part_id")
      .notNull()
      .references(() => spareParts.id, { onDelete: "restrict" }),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    kind: inventoryMovementKind("kind").notNull(),
    quantity: integer("quantity").notNull(),
    // Saldo resultante tras aplicar el movimiento. Redundante con la suma,
    // y a propósito: permite auditar el ledger sin recorrerlo entero y
    // detectar si alguien tocó spare_parts.stock por fuera.
    balanceAfter: integer("balance_after").notNull(),
    // Origen del consumo, si vino de la bitácora de un ticket.
    ticketCommentId: uuid("ticket_comment_id").references(
      () => ticketComments.id,
      { onDelete: "set null" },
    ),
    // Costo vigente al momento del movimiento (valuación histórica).
    unitCostMxn: numeric("unit_cost_mxn", { precision: 12, scale: 2 }),
    unitCostUsd: numeric("unit_cost_usd", { precision: 12, scale: 2 }),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("inventory_movements_part_idx").on(t.partId, t.occurredAt)],
);

// Tipo de cambio fechado. Sin esto, todo importe convertido se recalcula con
// la cotización de hoy y los reportes históricos cambian solos.
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteDate: date("quote_date").notNull(),
    baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
    quoteCurrency: varchar("quote_currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    // 'dof' (Diario Oficial), 'banxico', 'manual'…
    source: varchar("source", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fx_rates_unique_idx").on(
      t.quoteDate,
      t.baseCurrency,
      t.quoteCurrency,
    ),
  ],
);

/* ------------------------- Tipos ------------------------- */
export type User = typeof users.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketComment = typeof ticketComments.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type EquipmentModule = typeof equipmentModules.$inferSelect;
export type EquipmentSubmodule = typeof equipmentSubmodules.$inferSelect;
export type CrmPipeline = typeof crmPipelines.$inferSelect;
export type CrmStage = typeof crmStages.$inferSelect;
export type CrmOrganization = typeof crmOrganizations.$inferSelect;
export type CrmContact = typeof crmContacts.$inferSelect;
export type CrmDeal = typeof crmDeals.$inferSelect;
export type NewCrmDeal = typeof crmDeals.$inferInsert;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type CrmNote = typeof crmNotes.$inferSelect;
export type CrmDealProduct = typeof crmDealProducts.$inferSelect;
export type CrmLabel = typeof crmLabels.$inferSelect;
export type CrmGoal = typeof crmGoals.$inferSelect;
export type CrmEmailTemplate = typeof crmEmailTemplates.$inferSelect;
export type CrmAutomation = typeof crmAutomations.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
