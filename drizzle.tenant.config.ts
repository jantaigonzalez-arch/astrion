import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Migraciones de las tablas de NEGOCIO, las que se replican en el esquema de
 * cada inquilino (`tenant_<slug>`).
 *
 *   npx tsx scripts/tenant.ts migrate    aplica lo pendiente a TODOS los esquemas
 *
 * ⚠ El SQL de este directorio se escribe A MANO desde `0013`, y no queda otra:
 * la cadena de instantáneas de `meta/` se cortó ahí —hay journal hasta la 19
 * pero snapshots solo hasta la 12—, así que `drizzle-kit generate` con esta
 * configuración compara contra el estado de la 0012 y propone CREAR de nuevo
 * todo lo que vino después. Esa migración fallaría al aplicarse, porque las
 * tablas ya existen. Comprobado el 2026-08-25.
 *
 * Para volver a generarlas habría que reconstruir las instantáneas 0013–0019;
 * mientras tanto, el `.sql` nuevo se escribe a mano y se añade su entrada al
 * `meta/_journal.json`.
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
