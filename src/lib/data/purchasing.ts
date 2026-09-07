import "server-only";
import type { DbOrTx } from "@/lib/db";
import { ordenarPor } from "@/lib/data/orden";
import type { Orden } from "@/lib/listado";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import {
  inventoryMovements,
  purchaseOrderLines,
  purchaseOrderStatus,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
// `users` vive en el esquema de plataforma, no en el del inquilino: es la misma
// persona en todas las empresas. Alcanzable desde la conexión del inquilino
// porque `public` sigue en el search_path.
import { users } from "@/lib/db/platform";
import { incomingByPart } from "@/lib/domain/purchasing";

/**
 * Qué refacciones vienen en camino y para cuándo, indexado por refacción.
 *
 * Cuenta solo lo pendiente de órdenes vivas (enviadas o parciales): un borrador
 * todavía no es un compromiso con nadie, y una recibida ya está en existencia.
 *
 * Lo usa el inventario, que es donde cambia una decisión: "0 piezas" y "0
 * piezas, llegan 10 el martes" se ven igual en la pantalla y llevan a comprar
 * dos veces lo mismo.
 */
export async function getIncomingByPart() {
  const db = await tenantDb();
  return incomingByPart(db);
}

/**
 * Proveedores.
 *
 * `purchasableOnly` no es lo mismo que `onlyActive`, y la diferencia importa:
 * a un proveedor suspendido NO se le levanta una orden nueva, pero SÍ se le
 * captura la factura de lo que ya entregó. Filtrar los suspendidos también del
 * alta de facturas dejaría fuera del sistema una deuda que existe.
 */
/**
 * Por qué columnas se puede ordenar el padrón de proveedores.
 *
 * Lista BLANCA, como todas: lo que llega en `?orden=` es texto de fuera y aquí
 * se convierte en una columna de verdad o en nada. Ver `lib/listado.ts`.
 */
export const ORDEN_PROVEEDORES = {
  nombre: suppliers.name,
  rfc: suppliers.rfc,
  credito: suppliers.paymentTermsDays,
  moneda: suppliers.currency,
} as const;
export type CampoOrdenProveedor = keyof typeof ORDEN_PROVEEDORES;
export const CAMPOS_ORDEN_PROVEEDORES = Object.keys(
  ORDEN_PROVEEDORES,
) as CampoOrdenProveedor[];

/** Por nombre: a un padrón se viene a buscar a alguien, no a comparar. */
export const ORDEN_PROVEEDORES_DEFECTO: Orden<CampoOrdenProveedor> = {
  campo: "nombre",
  dir: "asc",
};

/**
 * Por qué se filtra el padrón de proveedores.
 *
 * Dos preguntas reales y ninguna más. «¿A quién le puedo comprar hoy?» —que
 * separa al suspendido y al dado de baja del que está operando— y «¿a quién le
 * pago en dólares?», que es lo que decide con qué saldo se cuenta.
 *
 * El estado NO es la columna `active`: son tres situaciones distintas que hoy
 * viven en dos columnas. Suspendido es temporal y con causa; de baja es
 * definitivo. Confundirlos en la pantalla sería esconder justo la diferencia
 * que `suspendSupplier` existe para registrar.
 */
export const ESTADOS_PROVEEDOR = ["operando", "suspendido", "baja"] as const;
export type EstadoProveedor = (typeof ESTADOS_PROVEEDOR)[number];

export const ESTADO_PROVEEDOR_LABEL: Record<EstadoProveedor, string> = {
  operando: "Operando",
  suspendido: "Suspendido",
  baja: "Dado de baja",
};

function condicionEstado(e: EstadoProveedor) {
  if (e === "baja") return eq(suppliers.active, false);
  if (e === "suspendido")
    return and(eq(suppliers.active, true), isNotNull(suppliers.suspendedAt));
  return and(eq(suppliers.active, true), isNull(suppliers.suspendedAt));
}

export type FiltrosProveedor = {
  estado?: EstadoProveedor;
  moneda?: string;
};

export async function getSuppliers(
  onlyActive = false,
  purchasableOnly = false,
  /**
   * Sin orden explícito manda el de siempre, alfabético. Es opcional a
   * propósito: nueve llamadas de esta función son para rellenar un `<select>`,
   * y ahí lo alfabético es lo correcto y no hay URL de la que sacar nada.
   */
  orden?: Orden<CampoOrdenProveedor>,
  filtros?: FiltrosProveedor,
) {
  const db = await tenantDb();
  const q = db
    .select()
    .from(suppliers)
    .orderBy(
      ...(orden
        ? ordenarPor(orden, ORDEN_PROVEEDORES, suppliers.name)
        : [asc(suppliers.name)]),
    );
  if (purchasableOnly) {
    return q.where(
      and(eq(suppliers.active, true), isNull(suppliers.suspendedAt)),
    );
  }
  if (onlyActive) return q.where(eq(suppliers.active, true));
  // Los filtros de la pantalla se combinan con `and`: cada uno acota al
  // anterior, que es cómo se lee una tabla filtrada por dos columnas.
  if (filtros?.estado || filtros?.moneda) {
    return q.where(
      and(
        filtros.estado ? condicionEstado(filtros.estado) : undefined,
        filtros.moneda ? eq(suppliers.currency, filtros.moneda) : undefined,
      ),
    );
  }
  return q;
}

/**
 * Cuántos proveedores caen en cada opción del filtro.
 *
 * Se cuenta sobre el padrón COMPLETO y no sobre lo ya filtrado: el menú tiene
 * que poder decir «hay 4 en dólares» aunque estés mirando los de pesos, o
 * cambiar de filtro sería un salto a ciegas.
 *
 * Los que dan cero no se ofrecen —lo hace `FiltroColumna`— porque una opción
 * con cero es un camino a una lista vacía.
 */
export async function contarProveedores(): Promise<{
  estado: Array<{ k: EstadoProveedor; n: number }>;
  moneda: Array<{ k: string; n: number }>;
}> {
  const db = await tenantDb();
  const filas = await db
    .select({
      currency: suppliers.currency,
      activo: suppliers.active,
      suspendido: sql<boolean>`${suppliers.suspendedAt} is not null`,
      n: sql<number>`count(*)::int`,
    })
    .from(suppliers)
    .groupBy(suppliers.currency, suppliers.active, sql`${suppliers.suspendedAt} is not null`);

  const porEstado = new Map<EstadoProveedor, number>();
  const porMoneda = new Map<string, number>();
  for (const f of filas) {
    const e: EstadoProveedor = !f.activo ? "baja" : f.suspendido ? "suspendido" : "operando";
    porEstado.set(e, (porEstado.get(e) ?? 0) + f.n);
    porMoneda.set(f.currency, (porMoneda.get(f.currency) ?? 0) + f.n);
  }
  return {
    estado: ESTADOS_PROVEEDOR.map((k) => ({ k, n: porEstado.get(k) ?? 0 })),
    moneda: [...porMoneda].sort().map(([k, n]) => ({ k, n })),
  };
}

export type OrderRow = {
  id: string;
  reference: string;
  supplierName: string;
  status: string;
  currency: string;
  expectedAt: string | null;
  createdAt: Date;
  lines: number;
  units: number;
  received: number;
  /** Total de la orden en la moneda en que se pactó. */
  total: number;
};

/**
 * Una página del listado de órdenes, con sus totales.
 *
 * ── LOS AGREGADOS VAN EN SQL ───────────────────────────────────────────────
 *
 * El listado no necesita los renglones: traerlos todos para sumarlos sería
 * mover cientos de filas a cambio de cuatro números por orden.
 *
 * ── Y AHORA TAMBIÉN VA PAGINADO ────────────────────────────────────────────
 *
 * Devolvía la tabla ENTERA. Con 2 612 órdenes eran 13 ms y parecía gratis, y
 * ése era el problema: el número de la derecha no tenía tope. Una empresa con
 * tres años de compras tiene decenas de miles de órdenes, y la pantalla las
 * traía todas —consulta, red y HTML— para enseñar las veinticinco de arriba.
 *
 * `count(*) over ()` da el total en la MISMA consulta y no en una segunda: son
 * dos preguntas sobre el mismo conjunto, y separarlas abre la ventana para que
 * el conteo y la página se contradigan si alguien registra una orden en medio.
 * Es lo mismo que ya hace `getProfitDetail`.
 *
 * Se cuenta DESPUÉS de agrupar —y por eso la ventana va sobre el resultado
 * agrupado—: lo que se pagina son órdenes, no renglones de orden.
 */
/**
 * Por qué columnas se ordenan las órdenes de compra.
 *
 * `piezas` y `total` son agregados de los renglones, así que ordenan por la
 * misma expresión que los calcula y no por una columna: con `group by`, un
 * `order by` sobre el agregado es lo correcto y lo único que Postgres admite.
 *
 * `proveedor` sí sale de la tabla unida, que aquí es un `innerJoin` explícito
 * —a diferencia de contactos, donde la relación la resuelve el cargador— y por
 * eso se puede ordenar por él.
 */
export const ORDEN_ORDENES = {
  folio: purchaseOrders.reference,
  proveedor: suppliers.name,
  estado: purchaseOrders.status,
  piezas: sql`coalesce(sum(${purchaseOrderLines.quantity}), 0)`,
  total: sql`coalesce(sum(${purchaseOrderLines.quantity} * coalesce(${purchaseOrderLines.unitCostMxn}, ${purchaseOrderLines.unitCostUsd}, 0)), 0)`,
  espera: purchaseOrders.expectedAt,
  creada: purchaseOrders.createdAt,
} as const;
export type CampoOrdenOrden = keyof typeof ORDEN_ORDENES;
export const CAMPOS_ORDEN_ORDENES = Object.keys(
  ORDEN_ORDENES,
) as CampoOrdenOrden[];

/**
 * Lo más reciente primero: una cola se mira por lo que acaba de entrar.
 *
 * Por FOLIO y no por fecha de creación, aunque sean lo mismo —el folio sale de
 * una secuencia y va rellenado con ceros, así que ordenarlo al revés da el
 * mismo resultado—. La diferencia está en la pantalla: `creada` no es una
 * columna visible, así que con ella el listado llegaba ordenado y SIN flecha en
 * ningún encabezado. Un orden que no se puede ver es un orden que la persona
 * no sabe que puede cambiar.
 */
export const ORDEN_ORDENES_DEFECTO: Orden<CampoOrdenOrden> = {
  campo: "folio",
  dir: "desc",
};

/**
 * Cuántas órdenes caen en cada opción del filtro.
 *
 * Sobre TODAS y no sobre lo ya filtrado, por lo mismo que en proveedores: el
 * menú tiene que poder decir «hay 12 enviadas» aunque estés mirando borradores.
 * Cambiar de filtro sin ese número es un salto a ciegas.
 */
export async function contarOrdenes(): Promise<{
  estado: Array<{ k: string; n: number }>;
  proveedor: Array<{ k: string; label: string; n: number }>;
}> {
  const db = await tenantDb();
  const [porEstado, porProveedor] = await Promise.all([
    db
      .select({ k: purchaseOrders.status, n: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .groupBy(purchaseOrders.status),
    db
      .select({
        k: purchaseOrders.supplierId,
        label: suppliers.name,
        n: sql<number>`count(*)::int`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .groupBy(purchaseOrders.supplierId, suppliers.name)
      .orderBy(asc(suppliers.name)),
  ]);
  return { estado: porEstado, proveedor: porProveedor };
}

export type FiltrosOrden = {
  estado?: (typeof purchaseOrderStatus.enumValues)[number];
  proveedor?: string;
};

export async function getPurchaseOrders(
  page?: { limit: number; offset: number },
  orden?: Orden<CampoOrdenOrden>,
  filtros?: FiltrosOrden,
  conexion?: DbOrTx,
): Promise<{ rows: OrderRow[]; total: number }> {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN: una descarga corre por el pool
    de SOLO LECTURA para no ocupar una de las dos conexiones que la empresa tiene
    para su trabajo del día. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());
  const q = db
    .select({
      total_count: sql<number>`count(*) over ()::int`,
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      supplierName: suppliers.name,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      expectedAt: purchaseOrders.expectedAt,
      createdAt: purchaseOrders.createdAt,
      lines: sql<number>`count(${purchaseOrderLines.id})::int`,
      units: sql<number>`coalesce(sum(${purchaseOrderLines.quantity}), 0)::int`,
      received: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQuantity}), 0)::int`,
      total: sql<number>`coalesce(sum(
        ${purchaseOrderLines.quantity} *
        coalesce(${purchaseOrderLines.unitCostMxn}, ${purchaseOrderLines.unitCostUsd}, 0)
      ), 0)::float8`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(purchaseOrderLines, eq(purchaseOrderLines.orderId, purchaseOrders.id))
    // El `where` va ANTES del `group by`: filtra órdenes, no renglones. Puesto
    // después, en un `having`, un filtro por proveedor recortaría los renglones
    // agregados y los totales saldrían mal.
    .where(
      and(
        filtros?.estado ? eq(purchaseOrders.status, filtros.estado) : undefined,
        filtros?.proveedor ? eq(purchaseOrders.supplierId, filtros.proveedor) : undefined,
      ),
    )
    .groupBy(
      purchaseOrders.id,
      purchaseOrders.reference,
      suppliers.name,
      purchaseOrders.status,
      purchaseOrders.currency,
      purchaseOrders.expectedAt,
      purchaseOrders.createdAt,
    )
    .orderBy(
      ...(orden
        ? ordenarPor(orden, ORDEN_ORDENES, purchaseOrders.reference)
        : [desc(purchaseOrders.createdAt)]),
    );

  const rows = (await (page ? q.limit(page.limit).offset(page.offset) : q)) as Array<
    OrderRow & { total_count: number }
  >;

  return {
    rows: rows as OrderRow[],
    // Sin filas no hay ventana de dónde leer el total, y cero es la respuesta.
    total: rows[0]?.total_count ?? 0,
  };
}

/** Una orden con todo lo necesario para su pantalla de detalle. */
export async function getPurchaseOrder(id: string) {
  const db = await tenantDb();

  const [order] = await db
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      expectedAt: purchaseOrders.expectedAt,
      notes: purchaseOrders.notes,
      sentAt: purchaseOrders.sentAt,
      closedAt: purchaseOrders.closedAt,
      createdAt: purchaseOrders.createdAt,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierEmail: suppliers.email,
      supplierPhone: suppliers.phone,
      paymentTermsDays: suppliers.paymentTermsDays,
      createdByName: users.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdById))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!order) return null;

  const lines = await db
    .select({
      id: purchaseOrderLines.id,
      partId: purchaseOrderLines.partId,
      partNumber: purchaseOrderLines.partNumber,
      description: purchaseOrderLines.description,
      quantity: purchaseOrderLines.quantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      unitCostMxn: purchaseOrderLines.unitCostMxn,
      unitCostUsd: purchaseOrderLines.unitCostUsd,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, id))
    .orderBy(asc(purchaseOrderLines.partNumber));

  // Las recepciones se leen del ledger, no de una tabla de recepciones: el
  // movimiento de inventario ES el documento de entrada.
  const receipts = await db
    .select({
      id: inventoryMovements.id,
      lineId: inventoryMovements.purchaseOrderLineId,
      quantity: inventoryMovements.quantity,
      balanceAfter: inventoryMovements.balanceAfter,
      occurredAt: inventoryMovements.occurredAt,
      note: inventoryMovements.note,
      actorName: users.name,
    })
    .from(inventoryMovements)
    .leftJoin(users, eq(users.id, inventoryMovements.actorId))
    .where(
      sql`${inventoryMovements.purchaseOrderLineId} in (
        select id from ${purchaseOrderLines} where order_id = ${id}::uuid
      )`,
    )
    .orderBy(desc(inventoryMovements.occurredAt));

  return { order, lines, receipts };
}
