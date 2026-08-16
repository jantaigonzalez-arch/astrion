import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Migraciones del PLANO DE CONTROL: lo que existe una sola vez para toda la
 * plataforma y vive en `public` — identidades, inquilinos, membresías, bitácora.
 *
 *   npm run db:generate    genera el SQL a partir de platform.ts
 *   npm run db:migrate     lo aplica a `public`
 *
 * Las tablas de NEGOCIO **no** se generan desde aquí: se replican en el esquema
 * de cada inquilino y las lleva `drizzle.tenant.config.ts` → `drizzle-tenant/`.
 *
 * Hasta el paso 1.5 este archivo incluía también `schema.ts`, porque las tablas
 * de negocio todavía estaban en `public`. Cuando se movieron a `tenant_<slug>`
 * la configuración quedó desfasada y el generador empezó a proponer recrearlas
 * aquí — lo que habría roto la regla que sostiene el aislamiento (ninguna tabla
 * de negocio en `public`, para que una consulta sin inquilino falle en vez de
 * devolver datos equivocados en silencio).
 *
 * Los enums de negocio SÍ viven en `public`, y eso es deliberado: las
 * migraciones de inquilino los crean calificados (`CREATE TYPE "public"."…"`)
 * para compartir un solo tipo entre todos los esquemas. Los gobierna
 * `drizzle-tenant/`, así que este archivo no debe verlos ni intentar borrarlos.
 */
export default defineConfig({
  schema: ["./src/lib/db/platform.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
