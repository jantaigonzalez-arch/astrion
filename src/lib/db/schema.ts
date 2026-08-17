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
import { relations, sql } from "drizzle-orm";

/**
 * TABLAS DE NEGOCIO — viven en el esquema de CADA inquilino (`tenant_<slug>`),
 * nunca en `public`.
 *
 * Se declaran SIN calificar el esquema a propósito: el `search_path` que fija
 * `withTenant()` en cada transacción decide a qué inquilino resuelven. La misma
 * consulta sirve para todos, y una consulta sin inquilino activo falla en vez
 * de devolver datos ajenos.
 *
 * `users`, `companies` y demás plano de control viven en public.ts y se
 * reexportan aquí para no romper los imports existentes.
 */
import { companies, users } from "./platform";

// NO se reexportan a propósito. Quien consulte `users` o `companies` debe
// importarlas de "@/lib/db/platform" y saber que son del plano de control:
// viven una sola vez en `public`, no una por inquilino. El reexport también
// rompería la generación de migraciones de inquilino, que toma este archivo
// como la lista de tablas a replicar en cada esquema.
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
/* Compras: estado de una orden.
 * draft      se está armando, todavía no se mandó al proveedor
 * sent       enviada; se espera mercancía
 * partial    llegó parte de lo pedido
 * received   llegó todo
 * cancelled  se canceló; lo ya recibido NO se revierte (ver purchasing.ts) */
export const purchaseOrderStatus = pgEnum("purchase_order_status", [
  "draft",
  "sent",
  "partial",
  "received",
  "cancelled",
]);

export const inventoryMovementKind = pgEnum("inventory_movement_kind", [
  "opening",
  "consumption",
  "purchase",
  "return",
  "adjustment",
]);

/* Estado de una requisición.
 *
 * `draft → submitted → approved → (partial) → ordered`, con `rejected` y
 * `cancelled` como salidas. La autorización es un estado y no una casilla
 * porque es el único punto del circuito donde alguien distinto al que pide
 * asume el gasto: sin ese corte, «requisición» es un sinónimo caro de «orden».
 *
 * draft      se está armando; las líneas se pueden tocar
 * submitted  pedida la autorización; ya no se toca
 * approved   autorizada; se puede convertir en órdenes
 * partial    parte de las líneas ya se convirtió
 * ordered    todo lo aprobado se convirtió en órdenes
 * rejected   no se autoriza, con motivo escrito
 * cancelled  se dio de baja; lo ya convertido NO se revierte */
export const requisitionStatus = pgEnum("requisition_status", [
  "draft",
  "submitted",
  "approved",
  "partial",
  "ordered",
  "rejected",
  "cancelled",
]);

/* Estado de una factura de proveedor. Lo deduce el saldo, no se elige a mano:
 * ver `payables.ts`.
 *
 * pending    capturada, sin un solo pago
 * partial    pagada en parte
 * paid       saldada
 * cancelled  anulada; solo mientras no tenga pagos aplicados */
export const supplierInvoiceStatus = pgEnum("supplier_invoice_status", [
  "pending",
  "partial",
  "paid",
  "cancelled",
]);

/**
 * Estado de una nota de crédito.
 *
 * `open` incluye la aplicada en parte: mientras le quede saldo a favor sigue
 * sirviendo para la próxima factura. Solo pasa a `applied` cuando se consume
 * entera, igual que una factura solo pasa a `paid` cuando se salda.
 */
export const supplierCreditNoteStatus = pgEnum("supplier_credit_note_status", [
  "open",
  "applied",
  "cancelled",
]);

/**
 * Estado de un anticipo.
 *
 * Mismo criterio que la nota de crédito: `open` incluye el aplicado en parte,
 * porque mientras le quede saldo sigue sirviendo para la próxima factura.
 */
export const supplierAdvanceStatus = pgEnum("supplier_advance_status", [
  "open",
  "applied",
  "cancelled",
]);

/** Qué se cargó en un lote de importación y desde qué formato. */
export const payableImportKind = pgEnum("payable_import_kind", [
  "charges_csv",
  "credits_csv",
  "charges_cfdi",
]);

/** Cómo se pagó. `other` existe para no perder un pago por falta de categoría. */
export const paymentMethod = pgEnum("payment_method", [
  "transfer",
  "cash",
  "check",
  "card",
  "other",
]);


/* ------------------------- Tickets ------------------------- */
export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Folio legible: EVO-000123 (generado en la app).
  reference: varchar("reference", { length: 20 }).notNull().unique(),
  // Folio del sistema anterior (EVO-0669, 4 dígitos). Los tickets migrados se
  // re-foliaron al formato de 6 dígitos, pero el técnico tiene el número viejo
  // en sus reportes de papel: sin esta columna, ese papel deja de ser
  // rastreable. Null en todo lo creado dentro de la app.
  legacyReference: varchar("legacy_reference", { length: 30 }),
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
}, (t) => [
  // Bandeja de soporte: filtra por estado y ordena por prioridad.
  index("tickets_status_priority_idx").on(t.status, t.priority),
  // Cola de un agente.
  index("tickets_assigned_status_idx").on(t.assignedToId, t.status),
  // Portal del cliente: "mis tickets", más recientes primero.
  index("tickets_created_by_idx").on(t.createdById, t.createdAt),
  // Listados y dashboard globales.
  index("tickets_created_at_idx").on(t.createdAt),
  // Historial de un equipo del laboratorio.
  index("tickets_equipment_idx").on(t.equipmentId),
]);

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
}, (t) => [
  // Bitácora de un ticket en orden cronológico: la consulta más frecuente
  // del portal. Sin este índice cada apertura de ticket escanea la tabla.
  index("ticket_comments_ticket_idx").on(t.ticketId, t.createdAt),
]);

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
}, (t) => [
  // Bandeja de leads: pendientes primero, más recientes arriba.
  index("leads_status_created_idx").on(t.status, t.createdAt),
]);

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
}, (t) => [
  // Equipos de un laboratorio (su portal y el selector al abrir un ticket).
  index("equipment_owner_idx").on(t.ownerId),
]);

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
}, (t) => [index("equipment_modules_equipment_idx").on(t.equipmentId)]);

export const equipmentSubmodules = pgTable("equipment_submodules", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => equipmentModules.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(), // submodelo
  serialNumber: varchar("serial_number", { length: 120 }),
  photo: text("photo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("equipment_submodules_module_idx").on(t.moduleId)]);

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
}, (t) => [
  // Refacciones de una actividad (se lee al render del ticket y en utilidad).
  index("ticket_comment_parts_comment_idx").on(t.commentId),
  // Consumo histórico de una refacción (alimenta rentabilidad y ML).
  index("ticket_comment_parts_part_idx").on(t.partId),
]);

/* ------------------------- Configuración global ------------------------- */
// Fila única ('global'): tarifas de mano de obra usadas para calcular utilidad.
export const settings = pgTable("settings", {
  id: varchar("id", { length: 20 }).primaryKey().default("global"),
  laborCostPerHour: numeric("labor_cost_per_hour", { precision: 12, scale: 2 }),
  laborRatePerHour: numeric("labor_rate_per_hour", { precision: 12, scale: 2 }),
  /**
   * Tipo de cambio USD→MXN vigente, el que la empresa fija en
   * Configuración → Moneda.
   *
   * Es el valor de HOY, no la historia: al guardar un negocio en dólares este
   * número se **estampa** en el propio negocio (`crm_deals.fx_rate`) junto con
   * la fecha. Por eso cambiarlo aquí mañana no reescribe lo que ya se informó
   * del mes pasado — que es justo lo que pasaría si los informes leyeran esta
   * fila en vez de la copia estampada.
   */
  usdRate: numeric("usd_rate", { precision: 12, scale: 4 }),
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
}, (t) => [
  // Contratos de un laboratorio.
  index("contracts_client_idx").on(t.clientId),
  // Cierre del ciclo negocio → contrato.
  index("contracts_deal_idx").on(t.dealId),
  index("contracts_created_at_idx").on(t.createdAt),
]);

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
}, (t) => [
  // Etapas de un pipeline en su orden de tablero.
  index("crm_stages_pipeline_order_idx").on(t.pipelineId, t.order),
]);

// Organización = laboratorio/empresa. Puede existir antes de ser cliente;
// al firmar se enlaza con la cuenta de portal (users) vía clientId.
export const crmOrganizations = pgTable("crm_organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  // RFC. Viene del padrón de SAE y es requisito para timbrar CFDI cuando
  // llegue facturación: sin esto habría que recapturarlo cliente por cliente.
  taxId: varchar("tax_id", { length: 20 }),
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
}, (t) => [
  index("crm_organizations_owner_idx").on(t.ownerId),
  // Enlace organización ↔ cuenta de portal del laboratorio.
  index("crm_organizations_client_idx").on(t.clientId),
]);

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
}, (t) => [
  // Contactos de una organización (ficha del laboratorio).
  index("crm_contacts_organization_idx").on(t.organizationId),
  index("crm_contacts_owner_idx").on(t.ownerId),
]);

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
}, (t) => [
  // La tabla más consultada del sistema. Postgres NO indexa las columnas de
  // foreign key por su cuenta, así que sin esto cada vista del CRM (tablero,
  // embudo, informes) hacía un sequential scan de crm_deals completa.

  // Tablero kanban y embudo por etapa: el join arranca por stage_id.
  index("crm_deals_stage_status_idx").on(t.stageId, t.status),
  // Agregados a nivel pipeline (valor total, conteos).
  index("crm_deals_pipeline_status_idx").on(t.pipelineId, t.status),
  // Filtro por vendedor, presente en casi todos los informes.
  index("crm_deals_owner_status_idx").on(t.ownerId, t.status),
  // Cerrados por mes (ventana de 12 meses sobre closed_at).
  index("crm_deals_pipeline_closed_idx").on(t.pipelineId, t.closedAt),
  // Pronóstico por mes de cierre estimado.
  index("crm_deals_pipeline_expected_idx").on(t.pipelineId, t.expectedCloseDate),
  // Negocios estancados (rottingDays compara contra updated_at).
  index("crm_deals_status_updated_idx").on(t.status, t.updatedAt),
]);

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
}, (t) => [
  // Actividades de un negocio (panel del detalle).
  index("crm_activities_deal_idx").on(t.dealId),
  // Agenda del vendedor: pendientes por vencer.
  index("crm_activities_owner_pending_idx").on(t.ownerId, t.done, t.dueAt),
  // Vencidas a nivel global (alertas del dashboard).
  index("crm_activities_pending_due_idx").on(t.done, t.dueAt),
]);

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
}, (t) => [
  index("crm_notes_deal_idx").on(t.dealId, t.createdAt),
  index("crm_notes_organization_idx").on(t.organizationId),
]);

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
}, (t) => [
  // Líneas de un negocio: se suman para calcular su valor.
  index("crm_deal_products_deal_idx").on(t.dealId),
]);

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
}, (t) => [
  // Objetivos vigentes de un vendedor en el periodo.
  index("crm_goals_owner_period_idx").on(t.ownerId, t.periodStart, t.periodEnd),
]);

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
}, (t) => [
  // Línea de tiempo de un negocio (proyección que alimenta su ficha).
  index("crm_deal_events_deal_idx").on(t.dealId, t.createdAt),
]);

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
export const purchaseOrderSeq = pgSequence("purchase_order_reference_seq", {
  startWith: 1,
  increment: 1,
});
export const supplierInvoiceSeq = pgSequence("supplier_invoice_reference_seq", {
  startWith: 1,
  increment: 1,
});
export const supplierCreditNoteSeq = pgSequence(
  "supplier_credit_note_reference_seq",
  { startWith: 1, increment: 1 },
);
export const payableImportSeq = pgSequence("payable_import_reference_seq", {
  startWith: 1,
  increment: 1,
});
export const supplierAdvanceSeq = pgSequence("supplier_advance_reference_seq", {
  startWith: 1,
  increment: 1,
});
export const requisitionSeq = pgSequence("requisition_reference_seq", {
  startWith: 1,
  increment: 1,
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
    // Origen de la ENTRADA, si vino de recibir una orden de compra.
    //
    // El movimiento ES la recepción: no hay una tabla aparte de recepciones
    // porque duplicaría el mismo hecho en dos lugares que después habría que
    // mantener de acuerdo. Con este enganche, «qué llegó de esta orden y
    // cuándo» se responde leyendo el ledger, que ya es append-only y auditable.
    purchaseOrderLineId: uuid("purchase_order_line_id").references(
      (): AnyPgColumn => purchaseOrderLines.id,
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
  (t) => [
    index("inventory_movements_part_idx").on(t.partId, t.occurredAt),
    // Recepciones de una línea de orden: se lee al abrir la orden.
    index("inventory_movements_po_line_idx").on(t.purchaseOrderLineId),
  ],
);

/* ------------------------- Compras ------------------------- */

/**
 * Proveedores.
 *
 * Contraparte de `users` con rol cliente: de un lado a quién se le presta el
 * servicio, del otro a quién se le compra la refacción. Se separan porque casi
 * nunca son la misma persona y porque el ciclo de dinero corre en sentidos
 * opuestos —cuentas por cobrar contra cuentas por pagar—.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    // RFC para poder conciliar el CFDI que emite el proveedor cuando exista
    // el módulo de cuentas por pagar. Opcional: hay proveedores del extranjero.
    rfc: varchar("rfc", { length: 13 }),
    contactName: varchar("contact_name", { length: 160 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 40 }),
    address: text("address"),
    /** Días de crédito pactados. 0 = de contado. */
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    /** Moneda habitual. La orden puede pactarse en otra. */
    currency: varchar("currency", { length: 3 }).notNull().default("MXN"),
    notes: text("notes"),
    // Se desactivan, no se borran: sus órdenes son historial de compra.
    active: boolean("active").notNull().default(true),

    /**
     * Suspensión de compras.
     *
     * Distinta de `active`, y por eso son dos campos y no un estado. Inactivo
     * significa «ya no trabajamos con él»: desaparece de los selectores y es
     * casi una baja. Suspendido significa «no le compres MIENTRAS», que es una
     * medida temporal con causa —entregó fuera de especificación, está en la
     * lista del SAT, hay una disputa abierta— y que alguien va a levantar.
     *
     * Bloquea órdenes nuevas. NO bloquea pagarle: lo que ya se le debe se le
     * sigue debiendo, y dejar de pagar por estar suspendido convierte una
     * medida de compras en un incumplimiento.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /** Por qué. Obligatorio al suspender: sin causa escrita nadie sabe qué
     *  tiene que pasar para levantarla. */
    suspendReason: text("suspend_reason"),
    suspendedById: uuid("suspended_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("suppliers_name_idx").on(t.name),
    index("suppliers_active_idx").on(t.active),
    index("suppliers_suspended_idx").on(t.suspendedAt),
  ],
);

/**
 * Orden de compra.
 *
 * `sent` no es decorativo: mientras está en `draft` las líneas se pueden tocar,
 * y a partir de `sent` no — porque el proveedor ya tiene una copia y cambiarla
 * de este lado dejaría dos documentos distintos con el mismo folio.
 */
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio legible: EVO-C-000123. La C lo distingue del ticket y del negocio. */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: purchaseOrderStatus("status").notNull().default("draft"),
    currency: varchar("currency", { length: 3 }).notNull().default("MXN"),
    // Tipo de cambio pactado y su fecha. Sin fechar, todo importe convertido se
    // recalcularía con la cotización de hoy y el costo histórico cambiaría solo.
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxDate: date("fx_date"),
    /** Cuándo se espera la mercancía. Alimenta el análisis de faltantes. */
    expectedAt: date("expected_at"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchase_orders_supplier_idx").on(t.supplierId, t.createdAt),
    index("purchase_orders_status_idx").on(t.status),
    index("purchase_orders_expected_idx").on(t.expectedAt),
  ],
);

/**
 * Renglón de una orden.
 *
 * `partId` es OBLIGATORIO, y es la decisión de diseño del módulo. Aspel permite
 * comprar texto libre; aquí no, porque una línea sin refacción del catálogo no
 * se puede recibir contra el inventario y dejaría un hueco silencioso entre lo
 * que se compró y lo que hay. Si la pieza no existe todavía, se da de alta —un
 * formulario— y así el ledger sigue siendo la única verdad de las existencias.
 */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references((): AnyPgColumn => purchaseOrders.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => spareParts.id, { onDelete: "restrict" }),
    // Copia histórica, igual que en la bitácora: si mañana se corrige el
    // catálogo, lo que decía la orden el día que se mandó no debe cambiar.
    partNumber: varchar("part_number", { length: 80 }).notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: integer("quantity").notNull(),
    /**
     * CACHÉ MATERIALIZADO, no fuente de verdad: es la suma de los movimientos
     * de inventario que apuntan a esta línea. Se actualiza solo al insertar un
     * movimiento, en la misma transacción. Mismo trato que `spare_parts.stock`.
     */
    receivedQuantity: integer("received_quantity").notNull().default(0),
    unitCostMxn: numeric("unit_cost_mxn", { precision: 12, scale: 2 }),
    unitCostUsd: numeric("unit_cost_usd", { precision: 12, scale: 2 }),
    /**
     * De qué línea de requisición salió este renglón. Nulo: la orden se capturó
     * directo, sin requisición, y eso sigue siendo válido.
     *
     * `set null` y no `cascade`: si alguien borra la requisición, la orden ya
     * está en manos del proveedor y no puede desaparecer con ella. Se pierde el
     * hilo, no el documento.
     */
    requisitionLineId: uuid("requisition_line_id").references(
      (): AnyPgColumn => requisitionLines.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchase_order_lines_order_idx").on(t.orderId),
    // Historial de compra de una refacción: alimenta el costo y, más adelante,
    // el modelo de reposición.
    index("purchase_order_lines_part_idx").on(t.partId),
    // El camino de vuelta: de la orden a la requisición y de ahí al pedido.
    index("purchase_order_lines_requisition_idx").on(t.requisitionLineId),
  ],
);

/* ------------------------- Requisiciones ------------------------- */

/**
 * Requisición: lo que HACE FALTA, antes de saber a quién comprárselo.
 *
 * Es un documento aparte de la orden de compra y no un borrador suyo, porque
 * responden a dos preguntas distintas que hacen dos personas distintas. Quien
 * vendió sabe QUÉ se necesita, para qué pedido y para cuándo; quien compra sabe
 * A QUIÉN, a qué precio y en qué moneda. Meter las dos en la orden borra al
 * primero del expediente: cuando alguien pregunte medio año después por qué se
 * compraron seis bombas, la orden solo sabrá decir a quién se le compraron.
 *
 * De ahí sale lo demás: una requisición produce VARIAS órdenes —una por
 * proveedor— y una línea sabe siempre de qué línea del pedido nació.
 *
 * `dealId` es opcional a propósito. El caso que la pide es el pedido del
 * cliente, pero la reposición de existencias es la misma necesidad sin negocio
 * detrás, y obligar a inventar un negocio falso para poder requisitar es el
 * atajo que acaba ensuciando el CRM.
 */
export const requisitions = pgTable(
  "requisitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio legible: EVO-R-000123. La R lo distingue de la orden (C). */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    /** El pedido que la originó. Nulo = reposición de existencias. */
    dealId: uuid("deal_id").references((): AnyPgColumn => crmDeals.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 240 }).notNull(),
    status: requisitionStatus("status").notNull().default("draft"),
    /** Para cuándo se necesita. Es lo que ordena la cola del comprador. */
    neededBy: date("needed_by"),
    notes: text("notes"),

    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /**
     * Quién autorizó. Se guarda aparte de quién pidió porque el valor entero
     * del documento está en que sean dos: si el mismo firma las dos casillas,
     * la autorización no autoriza nada.
     */
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Motivo del rechazo o de la baja. Obligatorio en ambos casos. */
    resolutionReason: text("resolution_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("requisitions_status_idx").on(t.status, t.neededBy),
    // Qué se requisitó para un pedido: se lee desde el detalle del negocio.
    index("requisitions_deal_idx").on(t.dealId),
  ],
);

/**
 * Renglón de una requisición.
 *
 * A diferencia de la orden, aquí `partId` es OPCIONAL. Esa es toda la razón de
 * ser de este documento: el vendedor pide «la bomba de la 1525» sin que la
 * pieza esté aún en el catálogo, y el comprador la resuelve. Obligar al
 * catálogo en el momento de pedir empujaría a dar de alta refacciones
 * inventadas con tal de poder seguir, que es exactamente lo que ensucia el
 * inventario. Lo que no se puede es CONVERTIR una línea sin `partId`: ahí la
 * orden vuelve a exigirla, porque sin ella no hay contra qué recibir.
 */
export const requisitionLines = pgTable(
  "requisition_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requisitionId: uuid("requisition_id")
      .notNull()
      .references((): AnyPgColumn => requisitions.id, { onDelete: "cascade" }),
    /** De qué línea del pedido nació. Nulo si se añadió a mano. */
    dealProductId: uuid("deal_product_id").references(
      (): AnyPgColumn => crmDealProducts.id,
      { onDelete: "set null" },
    ),
    /** Resuelta contra el catálogo. Nulo hasta que el comprador la identifica. */
    partId: uuid("part_id").references(() => spareParts.id, {
      onDelete: "restrict",
    }),
    /** Lo que se pidió, con las palabras de quien lo pidió. */
    description: varchar("description", { length: 300 }).notNull(),
    quantity: integer("quantity").notNull(),
    /**
     * CACHÉ MATERIALIZADO, no fuente de verdad: cuántas piezas de esta línea ya
     * viajaron a una orden. Se actualiza al crear la orden, en la misma
     * transacción. Mismo trato que `purchase_order_lines.received_quantity`.
     */
    orderedQuantity: integer("ordered_quantity").notNull().default(0),
    /**
     * Proveedor sugerido. Es una PROPUESTA, no una decisión: sale del historial
     * de compra de la pieza y el comprador la cambia si quiere. Se guarda para
     * que la sugerencia no se recalcule y cambie sola entre que se mira y se
     * convierte.
     */
    supplierId: uuid("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    /** Por qué se sugirió ese proveedor. Sin esto la sugerencia es un oráculo. */
    supplierReason: varchar("supplier_reason", { length: 200 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("requisition_lines_requisition_idx").on(t.requisitionId),
    index("requisition_lines_part_idx").on(t.partId),
    // Lo pendiente de convertir, agrupado por proveedor: es la consulta del
    // comprador cuando decide qué órdenes va a sacar hoy.
    index("requisition_lines_supplier_idx").on(t.supplierId),
  ],
);

/* ------------------------- Cuentas por pagar ------------------------- */

/**
 * La factura del proveedor: el documento que crea la deuda.
 *
 * No es la orden de compra. La orden dice qué se pidió; la factura dice cuánto
 * se debe, desde cuándo y hasta cuándo. Se separan porque en la práctica no
 * coinciden: un proveedor factura dos órdenes juntas, o una orden llega en tres
 * remisiones con su factura cada una, o factura un flete que nadie pidió. Con
 * la deuda colgada de la orden, cualquiera de esos casos obliga a falsear algo.
 *
 * Es además el documento fiscal, y por eso guarda el folio del proveedor y el
 * UUID del CFDI: son los datos con los que se concilia contra el SAT y contra
 * el estado de cuenta del proveedor, y no existen en ninguna orden.
 */
export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio interno: EVO-P-000123. La P la distingue de la orden (C). */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Folio impreso en la factura del proveedor. Suyo, no nuestro. */
    supplierFolio: varchar("supplier_folio", { length: 60 }),
    /**
     * UUID del CFDI (folio fiscal). Único: capturar dos veces la misma factura
     * es el error más caro de cuentas por pagar, porque termina en pagarla dos
     * veces. Nullable porque un proveedor extranjero no emite CFDI.
     */
    cfdiUuid: varchar("cfdi_uuid", { length: 36 }),
    currency: varchar("currency", { length: 3 }).notNull().default("MXN"),
    // Tipo de cambio de ESTA factura y su fecha. Igual que en la orden: sin
    // fechar, la deuda en dólares se revaluaría sola con la cotización de hoy.
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxDate: date("fx_date"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    /** IVA y demás traslados, junto. El desglose por tasa llega con el CFDI. */
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    /** Fecha de emisión, la que imprime el proveedor. */
    issuedAt: date("issued_at").notNull(),
    /**
     * Cuándo vence. Se calcula al capturar, sumando los días de crédito del
     * proveedor a la emisión, y se GUARDA en vez de derivarse en cada consulta:
     * si mañana cambian las condiciones del proveedor, las facturas ya emitidas
     * no deben cambiar de vencimiento por eso.
     */
    dueAt: date("due_at").notNull(),
    status: supplierInvoiceStatus("status").notNull().default("pending"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Estado de cuenta de un proveedor.
    index("supplier_invoices_supplier_idx").on(t.supplierId, t.issuedAt),
    // "¿qué vence esta semana?" — la consulta que sostiene la pantalla.
    index("supplier_invoices_due_idx").on(t.dueAt, t.status),
    index("supplier_invoices_status_idx").on(t.status),
    // Parcial: solo aplica a las que traen UUID. Sin `where`, dos facturas de
    // proveedor extranjero (ambas sin CFDI) chocarían entre sí.
    uniqueIndex("supplier_invoices_cfdi_uq")
      .on(t.cfdiUuid)
      .where(sql`${t.cfdiUuid} is not null`),
  ],
);

/**
 * Qué órdenes ampara una factura.
 *
 * Muchos a muchos, y no una columna `orderId` en la factura, porque las dos
 * direcciones ocurren: una factura que cubre varias órdenes y una orden que se
 * factura en partes. Es también el enganche que permite contestar "de lo que
 * recibí de esta orden, ¿cuánto me facturaron ya?".
 */
export const supplierInvoiceOrders = pgTable(
  "supplier_invoice_orders",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.orderId] }),
    index("supplier_invoice_orders_order_idx").on(t.orderId),
  ],
);

/**
 * Los pagos, como ledger.
 *
 * Mismo patrón que `inventoryMovements` y por la misma razón: el saldo de una
 * factura no se guarda mutando un campo, se construye con los pagos. Cada fila
 * lleva el saldo que quedó DESPUÉS de aplicarla, redundante a propósito —
 * permite auditar sin recorrer todo el historial y delata si alguien movió el
 * estado de la factura por fuera.
 *
 * El pago va en la moneda de la factura. Pagar una factura en dólares con
 * pesos es otra conversación (implica pérdida o ganancia cambiaria, que es un
 * asiento contable propio) y no se resuelve escondiéndola aquí.
 */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // restrict: el pago es la prueba de que el dinero salió. Borrar la factura
    // no puede llevarse el registro del pago por delante.
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Saldo pendiente tras aplicar este pago. Cero = factura saldada. */
    balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
    method: paymentMethod("method").notNull().default("transfer"),
    /** Folio de la transferencia, número de cheque… con qué se rastrea. */
    reference: varchar("reference", { length: 120 }),
    /** Cuándo salió el dinero, que no es cuándo se capturó. */
    paidAt: date("paid_at").notNull(),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("supplier_payments_invoice_idx").on(t.invoiceId, t.occurredAt)],
);

/**
 * Parcialidades de una factura.
 *
 * Una factura puede pactarse a pagar en varios vencimientos. Sin esto, la
 * antigüedad marca la factura ENTERA como vencida el día que pasa su única
 * fecha: 78 880 aparecen con 15 días de mora cuando en realidad solo venció el
 * primer tercio y los otros dos ni siquiera han llegado.
 *
 * Ausencia = una sola exhibición. La factura sin filas aquí se comporta
 * exactamente como antes, y por eso añadir esto no obligó a partir en
 * parcialidades las que ya existían.
 *
 * NO lleva estado ni saldo. Cuánto se ha cubierto de cada parcialidad se
 * deriva repartiendo lo aplicado a la factura en cascada, de la más antigua a
 * la más nueva — que es como se imputa un pago cuando nadie dice a qué
 * vencimiento va. Guardarlo sería el mismo error que guardar el saldo.
 */
export const supplierInvoiceInstallments = pgTable(
  "supplier_invoice_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "cascade" }),
    /** 1, 2, 3… Define el orden de la cascada. */
    seq: integer("seq").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    dueAt: date("due_at").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sii_invoice_seq_uq").on(t.invoiceId, t.seq),
    // "¿qué vence esta semana?" ahora se contesta aquí, no en la factura.
    index("sii_due_idx").on(t.dueAt),
  ],
);

/**
 * Anticipo a un proveedor.
 *
 * Dinero que sale ANTES de que exista la factura. Es el reverso de la nota de
 * crédito: aquella baja la deuda sin mover dinero, este mueve dinero sin que
 * haya deuda todavía.
 *
 * Va en su propia tabla y no como un pago porque un pago necesita una factura a
 * la que apuntar. Meterlo como pago obligaría a inventar una factura ficticia,
 * y esa factura acabaría en el estado de cuenta del proveedor como deuda que
 * nunca existió.
 *
 * Ojo al contar la salida de caja: el dinero salió el día del anticipo, no el
 * día en que se aplica a una factura. Sumar las aplicaciones junto con los
 * pagos lo contaría dos veces.
 */
export const supplierAdvances = pgTable(
  "supplier_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio interno: EVO-ANT-000123. */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("MXN"),
    method: paymentMethod("method").notNull().default("transfer"),
    /** Con qué se rastrea la salida: folio de transferencia, cheque… */
    reference_: varchar("payment_reference", { length: 120 }),
    /** Cuándo salió el dinero. */
    paidAt: date("paid_at").notNull(),
    /** CFDI de anticipo, cuando el proveedor lo emite. */
    cfdiUuid: varchar("cfdi_uuid", { length: 36 }),
    status: supplierAdvanceStatus("status").notNull().default("open"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_advances_supplier_idx").on(t.supplierId, t.paidAt),
    index("supplier_advances_status_idx").on(t.status),
    uniqueIndex("supplier_advances_cfdi_uq")
      .on(t.cfdiUuid)
      .where(sql`${t.cfdiUuid} is not null`),
  ],
);

/** Cómo se consumió un anticipo. Ledger, igual que pagos y notas de crédito. */
export const supplierAdvanceApplications = pgTable(
  "supplier_advance_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => supplierAdvances.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Saldo pendiente de la factura tras aplicar este importe. */
    balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
    appliedAt: date("applied_at").notNull(),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("saa_invoice_idx").on(t.invoiceId, t.occurredAt),
    index("saa_advance_idx").on(t.advanceId, t.occurredAt),
  ],
);

/**
 * Nota de crédito del proveedor.
 *
 * El documento que faltaba. Una devolución, una bonificación o un descuento
 * posterior bajan la deuda sin que salga dinero, y hasta ahora la única forma de
 * cuadrar el saldo era capturar un pago falso — con lo que el reporte de salidas
 * de caja quedaba inflado y el rastro del dinero real se perdía.
 *
 * No apunta a una factura: se aplica a las que haga falta (ver
 * `supplierCreditNoteApplications`). Una nota de $1,500 puede repartirse entre
 * tres facturas, o quedarse sin aplicar como saldo a favor hasta la próxima
 * compra. Amarrarla a una sola factura obligaría a partirla en pedazos ficticios.
 */
export const supplierCreditNotes = pgTable(
  "supplier_credit_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio interno: EVO-NC-000123. NC la distingue de la orden (C) y la factura (P). */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Folio impreso en la nota del proveedor. */
    supplierFolio: varchar("supplier_folio", { length: 60 }),
    /** Mismo control antiduplicado que la factura, y por la misma razón: aplicar
     *  dos veces la misma nota deja de deberle al proveedor dinero que sí se le
     *  debe, y eso sale a la luz tarde y con reclamo de por medio. */
    cfdiUuid: varchar("cfdi_uuid", { length: 36 }),
    currency: varchar("currency", { length: 3 }).notNull().default("MXN"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    issuedAt: date("issued_at").notNull(),
    status: supplierCreditNoteStatus("status").notNull().default("open"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_credit_notes_supplier_idx").on(t.supplierId, t.issuedAt),
    index("supplier_credit_notes_status_idx").on(t.status),
    // Parcial, como en las facturas: el proveedor extranjero no emite CFDI y sin
    // el `where` dos notas sin UUID chocarían entre sí.
    uniqueIndex("supplier_credit_notes_cfdi_uq")
      .on(t.cfdiUuid)
      .where(sql`${t.cfdiUuid} is not null`),
  ],
);

/**
 * Cómo se consumió una nota de crédito.
 *
 * Ledger, mismo patrón que `supplierPayments`: el saldo a favor no se guarda
 * mutando un campo, se construye con las aplicaciones. `balanceAfter` es el
 * saldo que le quedó A LA FACTURA tras aplicar este importe — igual que en los
 * pagos, para poder auditar sin recorrer todo el historial.
 */
export const supplierCreditNoteApplications = pgTable(
  "supplier_credit_note_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creditNoteId: uuid("credit_note_id")
      .notNull()
      .references(() => supplierCreditNotes.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** Saldo pendiente de la factura tras aplicar este importe. */
    balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }).notNull(),
    appliedAt: date("applied_at").notNull(),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("scna_invoice_idx").on(t.invoiceId, t.occurredAt),
    index("scna_note_idx").on(t.creditNoteId, t.occurredAt),
  ],
);

/**
 * Un lote de importación.
 *
 * Existe para poder contestar «¿de dónde salieron estas cuarenta facturas?» seis
 * meses después. Guarda el archivo de origen y el recuento, no las filas: cada
 * documento creado deja su propio evento con la fila cruda en el payload, que es
 * el precedente que ya sigue la migración del sistema anterior.
 */
export const payableImports = pgTable(
  "payable_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Folio interno: EVO-IMP-000123. */
    reference: varchar("reference", { length: 30 }).notNull().unique(),
    kind: payableImportKind("kind").notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    rowCount: integer("row_count").notNull(),
    okCount: integer("ok_count").notNull(),
    errorCount: integer("error_count").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payable_imports_created_idx").on(t.createdAt)],
);

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  orders: many(purchaseOrders),
}));

export const requisitionsRelations = relations(requisitions, ({ one, many }) => ({
  deal: one(crmDeals, {
    fields: [requisitions.dealId],
    references: [crmDeals.id],
  }),
  requestedBy: one(users, {
    fields: [requisitions.requestedById],
    references: [users.id],
  }),
  approvedBy: one(users, {
    fields: [requisitions.approvedById],
    references: [users.id],
  }),
  lines: many(requisitionLines),
}));

export const requisitionLinesRelations = relations(
  requisitionLines,
  ({ one, many }) => ({
    requisition: one(requisitions, {
      fields: [requisitionLines.requisitionId],
      references: [requisitions.id],
    }),
    part: one(spareParts, {
      fields: [requisitionLines.partId],
      references: [spareParts.id],
    }),
    supplier: one(suppliers, {
      fields: [requisitionLines.supplierId],
      references: [suppliers.id],
    }),
    dealProduct: one(crmDealProducts, {
      fields: [requisitionLines.dealProductId],
      references: [crmDealProducts.id],
    }),
    orderLines: many(purchaseOrderLines),
  }),
);

export const purchaseOrdersRelations = relations(
  purchaseOrders,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseOrders.supplierId],
      references: [suppliers.id],
    }),
    createdBy: one(users, {
      fields: [purchaseOrders.createdById],
      references: [users.id],
    }),
    lines: many(purchaseOrderLines),
  }),
);

export const purchaseOrderLinesRelations = relations(
  purchaseOrderLines,
  ({ one, many }) => ({
    order: one(purchaseOrders, {
      fields: [purchaseOrderLines.orderId],
      references: [purchaseOrders.id],
    }),
    part: one(spareParts, {
      fields: [purchaseOrderLines.partId],
      references: [spareParts.id],
    }),
    // De dónde salió: el hilo hasta la requisición y, por ella, hasta el pedido.
    requisitionLine: one(requisitionLines, {
      fields: [purchaseOrderLines.requisitionLineId],
      references: [requisitionLines.id],
    }),
    // Las recepciones de esta línea. El ledger es el documento de recepción.
    receipts: many(inventoryMovements),
  }),
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

/* ============================================================
   Laboratorio de ML
   ============================================================

   Las tres tablas viven en el esquema DEL INQUILINO, no en `public`, y esa es
   la decisión que sostiene toda la tesis del producto: el modelo de una empresa
   se entrena con su propio esquema y no puede alcanzar el de otra aunque
   alguien escriba mal una consulta. El aislamiento no es una promesa del
   código, es el `search_path`.

   El modelo entrenado se guarda en `params` como JSON, no como un artefacto
   en disco ni en un bucket. Suena modesto y es a propósito: significa que
   `pg_dump` de un inquilino se lleva sus modelos, que restaurar un respaldo
   restaura las predicciones, y que no hay un segundo sistema que sincronizar.
   Es lo que "el modelo viaja con el sistema" quiere decir literalmente.
   Cuando un algoritmo no quepa en JSON, ese será el momento de sacarlo — no
   antes. */

/**
 * Las PREGUNTAS que esta empresa quiere responder.
 *
 * Una plantilla no es un modelo: es una pregunta con su objetivo, sus rasgos y
 * la tolerancia con la que el negocio considera útil la respuesta. Vive en la
 * base y no en el código porque la operación de cada empresa pregunta cosas
 * distintas, y obligarlas a compartir un catálogo fijo convertía al laboratorio
 * en una demo de dos casos.
 *
 * Lo que NO vive aquí es el SQL. Las columnas `subject`, `target` y `features`
 * guardan identificadores de bloques definidos en `lib/ml/blocks.ts`, y la
 * consulta se compila desde ellos. Esa indirección es lo que permite que un
 * usuario arme su propia pregunta sin que pueda anclarla en el futuro ni
 * entrenar con una columna que todavía no existía cuando había que predecir.
 */
export const mlTemplates = pgTable(
  "ml_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Identificador estable. Es lo que guarda `ml_models.template`, así que
     * renombrar la plantilla no desconecta su historial de modelos.
     */
    slug: varchar("slug", { length: 60 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    question: text("question").notNull(),
    /** Bloques de `lib/ml/blocks.ts`. */
    subject: varchar("subject", { length: 40 }).notNull(),
    target: varchar("target", { length: 40 }).notNull(),
    features: jsonb("features").$type<string[]>().notNull(),
    /** Error que el negocio considera aceptable. Define el "% de aciertos". */
    tolerance: numeric("tolerance", { precision: 12, scale: 2 }).notNull(),
    /**
     * Las dos que trae el sistema de fábrica. Se marcan para no poder
     * borrarlas: son las que tienen historial de modelos y de predicciones
     * detrás, y perderlas dejaría huérfano todo lo medido hasta hoy.
     */
    builtin: boolean("builtin").notNull().default(false),

    /**
     * En qué módulo del ERP vive la pregunta.
     *
     * La configuración empieza donde el usuario está —Refacciones, Ventas— y no
     * donde está el modelo: nadie entra al ERP pensando «quiero una regresión»,
     * entra a Refacciones y se pregunta cuánto va a necesitar el mes que viene.
     */
    module: varchar("module", { length: 40 }).notNull().default("servicio"),

    /**
     * Qué clase de pregunta es: `forecast`, `regression`, `classification`,
     * `anomaly`. Cada una se evalúa distinto, y guardarlo es lo que impide que
     * una de clasificación se mida con el error absoluto de una de regresión.
     */
    task: varchar("task", { length: 20 }).notNull().default("forecast"),

    /**
     * Cuántos periodos hacia adelante. Un pronóstico a tres meses y otro a uno
     * son dos modelos distintos sobre la misma serie —se entrenan por separado,
     * directo y no recursivo— y hay que poder tener los dos.
     */
    horizon: integer("horizon").notNull().default(1),
    grain: varchar("grain", { length: 10 }).notNull().default("month"),

    /** `absolute` o `relative`. Ver la migración 0013. */
    toleranceKind: varchar("tolerance_kind", { length: 10 })
      .notNull()
      .default("relative"),

    /**
     * Familia fijada por el usuario, o `null` para que la elija el AutoML.
     *
     * Que se pueda fijar importa: a veces el negocio necesita un modelo que
     * pueda explicar en una junta aunque otro acierte un punto más, y queda
     * escrito que fue elección y no búsqueda.
     */
    algorithm: varchar("algorithm", { length: 40 }),

    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ml_templates_slug_uq").on(t.slug),
    index("ml_templates_module_idx").on(t.module),
  ],
);

export const mlModelStatus = pgEnum("ml_model_status", [
  // Entrenado y evaluado, sin decisión todavía.
  "backtested",
  // Sirviendo predicciones. Solo uno por plantilla a la vez.
  "production",
  // Reemplazado por una versión nueva, o retirado por degradarse.
  "retired",
  // Evaluado y RECHAZADO por no superar a la línea base. Se conserva: saber
  // qué no funciona con los datos de esta empresa vale tanto como lo que sí,
  // y evita que alguien lo vuelva a intentar dentro de seis meses.
  "rejected",
]);

export const mlModels = pgTable(
  "ml_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Plantilla de la que sale: `service_hours`, `maintenance_interval`… */
    template: varchar("template", { length: 60 }).notNull(),
    /** Consecutivo por plantilla. Reentrenar crea una versión, no pisa la anterior. */
    version: integer("version").notNull().default(1),
    status: mlModelStatus("status").notNull().default("backtested"),
    /** Familia del algoritmo, para leerla en la UI sin interpretar `params`. */
    algorithm: varchar("algorithm", { length: 60 }).notNull(),

    /** El modelo entrenado. Ver la nota de arriba sobre por qué vive aquí. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),

    /**
     * Métricas del backtest: error del modelo, error de la LÍNEA BASE, tamaños
     * de entrenamiento y prueba, y la fecha de corte.
     *
     * La línea base se guarda junto al resultado y no aparte porque un MAE
     * suelto no dice nada: 3,1 horas de error es bueno o malo según lo que
     * logre predecir "siempre el promedio". Sin ese número al lado, cualquier
     * modelo parece que funciona.
     */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),

    /**
     * ¿Le gana a la línea base? Es la compuerta de promoción.
     *
     * Se guarda como columna y no se recalcula al vuelo porque es la decisión
     * que autoriza a mostrar un número a un usuario. Un criterio que se
     * reinterpreta en cada lectura acaba cambiando sin que nadie lo note.
     */
    beatsBaseline: boolean("beats_baseline").notNull(),

    /** Corte temporal del backtest: se entrenó con lo anterior a esta fecha. */
    trainedUpTo: timestamp("trained_up_to", { withTimezone: true }),
    trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
    trainedById: uuid("trained_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    /** Por qué se rechazó o retiró. Queda escrito para no repetir el intento. */
    note: text("note"),

    /**
     * El conjunto EXACTO con el que se entrenó, congelado en parquet.
     *
     * Hasta ahora un modelo guardaba sus métricas y la fecha del último caso
     * que vio, pero no los casos. La consecuencia era que «reentrenar
     * exactamente con el snapshot del 1 de marzo» —el disparador que
     * `docs/ARQUITECTURA.md` llama *la killer feature para ML*— era imposible:
     * volver a correr la consulta hoy devuelve otros datos, porque el histórico
     * siguió creciendo. Sin esto, ninguna métrica del laboratorio es
     * reproducible; solo repetible por casualidad.
     *
     * Ruta relativa al lago, nunca absoluta: el lago se mueve entre el portátil
     * y el volumen de producción. Nulo en los modelos entrenados antes de que
     * existiera el plano analítico — son irreproducibles y conviene que se note.
     */
    datasetPath: varchar("dataset_path", { length: 300 }),

    /**
     * El modelo entrenado, serializado por el servicio de inteligencia.
     *
     * Columna propia y no dentro de `params`: `params` describe CÓMO se
     * configuró —algo que se lee y se muestra en la pantalla— y esto es un blob
     * opaco de decenas de kilobytes que solo Python sabe abrir. Mezclarlos
     * habría hecho ilegible cualquier consulta sobre la configuración.
     *
     * Vive aquí, en el esquema de la empresa, y no en el servicio: es lo que
     * sostiene la promesa de que los modelos viven donde viven los datos del
     * cliente, y lo que permite reiniciar o reemplazar el servicio sin que
     * ninguna empresa pierda nada.
     */
    modelBlob: text("model_blob"),

    /**
     * El perfilado del conjunto con el que se entrenó.
     *
     * Se guarda CON el modelo porque explica su veredicto, y dentro de seis
     * meses el histórico ya no será el mismo: «se rechazó por tener 14 periodos»
     * solo se puede sostener si queda escrito que en ese momento había 14.
     */
    dataProfile: jsonb("data_profile").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("ml_models_template_idx").on(t.template, t.status),
    uniqueIndex("ml_models_template_version_uq").on(t.template, t.version),
  ],
);

/**
 * Predicciones PERSISTIDAS.
 *
 * Nunca se calcula un modelo dentro de un render: una pantalla que depende de
 * un cálculo para pintarse hereda su latencia y su fallo. Se escribe aquí y la
 * UI lee una fila.
 *
 * Además, persistirlas es lo único que permite medirlas después. Una predicción
 * que solo existió en memoria durante un render no se puede comparar con lo que
 * pasó de verdad, y sin esa comparación no hay forma de saber si el modelo se
 * está degradando.
 */
export const mlPredictions = pgTable(
  "ml_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => mlModels.id, { onDelete: "cascade" }),
    /** Sobre qué se predice: `ticket`, `equipment`… */
    subjectType: varchar("subject_type", { length: 40 }).notNull(),
    /**
     * A QUIÉN se le hizo la predicción, en la identidad que use ese sujeto.
     *
     * Era `uuid` y dejó de serlo cuando la ontología llegó a compras. La
     * identidad de una refacción en este negocio es su NÚMERO DE PARTE, no una
     * llave interna: de 662 consumos registrados solo 6 coinciden con una fila
     * del catálogo, porque el resto son números que el técnico anotó en su
     * reporte y que el catálogo nunca tuvo. Exigir un uuid habría dejado fuera
     * al 99 % de la historia por respetar una llave que aquí no identifica nada.
     *
     * Los uuid siguen cabiendo: un texto de 120 los admite sin conversión.
     */
    subjectId: varchar("subject_id", { length: 120 }).notNull(),

    value: numeric("value", { precision: 12, scale: 2 }).notNull(),
    /** Banda de incertidumbre. Un número sin banda invita a creerle de más. */
    lower: numeric("lower", { precision: 12, scale: 2 }),
    upper: numeric("upper", { precision: 12, scale: 2 }),
    /** Cuántos casos históricos sostienen esta predicción en concreto. */
    support: integer("support"),
    /** Los rasgos con los que se predijo, para poder explicar el número. */
    features: jsonb("features").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ml_predictions_subject_idx").on(t.subjectType, t.subjectId),
    index("ml_predictions_model_idx").on(t.modelId, t.createdAt),
  ],
);

/**
 * Lo que pasó DE VERDAD.
 *
 * Es la tabla que casi todo producto con ML omite, y sin ella no se puede
 * responder la única pregunta que importa después del primer mes: ¿el modelo
 * sigue sirviendo? Un modelo entrenado con la operación de hace un año se
 * degrada sin avisar cuando cambia el mix de equipos o entra un cliente grande.
 * Sin resultado real registrado, esa degradación es invisible.
 *
 * Va aparte de `ml_predictions` porque el desenlace llega mucho después —a
 * veces semanas—, y mezclarlos obligaría a actualizar una fila que ya se
 * escribió. Una predicción es un hecho de su momento: no se corrige.
 */
export const mlOutcomes = pgTable(
  "ml_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id")
      .notNull()
      .references(() => mlPredictions.id, { onDelete: "cascade" }),
    /** Valor observado. */
    actual: numeric("actual", { precision: 12, scale: 2 }).notNull(),
    /** Error firmado: positivo = el modelo se quedó corto. */
    error: numeric("error", { precision: 12, scale: 2 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un desenlace por predicción: si llegan dos, alguien está reescribiendo
    // la historia y eso arruina cualquier medición de deriva.
    uniqueIndex("ml_outcomes_prediction_uq").on(t.predictionId),
    index("ml_outcomes_recorded_idx").on(t.recordedAt),
  ],
);

/**
 * Los PRONÓSTICOS emitidos, periodo por periodo.
 *
 * Tabla propia y no seis filas de `ml_predictions`, y la diferencia no es
 * cosmética: `ml_predictions` guarda una cifra por ENTIDAD para medir la deriva
 * contra un desenlace real —un ticket llevó estas horas, esta pieza volvió a
 * usarse en tantos días—. Meterle periodos futuros rompería ese cálculo sin
 * avisar, porque un mes no es una entidad y su desenlace tarda un mes en
 * existir.
 *
 * `issued_at` es lo que hace honesta a una proyección con el paso del tiempo:
 * permite comparar lo que se dijo en marzo con lo que pasó, sin que la versión
 * de hoy tape lo que la de marzo prometió. Un pronóstico es un hecho de su
 * momento y no se corrige — la misma regla que `ml_predictions`.
 */
export const mlForecasts = pgTable(
  "ml_forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => mlModels.id, { onDelete: "cascade" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** El periodo pronosticado, normalizado a su primer día. */
    period: date("period").notNull(),
    value: numeric("value", { precision: 16, scale: 2 }).notNull(),
    /** La banda. Un pronóstico sin banda invita a leerlo como certeza. */
    lower: numeric("lower", { precision: 16, scale: 2 }),
    upper: numeric("upper", { precision: 16, scale: 2 }),
    /** Qué pasó de verdad. Nulo hasta que el periodo cierre. */
    actual: numeric("actual", { precision: 16, scale: 2 }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /** Por entidad, cuando la serie se abre por pieza o por equipo. */
    subjectKey: varchar("subject_key", { length: 120 }),
  },
  (t) => [index("ml_forecasts_periodo_idx").on(t.period)],
);

/* ------------------------- Tipos ------------------------- */
/* User y Company se reexportan desde ./platform (arriba): son del plano de control. */
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
export type DomainEvent = typeof domainEvents.$inferSelect;
export type NewDomainEvent = typeof domainEvents.$inferInsert;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type PurchaseOrderStatus = (typeof purchaseOrderStatus.enumValues)[number];
export type Requisition = typeof requisitions.$inferSelect;
export type NewRequisition = typeof requisitions.$inferInsert;
export type RequisitionLine = typeof requisitionLines.$inferSelect;
export type RequisitionStatus = (typeof requisitionStatus.enumValues)[number];
export type SupplierInvoice = typeof supplierInvoices.$inferSelect;
export type NewSupplierInvoice = typeof supplierInvoices.$inferInsert;
export type SupplierPayment = typeof supplierPayments.$inferSelect;
export type SupplierInvoiceStatus =
  (typeof supplierInvoiceStatus.enumValues)[number];
export type SupplierCreditNote = typeof supplierCreditNotes.$inferSelect;
export type NewSupplierCreditNote = typeof supplierCreditNotes.$inferInsert;
export type SupplierCreditNoteApplication =
  typeof supplierCreditNoteApplications.$inferSelect;
export type SupplierCreditNoteStatus =
  (typeof supplierCreditNoteStatus.enumValues)[number];
export type SupplierInvoiceInstallment =
  typeof supplierInvoiceInstallments.$inferSelect;
export type SupplierAdvance = typeof supplierAdvances.$inferSelect;
export type SupplierAdvanceApplication =
  typeof supplierAdvanceApplications.$inferSelect;
export type SupplierAdvanceStatus =
  (typeof supplierAdvanceStatus.enumValues)[number];
export type PayableImport = typeof payableImports.$inferSelect;
export type PayableImportKind = (typeof payableImportKind.enumValues)[number];
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type FxRate = typeof fxRates.$inferSelect;
export type MlTemplate = typeof mlTemplates.$inferSelect;
export type NewMlTemplate = typeof mlTemplates.$inferInsert;
export type MlModel = typeof mlModels.$inferSelect;
export type NewMlModel = typeof mlModels.$inferInsert;
export type MlPrediction = typeof mlPredictions.$inferSelect;
export type MlOutcome = typeof mlOutcomes.$inferSelect;
export type MlModelStatus = (typeof mlModelStatus.enumValues)[number];

/**
 * DÓNDE SALE CADA ANÁLISIS.
 *
 * La asimetría que esta tabla existe para romper: las PREGUNTAS de ML siempre
 * fueron configurables —viven en `ml_templates`, hay constructor, se crean sin
 * tocar código—, mientras que los ANÁLISIS estaban clavados en una lista dentro
 * de `assistant.ts`. El usuario no podía añadir uno, ni apagar el que le
 * estorbaba, ni moverlo de pantalla, y el sistema no podía proponerle ninguno.
 * Dos mitades de la misma capa con dos reglas opuestas.
 *
 * Lo que se configura es la COLOCACIÓN, no el análisis: el catálogo de
 * `lib/ml/catalog.ts` sigue en código y curado, igual que los bloques de la
 * ontología. Nadie escribe consultas desde la interfaz.
 *
 * Sin filas no hay problema: `placements.ts` cae en la colocación de fábrica
 * del catálogo. Por eso esto no necesita semilla y el día que se despliega no
 * cambia nada — solo cuando alguien configura algo empiezan a existir filas.
 */
export const analysisPlacements = pgTable(
  "analysis_placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identificador del catálogo (`payables.calendar`). */
    analysis: varchar("analysis", { length: 60 }).notNull(),
    /** Prefijo de la pantalla (`/admin/compras`). */
    screen: varchar("screen", { length: 120 }).notNull(),
    /** Su sitio dentro de la pantalla. Menor primero. */
    position: integer("position").notNull().default(0),
    /**
     * Apagado explícito. Se guarda la fila en vez de borrarla para poder
     * distinguir «lo apagué» de «nunca lo configuré»: sin esa diferencia,
     * apagar un análisis de fábrica lo devolvería a la vida en la siguiente
     * carga, porque la ausencia de fila significa «usa el valor de fábrica».
     */
    active: boolean("active").notNull().default(true),
    /**
     * Quién lo colocó. `system` cuando lo aceptó una recomendación, para poder
     * responder «¿esto lo puse yo o me lo propuso el sistema?».
     */
    source: varchar("source", { length: 20 }).notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("analysis_placements_unique").on(t.analysis, t.screen),
    index("analysis_placements_screen_idx").on(t.screen, t.position),
  ],
);
