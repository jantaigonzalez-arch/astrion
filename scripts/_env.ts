/**
 * Carga las variables de entorno ANTES que cualquier otro módulo.
 *
 * Existe como archivo aparte por una razón concreta: `src/lib/db/index.ts` lee
 * `process.env.DATABASE_URL` al evaluarse, y los `import` se ejecutan antes que
 * el cuerpo del módulo que los declara. Llamar a dotenv dentro del script llega
 * tarde. Importando ESTE módulo primero, el entorno ya está puesto cuando se
 * evalúa la capa de base de datos.
 *
 *   import "./_env";              // ← siempre el primer import
 *   import { getDb } from "../src/lib/db";
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true }); // .env, si existe, sin pisar lo anterior
