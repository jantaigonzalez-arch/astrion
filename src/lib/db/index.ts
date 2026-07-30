import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Cliente Drizzle perezoso. Si DATABASE_URL no está configurada,
 * `isDbConfigured` es false y las features que requieren DB degradan
 * con elegancia (p. ej. el formulario de contacto responde OK sin persistir).
 */
const connectionString = process.env.DATABASE_URL;

export const isDbConfigured = Boolean(connectionString);

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está configurada. Copia .env.example a .env.local y define la conexión Postgres.",
    );
  }
  if (!_db) {
    const client = postgres(connectionString, { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };

type Db = ReturnType<typeof getDb>;

/**
 * Cliente o transacción, indistintamente. Permite que un helper de dominio
 * (registrar un evento, mover inventario) se invoque suelto o dentro de un
 * `db.transaction(...)` sin duplicar la implementación.
 *
 * El tipo de la transacción se deriva de la firma de `db.transaction` en vez
 * de escribirse a mano: así no se desincroniza al actualizar drizzle.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
