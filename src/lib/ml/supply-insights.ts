import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { Block, ProjectionBlock } from "@/lib/ml/blocks-types";
import {
  commentParts,
  inventoryMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
  suppliers,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import type { DbOrTx } from "@/lib/db";

/**
 * Refacciones, compras y cuentas por pagar: el QUIÉN y el QUÉ que faltaban.
 *
 * Los tres módulos tenían solo avisos —«esto hay que atenderlo»— y en pagos,
 * además, un calendario. Ninguno decía en qué se va el dinero ni quién lo
 * mueve, que son las dos preguntas con las que alguien abre un tablero de
 * suministro.
 *
 * ── HONESTIDAD SOBRE LO QUE HOY DICEN ──────────────────────────────────────
 *
 * De los cinco de este archivo, hoy contra producción solo habla el primero.
 * Los otros cuatro leen tablas que están VACÍAS: cero órdenes de compra, cero
 * facturas de proveedor, cero movimientos de inventario. La empresa todavía no
 * usa esos módulos.
 *
 * Se escriben igual, y no es adelantarse: un módulo cuyo tablero nace vacío no
 * se estrena nunca —nadie compone un tablero para ver si algún día dirá algo—.
 * Lo que sí sería un error es que salieran con ceros: todos devuelven `[]`
 * mientras no haya nada, así que hasta que se registre la primera orden el
 * tablero enseña qué está vigilando en vez de dibujar un cero.
 *
 * Medido el 2026-08-25 contra `tenant_evoelution`: 739 líneas de refacción
 * consumida, 0 órdenes, 0 facturas, 0 movimientos.
 */

const n = (v: number) => Math.round(v).toLocaleString("es-MX");
const s = (v: number) => (v === 1 ? "" : "s");

/** Etiqueta corta para el eje: los nombres de proveedor y persona no caben. */
/**
 * Recorta una etiqueta que no cabe.
 *
 * El límite era 16 porque la etiqueta iba centrada bajo una columna de un
 * doceavo del ancho. Estos bloques se dibujan como ranking horizontal, donde
 * el nombre ocupa una línea entera, así que el recorte de aquí ya no lo impone
 * el dibujo: lo impone que un nombre de refacción de ochenta caracteres tampoco
 * ayuda a nadie. De ahí 32, y el `truncate` del componente se encarga del resto
 * según el ancho REAL, que es quien lo sabe.
 */
function corto(texto: string | null, max = 32): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return "—";
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

/* ------------------------- 1 · Qué refacciones se consumen ------------------------- */

/**
 * Las refacciones que más se van en servicio.
 *
 * Se cuenta lo CONSUMIDO en bitácora (`ticket_comment_parts`) y no el stock:
 * son dos preguntas distintas y solo una es de tablero. El stock dice qué hay
 * ahora —eso ya lo enseña la pantalla de refacciones, con su buscador— y el
 * consumo dice qué se repone, que es lo que decide una compra.
 *
 * La cantidad manda sobre el importe porque las líneas importadas del sistema
 * anterior vinieron SIN precio: ordenar por dinero pondría arriba las pocas
 * capturadas a mano y dejaría abajo las que de verdad se gastan. Cuando haya
 * precios, el importe entra en la nota sin cambiar el eje.
 */
export async function partsConsumption(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      parte: commentParts.partNumber,
      descripcion: commentParts.description,
      cantidad: sql<number>`sum(${commentParts.quantity})::int`,
      veces: sql<number>`count(*)::int`,
      importe: sql<number>`coalesce(sum(${commentParts.quantity} * ${commentParts.unitPriceMxn}), 0)::float`,
    })
    .from(commentParts)
    .groupBy(commentParts.partNumber, commentParts.description)
    .orderBy(desc(sql`sum(${commentParts.quantity})`))
    .limit(8);

  if (filas.length === 0) return [];

  const [{ lineas = 0, piezas = 0 } = {}] = await db
    .select({
      lineas: sql<number>`count(*)::int`,
      piezas: sql<number>`coalesce(sum(${commentParts.quantity}), 0)::int`,
    })
    .from(commentParts);

  const primera = filas[0];
  const conImporte = filas.reduce((a, f) => a + f.importe, 0);

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "parts.consumption",
    title: "Refacciones que más se consumen",
    note: [
      `${n(piezas)} pieza${s(piezas)} en ${n(lineas)} línea${s(lineas)} de bitácora. ` +
        `La más usada es ${primera.parte} (${primera.descripcion || "sin descripción"}), ` +
        `${n(primera.cantidad)} pieza${s(primera.cantidad)} en ${n(primera.veces)} servicio${s(primera.veces)}.`,
      conImporte > 0
        ? `Las ocho de la gráfica suman ${n(conImporte)} MXN a precio de venta.`
        : "Las líneas importadas no traen precio, así que se cuenta en piezas y no en dinero.",
    ].join(" "),
    bars: filas.map((f) => ({
      key: f.parte,
      // Sin el 14 de antes: en horizontal cabe, y catorce caracteres de un
      // nombre de refacción se comen justo la parte que la distingue de otra.
      label: corto(f.parte),
      value: f.cantidad,
    })),
    href: "/admin/refacciones",
  };
  return [bloque];
}

/* ------------------------- 2 · Quién mueve el inventario ------------------------- */

/**
 * Entradas y salidas de almacén, por quien las registró.
 *
 * Es un análisis de CONTROL, no de productividad, y la diferencia decide cómo
 * se lee: no dice quién trabaja más, dice quién tiene las manos en el almacén.
 * En un inventario que cuadra, ver un nombre inesperado con muchos ajustes es
 * exactamente el hallazgo que se busca.
 */
export async function movementsByActor(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: inventoryMovements.actorId,
      nombre: users.name,
      total: sql<number>`count(*)::int`,
      ajustes: sql<number>`count(*) filter (where ${inventoryMovements.kind} = 'adjustment')::int`,
    })
    .from(inventoryMovements)
    .leftJoin(users, eq(inventoryMovements.actorId, users.id))
    .where(isNotNull(inventoryMovements.actorId))
    .groupBy(inventoryMovements.actorId, users.name)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  if (filas.length === 0) return [];

  const total = filas.reduce((a, f) => a + f.total, 0);
  const ajustes = filas.reduce((a, f) => a + f.ajustes, 0);

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "parts.movements-by-actor",
    title: "Quién mueve el almacén",
    note:
      `${n(total)} movimiento${s(total)} registrado${s(total)} por ${filas.length} persona` +
      `${s(filas.length)}.` +
      (ajustes > 0
        ? ` ${n(ajustes)} son ajustes manuales, que son los que conviene mirar: ` +
          "una entrada tiene orden de compra detrás y un ajuste solo tiene a quien lo hizo."
        : ""),
    bars: filas.map((f) => ({
      key: f.id ?? "—",
      label: corto((f.nombre ?? "").split(" ")[0], 12),
      value: f.total,
    })),
    href: "/admin/refacciones",
  };
  return [bloque];
}

/* ------------------------- 3 · Quién compra ------------------------- */

/**
 * Las órdenes de compra, por quien las levantó.
 *
 * Cuenta las que SALIERON —enviadas, parciales o recibidas— y deja fuera los
 * borradores. Un borrador no es una compra: es una intención que puede morir
 * ahí, y contarlo haría quedar como el que más compra a quien más empieza y no
 * termina.
 */
export async function purchasingByBuyer(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: purchaseOrders.createdById,
      nombre: users.name,
      total: sql<number>`count(*)::int`,
    })
    .from(purchaseOrders)
    .leftJoin(users, eq(purchaseOrders.createdById, users.id))
    .where(sql`${purchaseOrders.status} in ('sent', 'partial', 'received')`)
    .groupBy(purchaseOrders.createdById, users.name)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  if (filas.length === 0) return [];

  const total = filas.reduce((a, f) => a + f.total, 0);
  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "purchasing.by-buyer",
    title: "Quién levanta las compras",
    note:
      `${n(total)} orden${total === 1 ? "" : "es"} en firme. ${primero.nombre ?? "—"} levantó ` +
      `${n(primero.total)}. Los borradores no cuentan: una compra existe cuando sale al proveedor.`,
    bars: filas.map((f) => ({
      key: f.id ?? "—",
      label: corto((f.nombre ?? "").split(" ")[0], 12),
      value: f.total,
    })),
    href: "/admin/compras",
  };
  return [bloque];
}

/* ------------------------- 4 · A qué proveedores se les compra ------------------------- */

/**
 * En qué proveedores se concentra el gasto comprometido.
 *
 * El espejo de «de qué clientes viene el negocio», y se lee con la misma
 * inquietud: depender de un solo proveedor para una refacción crítica es un
 * riesgo de operación, no una eficiencia.
 *
 * Suma las LÍNEAS de las órdenes en firme, a costo. Es lo comprometido, no lo
 * pagado —eso vive en cuentas por pagar— y la nota lo dice para que nadie lea
 * este bloque como una salida de caja.
 */
export async function purchasingBySupplier(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: purchaseOrders.supplierId,
      nombre: suppliers.name,
      importe: sql<number>`coalesce(sum(${purchaseOrderLines.quantity} * coalesce(${purchaseOrderLines.unitCostMxn}, 0)), 0)::float`,
      ordenes: sql<number>`count(distinct ${purchaseOrders.id})::int`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.orderId, purchaseOrders.id))
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(sql`${purchaseOrders.status} in ('sent', 'partial', 'received')`)
    .groupBy(purchaseOrders.supplierId, suppliers.name)
    .orderBy(desc(sql`coalesce(sum(${purchaseOrderLines.quantity} * coalesce(${purchaseOrderLines.unitCostMxn}, 0)), 0)`))
    .limit(8);

  const conImporte = filas.filter((f) => f.importe > 0);
  if (conImporte.length === 0) return [];

  const total = conImporte.reduce((a, f) => a + f.importe, 0);
  const primero = conImporte[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "purchasing.by-supplier",
    title: "A qué proveedores se les compra",
    note:
      `${n(total)} MXN comprometidos en ${conImporte.length} proveedor${s(conImporte.length)}. ` +
      `${primero.nombre ?? "—"} concentra ${Math.round((primero.importe / total) * 100)} % ` +
      `en ${n(primero.ordenes)} orden${primero.ordenes === 1 ? "" : "es"}. ` +
      "Es lo comprometido en órdenes, no lo pagado.",
    bars: conImporte.map((f) => ({
      key: f.id ?? "—",
      label: corto(f.nombre),
      value: Math.round(f.importe),
    })),
    currency: "MXN",
    total: Math.round(total),
    href: "/admin/compras",
  };
  return [bloque];
}

/* ------------------------- 5 · A quién se le debe ------------------------- */

/**
 * El saldo pendiente, por proveedor.
 *
 * El módulo de pagos sabía decir CUÁNDO vence —su calendario y su proyección
 * del mes— pero no A QUIÉN. Y esa es la pregunta de la llamada incómoda: si un
 * proveedor concentra el saldo, la conversación de plazos es con él y no con
 * los doce pequeños.
 *
 * Solo lo vivo: pendientes y parciales. Las canceladas no se deben y las
 * pagadas ya no.
 */
export async function payablesBySupplier(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: supplierInvoices.supplierId,
      nombre: suppliers.name,
      saldo: sql<number>`coalesce(sum(${supplierInvoices.total}), 0)::float`,
      facturas: sql<number>`count(*)::int`,
      vencidas: sql<number>`count(*) filter (where ${supplierInvoices.dueAt} < now())::int`,
    })
    .from(supplierInvoices)
    .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(
      and(
        sql`${supplierInvoices.status} in ('pending', 'partial')`,
        isNotNull(supplierInvoices.total),
      ),
    )
    .groupBy(supplierInvoices.supplierId, suppliers.name)
    .orderBy(desc(sql`coalesce(sum(${supplierInvoices.total}), 0)`))
    .limit(8);

  const conSaldo = filas.filter((f) => f.saldo > 0);
  if (conSaldo.length === 0) return [];

  const total = conSaldo.reduce((a, f) => a + f.saldo, 0);
  const primero = conSaldo[0];
  const vencidas = conSaldo.reduce((a, f) => a + f.vencidas, 0);

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "payables.by-supplier",
    title: "A quién se le debe",
    note:
      `${n(total)} MXN pendientes en ${conSaldo.length} proveedor${s(conSaldo.length)}. ` +
      `${primero.nombre ?? "—"} concentra ${Math.round((primero.saldo / total) * 100)} %.` +
      (vencidas > 0 ? ` ${n(vencidas)} factura${s(vencidas)} ya venció.` : ""),
    bars: conSaldo.map((f) => ({
      key: f.id ?? "—",
      label: corto(f.nombre),
      value: Math.round(f.saldo),
      // El proveedor con facturas vencidas se marca como estado y no como una
      // barra más: es la diferencia entre deber y deber tarde.
      alert: f.vencidas > 0,
    })),
    currency: "MXN",
    total: Math.round(total),
    href: "/admin/compras/cuentas-por-pagar",
  };
  return [bloque];
}
