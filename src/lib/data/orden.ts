import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Orden } from "@/lib/listado";

/**
 * De una llave de orden a un `ORDER BY` que no muerde.
 *
 * ── POR QUÉ NO SE ESCRIBE EN CADA CONSULTA ────────────────────────────────
 *
 * Porque un `order by` correcto en un listado PAGINADO lleva dos cosas que es
 * fácil olvidar, y las dos fallan en silencio:
 *
 *   `nulls last` en las DOS direcciones. La mitad de los tickets no tiene plazo
 *   de SLA y muchos proveedores no tienen última compra: ordenar por esa
 *   columna hacia abajo empieza por doscientos huecos. Lo vacío va al final se
 *   mire como se mire, y Postgres por omisión lo pone primero al descender.
 *
 *   Un DESEMPATE estable. Sin él, dos filas con el mismo valor pueden salir en
 *   distinto orden en dos consultas, y con paginación eso significa que una
 *   fila aparece en la página 1 y otra vez en la 2 mientras una tercera no sale
 *   nunca. No es teórico: pasa en cuanto se ordena por una columna con
 *   repetidos, que es casi cualquiera que no sea el folio.
 *
 * `lib/data/tickets.ts` ya lo hacía bien y a mano. Esto es lo mismo, extraído
 * para que las otras pantallas no tengan que acordarse — que es precisamente
 * la clase de detalle que nadie recuerda al escribir la sexta.
 *
 * ── SEGURO POR CONSTRUCCIÓN ───────────────────────────────────────────────
 *
 * El campo no llega como texto: llega como llave de un mapa que declara quien
 * consulta. Lo que venga en `?orden=` ya lo filtró `parseOrden` contra ese
 * mismo catálogo, así que aquí no puede entrar una columna inventada. Ver la
 * cabecera de `lib/listado.ts`.
 *
 * Vive en `data/` y no en `listado.ts` porque importa drizzle, y a `listado.ts`
 * lo carga un componente de cliente —el filtro de columna—: meter el motor de
 * consultas ahí lo mandaría entero al navegador.
 */
export function ordenarPor<K extends string>(
  orden: Orden<K>,
  columnas: Record<K, SQL | SQL.Aliased | { name: string }>,
  /** La columna que rompe empates. Casi siempre la clave, o el folio. */
  desempate: SQL | SQL.Aliased | { name: string },
): SQL[] {
  const col = columnas[orden.campo];
  const dir = orden.dir === "asc" ? sql`asc` : sql`desc`;
  return [
    sql`${col} ${dir} nulls last`,
    // Descendente siempre: el desempate no es información, es estabilidad, y
    // que sea el mismo en las dos direcciones hace la paginación reproducible.
    sql`${desempate} desc`,
  ];
}
