import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  // Plano de control (public) y tablas de negocio. Ambos se generan juntos
  // mientras dura la Fase 1: las de negocio todavía viven en `public` y se
  // mueven a los esquemas por inquilino en el paso 1.5.
  schema: ["./src/lib/db/platform.ts", "./src/lib/db/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
