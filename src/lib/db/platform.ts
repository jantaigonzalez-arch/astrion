import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  jsonb,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * PLANO DE CONTROL — tablas que viven en el esquema `public`.
 *
 * Es la frontera del producto: aquí está lo que la PLATAFORMA sabe (qué
 * inquilinos existen, quién es quién, quién puede entrar a dónde), mientras que
 * los datos de negocio de cada inquilino viven en su propio esquema de Postgres
 * (`tenant_<slug>`), aislados físicamente.
 *
 * Regla que hace segura toda la arquitectura: NINGUNA tabla de negocio existe
 * en `public`. Si una consulta se ejecuta sin inquilino activo, Postgres
 * responde "relation does not exist" — un error ruidoso, nunca los datos de
 * otro cliente. La ausencia es el mecanismo de seguridad.
 *
 * Estas tablas se consultan con `getDb()` directo, SIN inquilino activo: son
 * justamente lo que hay que leer para saber cuál es el inquilino.
 */

/* ------------------------- Enums del plano de control ------------------------- */

export const tenantStatus = pgEnum("tenant_status", [
  "trial",
  "active",
  "suspended", // falta de pago o incumplimiento: entra en solo lectura
  "cancelled", // baja; el esquema se conserva hasta cumplir la retención
]);

/**
 * Rol DENTRO de un inquilino. Reemplaza a `users.role`, que era global y por
 * tanto incompatible con que una persona atienda a dos clientes con papeles
 * distintos (agente en uno, administrador en otro).
 *
 * `owner` es nuevo: quien puede facturar, invitar administradores y dar (o
 * revocar) el consentimiento de datos para modelos globales. Esa última
 * facultad no debería ser de cualquier administrador.
 */
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "agent",
  "sales",
  "client",
]);

/* ------------------------- Identidad ------------------------- */

/**
 * Rol heredado, global. Se conserva mientras la Fase 1 migra las 45 páginas y
 * las acciones a leer el rol desde `memberships`. Al terminar 1.6 se elimina la
 * columna `users.role`; hasta entonces las dos conviven y `memberships` manda.
 */
export const userRole = pgEnum("user_role", ["admin", "agent", "client", "sales"]);

/**
 * La persona, única en TODA la plataforma. El correo es único global a
 * propósito: una identidad, muchas membresías. Es lo que permite que un
 * consultor entre con la misma cuenta a dos laboratorios y cambie de uno a otro
 * con un selector, en vez de tener dos contraseñas.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  // Null = la cuenta existe pero no puede iniciar sesión (auth.ts lo exige).
  // Así se importan padrones de clientes sin abrirles acceso por accidente.
  passwordHash: text("password_hash"),
  role: userRole("role").notNull().default("client"), // heredado, ver nota arriba
  company: varchar("company", { length: 200 }),
  phone: varchar("phone", { length: 40 }),
  active: boolean("active").notNull().default(true),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------- Inquilinos ------------------------- */

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identificador legible y estable. Base del nombre del esquema. */
    slug: varchar("slug", { length: 40 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    status: tenantStatus("status").notNull().default("trial"),
    plan: varchar("plan", { length: 40 }).notNull().default("poc"),

    /* --- Consentimiento de datos para modelos globales ---
     * Apagado por defecto, y esa es la postura correcta: el dato de un
     * laboratorio farmacéutico no sale de su esquema salvo decisión explícita.
     * Se guarda quién y cuándo porque es un consentimiento revocable que hay
     * que poder demostrar en una auditoría. */
    mlContribution: boolean("ml_contribution").notNull().default(false),
    mlConsentAt: timestamp("ml_consent_at", { withTimezone: true }),
    mlConsentBy: uuid("ml_consent_by").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tenants_status_idx").on(t.status)],
);

/**
 * Mapa inquilino → esquema físico.
 *
 * Existe como tabla y no se deriva del slug por dos razones concretas:
 * renombrar un inquilino no debe implicar renombrar su esquema (una operación
 * que rompe conexiones vivas), y cada esquema necesita registrar SU PROPIA
 * versión de migración — con N esquemas, una migración puede quedar aplicada en
 * unos y no en otros, y hay que poder saber en cuáles.
 */
export const tenantSchemas = pgTable(
  "tenant_schemas",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** Identificador real de Postgres, p. ej. `tenant_evoelution`. Máx. 63. */
    schemaName: varchar("schema_name", { length: 63 }).notNull().unique(),
    /** Última migración de inquilino aplicada A ESTE esquema. */
    migratedVersion: varchar("migrated_version", { length: 120 }),
    migratedAt: timestamp("migrated_at", { withTimezone: true }),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("tenant_schemas_version_idx").on(t.migratedVersion)],
);

/** Qué papel juega una persona en un inquilino. Una fila por combinación. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("client"),
    active: boolean("active").notNull().default(true),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Una persona tiene UN rol por inquilino; dos filas serían ambiguas.
    uniqueIndex("memberships_user_tenant_idx").on(t.userId, t.tenantId),
    // "¿a qué inquilinos pertenece esta persona?" — se resuelve en cada login.
    index("memberships_user_idx").on(t.userId, t.active),
    // "¿quiénes son los miembros de este inquilino?" — pantalla de usuarios.
    index("memberships_tenant_idx").on(t.tenantId, t.active),
  ],
);

/* ------------------------- Empresas (entidades legales) ------------------------- */

/**
 * Entidad legal que emite documentos, DENTRO de un inquilino.
 *
 * Dos niveles a propósito: el inquilino es la frontera de aislamiento y de
 * facturación del SaaS; la empresa es quien tiene RFC y emite CFDI. Un grupo
 * con dos razones sociales necesita ver su operación consolidada bajo un solo
 * inquilino, y a la vez facturar por separado.
 *
 * Vive en `public` y no en el esquema del inquilino porque las tablas de
 * negocio la referencian por FK, y una FK entre esquemas necesita que el
 * destino esté en un lugar fijo.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable durante la Fase 1: las empresas existentes se adoptan al crear
    // el inquilino de Evoelution. Pasa a NOT NULL al cerrar 1.5.
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "restrict",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legal_name", { length: 240 }),
    /** RFC en México. Requisito para timbrar CFDI. */
    taxId: varchar("tax_id", { length: 20 }),
    /** Moneda funcional: en la que se llevan los libros de esta empresa. */
    functionalCurrency: varchar("functional_currency", { length: 3 })
      .notNull()
      .default("MXN"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("companies_tenant_idx").on(t.tenantId)],
);

/* ------------------------- Auditoría del plano de control ------------------------- */

/**
 * Bitácora de la plataforma: altas de inquilino, cambios de plan, consentimiento
 * de datos, aprovisionamiento de esquemas.
 *
 * Separada de `domain_events` a propósito: aquélla vive DENTRO del esquema de
 * cada inquilino y describe su negocio; ésta describe la plataforma y debe
 * sobrevivir aunque un inquilino se dé de baja y su esquema se elimine.
 */
export const platformEvents = pgTable(
  "platform_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    /** 'tenant.provisioned' | 'tenant.ml_consent_granted' | 'tenant.migrated'… */
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("platform_events_tenant_idx").on(t.tenantId, t.occurredAt),
    index("platform_events_type_idx").on(t.eventType, t.occurredAt),
  ],
);

/* ------------------------- Tipos ------------------------- */

export type User = typeof users.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantSchema = typeof tenantSchemas.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type Company = typeof companies.$inferSelect;
export type PlatformEvent = typeof platformEvents.$inferSelect;

/* ------------------------- Utilidades ------------------------- */

/**
 * Nombre de esquema a partir del slug. Se valida en vez de escaparse porque el
 * nombre de un esquema NO puede parametrizarse en SQL: termina interpolado en
 * un `CREATE SCHEMA` o un `SET search_path`. Un slug con comillas o punto y
 * coma sería inyección directa, así que la lista blanca es la defensa.
 */
export function schemaNameFor(slug: string): string {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(slug)) {
    throw new Error(
      `Slug de inquilino inválido: ${JSON.stringify(slug)}. Solo minúsculas, dígitos y guion bajo, empezando por letra (2–40).`,
    );
  }
  const name = `tenant_${slug}`;
  if (name.length > 63) {
    throw new Error(`El nombre de esquema "${name}" excede los 63 caracteres de Postgres.`);
  }
  return name;
}

/** Esquemas reservados: ningún inquilino puede llamarse así. */
export const RESERVED_SLUGS = new Set([
  "public",
  "information_schema",
  "pg_catalog",
  "pg_toast",
  "drizzle",
  "admin",
  "api",
  "www",
  "app",
]);
