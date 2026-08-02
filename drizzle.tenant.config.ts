import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Migraciones de las tablas de NEGOCIO, las que se replican en el esquema de
 * cada inquilino (`tenant_<slug>`).
 *
 *   npm run db:generate:tenant     genera el SQL a partir de schema.ts
 *   npx tsx scripts/tenant-migrate.ts    lo aplica a TODOS los esquemas
 *
 * El SQL sale sin calificar el esquema, y ahí está el truco: el runner lo
 * aplica con `SET search_path TO tenant_x`, así que el mismo archivo sirve para
 * todos los inquilinos.
 *
 * `tablesFilter` excluye el plano de control (public): esas tablas existen una
 * sola vez para toda la plataforma, y las de negocio las referencian por FK
 * cruzando esquemas —algo que Postgres permite sin problema dentro de la misma
 * base—.
 */
const PLATFORM_TABLES = [
  "users",
  "tenants",
  "tenant_schemas",
  "memberships",
  "companies",
  "platform_events",
];

export default defineConfig({
  schema: ["./src/lib/db/schema.ts"],
  out: "./drizzle-tenant",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  tablesFilter: PLATFORM_TABLES.map((t) => `!${t}`),
  verbose: true,
  strict: true,
});
