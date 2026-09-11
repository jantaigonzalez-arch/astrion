import "server-only";
import type { DbOrTx } from "@/lib/db";
import { and, asc, eq, gt, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { spareParts } from "@/lib/db/schema";
import { ordenarPor } from "@/lib/data/orden";
import type { Orden } from "@/lib/listado";

/**
 * EL CATÁLOGO ENTERO, y por eso solo para la descarga.
 *
 * Con la carga del reporte del ERP anterior el catálogo pasó de una refacción a
 * 6 609. Medido en local con ese catálogo, antes de cambiar nada: el
 * inventario pesaba 10 MB, el detalle de un ticket 1.2 MB y 4 s —porque su
 * buscador de refacciones recibía el catálogo entero en cada visita— y la
 * orden de compra nueva otro 1.2 MB. Las pantallas ahora piden lo que enseñan:
 * una página (`listarRefacciones`) o veinte coincidencias (`buscarRefacciones`).
 * Lo que queda llamando a esta es la exportación, que sí quiere todo.
 */
export async function getSpareParts(onlyActive = false, conexion?: DbOrTx) {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN.

    Una descarga corre por el pool de SOLO LECTURA para no ocupar una de las dos
    conexiones que la empresa tiene para su trabajo del día. Opcional y con el
    mismo comportamiento al omitirla, así que ninguna de las llamadas que ya
    existían cambia. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());
  const q = db.select().from(spareParts).orderBy(asc(spareParts.partNumber));
  if (onlyActive) return q.where(eq(spareParts.active, true));
  return q;
}

export async function getSparePartById(id: string) {
  const db = await tenantDb();
  const [p] = await db
    .select()
    .from(spareParts)
    .where(eq(spareParts.id, id))
    .limit(1);
  return p ?? null;
}

/* ============================ La búsqueda ============================ */

/** Lo que un buscador de refacciones enseña de cada una. */
export type OpcionRefaccion = {
  id: string;
  partNumber: string;
  description: string;
  brand: string | null;
  costMxn: string | null;
  costUsd: string | null;
  priceMxn: string | null;
  stock: number;
};

const COLUMNAS_OPCION = {
  id: spareParts.id,
  partNumber: spareParts.partNumber,
  description: spareParts.description,
  brand: spareParts.brand,
  costMxn: spareParts.costMxn,
  costUsd: spareParts.costUsd,
  priceMxn: spareParts.priceMxn,
  stock: spareParts.stock,
};

/** `%` y `_` son comodines de LIKE: tecleados, se buscan como texto. */
function comoTexto(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Número de parte, descripción y marca en un solo texto, en minúsculas y sin
 * acentos: «válvula» tiene que salir tecleando «valvula», como en `Selector`.
 * `translate` y no la extensión `unaccent`, que no está instalada y pediría un
 * superusuario en producción para una lista de diez letras.
 */
const HENO = sql`translate(lower(${spareParts.partNumber} || ' ' || ${spareParts.description} || ' ' || coalesce(${spareParts.brand}, '')), 'áéíóúüñ', 'aeiouun')`;

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Cada palabra tiene que aparecer, en cualquier orden. Como en `Selector`. */
function coincide(q: string): SQL | undefined {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return undefined;
  return and(...palabras.map((p) => sql`${HENO} like ${`%${comoTexto(p)}%`}`));
}

/**
 * Las refacciones que casan con lo tecleado, las mejores primero. Para los
 * buscadores —ticket, orden de compra, requisición, negocio—, que antes
 * recibían el catálogo entero y filtraban en el navegador.
 *
 * El orden es el de quien busca: el número de parte EXACTO arriba (se teclea
 * leyéndolo de la pieza), después los que EMPIEZAN así, después lo que hay en
 * almacén. Con el campo vacío salen primero las que tienen existencia: es lo que
 * se puede usar ya.
 *
 * Sin índice de trigramas a propósito: con `%` delante ningún btree sirve, y
 * sobre 6 600 filas el barrido cuesta unos milisegundos (ver el skill de
 * rendimiento). Si el catálogo crece un orden de magnitud, `pg_trgm`.
 */
export async function buscarRefacciones(
  q: string,
  opts: { limite?: number; conexion?: DbOrTx } = {},
): Promise<OpcionRefaccion[]> {
  const db = opts.conexion ?? (await tenantDb());
  const texto = normalizar(q);
  return db
    .select(COLUMNAS_OPCION)
    .from(spareParts)
    .where(and(eq(spareParts.active, true), coincide(q)))
    .orderBy(
      sql`lower(${spareParts.partNumber}) = ${texto} desc`,
      sql`lower(${spareParts.partNumber}) like ${`${comoTexto(texto)}%`} desc`,
      sql`${spareParts.stock} > 0 desc`,
      asc(spareParts.partNumber),
    )
    .limit(Math.min(opts.limite ?? 20, 50));
}

/** ¿Hay algo que buscar? Para decir «el catálogo está vacío» sin traerlo. */
export async function hayRefacciones(): Promise<boolean> {
  const db = await tenantDb();
  const [fila] = await db
    .select({ id: spareParts.id })
    .from(spareParts)
    .where(eq(spareParts.active, true))
    .limit(1);
  return !!fila;
}

/* ====================== El listado del inventario ====================== */

/**
 * Por qué se filtra por existencia.
 *
 * `con` es nuevo y es el que más se usa desde la carga del ERP anterior: de las
 * 6 609 refacciones solo 417 tienen piezas en almacén. El resto es catálogo —lo
 * que se ha comprado alguna vez—, y sin este filtro el inventario de verdad
 * queda disuelto en él.
 */
export const FILTROS_EXISTENCIA = ["con", "low", "out", "over", "incoming"] as const;
export type FiltroExistencia = (typeof FILTROS_EXISTENCIA)[number];

/**
 * Por qué columnas se ordena. `margen` es precio menos costo, calculado: ordenar
 * por él encuentra lo que se vende por debajo de lo que cuesta. Sin precio o sin
 * costo no hay margen que comparar —no es cero— y va al final (`nulls last`).
 */
const ORDEN_REFACCIONES = {
  parte: spareParts.partNumber,
  descripcion: spareParts.description,
  marca: spareParts.brand,
  costo: spareParts.costMxn,
  precio: spareParts.priceMxn,
  margen: sql`${spareParts.priceMxn} - ${spareParts.costMxn}`,
  existencias: spareParts.stock,
};
export type CampoRefaccion = keyof typeof ORDEN_REFACCIONES;
export const CAMPOS_REFACCION = Object.keys(ORDEN_REFACCIONES) as CampoRefaccion[];

/**
 * Por número de parte, y ya no por existencias de menor a mayor.
 *
 * Arrancaba por existencias para que «lo que falta» saliera en la primera fila.
 * Con el catálogo del ERP eso son 6 190 refacciones en cero que no faltan —
 * nunca se tuvieron en almacén—, y la primera página se volvía una lista de
 * ceros. Los sobregiros, que son lo que de verdad falta, tienen su aviso arriba
 * del listado y su filtro.
 */
export const ORDEN_REFACCIONES_DEFECTO: Orden<CampoRefaccion> = { campo: "parte", dir: "asc" };

export type OpcionesInventario = {
  q?: string;
  marca?: string;
  existencia?: FiltroExistencia;
  /** Las que tienen algo pendiente de recibir: ids de `incomingByPart`. */
  enCamino?: readonly string[];
  orden?: Orden<CampoRefaccion>;
  limit?: number;
  offset?: number;
};

function filtroInventario(o: OpcionesInventario): SQL | undefined {
  const e = o.existencia;
  return and(
    coincide(o.q ?? ""),
    o.marca ? eq(spareParts.brand, o.marca) : undefined,
    e === "con" ? gt(spareParts.stock, 0) : undefined,
    e === "low" ? sql`${spareParts.stock} between 1 and 3` : undefined,
    e === "out" ? eq(spareParts.stock, 0) : undefined,
    e === "over" ? lt(spareParts.stock, 0) : undefined,
    // Nada en camino: ningún id, y no «todos» por un `in ()` vacío.
    e === "incoming"
      ? o.enCamino?.length
        ? inArray(spareParts.id, [...o.enCamino])
        : sql`false`
      : undefined,
  );
}

/** Una página del inventario. */
export async function listarRefacciones(o: OpcionesInventario) {
  const db = await tenantDb();
  return db
    .select({ ...COLUMNAS_OPCION, priceUsd: spareParts.priceUsd, active: spareParts.active })
    .from(spareParts)
    .where(filtroInventario(o))
    .orderBy(...ordenarPor(o.orden ?? ORDEN_REFACCIONES_DEFECTO, ORDEN_REFACCIONES, spareParts.id))
    .limit(o.limit ?? 25)
    .offset(o.offset ?? 0);
}

/**
 * Cuántas caen en el filtro y cuánto valen: lo que el pie del listado dice. El
 * valor en existencia es sobre lo FILTRADO —«cuánto dinero hay en lo que estoy
 * viendo»—, y solo cuenta piezas positivas: un sobregiro no es dinero en almacén.
 */
export async function contarRefacciones(o: OpcionesInventario) {
  const db = await tenantDb();
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      valor: sql<string>`coalesce(sum(${spareParts.costMxn} * ${spareParts.stock}) filter (where ${spareParts.stock} > 0), 0)::text`,
    })
    .from(spareParts)
    .where(filtroInventario(o));
  return { n: r.n, valor: Number(r.valor) };
}

/**
 * Lo que los chips cuentan y el aviso de sobregiro enseña, en una consulta.
 * Sobre el catálogo COMPLETO y no sobre lo filtrado: el chip tiene que decir
 * «hay 3 agotadas» aunque se esté mirando otra cosa.
 */
export async function resumenInventario() {
  const db = await tenantDb();
  const [[c], sobregiros, marcas] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        con: sql<number>`count(*) filter (where ${spareParts.stock} > 0)::int`,
        low: sql<number>`count(*) filter (where ${spareParts.stock} between 1 and 3)::int`,
        out: sql<number>`count(*) filter (where ${spareParts.stock} = 0)::int`,
      })
      .from(spareParts),
    // Pocas por naturaleza —un sobregiro es una anomalía—, y el aviso las
    // enumera con lo que viene en camino para cada una.
    db
      .select({ id: spareParts.id, partNumber: spareParts.partNumber, stock: spareParts.stock })
      .from(spareParts)
      .where(lt(spareParts.stock, 0))
      .orderBy(asc(spareParts.stock))
      .limit(200),
    db
      .selectDistinct({ marca: spareParts.brand })
      .from(spareParts)
      .where(isNotNull(spareParts.brand))
      .orderBy(asc(spareParts.brand))
      .limit(60),
  ]);
  return {
    ...c,
    sobregiros,
    marcas: marcas.map((m) => m.marca!).filter(Boolean),
  };
}
