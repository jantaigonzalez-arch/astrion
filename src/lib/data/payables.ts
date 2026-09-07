import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { DbOrTx } from "@/lib/db";
import {
  purchaseOrders,
  suppliers,
  supplierInvoiceOrders,
  supplierInvoices,
  supplierPayments,
  supplierCreditNotes,
  supplierCreditNoteApplications,
  supplierInvoiceInstallments,
  supplierAdvances,
  supplierAdvanceApplications,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import type {
  SupplierInvoiceStatus,
  SupplierCreditNoteStatus,
} from "@/lib/db/schema";

/**
 * Lecturas de cuentas por pagar.
 *
 * El saldo se calcula sumando el ledger de pagos y NO se lee de una columna:
 * la tabla no tiene una. Ver la nota de `domain/payables.ts` — un saldo
 * guardado se desincroniza del historial y deja de haber forma de saber cuál
 * de los dos es la verdad.
 */

export type PayableRow = {
  id: string;
  reference: string;
  supplierFolio: string | null;
  supplierId: string;
  supplierName: string;
  currency: string;
  total: number;
  /** Dinero que salió. */
  paid: number;
  /** Rebajado con notas de crédito. Baja el saldo pero no es una salida de caja. */
  credited: number;
  /** Cubierto con anticipos. Es dinero, pero salió antes de que existiera la factura. */
  advanced: number;
  balance: number;
  issuedAt: string;
  dueAt: string;
  status: SupplierInvoiceStatus;
  /** Días de atraso del vencimiento más antiguo sin cubrir. Negativo = por vencer. */
  daysLate: number;
  /** 0 = una sola exhibición. >0 = está partida en parcialidades. */
  installmentCount: number;
};

/**
 * Facturas con su saldo, ordenadas por vencimiento.
 *
 * El atraso lo calcula Postgres con su propia fecha (`current_date`) y no el
 * servidor de Node: son dos relojes y dos zonas horarias distintas, y un día de
 * diferencia cambia si una factura aparece o no en «vencidas».
 */
export async function getPayables(opts?: {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  /** Solo lo que se debe: excluye pagadas y canceladas. */
  onlyOpen?: boolean;
  /**
   * Solo el archivo: pagadas y canceladas.
   *
   * Es la mitad que crece para siempre. Una empresa que lleva tres años en el
   * sistema tiene decenas de miles de facturas cerradas y ninguna razón para
   * mirarlas todas de una vez, así que esta es la lista que se pagina.
   */
  onlyClosed?: boolean;
  limit?: number;
  offset?: number;
}, conexion?: DbOrTx): Promise<PayableRow[]> {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN: una descarga corre por el pool
    de SOLO LECTURA para no ocupar una de las dos conexiones que la empresa tiene
    para su trabajo del día. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());

  const pagado = sql<string>`coalesce((
    select sum(p.amount) from ${supplierPayments} p
     where p.invoice_id = ${supplierInvoices.id}
  ), 0)::text`;

  // Las notas de crédito bajan el saldo sin ser dinero, así que van aparte de
  // `pagado`: el saldo las suma, y el reporte de salidas de caja no.
  const acreditado = sql<string>`coalesce((
    select sum(a.amount) from ${supplierCreditNoteApplications} a
     where a.invoice_id = ${supplierInvoices.id}
  ), 0)::text`;

  // Anticipos imputados. SÍ son dinero, pero salió el día del anticipo y no
  // hoy: por eso van en su propia columna y no sumados a `pagado`, o el
  // reporte de caja del mes contaría dos veces la misma salida.
  const anticipado = sql<string>`coalesce((
    select sum(v.amount) from ${supplierAdvanceApplications} v
     where v.invoice_id = ${supplierInvoices.id}
  ), 0)::text`;

  /**
   * Días de atraso del vencimiento más antiguo sin cubrir.
   *
   * Con parcialidades, `supplier_invoices.due_at` es la fecha del ÚLTIMO pago
   * pactado, así que medir contra ella diría que una factura no está vencida
   * cuando su primera parcialidad lleva dos meses sin pagarse. Se busca la
   * primera parcialidad cuyo acumulado supera lo ya cubierto: esa es la que
   * está pendiente. Sin parcialidades se cae al vencimiento de la factura.
   */
  const moraReal = sql<number>`coalesce((
    select (current_date - x.due_at)::int
      from (
        select s.due_at,
               sum(s.amount) over (order by s.seq
                 rows between unbounded preceding and current row) as acum
          from ${supplierInvoiceInstallments} s
         where s.invoice_id = ${supplierInvoices.id}
      ) x
     where x.acum > (
       coalesce((select sum(p.amount) from ${supplierPayments} p
                  where p.invoice_id = ${supplierInvoices.id}), 0)
     + coalesce((select sum(a.amount) from ${supplierCreditNoteApplications} a
                  where a.invoice_id = ${supplierInvoices.id}), 0)
     + coalesce((select sum(v.amount) from ${supplierAdvanceApplications} v
                  where v.invoice_id = ${supplierInvoices.id}), 0))
     order by x.due_at
     limit 1
  ), (current_date - ${supplierInvoices.dueAt})::int)`;

  const query = db
    .select({
      id: supplierInvoices.id,
      reference: supplierInvoices.reference,
      supplierFolio: supplierInvoices.supplierFolio,
      supplierId: supplierInvoices.supplierId,
      supplierName: suppliers.name,
      currency: supplierInvoices.currency,
      total: supplierInvoices.total,
      paid: pagado,
      credited: acreditado,
      advanced: anticipado,
      issuedAt: supplierInvoices.issuedAt,
      dueAt: supplierInvoices.dueAt,
      status: supplierInvoices.status,
      daysLate: moraReal,
      installmentCount: sql<number>`(select count(*)::int
        from ${supplierInvoiceInstallments} s
       where s.invoice_id = ${supplierInvoices.id})`,
    })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .where(
      and(
        opts?.status ? eq(supplierInvoices.status, opts.status) : undefined,
        opts?.supplierId ? eq(supplierInvoices.supplierId, opts.supplierId) : undefined,
        opts?.onlyOpen
          ? sql`${supplierInvoices.status} in ('pending', 'partial')`
          : undefined,
        opts?.onlyClosed
          ? sql`${supplierInvoices.status} in ('paid', 'cancelled')`
          : undefined,
      ),
    )
    // El archivo se lee de lo más reciente a lo más viejo; lo pendiente, por
    // vencimiento más próximo. Son dos preguntas distintas: "¿qué pago
    // primero?" y "¿qué pasó últimamente?".
    .orderBy(
      opts?.onlyClosed ? desc(supplierInvoices.dueAt) : asc(supplierInvoices.dueAt),
    )
    .$dynamic();

  // El límite se encadena solo si lo pidieron: un `limit` fijo enorme obligaría
  // a Postgres a planificar con un tope que nunca se alcanza, y sobre todo
  // haría que quien lee esto tenga que averiguar si ese número significa algo.
  const rows = await (opts?.limit
    ? query.limit(opts.limit).offset(opts.offset ?? 0)
    : query);

  return rows.map((r) => {
    const total = Number(r.total);
    const paid = Number(r.paid);
    const credited = Number(r.credited);
    const advanced = Number(r.advanced);
    return {
      ...r,
      total,
      paid,
      credited,
      advanced,
      balance: total - paid - credited - advanced,
      daysLate: Number(r.daysLate),
      installmentCount: Number(r.installmentCount),
    };
  });
}

/**
 * Cuántas facturas hay bajo un filtro, para paginar sin traerlas.
 *
 * Solo cuenta: ni saldos, ni mora, ni parcialidades. Las subconsultas por fila
 * de `getPayables` son caras justamente porque calculan el estado real de cada
 * factura, y para saber cuántas páginas hay no hace falta nada de eso.
 */
export async function countPayables(opts?: {
  supplierId?: string;
  onlyOpen?: boolean;
  onlyClosed?: boolean;
}): Promise<number> {
  const db = await tenantDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supplierInvoices)
    .where(
      and(
        opts?.supplierId ? eq(supplierInvoices.supplierId, opts.supplierId) : undefined,
        opts?.onlyOpen
          ? sql`${supplierInvoices.status} in ('pending', 'partial')`
          : undefined,
        opts?.onlyClosed
          ? sql`${supplierInvoices.status} in ('paid', 'cancelled')`
          : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Una factura con sus órdenes amparadas y su historial de pagos. */
export async function getPayable(id: string) {
  const db = await tenantDb();

  const [invoice] = await db
    .select({
      id: supplierInvoices.id,
      reference: supplierInvoices.reference,
      supplierFolio: supplierInvoices.supplierFolio,
      cfdiUuid: supplierInvoices.cfdiUuid,
      supplierId: supplierInvoices.supplierId,
      supplierName: suppliers.name,
      paymentTermsDays: suppliers.paymentTermsDays,
      currency: supplierInvoices.currency,
      subtotal: supplierInvoices.subtotal,
      taxTotal: supplierInvoices.taxTotal,
      total: supplierInvoices.total,
      issuedAt: supplierInvoices.issuedAt,
      dueAt: supplierInvoices.dueAt,
      status: supplierInvoices.status,
      notes: supplierInvoices.notes,
      cancelReason: supplierInvoices.cancelReason,
      createdByName: users.name,
      daysLate: sql<number>`(current_date - ${supplierInvoices.dueAt})::int`,
    })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .leftJoin(users, eq(users.id, supplierInvoices.createdById))
    .where(eq(supplierInvoices.id, id))
    .limit(1);

  if (!invoice) return null;

  const [payments, orders, credits] = await Promise.all([
    db
      .select({
        id: supplierPayments.id,
        amount: supplierPayments.amount,
        balanceAfter: supplierPayments.balanceAfter,
        method: supplierPayments.method,
        reference: supplierPayments.reference,
        paidAt: supplierPayments.paidAt,
        note: supplierPayments.note,
        actorName: users.name,
        occurredAt: supplierPayments.occurredAt,
      })
      .from(supplierPayments)
      .leftJoin(users, eq(users.id, supplierPayments.actorId))
      .where(eq(supplierPayments.invoiceId, id))
      .orderBy(desc(supplierPayments.occurredAt)),
    db
      .select({
        id: purchaseOrders.id,
        reference: purchaseOrders.reference,
        status: purchaseOrders.status,
      })
      .from(supplierInvoiceOrders)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierInvoiceOrders.orderId))
      .where(eq(supplierInvoiceOrders.invoiceId, id)),
    // Las notas aplicadas van aparte de los pagos en la pantalla, y no
    // mezcladas en un solo historial: leer «se abonaron 1 500» sin distinguir
    // si ese dinero salió de la caja o no es exactamente la confusión que la
    // nota de crédito existe para eliminar.
    db
      .select({
        id: supplierCreditNoteApplications.id,
        amount: supplierCreditNoteApplications.amount,
        balanceAfter: supplierCreditNoteApplications.balanceAfter,
        appliedAt: supplierCreditNoteApplications.appliedAt,
        note: supplierCreditNoteApplications.note,
        creditNoteId: supplierCreditNotes.id,
        creditNoteRef: supplierCreditNotes.reference,
        actorName: users.name,
        occurredAt: supplierCreditNoteApplications.occurredAt,
      })
      .from(supplierCreditNoteApplications)
      .innerJoin(
        supplierCreditNotes,
        eq(supplierCreditNotes.id, supplierCreditNoteApplications.creditNoteId),
      )
      .leftJoin(users, eq(users.id, supplierCreditNoteApplications.actorId))
      .where(eq(supplierCreditNoteApplications.invoiceId, id))
      .orderBy(desc(supplierCreditNoteApplications.occurredAt)),
  ]);

  const [advances, installments] = await Promise.all([
    db
      .select({
        id: supplierAdvanceApplications.id,
        amount: supplierAdvanceApplications.amount,
        balanceAfter: supplierAdvanceApplications.balanceAfter,
        appliedAt: supplierAdvanceApplications.appliedAt,
        note: supplierAdvanceApplications.note,
        advanceRef: supplierAdvances.reference,
        advancePaidAt: supplierAdvances.paidAt,
        actorName: users.name,
      })
      .from(supplierAdvanceApplications)
      .innerJoin(
        supplierAdvances,
        eq(supplierAdvances.id, supplierAdvanceApplications.advanceId),
      )
      .leftJoin(users, eq(users.id, supplierAdvanceApplications.actorId))
      .where(eq(supplierAdvanceApplications.invoiceId, id))
      .orderBy(desc(supplierAdvanceApplications.occurredAt)),
    db
      .select({
        id: supplierInvoiceInstallments.id,
        seq: supplierInvoiceInstallments.seq,
        amount: supplierInvoiceInstallments.amount,
        dueAt: supplierInvoiceInstallments.dueAt,
        note: supplierInvoiceInstallments.note,
        daysLate: sql<number>`(current_date - ${supplierInvoiceInstallments.dueAt})::int`,
      })
      .from(supplierInvoiceInstallments)
      .where(eq(supplierInvoiceInstallments.invoiceId, id))
      .orderBy(asc(supplierInvoiceInstallments.seq)),
  ]);

  const total = Number(invoice.total);
  const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
  const credited = credits.reduce((a, c) => a + Number(c.amount), 0);
  const advanced = advances.reduce((a, v) => a + Number(v.amount), 0);
  const cubierto = paid + credited + advanced;

  // Estado de cada parcialidad, derivado en cascada. Mismo criterio que la
  // consulta de antigüedad: se imputa de la más antigua a la más nueva.
  let acumulado = 0;
  const plan = installments.map((p) => {
    const importe = Number(p.amount);
    const antes = acumulado;
    acumulado += importe;
    const saldo = Math.max(0, Math.min(importe, antes + importe - cubierto));
    return {
      ...p,
      amount: importe,
      balance: saldo,
      paid: importe - saldo,
      daysLate: Number(p.daysLate),
      status: saldo <= 0.005 ? ("paid" as const) : saldo < importe ? ("partial" as const) : ("pending" as const),
    };
  });

  return {
    invoice: {
      ...invoice,
      total,
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.taxTotal),
      daysLate: Number(invoice.daysLate),
    },
    payments,
    credits,
    advances,
    installments: plan,
    orders,
    paid,
    credited,
    advanced,
    balance: total - cubierto,
  };
}

/**
 * Órdenes que se le pueden facturar a un proveedor.
 *
 * Recibidas o parciales: de un borrador no hay mercancía que facturar, y una
 * cancelada no se factura. Se excluyen las que YA están amparadas por otra
 * factura viva — una orden facturada dos veces es una deuda duplicada, que es
 * justo lo que este módulo existe para evitar.
 */
export async function getInvoiceableOrders(supplierId?: string) {
  const db = await tenantDb();
  return db
    .select({
      id: purchaseOrders.id,
      reference: purchaseOrders.reference,
      supplierId: purchaseOrders.supplierId,
      status: purchaseOrders.status,
      currency: purchaseOrders.currency,
      expectedAt: purchaseOrders.expectedAt,
      total: sql<string>`coalesce((
        select sum(l.quantity * coalesce(l.unit_cost_mxn, l.unit_cost_usd, 0))
          from purchase_order_lines l where l.order_id = ${purchaseOrders.id}
      ), 0)::text`,
    })
    .from(purchaseOrders)
    .where(
      and(
        supplierId ? eq(purchaseOrders.supplierId, supplierId) : undefined,
        sql`${purchaseOrders.status} in ('sent', 'partial', 'received')`,
        sql`not exists (
          select 1 from supplier_invoice_orders io
            join supplier_invoices i on i.id = io.invoice_id
           where io.order_id = ${purchaseOrders.id}
             and i.status <> 'cancelled')`,
      ),
    )
    .orderBy(desc(purchaseOrders.createdAt));
}

/**
 * Saldo de una factura `i` en SQL crudo: total menos pagos menos notas de
 * crédito aplicadas.
 *
 * Se define una vez y se interpola en las tres consultas que lo necesitan
 * —resumen, antigüedad e historial—. Tres copias de esta expresión es
 * exactamente cómo un módulo acaba enseñando tres saldos distintos para la
 * misma factura el día que se añade un concepto nuevo.
 */
const SALDO_ABIERTO = sql`
  i.total
  - coalesce((select sum(p.amount) from supplier_payments p
               where p.invoice_id = i.id), 0)
  - coalesce((select sum(a.amount) from supplier_credit_note_applications a
               where a.invoice_id = i.id), 0)
  - coalesce((select sum(v.amount) from supplier_advance_applications v
               where v.invoice_id = i.id), 0)`;

/**
 * Las facturas abiertas expandidas en VENCIMIENTOS, con el saldo de cada uno.
 *
 * Es la pieza central de las parcialidades. Una factura sin partir aporta un
 * vencimiento —ella misma—; una partida aporta uno por parcialidad. Todo lo que
 * mide mora se apoya en esto, así que una factura de 78 880 a tres pagos deja
 * de aparecer entera como vencida el día que pasa el primero.
 *
 * La imputación es EN CASCADA, de la parcialidad más antigua a la más nueva:
 * es como se aplica un pago cuando nadie dice a qué vencimiento va, y es lo que
 * permite no guardar un estado por parcialidad. La fórmula por renglón es
 *
 *     saldo = min(importe, max(0, acumulado_anterior + importe − cubierto))
 *
 * donde `cubierto` es todo lo aplicado a la factura —pagos, notas de crédito y
 * anticipos imputados— y `acumulado_anterior` sale de una ventana sobre `seq`.
 *
 * Se define una vez y se interpola donde haga falta. Tres copias de esta
 * consulta es cómo el módulo acabaría enseñando tres moras distintas para la
 * misma factura.
 */
const VENCIMIENTOS = sql`
  cubierto as (
    select i.id as invoice_id,
           coalesce((select sum(p.amount) from supplier_payments p
                      where p.invoice_id = i.id), 0)
         + coalesce((select sum(a.amount) from supplier_credit_note_applications a
                      where a.invoice_id = i.id), 0)
         + coalesce((select sum(v.amount) from supplier_advance_applications v
                      where v.invoice_id = i.id), 0) as monto
      from supplier_invoices i
     where i.status in ('pending', 'partial')
  ),
  crudos as (
    select i.id as invoice_id, i.supplier_id, i.currency,
           s.seq, s.due_at, s.amount as importe
      from supplier_invoices i
      join supplier_invoice_installments s on s.invoice_id = i.id
     where i.status in ('pending', 'partial')
    union all
    -- Sin parcialidades: la factura entera es un único vencimiento.
    select i.id, i.supplier_id, i.currency, 1, i.due_at, i.total
      from supplier_invoices i
     where i.status in ('pending', 'partial')
       and not exists (select 1 from supplier_invoice_installments s
                        where s.invoice_id = i.id)
  ),
  cascada as (
    select c.*,
           coalesce(sum(c.importe) over (
             partition by c.invoice_id order by c.seq
             rows between unbounded preceding and 1 preceding), 0) as antes
      from crudos c
  ),
  vencimientos as (
    select c.invoice_id, c.supplier_id, c.currency, c.seq, c.due_at, c.importe,
           (current_date - c.due_at)::int as mora,
           greatest(0, least(c.importe, c.antes + c.importe - k.monto)) as saldo
      from cascada c
      join cubierto k on k.invoice_id = c.invoice_id
  )`;

export type CurrencySummary = {
  currency: string;
  /** Lo que se debe en total, de lo que sigue abierto. */
  balance: number;
  count: number;
  /** Vencido: la fecha ya pasó y sigue con saldo. */
  overdue: number;
  overdueCount: number;
  /** Vence dentro de los próximos 7 días. */
  dueSoon: number;
  dueSoonCount: number;
};

/**
 * El resumen, SEPARADO POR MONEDA.
 *
 * No es una floritura: sumar 12 000 USD con 300 000 MXN en un solo «saldo
 * total» da un número que no existe en ninguna divisa. Convertirlos tampoco
 * serviría sin fijar a qué tipo de cambio y de qué día — y esa conversión es
 * una decisión contable, no algo que una pantalla de saldos deba inventar.
 *
 * Casi siempre trae un solo elemento. La pantalla lo pinta igual que antes
 * cuando así es, y solo se desdobla si de verdad hay más de una.
 */
export type PayablesSummary = {
  byCurrency: CurrencySummary[];
  /** Si es true, la pantalla no puede enseñar un único total. */
  multiCurrency: boolean;
};

/**
 * El resumen que encabeza la pantalla.
 *
 * Separa vencido de por vencer porque son dos decisiones distintas: lo vencido
 * ya es un problema con el proveedor, lo que vence esta semana es la lista de
 * pagos a programar.
 */
export async function getPayablesSummary(
  conexion?: DbOrTx,
): Promise<PayablesSummary> {
  return payablesSummaryFrom(conexion ?? (await tenantDb()));
}

/**
 * Igual que la anterior con la conexión explícita, para lo que corre fuera de
 * una petición. Mismo par que `tenantDb()` / `tenantDbFor()`.
 *
 * Existe sobre todo para poder PROBAR esta consulta: es SQL crudo, así que el
 * typecheck no la mira, y es la que decide qué se considera vencido.
 */
export async function payablesSummaryFrom(db: DbOrTx): Promise<PayablesSummary> {
  // Los importes se miden por VENCIMIENTO y los conteos por FACTURA: «$X
  // vencidos» es la suma de lo que de verdad venció, pero «3 facturas» tiene
  // que seguir siendo tres facturas y no seis parcialidades.
  const rows = (await db.execute(sql`
    with ${VENCIMIENTOS}
    select
      currency,
      coalesce(sum(saldo), 0)::text                                     as balance,
      count(distinct invoice_id)::int                                   as count,
      coalesce(sum(saldo) filter (where mora > 0), 0)::text             as overdue,
      count(distinct invoice_id) filter (where mora > 0)::int           as overdue_count,
      coalesce(sum(saldo) filter (
        where mora <= 0 and due_at <= current_date + 7), 0)::text       as due_soon,
      count(distinct invoice_id) filter (
        where mora <= 0 and due_at <= current_date + 7)::int            as due_soon_count
      from vencimientos where saldo > 0.005
     group by currency
     order by sum(saldo) desc`)) as unknown as Array<{
    currency: string;
    balance: string;
    count: number;
    overdue: string;
    overdue_count: number;
    due_soon: string;
    due_soon_count: number;
  }>;

  const byCurrency = rows.map((r) => ({
    currency: r.currency,
    balance: Number(r.balance),
    count: Number(r.count),
    overdue: Number(r.overdue),
    overdueCount: Number(r.overdue_count),
    dueSoon: Number(r.due_soon),
    dueSoonCount: Number(r.due_soon_count),
  }));

  return { byCurrency, multiCurrency: byCurrency.length > 1 };
}

/* ===================== Antigüedad de saldos ===================== */

export type AgingBucket = {
  /** `al_corriente` | `d1_30` | `d31_60` | `d61_90` | `d90_mas` */
  key: AgingKey;
  amount: number;
  count: number;
};

export type AgingKey = "al_corriente" | "d1_30" | "d31_60" | "d61_90" | "d90_mas";

export const AGING_LABEL: Record<AgingKey, string> = {
  al_corriente: "Al corriente",
  d1_30: "1 a 30 días",
  d31_60: "31 a 60 días",
  d61_90: "61 a 90 días",
  d90_mas: "Más de 90 días",
};

export type SupplierAgingRow = {
  supplierId: string;
  supplierName: string;
  /** Días de crédito pactados, para leer la mora en su contexto. */
  paymentTermsDays: number;
  total: number;
  buckets: Record<AgingKey, number>;
};

export type CurrencyAging = {
  currency: string;
  buckets: AgingBucket[];
  bySupplier: SupplierAgingRow[];
  total: number;
};

/**
 * La antigüedad, SEPARADA POR MONEDA. Misma razón que el resumen: un total que
 * suma dólares con pesos no es un importe de nada.
 */
export type PayablesAging = {
  byCurrency: CurrencyAging[];
  multiCurrency: boolean;
};

/**
 * Antigüedad de saldos: cuánto se debe y desde hace cuánto.
 *
 * Es la vista con la que de verdad se decide a quién pagar. El total y lo
 * vencido dicen si hay un problema; los tramos dicen de quién es y qué tan
 * viejo — un proveedor con 40 000 a noventa días es una llamada de teléfono
 * distinta a otro con 40 000 vencidos ayer.
 *
 * Los tramos se miden desde el VENCIMIENTO, no desde la emisión: un proveedor a
 * 90 días de crédito no está moroso el día 60, y medir desde la emisión lo
 * pintaría de rojo por haber concedido mejores condiciones.
 */
export async function getPayablesAging(conexion?: DbOrTx): Promise<PayablesAging> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    with ${VENCIMIENTOS},
    clasificadas as (
      select supplier_id, currency, saldo,
             case
               when mora <= 0  then 'al_corriente'
               when mora <= 30 then 'd1_30'
               when mora <= 60 then 'd31_60'
               when mora <= 90 then 'd61_90'
               else 'd90_mas'
             end as tramo
        from vencimientos
       where saldo > 0.005
    )
    select s.id                 as supplier_id,
           s.name               as supplier_name,
           s.payment_terms_days as terms,
           c.currency           as currency,
           c.tramo              as tramo,
           sum(c.saldo)::text   as importe,
           count(*)::int        as cuantas
      from clasificadas c
      join suppliers s on s.id = c.supplier_id
     group by s.id, s.name, s.payment_terms_days, c.currency, c.tramo`)) as unknown as Array<{
    supplier_id: string;
    supplier_name: string;
    terms: number;
    currency: string;
    tramo: AgingKey;
    importe: string;
    cuantas: number;
  }>;

  const vacios = (): Record<AgingKey, number> => ({
    al_corriente: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_mas: 0,
  });

  type Acc = {
    totales: Record<AgingKey, number>;
    conteos: Record<AgingKey, number>;
    porProveedor: Map<string, SupplierAgingRow>;
  };
  const porMoneda = new Map<string, Acc>();

  for (const r of rows) {
    let acc = porMoneda.get(r.currency);
    if (!acc) {
      acc = { totales: vacios(), conteos: vacios(), porProveedor: new Map() };
      porMoneda.set(r.currency, acc);
    }

    const importe = Number(r.importe);
    acc.totales[r.tramo] += importe;
    acc.conteos[r.tramo] += r.cuantas;

    let fila = acc.porProveedor.get(r.supplier_id);
    if (!fila) {
      fila = {
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        paymentTermsDays: r.terms,
        total: 0,
        buckets: vacios(),
      };
      acc.porProveedor.set(r.supplier_id, fila);
    }
    fila.buckets[r.tramo] += importe;
    fila.total += importe;
  }

  const orden: AgingKey[] = ["al_corriente", "d1_30", "d31_60", "d61_90", "d90_mas"];

  const byCurrency = [...porMoneda.entries()]
    .map(([currency, acc]) => ({
      currency,
      buckets: orden.map((key) => ({
        key,
        amount: acc.totales[key],
        count: acc.conteos[key],
      })),
      // De mayor deuda a menor: quien más pesa es a quien primero hay que mirar.
      bySupplier: [...acc.porProveedor.values()].sort((a, b) => b.total - a.total),
      total: orden.reduce((s2, k) => s2 + acc.totales[k], 0),
    }))
    // La moneda con más saldo primero: casi siempre la local.
    .sort((a, b) => b.total - a.total);

  return { byCurrency, multiCurrency: byCurrency.length > 1 };
}

/* ===================== Historial crediticio ===================== */

export type SupplierCreditHistory = {
  supplierId: string;
  supplierName: string;
  rfc: string | null;
  /** Días de crédito pactados. La vara contra la que se mide todo lo demás. */
  paymentTermsDays: number;
  /** Saldo abierto hoy. */
  balance: number;
  openCount: number;
  /** Facturado en los últimos 12 meses. */
  purchased12m: number;
  /** Facturas saldadas de las que se puede medir comportamiento. */
  settledCount: number;
  /**
   * Días reales desde la emisión hasta el último pago, ponderados por importe.
   * `null` si todavía no hay ninguna saldada.
   */
  avgDaysToPay: number | null;
  /** % de facturas saldadas dentro del plazo pactado. */
  onTimePct: number | null;
  /** La peor mora registrada, en días. */
  worstLateDays: number | null;
  /** Saldo a favor: notas de crédito con importe sin aplicar. */
  creditAvailable: number;
};

/**
 * Cómo se le ha pagado a un proveedor.
 *
 * Los días promedio se ponderan POR IMPORTE y no por número de facturas. Sin
 * ponderar, veinte facturas de mil pagadas puntuales tapan una de doscientos
 * mil pagada con sesenta días de retraso, que es justo la que define la
 * relación con ese proveedor.
 *
 * Se mide contra facturas SALDADAS: una abierta todavía puede pagarse a tiempo
 * y contarla como mora sería adelantar un juicio. Lo abierto y vencido ya sale
 * en la antigüedad.
 */
export async function getSupplierCreditHistory(
  supplierId: string,
  conexion?: DbOrTx,
): Promise<SupplierCreditHistory | null> {
  const db = conexion ?? (await tenantDb());

  const base = (await db.execute(sql`
    select id, name, rfc, payment_terms_days as terms
      from suppliers where id = ${supplierId}::uuid`)) as unknown as Array<{
    id: string;
    name: string;
    rfc: string | null;
    terms: number;
  }>;
  const s = base[0];
  if (!s) return null;

  const rows = (await db.execute(sql`
    with saldos as (
      select i.id, i.status, i.issued_at, i.due_at, i.total,
             ${SALDO_ABIERTO} as saldo
        from supplier_invoices i
       where i.supplier_id = ${supplierId}::uuid
         and i.status <> 'cancelled'
    ),
    saldadas as (
      -- Fecha en que quedó cubierta: el último movimiento que la cerró, sea un
      -- pago o la aplicación de una nota de crédito.
      select s.id, s.issued_at, s.due_at, s.total,
             greatest(
               coalesce((select max(p.paid_at) from supplier_payments p
                          where p.invoice_id = s.id), s.issued_at),
               coalesce((select max(a.applied_at)
                           from supplier_credit_note_applications a
                          where a.invoice_id = s.id), s.issued_at)
             ) as cubierta_el
        from saldos s
       where s.status = 'paid'
    )
    select
      coalesce((select sum(saldo) from saldos where status in ('pending','partial')), 0)::text as balance,
      coalesce((select count(*) from saldos where status in ('pending','partial')), 0)::int    as open_count,
      coalesce((select sum(total) from saldos
                 where issued_at >= current_date - interval '12 months'), 0)::text             as purchased_12m,
      (select count(*) from saldadas)::int                                                     as settled_count,
      (select sum((cubierta_el - issued_at)::int * total) / nullif(sum(total), 0)
         from saldadas)::float8                                                                as avg_days,
      (select count(*) filter (where cubierta_el <= due_at)::float8 / nullif(count(*), 0) * 100
         from saldadas)::float8                                                                as on_time,
      (select max((cubierta_el - due_at)::int) from saldadas)::int                             as worst_late,
      coalesce((
        select sum(n.total - coalesce((
                 select sum(a.amount) from supplier_credit_note_applications a
                  where a.credit_note_id = n.id), 0))
          from supplier_credit_notes n
         where n.supplier_id = ${supplierId}::uuid and n.status = 'open'
      ), 0)::text                                                                              as credit_available
  `)) as unknown as Array<{
    balance: string;
    open_count: number;
    purchased_12m: string;
    settled_count: number;
    avg_days: number | null;
    on_time: number | null;
    worst_late: number | null;
    credit_available: string;
  }>;

  const r = rows[0];
  return {
    supplierId: s.id,
    supplierName: s.name,
    rfc: s.rfc,
    paymentTermsDays: s.terms,
    balance: Number(r?.balance ?? 0),
    openCount: Number(r?.open_count ?? 0),
    purchased12m: Number(r?.purchased_12m ?? 0),
    settledCount: Number(r?.settled_count ?? 0),
    avgDaysToPay: r?.avg_days === null || r?.avg_days === undefined ? null : Math.round(r.avg_days),
    onTimePct: r?.on_time === null || r?.on_time === undefined ? null : Math.round(r.on_time),
    // Una mora negativa significa que se pagó antes de vencer: no es mora.
    worstLateDays:
      r?.worst_late === null || r?.worst_late === undefined
        ? null
        : Math.max(0, r.worst_late),
    creditAvailable: Number(r?.credit_available ?? 0),
  };
}

export type CreditNoteRow = {
  id: string;
  reference: string;
  supplierFolio: string | null;
  currency: string;
  total: number;
  applied: number;
  remaining: number;
  issuedAt: string;
  status: SupplierCreditNoteStatus;
};

/** Notas de crédito de un proveedor, con lo que les queda sin aplicar. */
export async function getSupplierCreditNotes(
  supplierId: string,
): Promise<CreditNoteRow[]> {
  const db = await tenantDb();
  const rows = (await db.execute(sql`
    select n.id, n.reference, n.supplier_folio, n.currency, n.status,
           n.issued_at::text as issued_at,
           n.total::text     as total,
           coalesce((select sum(a.amount) from supplier_credit_note_applications a
                      where a.credit_note_id = n.id), 0)::text as applied
      from supplier_credit_notes n
     where n.supplier_id = ${supplierId}::uuid
     order by n.issued_at desc, n.reference desc`)) as unknown as Array<{
    id: string;
    reference: string;
    supplier_folio: string | null;
    currency: string;
    status: SupplierCreditNoteStatus;
    issued_at: string;
    total: string;
    applied: string;
  }>;

  return rows.map((r) => {
    const total = Number(r.total);
    const applied = Number(r.applied);
    return {
      id: r.id,
      reference: r.reference,
      supplierFolio: r.supplier_folio,
      currency: r.currency,
      total,
      applied,
      remaining: total - applied,
      issuedAt: r.issued_at,
      status: r.status,
    };
  });
}

/** Datos de suspensión y anticipos abiertos de un proveedor. */
export async function getSupplierControls(supplierId: string) {
  const db = await tenantDb();

  const [row] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      currency: suppliers.currency,
      active: suppliers.active,
      suspendedAt: sql<string | null>`to_char(${suppliers.suspendedAt}, 'YYYY-MM-DD')`,
      suspendReason: suppliers.suspendReason,
      suspendedBy: users.name,
    })
    .from(suppliers)
    .leftJoin(users, eq(users.id, suppliers.suspendedById))
    .where(eq(suppliers.id, supplierId))
    .limit(1);

  if (!row) return null;

  const advances = (await db.execute(sql`
    select a.id, a.reference, a.currency, a.status,
           a.paid_at::text as paid_at,
           a.amount::text  as amount,
           a.payment_reference,
           coalesce((select sum(x.amount) from supplier_advance_applications x
                      where x.advance_id = a.id), 0)::text as applied
      from supplier_advances a
     where a.supplier_id = ${supplierId}::uuid
     order by a.paid_at desc, a.reference desc`)) as unknown as Array<{
    id: string;
    reference: string;
    currency: string;
    status: string;
    paid_at: string;
    amount: string;
    payment_reference: string | null;
    applied: string;
  }>;

  return {
    supplier: row,
    advances: advances.map((a) => {
      const total = Number(a.amount);
      const applied = Number(a.applied);
      return {
        id: a.id,
        reference: a.reference,
        currency: a.currency,
        status: a.status,
        paidAt: a.paid_at,
        paymentReference: a.payment_reference,
        amount: total,
        applied,
        remaining: total - applied,
      };
    }),
  };
}

/* ===================== Análisis de cuentas por pagar ===================== */

/**
 * Estas consultas aceptan una conexión explícita además de tomarla del
 * inquilino activo, por la misma razón que `payablesSummaryFrom`: son SQL crudo
 * que el typecheck no mira, y sin poder ejecutarlas fuera de una petición el
 * único sitio donde se descubre un error es la pantalla del usuario.
 *
 * Ya pasó: `current_date + $1` con el parámetro sin tipo hacía que Postgres no
 * supiera si sumar días o un intervalo, y reventaba solo en producción porque
 * la prueba a mano usaba un literal. De ahí el `::int` explícito abajo.
 */

export type WeekBucket = {
  /** `vencido` para lo que ya pasó, o el lunes de la semana en `YYYY-MM-DD`. */
  key: string;
  label: string;
  overdue: boolean;
  amount: number;
  count: number;
};

export type PaymentCalendar = {
  currency: string;
  weeks: WeekBucket[];
  total: number;
};

/**
 * Qué hay que pagar y cuándo, por semana.
 *
 * La antigüedad mira hacia atrás —cuánto lleva vencido—; esto mira hacia
 * adelante, que es la pregunta de tesorería: cuánto tengo que tener disponible
 * las próximas seis semanas. Son dos lecturas del mismo saldo y ninguna
 * sustituye a la otra.
 *
 * Lo vencido va en un tramo aparte y primero: no tiene semana futura a la que
 * pertenecer, y repartirlo por su fecha original lo escondería a la izquierda
 * del calendario.
 */
export async function getPaymentCalendar(
  weeks = 6,
  conexion?: DbOrTx,
): Promise<PaymentCalendar[]> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    with ${VENCIMIENTOS}
    select currency,
           case when mora > 0 then 'vencido'
                else to_char(date_trunc('week', due_at), 'YYYY-MM-DD') end as tramo,
           (mora > 0)                as vencido,
           sum(saldo)::text          as importe,
           count(*)::int             as cuantos
      from vencimientos
     where saldo > 0.005
       and (mora > 0 or due_at < current_date + ${weeks * 7}::int)
     group by currency, tramo, vencido
     order by currency, vencido desc, tramo`)) as unknown as Array<{
    currency: string;
    tramo: string;
    vencido: boolean;
    importe: string;
    cuantos: number;
  }>;

  const porMoneda = new Map<string, WeekBucket[]>();
  for (const r of rows) {
    const lista = porMoneda.get(r.currency) ?? [];
    lista.push({
      key: r.tramo,
      label: r.vencido ? "Vencido" : etiquetaSemana(r.tramo),
      overdue: r.vencido,
      amount: Number(r.importe),
      count: r.cuantos,
    });
    porMoneda.set(r.currency, lista);
  }

  return [...porMoneda.entries()]
    .map(([currency, semanas]) => ({
      currency,
      weeks: semanas,
      total: semanas.reduce((a, s) => a + s.amount, 0),
    }))
    .sort((a, b) => b.total - a.total);
}

function etiquetaSemana(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const lunes = new Date(Date.UTC(y, m - 1, d));
  const domingo = new Date(lunes);
  domingo.setUTCDate(domingo.getUTCDate() + 6);
  const dd = (t: Date) => String(t.getUTCDate()).padStart(2, "0");
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${dd(lunes)}–${dd(domingo)} ${MES[domingo.getUTCMonth()]}`;
}

export type CashMonth = {
  month: string;
  label: string;
  /** Pagos contra factura. */
  payments: number;
  /** Anticipos entregados. También es caja, pero sin factura detrás. */
  advances: number;
  total: number;
};

/**
 * Salida de caja por mes.
 *
 * Suma pagos y anticipos porque los dos sacaron dinero del banco. NO suma las
 * imputaciones de anticipo —ese dinero ya se contó el día que salió— ni las
 * notas de crédito, que bajan la deuda sin mover un peso. Esa distinción es
 * toda la razón por la que estos tres conceptos viven en tablas separadas.
 *
 * Solo la moneda que más pesa: mezclar divisas en una serie temporal daría una
 * línea que no representa ningún importe real.
 */
export async function getCashOutByMonth(
  months = 12,
  conexion?: DbOrTx,
): Promise<{
  currency: string;
  data: CashMonth[];
}> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    with movs as (
      select i.currency, p.paid_at::date as fecha, p.amount, 'pago' as tipo
        from supplier_payments p
        join supplier_invoices i on i.id = p.invoice_id
      union all
      select a.currency, a.paid_at::date, a.amount, 'anticipo'
        from supplier_advances a
       where a.status <> 'cancelled'
    ),
    principal as (
      select currency from movs group by currency order by sum(amount) desc limit 1
    ),
    meses as (
      select to_char(generate_series(
               date_trunc('month', current_date) - ${`${months - 1} months`}::interval,
               date_trunc('month', current_date),
               '1 month'), 'YYYY-MM') as mes
    )
    select m.mes,
           (select currency from principal) as currency,
           coalesce(sum(v.amount) filter (where v.tipo = 'pago'), 0)::text     as pagos,
           coalesce(sum(v.amount) filter (where v.tipo = 'anticipo'), 0)::text as anticipos
      from meses m
      left join movs v
        on to_char(v.fecha, 'YYYY-MM') = m.mes
       and v.currency = (select currency from principal)
     group by m.mes
     order by m.mes`)) as unknown as Array<{
    mes: string;
    currency: string | null;
    pagos: string;
    anticipos: string;
  }>;

  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return {
    currency: rows[0]?.currency ?? "MXN",
    data: rows.map((r) => {
      const payments = Number(r.pagos);
      const advances = Number(r.anticipos);
      return {
        month: r.mes,
        label: MES[Number(r.mes.slice(5, 7)) - 1],
        payments,
        advances,
        total: payments + advances,
      };
    }),
  };
}

export type IdleMoney = {
  /** Anticipos entregados y todavía sin imputar a ninguna factura. */
  advances: { total: number; count: number; oldestDays: number | null };
  /** Notas de crédito con saldo a favor sin aplicar. */
  creditNotes: { total: number; count: number; oldestDays: number | null };
  currency: string;
};

/**
 * Dinero parado.
 *
 * Las dos formas de tener saldo a favor sin usarlo: un anticipo que ya salió
 * del banco y no se ha imputado a nada, y una nota de crédito que el proveedor
 * concedió y nadie aplicó. Las dos se pagan dos veces si se olvidan — se le
 * vuelve a pagar al proveedor lo que ya se le adelantó, o se le paga íntegra
 * una factura que traía descuento.
 *
 * La antigüedad importa: un anticipo de hace ocho meses sin imputar suele
 * significar que la factura nunca llegó.
 */
export async function getIdleMoney(conexion?: DbOrTx): Promise<IdleMoney> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    select
      coalesce((select sum(a.amount - coalesce((
                 select sum(x.amount) from supplier_advance_applications x
                  where x.advance_id = a.id), 0))
                 from supplier_advances a where a.status = 'open'), 0)::text as ant_total,
      (select count(*) from supplier_advances a where a.status = 'open'
         and a.amount > coalesce((select sum(x.amount)
               from supplier_advance_applications x where x.advance_id = a.id), 0))::int as ant_n,
      (select max((current_date - a.paid_at)::int) from supplier_advances a
        where a.status = 'open')::int as ant_dias,
      coalesce((select sum(n.total - coalesce((
                 select sum(x.amount) from supplier_credit_note_applications x
                  where x.credit_note_id = n.id), 0))
                 from supplier_credit_notes n where n.status = 'open'), 0)::text as nc_total,
      (select count(*) from supplier_credit_notes n where n.status = 'open')::int as nc_n,
      (select max((current_date - n.issued_at)::int) from supplier_credit_notes n
        where n.status = 'open')::int as nc_dias,
      (select currency from supplier_invoices
        group by currency order by count(*) desc limit 1) as moneda
  `)) as unknown as Array<{
    ant_total: string;
    ant_n: number;
    ant_dias: number | null;
    nc_total: string;
    nc_n: number;
    nc_dias: number | null;
    moneda: string | null;
  }>;

  const r = rows[0];
  return {
    advances: {
      total: Number(r?.ant_total ?? 0),
      count: Number(r?.ant_n ?? 0),
      oldestDays: r?.ant_dias ?? null,
    },
    creditNotes: {
      total: Number(r?.nc_total ?? 0),
      count: Number(r?.nc_n ?? 0),
      oldestDays: r?.nc_dias ?? null,
    },
    currency: r?.moneda ?? "MXN",
  };
}

export type SupplierBehavior = {
  supplierId: string;
  supplierName: string;
  paymentTermsDays: number;
  currency: string;
  balance: number;
  /** % del saldo total de su moneda. */
  share: number;
  settledCount: number;
  avgDaysToPay: number | null;
  onTimePct: number | null;
  suspended: boolean;
};

/**
 * Comportamiento de pago y concentración, de todos los proveedores a la vez.
 *
 * Es la versión agregada de lo que la ficha de cada proveedor enseña por
 * separado, y contesta la pregunta que ninguna ficha puede: de quién dependemos
 * y a quién le estamos quedando mal. Mismos criterios que
 * `getSupplierCreditHistory` —días ponderados por importe, solo facturas
 * saldadas—, para que los dos números coincidan.
 */
export async function getSupplierBehavior(
  conexion?: DbOrTx,
): Promise<SupplierBehavior[]> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    with saldadas as (
      select i.supplier_id, i.currency, i.issued_at, i.due_at, i.total,
             greatest(
               coalesce((select max(p.paid_at) from supplier_payments p
                          where p.invoice_id = i.id), i.issued_at),
               coalesce((select max(a.applied_at)
                           from supplier_credit_note_applications a
                          where a.invoice_id = i.id), i.issued_at),
               coalesce((select max(v.applied_at)
                           from supplier_advance_applications v
                          where v.invoice_id = i.id), i.issued_at)
             ) as cubierta
        from supplier_invoices i where i.status = 'paid'
    ),
    abiertas as (
      select i.supplier_id, i.currency, ${SALDO_ABIERTO} as saldo
        from supplier_invoices i where i.status in ('pending', 'partial')
    )
    select s.id, s.name, s.payment_terms_days as terms,
           s.currency, (s.suspended_at is not null) as suspendido,
           coalesce((select sum(saldo) from abiertas a
                      where a.supplier_id = s.id), 0)::text as saldo,
           (select count(*) from saldadas d where d.supplier_id = s.id)::int as n,
           (select sum((d.cubierta - d.issued_at)::int * d.total) / nullif(sum(d.total), 0)
              from saldadas d where d.supplier_id = s.id)::float8 as dias,
           (select count(*) filter (where d.cubierta <= d.due_at)::float8
                    / nullif(count(*), 0) * 100
              from saldadas d where d.supplier_id = s.id)::float8 as puntual
      from suppliers s
     where s.active = true`)) as unknown as Array<{
    id: string;
    name: string;
    terms: number;
    currency: string;
    suspendido: boolean;
    saldo: string;
    n: number;
    dias: number | null;
    puntual: number | null;
  }>;

  // La cuota se calcula sobre el saldo de SU moneda: un proveedor en dólares no
  // representa un porcentaje de la deuda en pesos.
  const totalPorMoneda = new Map<string, number>();
  for (const r of rows) {
    totalPorMoneda.set(
      r.currency,
      (totalPorMoneda.get(r.currency) ?? 0) + Number(r.saldo),
    );
  }

  return rows
    .map((r) => {
      const balance = Number(r.saldo);
      const totalMoneda = totalPorMoneda.get(r.currency) ?? 0;
      return {
        supplierId: r.id,
        supplierName: r.name,
        paymentTermsDays: r.terms,
        currency: r.currency,
        balance,
        share: totalMoneda > 0 ? (balance / totalMoneda) * 100 : 0,
        settledCount: r.n,
        avgDaysToPay: r.dias === null ? null : Math.round(r.dias),
        onTimePct: r.puntual === null ? null : Math.round(r.puntual),
        suspended: r.suspendido,
      };
    })
    .filter((r) => r.balance > 0.005 || r.settledCount > 0)
    .sort((a, b) => b.balance - a.balance);
}
