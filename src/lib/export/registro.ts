import "server-only";
import type { DbOrTx } from "@/lib/db";
import type { Modulo } from "@/lib/permisos";
import type { Columna } from "./formatos";

/**
 * QUÉ SE PUEDE DESCARGAR DE CADA MÓDULO.
 *
 * ── LA REGLA QUE SOSTIENE TODO ESTO ────────────────────────────────────────
 *
 * Un dataset llama a LA MISMA función de datos que usa su pantalla, con los
 * mismos filtros ya interpretados. No escribe su propia consulta.
 *
 * Es la única forma de que «descargar» signifique de verdad «lo que estoy
 * viendo». Con una consulta propia, la pantalla y el archivo empiezan iguales y
 * se separan en el primer cambio que alguien haga en una sola de las dos — y la
 * discrepancia no falla: produce un archivo que parece bien y no cuadra con lo
 * que la persona tenía delante. Eso, en un ERP, es un correo al contador con
 * cifras que no coinciden con el sistema.
 *
 * De ahí también que el filtrado NO viva aquí: los `searchParams` se
 * interpretan con los mismos ayudantes que la pantalla —`parseOrden`,
 * `parseFiltro`, `parsePage`— dentro de cada `filas()`.
 *
 * ── EL TOPE ────────────────────────────────────────────────────────────────
 *
 * Ninguna descarga pasa de `TOPE_FILAS`, y al superarlo NO se recorta: se
 * rechaza con un mensaje que dice cuántas filas hay y que hay que filtrar. Un
 * archivo truncado en silencio es peor que ninguno — quien lo recibe suma una
 * columna, le da un total que no es, y no tiene forma de enterarse.
 *
 * El número sale de una medición y no de la intuición: generar el .xlsx es
 * trabajo SÍNCRONO que bloquea el bucle de eventos de Node, o sea que mientras
 * dura, TODA otra petición del servidor espera. Medido en esta máquina, 20 000
 * filas tardan 173 ms y 5 000 tardan 48 ms. Veinte mil es el punto donde el
 * bloqueo sigue siendo tolerable y ya deja seis veces de holgura sobre la tabla
 * más grande del inquilino de hoy (3 240 filas).
 *
 * Si algún día hace falta más, lo que hay que cambiar NO es este número: es
 * sacar la generación del hilo que atiende peticiones.
 */
export const TOPE_FILAS = 20_000;

export type ContextoExtraccion = {
  /** Los `searchParams` de la pantalla, tal cual. */
  sp: Record<string, string | undefined>;
  /** Conexión de SOLO LECTURA. Ver `tenantDbReadOnly`. */
  db: DbOrTx;
  /** Quién descarga, para los datasets que acotan por persona. */
  userId: string | null;
  /** Si administra el módulo: decide si ve todo o solo lo suyo. */
  administra: boolean;
};

/**
 * La llave de una columna en la URL: `folio`, `dias-de-atraso`.
 *
 * Se deriva del título en vez de declararse a mano. Una lista de identificadores
 * escrita aparte es una lista que se desincroniza el día que alguien renombra
 * una columna y no toca la otra mitad — y el síntoma sería una descarga a la
 * que le falta justo la columna que se pidió.
 *
 * El precio es que renombrar un título cambia su llave. Es aceptable porque
 * estas URLs no se guardan: se arman en el diálogo cada vez, y una llave que ya
 * no existe se ignora al validar.
 */
export function llaveDeColumna(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type Dataset = {
  /** El de la URL: `/api/export/tickets`. */
  id: string;
  /** Qué permiso exige. Se comprueba con `puedeEn(modulo, "ver")`. */
  modulo: Modulo;
  /** Lo que se lee en el botón y da nombre al archivo. */
  nombre: string;
  /** Las columnas, con su tipo. El tipo es lo que salva folios y fechas. */
  columnas: Columna<never>[];
  /** Las filas, con los filtros de la pantalla ya aplicados. */
  filas: (ctx: ContextoExtraccion) => Promise<unknown[]>;
};

/**
 * Declara un dataset conservando el tipo de sus filas.
 *
 * ── EL `NoInfer` NO ES ADORNO ──────────────────────────────────────────────
 *
 * Sin él, TypeScript intenta deducir `T` de las DOS propiedades a la vez y se
 * queda en `unknown`: las columnas reciben la fila como parámetro, así que
 * ofrecen un candidato tan bueno como el de `filas` y la inferencia se rinde.
 * El síntoma era veinte errores de «`v` es de tipo unknown» dentro de accesos
 * perfectamente correctos.
 *
 * `NoInfer` dice cuál manda: el tipo sale de lo que DEVUELVE la consulta, y las
 * columnas se comprueban contra él. Eso es justo lo que se quiere que falle —
 * una columna que lee un campo que la consulta no trae tiene que dar error de
 * compilación, no una celda vacía en el archivo de alguien.
 */
export function dataset<T>(d: {
  id: string;
  modulo: Modulo;
  nombre: string;
  filas: (ctx: ContextoExtraccion) => Promise<T[]>;
  columnas: Columna<NoInfer<T>>[];
}): Dataset {
  return d as unknown as Dataset;
}
