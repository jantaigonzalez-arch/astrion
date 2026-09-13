import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { clienteValidacionSat, crmOrganizations } from "@/lib/db/schema";
import { getSettings } from "@/lib/data/settings";
import { decision69b } from "@/lib/politica-clientes";

/**
 * ¿LA EMPRESA BLOQUEA ESTO POR LA LISTA 69-B? (0038)
 *
 * La lista 69-B del SAT es la de contribuyentes con operaciones presuntamente
 * inexistentes. Qué se hace con un cliente que aparece en ella —nada, avisar o
 * bloquear— lo decide cada empresa en Configuración → Clientes; aquí solo se
 * hace cumplir el `bloquear`, en lo que se da de alta NUEVO: un contrato o un
 * ticket. El `avisar` lo pinta la ficha de la organización, y lo ya firmado no
 * se toca: bloquear hacia atrás dejaría a medias trabajo que ya se aceptó.
 *
 * Se hace aquí y no en la pantalla por lo de siempre: la acción de contratos y
 * las dos de tickets se pueden llamar sin pasar por ningún formulario.
 *
 * El cliente llega como su CUENTA DE PORTAL, que es como lo nombran contratos y
 * tickets; el estatus vive en `cliente_validacion_sat`, por organización. Sin
 * organización enlazada o sin expediente, no hay estatus que mirar y no se
 * bloquea — no se inventa un «listado» que nadie capturó.
 *
 * Devuelve el motivo si se bloquea y `null` si no, como `firmaValida()`.
 */
export async function vetoLista69b(
  db: DbOrTx,
  clientUserId: string,
  que: "contratos" | "tickets",
): Promise<string | null> {
  /*
    TODAS las organizaciones de la cuenta, no la primera. `client_id` no es único
    en la base —lo mantiene 1:1 `enforceSingleClientLink`, no un índice—, y con
    `limit 1` sin orden una cuenta enlazada a dos se bloqueaba o no según cuál
    saliera primero. Si CUALQUIERA lo exige, se bloquea. Lo señaló
    `_probe-acciones-clientes-config`.
  */
  const filas = await db
    .select({ nombre: crmOrganizations.name, estatus: clienteValidacionSat.lista69b })
    .from(crmOrganizations)
    .innerJoin(clienteValidacionSat, eq(clienteValidacionSat.organizationId, crmOrganizations.id))
    .where(eq(crmOrganizations.clientId, clientUserId));
  if (filas.length === 0) return null;

  const { clientes69b } = await getSettings(db);
  const fila = filas.find((f) => decision69b(f.estatus, clientes69b) === "bloquear");
  if (!fila) return null;

  return (
    `«${fila.nombre}» está en la lista 69-B del SAT como ${fila.estatus}, y tu empresa ` +
    `no permite ${que} nuevos con clientes así. Se configura en Configuración → Clientes.`
  );
}
