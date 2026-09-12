import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import {
  crmDealProducts,
  crmDeals,
  purchaseOrderLines,
  purchaseOrders,
  requisitionLines,
  requisitions,
  spareParts,
  suppliers,
  type RequisitionStatus,
} from "@/lib/db/schema";
import { recordEvent } from "@/lib/domain/events";
import {
  nextPurchaseOrderReference,
  nextRequisitionReference,
} from "@/lib/domain/references";
import { assertSupplierPurchasable, incomingByPart } from "@/lib/domain/purchasing";

/**
 * Requisiciones: de lo que el cliente pidió a lo que hay que comprar.
 *
 * El módulo entero existe por una resta. Copiar las líneas de un pedido a una
 * orden de compra es trivial y es lo que hace todo mundo la primera vez; el
 * resultado es que se vuelve a comprar lo que ya está en el almacén y lo que ya
 * viene en camino de una orden anterior. La requisición es el documento donde
 * esa resta se hace UNA vez, se deja escrita y se puede discutir:
 *
 *     falta = pedido − existencia − en camino − en trámite
 *
 * Los cuatro sumandos se guardan y se enseñan por separado, no solo el
 * resultado. Un número solo —«compra 4»— no se puede auditar: quien lo mira no
 * sabe si el sistema ya contó las 6 que llegan el martes, y ante la duda pide
 * las 10. Enseñar la resta es lo que hace que le crean.
 *
 * Lo que este archivo NO hace: decidir. El proveedor que propone sale del
 * historial de compra y viene con el motivo escrito al lado; el comprador lo
 * cambia sin dar explicaciones. Una sugerencia que no se puede contradecir es
 * una orden disfrazada.
 */

/* ======================= La resta ======================= */

/** Una necesidad ya neteada, con los sumandos a la vista. */
export type Necesidad = {
  /** Línea del pedido de la que sale. Nulo si se añadió a mano. */
  dealProductId: string | null;
  partId: string | null;
  partNumber: string | null;
  description: string;
  /** Lo que pidió el cliente. */
  pedido: number;
  /** Existencia libre en almacén. Nunca negativa aquí: un sobregiro no cubre. */
  existencia: number;
  /** Pedido al proveedor —orden ENVIADA— y todavía sin recibir. */
  enCamino: number;
  /**
   * Ya dentro del circuito de compra, pero sin ser todavía un compromiso con
   * nadie: requisiciones vivas y órdenes en BORRADOR.
   *
   * Los borradores cuentan aquí y no en `enCamino`, y que cuenten no es un
   * detalle. Al convertir una requisición la orden nace en borrador, así que
   * durante ese rato las piezas no están en ninguno de los otros tres
   * sumandos: la requisición ya se convirtió y la orden todavía no se envió.
   * Sin este renglón el pedido vuelve a decir «falta 8» al minuto de haberlo
   * comprado, y el segundo «Generar requisición» compra doble sin que nada
   * falle. Es exactamente el error que el módulo vino a cerrar, colándose por
   * la ventana de tiempo más corta.
   */
  enTramite: number;
  /** El resultado de la resta. Es lo único que se compra. */
  falta: number;
};

/**
 * Qué hace falta comprar para un pedido.
 *
 * Lee, no escribe. Se usa para la vista previa —el usuario ve la resta antes de
 * crear nada— y otra vez dentro de la transacción que crea la requisición. Que
 * el número de la pantalla y el del documento salgan de la MISMA función es lo
 * que evita la sorpresa clásica: la vista previa decía 4 y la requisición nació
 * con 7 porque la calculó otro código.
 */
export async function necesidadDelPedido(
  tx: DbOrTx,
  dealId: string,
): Promise<Necesidad[]> {
  const lineas = await tx
    .select({
      id: crmDealProducts.id,
      partId: crmDealProducts.partId,
      name: crmDealProducts.name,
      quantity: crmDealProducts.quantity,
    })
    .from(crmDealProducts)
    .where(eq(crmDealProducts.dealId, dealId))
    .orderBy(crmDealProducts.createdAt);

  if (lineas.length === 0) return [];

  const partIds = [...new Set(lineas.map((l) => l.partId).filter(Boolean))] as string[];

  const [catalogo, enCamino, ajeno, borradores, propio] = await Promise.all([
    partIds.length
      ? tx
          .select({
            id: spareParts.id,
            partNumber: spareParts.partNumber,
            description: spareParts.description,
            stock: spareParts.stock,
          })
          .from(spareParts)
          .where(inArray(spareParts.id, partIds))
      : Promise.resolve([]),
    incomingByPart(tx),
    pendienteAjeno(tx, partIds, dealId),
    pendienteEnBorradores(tx, partIds),
    pendientePropio(tx, dealId),
  ]);

  const porParte = new Map(catalogo.map((p) => [p.id, p]));

  // Un pedido puede traer la misma refacción en dos renglones. La existencia y
  // lo que viene en camino son UNO solo para las dos, así que se van gastando
  // conforme se recorren las líneas: sin este acumulador, cada renglón
  // descontaría las mismas 6 piezas y la requisición saldría corta.
  const gastado = new Map<string, number>();

  return lineas.map((l) => {
    // Se redondea hacia arriba: se venden 10.5 metros y se compran 11 piezas.
    // Hacia abajo dejaría al almacén corto justo en la línea que ya se vendió.
    const pedido = Math.ceil(Number(l.quantity));
    const part = l.partId ? porParte.get(l.partId) : undefined;

    // Lo que YA se requisitó para ESTE renglón. Va primero y no entra al
    // reparto de recursos compartidos porque no es una cobertura ajena: es este
    // mismo renglón, ya pedido. Sin esta resta, darle dos veces al botón
    // duplica la requisición — y con las líneas sin refacción del catálogo era
    // la única defensa posible, porque a esas no se les puede netear por pieza.
    const yaPedidoAquí = Math.min(pedido, propio.get(l.id) ?? 0);
    const restante = pedido - yaPedidoAquí;

    if (!l.partId || !part) {
      // Sin refacción del catálogo no hay existencia contra qué netear: se pide
      // lo que quede y el comprador la identifica. Es el caso que justifica que
      // `part_id` sea opcional en la requisición y obligatorio en la orden.
      return {
        dealProductId: l.id,
        partId: null,
        partNumber: null,
        description: l.name,
        pedido,
        existencia: 0,
        enCamino: 0,
        enTramite: yaPedidoAquí,
        falta: restante,
      };
    }

    const usado = gastado.get(l.partId) ?? 0;
    // El stock puede quedar negativo (es un ledger, no un contador acotado).
    // Un sobregiro no cubre nada, así que para netear se toma como cero.
    const libre = Math.max(0, part.stock);
    const camino = enCamino.get(l.partId)?.quantity ?? 0;
    const tramite = (ajeno.get(l.partId) ?? 0) + (borradores.get(l.partId) ?? 0);

    const cobertura = Math.max(0, libre + camino + tramite - usado);
    const aplicada = Math.min(cobertura, restante);
    gastado.set(l.partId, usado + aplicada);

    // El desglose reparte la cobertura en el mismo orden en que se consume:
    // primero lo que ya está, luego lo que viene, luego lo que está en trámite.
    const deExistencia = Math.min(aplicada, Math.max(0, libre - usado));
    const resto = aplicada - deExistencia;
    const deCamino = Math.min(resto, Math.max(0, libre + camino - usado - deExistencia));

    return {
      dealProductId: l.id,
      partId: l.partId,
      partNumber: part.partNumber,
      description: part.description,
      pedido,
      existencia: deExistencia,
      enCamino: deCamino,
      enTramite: yaPedidoAquí + (resto - deCamino),
      falta: restante - aplicada,
    };
  });
}

/**
 * Estados en los que una requisición todavía compromete piezas.
 *
 * `draft` cuenta igual que `approved`. Podría discutirse —un borrador todavía
 * no compromete nada—, pero no contarlo reabre justo el error que el módulo
 * viene a cerrar: dos personas armando a la vez la requisición del mismo
 * pedido, ninguna viendo a la otra, y el doble de piezas compradas.
 */
const VIVA = sql`${requisitions.status} in ('draft', 'submitted', 'approved', 'partial')`;
const SIN_CONVERTIR = sql`${requisitionLines.quantity} > ${requisitionLines.orderedQuantity}`;

/**
 * Lo que OTROS ya pidieron de estas refacciones.
 *
 * Excluye lo que se pidió para este mismo pedido: eso se cuenta aparte, renglón
 * por renglón, en `pendientePropio`. Sin la exclusión el mismo compromiso se
 * restaría dos veces y la requisición saldría corta — un error mucho más caro
 * que el contrario, porque no se ve hasta que falta la pieza.
 */
async function pendienteAjeno(
  tx: DbOrTx,
  partIds: string[],
  dealId: string,
): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();

  const rows = await tx
    .select({
      partId: requisitionLines.partId,
      pendiente: sql<number>`sum(${requisitionLines.quantity} - ${requisitionLines.orderedQuantity})::int`,
    })
    .from(requisitionLines)
    .innerJoin(requisitions, eq(requisitions.id, requisitionLines.requisitionId))
    .leftJoin(
      crmDealProducts,
      eq(crmDealProducts.id, requisitionLines.dealProductId),
    )
    .where(
      and(
        inArray(requisitionLines.partId, partIds),
        VIVA,
        SIN_CONVERTIR,
        // Sin línea de pedido detrás es reposición de existencias: ajena, y por
        // tanto sí cuenta como cobertura.
        sql`(${requisitionLines.dealProductId} is null or ${crmDealProducts.dealId} <> ${dealId})`,
      ),
    )
    .groupBy(requisitionLines.partId);

  return new Map(rows.map((r) => [r.partId!, Number(r.pendiente)]));
}

/**
 * Lo pendiente en órdenes de compra en BORRADOR.
 *
 * `incomingByPart` excluye los borradores, y hace bien: para el inventario, un
 * borrador no es mercancía que vaya a llegar, porque el proveedor ni siquiera
 * lo ha visto. Pero para decidir si hay que COMPRAR sí cuenta: alguien ya
 * capturó esas piezas y volver a pedirlas es comprar dos veces. Son dos
 * preguntas distintas sobre la misma fila, y por eso son dos consultas.
 *
 * Se cuentan también los borradores que no salieron de ninguna requisición: una
 * orden capturada a mano compromete igual.
 */
async function pendienteEnBorradores(
  tx: DbOrTx,
  partIds: string[],
): Promise<Map<string, number>> {
  if (partIds.length === 0) return new Map();

  const rows = await tx
    .select({
      partId: purchaseOrderLines.partId,
      pendiente: sql<number>`sum(${purchaseOrderLines.quantity} - ${purchaseOrderLines.receivedQuantity})::int`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(
      and(
        inArray(purchaseOrderLines.partId, partIds),
        eq(purchaseOrders.status, "draft"),
        sql`${purchaseOrderLines.quantity} > ${purchaseOrderLines.receivedQuantity}`,
      ),
    )
    .groupBy(purchaseOrderLines.partId);

  return new Map(rows.map((r) => [r.partId, Number(r.pendiente)]));
}

/**
 * Lo ya pedido para CADA renglón de este pedido, por línea de pedido.
 *
 * Es lo que hace que el botón «Generar requisición» sea idempotente. Netear
 * solo por refacción no bastaba: las líneas que el vendedor escribió a mano no
 * tienen refacción, así que se habrían duplicado enteras en cada pulsación sin
 * que nada fallara.
 */
async function pendientePropio(
  tx: DbOrTx,
  dealId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      dealProductId: requisitionLines.dealProductId,
      pendiente: sql<number>`sum(${requisitionLines.quantity} - ${requisitionLines.orderedQuantity})::int`,
    })
    .from(requisitionLines)
    .innerJoin(requisitions, eq(requisitions.id, requisitionLines.requisitionId))
    .innerJoin(
      crmDealProducts,
      eq(crmDealProducts.id, requisitionLines.dealProductId),
    )
    .where(and(eq(crmDealProducts.dealId, dealId), VIVA, SIN_CONVERTIR))
    .groupBy(requisitionLines.dealProductId);

  return new Map(rows.map((r) => [r.dealProductId!, Number(r.pendiente)]));
}

/* ======================= El proveedor sugerido ======================= */

export type Sugerencia = { supplierId: string; reason: string };

/**
 * A quién se le suele comprar cada refacción.
 *
 * Sale del HISTORIAL, no de un campo «proveedor preferido» en el catálogo. Ese
 * campo existe en muchos ERP y en la práctica se llena una vez y nadie lo vuelve
 * a tocar, así que a los dos años miente. La última compra real no puede
 * mentir: es un hecho, y viene con su folio y su fecha para que quien la lea
 * pueda ir a verla.
 *
 * Excluye a los suspendidos y a los dados de baja. Proponer al que no se le
 * puede comprar solo hace que el comprador descubra el bloqueo tres pantallas
 * después.
 */
export async function sugerirProveedores(
  tx: DbOrTx,
  partIds: string[],
): Promise<Map<string, Sugerencia>> {
  if (partIds.length === 0) return new Map();

  // Con el constructor de consultas y no con SQL crudo, y no es por gusto: en
  // una plantilla `sql`, un array de JS se expande como LISTA DE PARÁMETROS
  // —`($1, $2)`—, no como array de Postgres, así que `= any(${partIds})` falla
  // con «malformed array literal». `inArray` genera la forma correcta y además
  // comprueba los tipos de las columnas.
  const rows = await tx
    .selectDistinctOn([purchaseOrderLines.partId], {
      partId: purchaseOrderLines.partId,
      supplierId: purchaseOrders.supplierId,
      reference: purchaseOrders.reference,
      boughtOn: sql<string>`${purchaseOrders.createdAt}::date::text`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(
      and(
        inArray(purchaseOrderLines.partId, partIds),
        ne(purchaseOrders.status, "cancelled"),
        eq(suppliers.active, true),
        isNull(suppliers.suspendedAt),
      ),
    )
    // La MÁS RECIENTE, no la más frecuente: si se cambió de proveedor hace dos
    // meses, proponer al de siempre sería proponer al que ya se dejó.
    .orderBy(purchaseOrderLines.partId, desc(purchaseOrders.createdAt));

  return new Map(
    rows.map((r) => [
      r.partId,
      {
        supplierId: r.supplierId,
        reason: `Última compra: ${r.reference} · ${r.boughtOn}`,
      },
    ]),
  );
}

/* ======================= Alta ======================= */

export type CrearDesdePedido = {
  dealId: string;
  actorId: string | null;
  neededBy?: string | null;
  notes?: string | null;
  /** Prefijo de folio explícito, para lo que corre fuera de una petición. */
  folioPrefix?: string;
};

export type CrearResultado =
  | { ok: true; id: string; reference: string; lineas: number }
  | { ok: false; reason: string };

/**
 * Crea la requisición de un pedido.
 *
 * Solo entran las líneas con `falta > 0`. Una línea cubierta por completo no se
 * escribe ni siquiera en cero: un documento lleno de renglones que no hay que
 * comprar entrena a firmarlo sin leerlo.
 */
export async function createRequisitionFromDeal(
  tx: DbOrTx,
  input: CrearDesdePedido,
): Promise<CrearResultado> {
  const [deal] = await tx
    .select({
      id: crmDeals.id,
      reference: crmDeals.reference,
      title: crmDeals.title,
      status: crmDeals.status,
    })
    .from(crmDeals)
    .where(eq(crmDeals.id, input.dealId))
    .limit(1);

  if (!deal) return { ok: false, reason: "El pedido no existe." };
  if (deal.status === "lost") {
    return { ok: false, reason: "El negocio está perdido: no hay qué surtir." };
  }

  const necesidad = await necesidadDelPedido(tx, deal.id);
  const aComprar = necesidad.filter((n) => n.falta > 0);

  if (necesidad.length === 0) {
    return { ok: false, reason: "El pedido no tiene productos capturados." };
  }
  if (aComprar.length === 0) {
    return {
      ok: false,
      reason:
        "No hace falta comprar nada: todo está en existencia, en camino o ya en trámite.",
    };
  }

  const partIds = aComprar.map((n) => n.partId).filter(Boolean) as string[];
  const sugerencias = await sugerirProveedores(tx, partIds);

  const reference = await nextRequisitionReference(tx, input.folioPrefix);
  const [req] = await tx
    .insert(requisitions)
    .values({
      reference,
      dealId: deal.id,
      title: `${deal.reference} · ${deal.title}`,
      neededBy: input.neededBy || null,
      notes: input.notes?.trim() || null,
      requestedById: input.actorId,
    })
    .returning({ id: requisitions.id });

  await tx.insert(requisitionLines).values(
    aComprar.map((n) => {
      const s = n.partId ? sugerencias.get(n.partId) : undefined;
      return {
        requisitionId: req.id,
        dealProductId: n.dealProductId,
        partId: n.partId,
        description: n.description,
        quantity: n.falta,
        supplierId: s?.supplierId ?? null,
        supplierReason: s?.reason ?? null,
        // La resta queda escrita en el renglón. Sin esto, mañana nadie puede
        // reconstruir por qué se pidieron 4 y no 10: la existencia de entonces
        // ya no es la de hoy.
        notes: n.partId
          ? `Pedido ${n.pedido} · existencia ${n.existencia} · en camino ${n.enCamino} · en trámite ${n.enTramite}`
          : "Sin refacción del catálogo: hay que identificarla antes de comprar.",
      };
    }),
  );

  await recordEvent(tx, {
    aggregateType: "requisition",
    aggregateId: req.id,
    eventType: "requisition.created",
    actorId: input.actorId,
    payload: {
      reference,
      deal: deal.reference,
      lines: aComprar.length,
      units: aComprar.reduce((a, n) => a + n.falta, 0),
      // Lo que la resta ahorró. Es el número que justifica el módulo entero.
      cubierto: necesidad.reduce(
        (a, n) => a + n.existencia + n.enCamino + n.enTramite,
        0,
      ),
    },
  });

  return { ok: true, id: req.id, reference, lineas: aComprar.length };
}

/* ======================= Circuito de autorización ======================= */

type Paso = { ok: true } | { ok: false; reason: string };

/** De qué estados se puede pasar a cuál. Un solo sitio donde consultarlo. */
const TRANSICIONES: Record<RequisitionStatus, RequisitionStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["partial", "ordered", "cancelled"],
  partial: ["ordered", "cancelled"],
  ordered: [],
  rejected: [],
  cancelled: [],
};

async function mover(
  tx: DbOrTx,
  id: string,
  destino: RequisitionStatus,
): Promise<{ ok: true; reference: string; desde: RequisitionStatus } | { ok: false; reason: string }> {
  const [req] = await tx
    .select({ status: requisitions.status, reference: requisitions.reference })
    .from(requisitions)
    .where(eq(requisitions.id, id))
    .limit(1);

  if (!req) return { ok: false, reason: "La requisición no existe." };
  if (!TRANSICIONES[req.status].includes(destino)) {
    return {
      ok: false,
      reason: `Una requisición ${REQUISITION_STATUS_LABEL[req.status].toLowerCase()} no se puede ${VERBO[destino]}.`,
    };
  }
  return { ok: true, reference: req.reference, desde: req.status };
}

const VERBO: Record<RequisitionStatus, string> = {
  draft: "regresar a borrador",
  submitted: "enviar a autorizar",
  approved: "autorizar",
  partial: "convertir",
  ordered: "convertir",
  rejected: "rechazar",
  cancelled: "cancelar",
};

/** La manda a autorizar. A partir de aquí las líneas dejan de tocarse. */
export async function submitRequisition(
  tx: DbOrTx,
  input: { id: string; actorId: string | null },
): Promise<Paso> {
  const paso = await mover(tx, input.id, "submitted");
  if (!paso.ok) return paso;

  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(requisitionLines)
    .where(eq(requisitionLines.requisitionId, input.id))) as Array<{ n: number }>;
  if (n === 0) return { ok: false, reason: "Una requisición sin renglones no se autoriza." };

  await tx
    .update(requisitions)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(requisitions.id, input.id));

  await recordEvent(tx, {
    aggregateType: "requisition",
    aggregateId: input.id,
    eventType: "requisition.submitted",
    actorId: input.actorId,
    payload: { reference: paso.reference, lines: n },
  });
  return { ok: true };
}

/**
 * Autoriza.
 *
 * `approvedById` se guarda aunque coincida con `requestedById`: el sistema no
 * impide que la misma persona pida y autorice —en una PYME de seis personas a
 * veces no hay otra—, pero lo DEJA ESCRITO. Prohibirlo llevaría a que se firme
 * con la cuenta de alguien más, que es peor: se pierde el rastro real.
 */
export async function approveRequisition(
  tx: DbOrTx,
  input: { id: string; actorId: string | null },
): Promise<Paso> {
  const paso = await mover(tx, input.id, "approved");
  if (!paso.ok) return paso;

  await tx
    .update(requisitions)
    .set({
      status: "approved",
      approvedById: input.actorId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, input.id));

  await recordEvent(tx, {
    aggregateType: "requisition",
    aggregateId: input.id,
    eventType: "requisition.approved",
    actorId: input.actorId,
    payload: { reference: paso.reference },
  });
  return { ok: true };
}

/** Rechaza. El motivo es obligatorio: sin él nadie sabe qué corregir. */
export async function rejectRequisition(
  tx: DbOrTx,
  input: { id: string; actorId: string | null; reason: string },
): Promise<Paso> {
  const motivo = input.reason.trim();
  if (motivo.length < 4) {
    return { ok: false, reason: "Escribe por qué se rechaza." };
  }
  const paso = await mover(tx, input.id, "rejected");
  if (!paso.ok) return paso;

  await tx
    .update(requisitions)
    .set({
      status: "rejected",
      resolutionReason: motivo,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, input.id));

  await recordEvent(tx, {
    aggregateType: "requisition",
    aggregateId: input.id,
    eventType: "requisition.rejected",
    actorId: input.actorId,
    payload: { reference: paso.reference, note: motivo },
  });
  return { ok: true };
}

/**
 * Cancela.
 *
 * Lo ya convertido en órdenes NO se revierte, igual que en la cancelación de
 * una orden con mercancía recibida: esas órdenes ya están en manos del
 * proveedor. Cancelar la requisición cierra lo pendiente, no borra el pasado.
 */
export async function cancelRequisition(
  tx: DbOrTx,
  input: { id: string; actorId: string | null; reason: string },
): Promise<Paso> {
  const motivo = input.reason.trim();
  if (motivo.length < 4) return { ok: false, reason: "Escribe por qué se cancela." };

  const paso = await mover(tx, input.id, "cancelled");
  if (!paso.ok) return paso;

  const [pend] = (await tx
    .select({
      n: sql<number>`coalesce(sum(${requisitionLines.quantity} - ${requisitionLines.orderedQuantity}), 0)::int`,
    })
    .from(requisitionLines)
    .where(eq(requisitionLines.requisitionId, input.id))) as Array<{ n: number }>;

  await tx
    .update(requisitions)
    .set({
      status: "cancelled",
      resolutionReason: motivo,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(requisitions.id, input.id));

  await recordEvent(tx, {
    aggregateType: "requisition",
    aggregateId: input.id,
    eventType: "requisition.cancelled",
    actorId: input.actorId,
    payload: {
      reference: paso.reference,
      note: motivo,
      previousStatus: paso.desde,
      // Cuántas piezas se dejaron de pedir: es el dato que explica después por
      // qué el pedido nunca se surtió completo.
      pendingCancelled: pend?.n ?? 0,
    },
  });
  return { ok: true };
}

/* ======================= Conversión a órdenes ======================= */

export type ConvertirResultado =
  | {
      ok: true;
      /** Una por proveedor. */
      orders: Array<{ id: string; reference: string; supplier: string; lines: number }>;
      /** Renglones que no se pudieron convertir, con su causa. */
      omitidas: Array<{ lineId: string; description: string; reason: string }>;
    }
  | { ok: false; reason: string };

/**
 * Convierte lo pendiente en órdenes de compra: UNA POR PROVEEDOR.
 *
 * Es el punto donde la requisición deja de ser un documento interno. Tres cosas
 * que no son obvias:
 *
 *  1. Se agrupa por proveedor porque la orden es lo que se le manda a ÉL. Una
 *     orden con renglones de tres proveedores no se puede enviar.
 *  2. La suspensión se vuelve a comprobar aquí, aunque ya se comprobara al
 *     sugerir. Entre que se autorizó la requisición y se convierte pueden pasar
 *     días, y suspender a un proveedor tiene que bloquear también lo que ya
 *     estaba en la cola.
 *  3. Un renglón que no se puede convertir NO tumba a los demás. Se omite con
 *     su motivo y las otras órdenes salen: parar todo porque una refacción no
 *     está identificada dejaría al pedido sin comprar por un renglón.
 */
export async function convertToPurchaseOrders(
  tx: DbOrTx,
  input: {
    id: string;
    actorId: string | null;
    /** Subconjunto de renglones. Vacío o ausente = todo lo pendiente. */
    lineIds?: string[];
    folioPrefix?: string;
  },
): Promise<ConvertirResultado> {
  const [req] = await tx
    .select({
      id: requisitions.id,
      reference: requisitions.reference,
      status: requisitions.status,
      neededBy: requisitions.neededBy,
    })
    .from(requisitions)
    .where(eq(requisitions.id, input.id))
    .limit(1)
    /*
      CON CANDADO. Sin él, un doble clic compraba el doble.

      Dos conversiones a la vez leían los mismos renglones pendientes, y las dos
      sacaban su orden: con un renglón de 2 piezas se le pedían 4 al proveedor.
      Nadie lo veía, porque `ordered_quantity` se FIJA al total en vez de
      sumarse, así que el renglón seguía diciendo «2 de 2». Con el candado la
      segunda espera a que la primera confirme, y entonces ya no hay pendiente.
      Lo encontró `_probe-acciones-requisiciones`. Quien llama tiene que pasar
      una transacción, que es lo que hace la acción.
    */
    .for("update");

  if (!req) return { ok: false, reason: "La requisición no existe." };
  if (req.status !== "approved" && req.status !== "partial") {
    return {
      ok: false,
      reason: "Solo se convierte una requisición autorizada. Pide la autorización primero.",
    };
  }

  const lineas = await tx
    .select({
      id: requisitionLines.id,
      partId: requisitionLines.partId,
      description: requisitionLines.description,
      quantity: requisitionLines.quantity,
      orderedQuantity: requisitionLines.orderedQuantity,
      supplierId: requisitionLines.supplierId,
    })
    .from(requisitionLines)
    .where(eq(requisitionLines.requisitionId, req.id))
    .orderBy(requisitionLines.createdAt);

  const elegidas = input.lineIds?.length
    ? lineas.filter((l) => input.lineIds!.includes(l.id))
    : lineas;

  const omitidas: Array<{ lineId: string; description: string; reason: string }> = [];
  const listas: typeof lineas = [];

  for (const l of elegidas) {
    const pendiente = l.quantity - l.orderedQuantity;
    if (pendiente <= 0) continue; // Ya convertida: no es una omisión, es un no-op.
    if (!l.partId) {
      omitidas.push({
        lineId: l.id,
        description: l.description,
        reason: "Sin refacción del catálogo. Identifícala para poder recibirla.",
      });
      continue;
    }
    if (!l.supplierId) {
      omitidas.push({
        lineId: l.id,
        description: l.description,
        reason: "Sin proveedor asignado.",
      });
      continue;
    }
    listas.push(l);
  }

  // Se agrupa por proveedor y se comprueba UNA vez por proveedor, no por
  // renglón: con seis renglones del mismo suspendido, seis consultas idénticas.
  const porProveedor = new Map<string, typeof lineas>();
  for (const l of listas) {
    const g = porProveedor.get(l.supplierId!);
    if (g) g.push(l);
    else porProveedor.set(l.supplierId!, [l]);
  }

  const orders: Array<{ id: string; reference: string; supplier: string; lines: number }> = [];

  for (const [supplierId, grupo] of porProveedor) {
    const [prov] = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        currency: suppliers.currency,
      })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .limit(1);

    if (!prov) {
      for (const l of grupo) {
        omitidas.push({
          lineId: l.id,
          description: l.description,
          reason: "El proveedor ya no existe.",
        });
      }
      continue;
    }

    const permitido = await assertSupplierPurchasable(tx, supplierId);
    if (!permitido.ok) {
      for (const l of grupo) {
        omitidas.push({ lineId: l.id, description: l.description, reason: permitido.reason });
      }
      continue;
    }

    const partIds = grupo.map((l) => l.partId!);
    const catalogo = await tx
      .select({
        id: spareParts.id,
        partNumber: spareParts.partNumber,
        description: spareParts.description,
        costMxn: spareParts.costMxn,
        costUsd: spareParts.costUsd,
      })
      .from(spareParts)
      .where(inArray(spareParts.id, partIds));
    const byId = new Map(catalogo.map((p) => [p.id, p]));

    const reference = await nextPurchaseOrderReference(tx, input.folioPrefix);
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        reference,
        supplierId: prov.id,
        currency: prov.currency,
        // La fecha en que se necesita viaja del pedido a la orden. Es el dato
        // que después alimenta el análisis de atraso de entrega.
        expectedAt: req.neededBy,
        notes: `Generada desde la requisición ${req.reference}.`,
        createdById: input.actorId,
      })
      .returning({ id: purchaseOrders.id });

    const usd = prov.currency === "USD";
    const filas = grupo
      .map((l) => {
        const part = byId.get(l.partId!);
        if (!part) return null;
        const costo = (usd ? part.costUsd : part.costMxn) ?? null;
        return {
          orderId: order.id,
          partId: part.id,
          // Copia histórica, igual que en el alta manual: la orden tiene que
          // seguir diciendo lo mismo aunque el catálogo se corrija mañana.
          partNumber: part.partNumber,
          description: part.description,
          quantity: l.quantity - l.orderedQuantity,
          unitCostMxn: usd ? null : costo,
          unitCostUsd: usd ? costo : null,
          requisitionLineId: l.id,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (filas.length === 0) continue;
    await tx.insert(purchaseOrderLines).values(filas as never);

    // El caché de la línea sube en la MISMA transacción que la orden, igual que
    // `received_quantity` sube con el movimiento de inventario.
    for (const l of grupo) {
      if (!byId.has(l.partId!)) continue;
      await tx
        .update(requisitionLines)
        .set({ orderedQuantity: l.quantity })
        .where(eq(requisitionLines.id, l.id));
    }

    await recordEvent(tx, {
      aggregateType: "purchase_order",
      aggregateId: order.id,
      eventType: "purchase_order.created",
      actorId: input.actorId,
      payload: {
        reference,
        supplier: prov.name,
        currency: prov.currency,
        lines: filas.length,
        units: grupo.reduce((a, l) => a + (l.quantity - l.orderedQuantity), 0),
        // El hilo de vuelta, también en la bitácora y no solo en la columna.
        requisition: req.reference,
      },
    });

    orders.push({
      id: order.id,
      reference,
      supplier: prov.name,
      lines: filas.length,
    });
  }

  // El estado se RECALCULA desde las líneas, no se adivina desde lo que acaba
  // de pasar: si quedó un renglón sin identificar, la requisición sigue abierta
  // y eso es justo lo que tiene que verse.
  const [resto] = (await tx
    .select({
      n: sql<number>`coalesce(sum(${requisitionLines.quantity} - ${requisitionLines.orderedQuantity}), 0)::int`,
    })
    .from(requisitionLines)
    .where(eq(requisitionLines.requisitionId, req.id))) as Array<{ n: number }>;

  const cerrada = (resto?.n ?? 0) <= 0;
  if (orders.length > 0) {
    await tx
      .update(requisitions)
      .set({
        status: cerrada ? "ordered" : "partial",
        closedAt: cerrada ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(requisitions.id, req.id));

    await recordEvent(tx, {
      aggregateType: "requisition",
      aggregateId: req.id,
      eventType: "requisition.ordered",
      actorId: input.actorId,
      payload: {
        reference: req.reference,
        orders: orders.map((o) => o.reference),
        pendingLines: resto?.n ?? 0,
        skipped: omitidas.length,
      },
    });
  }

  return { ok: true, orders, omitidas };
}

/* ======================= Etiquetas ======================= */

export const REQUISITION_STATUS_LABEL: Record<RequisitionStatus, string> = {
  draft: "Borrador",
  submitted: "Por autorizar",
  approved: "Autorizada",
  partial: "Parcial",
  ordered: "Convertida",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};
