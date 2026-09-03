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
  bigint,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { RUTAS_DE_PRIMER_NIVEL } from "@/lib/tenancy/host";

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

/**
 * Rol DE PLATAFORMA: quien opera el SaaS, por encima de los inquilinos.
 *
 * Es una dimensión distinta de `membershipRole`, no un valor más de esa lista.
 * Un dueño de cuenta manda en SU empresa y no debe ver ninguna otra; un
 * superadministrador ve todas y puede entrar a cualquiera. Meterlos en el mismo
 * enum haría que un error de comparación convirtiera a un cliente en operador
 * de la plataforma.
 *
 * · superadmin — alta de inquilinos, entrar a cualquiera, ver la bitácora
 * · support    — entra a un inquilino solo para diagnosticar; sin altas
 *
 * Nulo en la enorme mayoría de las cuentas: son usuarios de un cliente.
 */
export const platformRole = pgEnum("platform_role", ["superadmin", "support"]);

/** Ciclo de vida de una solicitud de alta. Ver `tenantSignups`. */
export const signupStatus = pgEnum("signup_status", [
  "pending",
  "approved",
  "rejected",
]);

/* ------------------------- Identidad ------------------------- */

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
  company: varchar("company", { length: 200 }),
  phone: varchar("phone", { length: 40 }),
  active: boolean("active").notNull().default(true),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * QUIEN OPERA ASTRAION. Tabla aparte, y no una columna de `users`.
 *
 * ── POR QUÉ SE SEPARÓ ──────────────────────────────────────────────────────
 *
 * Antes era `users.platform_role`: una columna nula en 137 de 138 cuentas, que
 * convertía la misma fila en «trabajo en esta empresa» y «opero el producto».
 * En bajío eso se veía en su forma más pura — el único operador del SaaS era
 * `admin@evoelution.com`, que ADEMÁS tenía dos membresías en empresas. La misma
 * contraseña abría la consola de todos los clientes y el portal de uno.
 *
 * Ahora son dos identidades y dos credenciales, aunque sean la misma persona.
 * Operar la plataforma es un trabajo distinto de usarla, y entrar a hacer uno u
 * otro tiene que ser un acto distinto.
 *
 * ── LA CONSECUENCIA QUE SOSTIENE TODO LO DEMÁS ─────────────────────────────
 *
 * Un operador NO existe para los esquemas de inquilino. Las 33 columnas de
 * negocio que apuntan a `users` —`created_by_id`, `actor_id`, `owner_id`…— no
 * pueden recibir un id de aquí, y eso no es una limitación que haya que
 * recordar: es la razón por la que entrar a una empresa es de SOLO LECTURA.
 * La conexión que recibe un operador se abre con `default_transaction_read_only`,
 * así que Postgres rechaza la escritura antes de que ninguna foránea se entere.
 * Ver `tenancy/context.ts`.
 *
 * Las dos columnas que sí registran a un operador —quién entró a una empresa y
 * quién aprobó un alta— apuntan aquí, que es donde siempre debieron apuntar.
 */
export const platformUsers = pgTable("platform_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }),
  /**
   * Único entre operadores, y SIN relación con `users.email`.
   *
   * Que el mismo correo exista en las dos tablas es correcto y esperado: son
   * dos cuentas de la misma persona para dos trabajos. Cruzarlas —buscar en
   * ambas al iniciar sesión, o prohibir el duplicado— devolvería por la puerta
   * de atrás la confusión que esta tabla existe para deshacer.
   */
  email: varchar("email", { length: 255 }).notNull().unique(),
  /** Null = la cuenta existe y no puede entrar. Igual que en `users`. */
  passwordHash: text("password_hash"),
  role: platformRole("role").notNull(),
  active: boolean("active").notNull().default(true),
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

    /* --- Marca de la empresa ---
     * Vive en el plano de control, y no en los `settings` de su esquema, por
     * una razón concreta: la pantalla de acceso tiene que pintarla ANTES de
     * que haya sesión, y sin sesión no hay conexión al esquema del inquilino.
     *
     * Nulo = todavía no subió logo. Se cae a un monograma con su inicial,
     * NUNCA a la marca de otra empresa: ver el logo de Evoelution en el portal
     * de ACME es exactamente el error que esto viene a corregir. */
    logoUrl: text("logo_url"),
    /** Nombre corto para la barra lateral, si el legal es muy largo. */
    brandName: varchar("brand_name", { length: 60 }),

    /**
     * Prefijo de los folios de esta empresa: `EVO-000123`, `ACM-000045`.
     *
     * Estaba clavado como "EVO-" en el código, y era el mismo error que el
     * logo en otra capa: el primer ticket de ACME habría nacido `EVO-000001`.
     *
     * Se guarda aquí, junto a la marca, porque es marca: el folio es lo que el
     * cliente escribe en un correo y lo que aparece en el reporte de servicio
     * firmado. Cambiarlo NO reescribe los folios ya emitidos —un documento
     * emitido no se altera—, así que la empresa termina con dos series si lo
     * cambia a medio camino. Por eso la UI lo advierte.
     */
    folioPrefix: varchar("folio_prefix", { length: 8 }),

    /* --- Desde qué dirección avisa esta empresa ---
     *
     * Vive en el plano de control y no en los `settings` de su esquema por lo
     * mismo que la marca: para mandar un correo hay que saber el remitente
     * ANTES de abrir la conexión al inquilino, y a veces sin petición ninguna
     * —un aviso disparado por un proceso de fondo—.
     *
     * `mailDomain` es el dominio que el cliente publica en su DNS; `mailFrom`
     * la dirección concreta. `mailVerifiedAt` es la fecha en que el proveedor
     * confirmó los registros, y es lo que decide si se usa: un dominio a medio
     * verificar manda correo que acaba en spam y quema la reputación de todos
     * los demás. Sin verificar, el aviso sale por el remitente de la
     * plataforma; ver `remitenteDe` en `lib/mail`.
     *
     * `mailReplyTo` es el buzón real de la empresa. Es lo que hace que cuando
     * el cliente final le da a Responder, la respuesta le llegue a alguien y
     * no a un buzón de sistema que nadie lee. */
    mailDomain: varchar("mail_domain", { length: 255 }),
    mailFrom: varchar("mail_from", { length: 255 }),
    mailFromName: varchar("mail_from_name", { length: 120 }),
    mailReplyTo: varchar("mail_reply_to", { length: 255 }),
    mailVerifiedAt: timestamp("mail_verified_at", { withTimezone: true }),

    /* --- El buzón propio de la empresa (SMTP) ---
     *
     * La alternativa a que cada cliente pelee con su DNS: escribe el correo y
     * la contraseña de un buzón que YA tiene, y el sistema envía a través de
     * él. Sale de su servidor, lo firma su proveedor —así que SPF y DKIM ya
     * están bien sin tocar nada— y le queda en Enviados.
     *
     * `smtpPassword` va CIFRADA (ver `lib/secretos`). Es el dato más peligroso
     * de esta base: abre el buzón entero de un cliente. No se devuelve nunca a
     * la interfaz ni aparece en ningún registro.
     *
     * Cuando hay SMTP configurado manda sobre todo lo demás: es el remitente
     * que el cliente eligió a mano. */
    smtpHost: varchar("smtp_host", { length: 255 }),
    smtpPort: integer("smtp_port"),
    smtpUser: varchar("smtp_user", { length: 255 }),
    smtpPassword: text("smtp_password"),
    /** Última vez que una prueba de envío funcionó. Null = sin comprobar. */
    smtpCheckedAt: timestamp("smtp_checked_at", { withTimezone: true }),

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

/* ------------------------- Solicitudes de alta ------------------------- */

/**
 * Empresa que pidió entrar, ANTES de ser inquilino.
 *
 * Tabla aparte de `tenants` a propósito: un inquilino cuesta un esquema de
 * Postgres con decenas de tablas, y crear uno por cada formulario que alguien
 * llena en la web dejaría la base sembrada de esquemas vacíos —caros de listar,
 * de migrar y de borrar—. Aquí la solicitud es solo una fila; el esquema nace
 * al aprobarla.
 *
 * También separa dos cosas que no son la misma: quién PIDIÓ (dato declarado por
 * un desconocido, sin verificar) y quién ES cliente. El correo de esta tabla no
 * es una identidad: no crea usuario ni permite iniciar sesión. Eso ocurre en la
 * aprobación, y por eso `email` no es único aquí — la misma persona puede pedir
 * dos veces, y el historial de sus intentos es justamente lo que hay que ver.
 */
export const tenantSignups = pgTable(
  "tenant_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    companyName: varchar("company_name", { length: 160 }).notNull(),
    /** Identificador propuesto. Sugerencia: al aprobar se puede corregir. */
    desiredSlug: varchar("desired_slug", { length: 40 }),
    contactName: varchar("contact_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    /** Rango de personas: es lo que decide si el producto le queda. */
    size: varchar("size", { length: 40 }),
    industry: varchar("industry", { length: 120 }),
    note: text("note"),
    /** Idioma en que llegó: define en cuál se le responde. */
    locale: varchar("locale", { length: 5 }).notNull().default("es"),

    status: signupStatus("status").notNull().default("pending"),
    /** El inquilino que nació de esta solicitud, si se aprobó. */
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    /** Quién la revisó: es personal de Astraion, no de ninguna empresa. */
    reviewedBy: uuid("reviewed_by").references(() => platformUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Motivo del rechazo. Se guarda para poder sostener la decisión después. */
    rejectionReason: text("rejection_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // La bandeja: "qué está pendiente, lo más viejo primero".
    index("tenant_signups_status_idx").on(t.status, t.createdAt),
    // "¿este correo ya había pedido antes?" — se consulta en cada envío.
    index("tenant_signups_email_idx").on(t.email),
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
    /**
     * Quién lo hizo, y siempre es personal de Astraion: esta bitácora registra
     * a la plataforma operando sobre los inquilinos —quién entró a la empresa
     * de un cliente y cuándo—, no lo que hace la gente dentro de la suya. Eso
     * último vive en los eventos de dominio de cada esquema.
     */
    actorId: uuid("actor_id").references(() => platformUsers.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("platform_events_tenant_idx").on(t.tenantId, t.occurredAt),
    index("platform_events_type_idx").on(t.eventType, t.occurredAt),
  ],
);

/* ------------------------- Plano analítico ------------------------- */

/**
 * Qué se extrajo de cada inquilino hacia el lago, y hasta dónde.
 *
 * Es la contabilidad del extractor incremental, y vive en `public` por la misma
 * razón que `platform_events`: describe a la plataforma operando sobre los
 * inquilinos, no el negocio de ninguno. Además tiene que sobrevivir a que un
 * esquema de inquilino se elimine — si no, quedarían archivos parquet en el
 * lago sin nadie que sepa de dónde salieron.
 *
 * El marcador de agua de un inquilino es `max(to_event_id)`. Se guarda por lote
 * y no como un solo número mutable a propósito: un contador que se sobrescribe
 * no deja saber qué archivo cubre qué rango, y en el momento en que alguien
 * pregunte "¿con qué datos se entrenó este modelo?" —que es el disparador que
 * tu arquitectura fija para adoptar Iceberg— la respuesta tiene que ser una
 * lista de archivos, no una fecha.
 */
export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    /** Último `domain_events.id` YA extraído antes de este lote (exclusivo). */
    fromEventId: bigint("from_event_id", { mode: "number" }).notNull(),
    /** Último `domain_events.id` incluido en este lote (inclusivo). */
    toEventId: bigint("to_event_id", { mode: "number" }).notNull(),

    rows: integer("rows").notNull(),
    /** Ruta relativa dentro del lago. Nunca absoluta: el lago se puede mover. */
    path: varchar("path", { length: 300 }).notNull(),
    bytes: integer("bytes").notNull(),

    /**
     * Si el inquilino tenía consentimiento de ML **en el momento de extraer**.
     *
     * Se congela para poder auditar. NO es lo que decide si el dato entra a un
     * entrenamiento global: eso se evalúa contra el consentimiento VIGENTE al
     * leer. La diferencia importa — un consentimiento que solo se pudiera
     * revocar borrando archivos no sería revocable de verdad.
     */
    consentedAtExtraction: boolean("consented_at_extraction").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "¿por dónde iba este inquilino?" — la pregunta de cada corrida.
    index("analytics_snapshots_tenant_idx").on(t.tenantId, t.toEventId),
    // Un lote no se extrae dos veces: si la corrida se repite, choca aquí en
    // vez de duplicar filas en el lago.
    uniqueIndex("analytics_snapshots_range_idx").on(t.tenantId, t.toEventId),
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
export type TenantSignup = typeof tenantSignups.$inferSelect;
export type SignupStatus = (typeof signupStatus.enumValues)[number];

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

/**
 * Prefijo de folio sugerido a partir del nombre: "ACME Laboratorios" → "ACM".
 *
 * Es solo una propuesta para el alta; la empresa puede cambiarlo después. Se
 * quitan los acentos antes de recortar para que "Álvarez" dé "ALV" y no algo
 * roto, y se cae a "ORG" cuando el nombre no deja ninguna letra utilizable
 * (por ejemplo, un nombre escrito solo con dígitos o símbolos).
 */
export function suggestFolioPrefix(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return letters.slice(0, 3) || "ORG";
}

/** Formato exigido al prefijo: 2–8 caracteres, mayúsculas y dígitos. */
export const FOLIO_PREFIX_RE = /^[A-Z][A-Z0-9]{1,7}$/;

/**
 * Identificadores reservados: ningún inquilino puede llamarse así.
 *
 * Dos motivos distintos conviven aquí. Los de Postgres son para que el esquema
 * del inquilino no choque con los del catálogo. Los de ruteo son los
 * peligrosos: con el inquilino en la URL (`/evoelution/tickets`), un inquilino
 * llamado «productos» secuestraría `/productos` del sitio público.
 *
 * ── LA MITAD DE RUTEO YA NO SE ESCRIBE AQUÍ ──────────────────────────────
 *
 * Se DERIVA de `RUTAS_DE_PRIMER_NIVEL`. Antes esta lista y el `NOT_A_TENANT`
 * del proxy eran dos copias con un comentario que pedía mantenerlas en línea a
 * mano, y no lo estaban: a las dos les faltaba `consola`, la puerta de quien
 * opera Astraion. Nada impedía registrar un inquilino con ese nombre.
 *
 * Los guiones se vuelven guiones bajos porque el formato de un slug —el mismo
 * que exige `schemaNameFor`— no admite guiones: la ruta `/evo-ai` solo puede
 * chocar con el slug `evo_ai`, y es ése el que hay que reservar. La entrada se
 * escribía así a mano; ahora sale de la ruta y no puede desalinearse.
 */
const RUTEO_RESERVADO = RUTAS_DE_PRIMER_NIVEL.map((r) => r.replaceAll("-", "_"));

export const RESERVED_SLUGS = new Set([
  // Postgres: un esquema no puede chocar con los del catálogo.
  "public",
  "information_schema",
  "pg_catalog",
  "pg_toast",
  "drizzle",
  // Nombres que un subdominio o una URL da por sentados. No son rutas de la
  // aplicación, así que no salen de la lista derivada.
  "admin",
  "api",
  "www",
  "app",
  // Las rutas de primer nivel, en forma de slug.
  ...RUTEO_RESERVADO,
]);
