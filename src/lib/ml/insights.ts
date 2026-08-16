import "server-only";
import type { DbOrTx } from "@/lib/db";
import type {
  Block,
  ForecastBlock,
  ProjectionBlock,
  TrendBlock,
} from "./blocks-types";
import { sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { templateById } from "./templates";

/**
 * La capa de análisis del ERP.
 *
 * El laboratorio (`/admin/ml`) es donde se ENTRENA. Esto es donde se USA: la
 * frase que aparece en la pantalla de trabajo y cambia una decisión. Si la
 * predicción solo vive en el panel de administración, el producto tiene un
 * módulo de ML; si aparece donde alguien decide, el producto es distinto.
 *
 * Cinco garantías, y son lo que la vuelve infraestructura en vez de un adorno:
 *
 * 1. NO CALCULA. Lee predicciones ya escritas por los enganches de operación.
 *    Es la misma regla de `serve.ts` y por el mismo motivo: una pantalla que
 *    calcula hereda la latencia y el fallo del cálculo, y devuelve un número
 *    distinto en cada recarga —con lo que deja de ser auditable—.
 *
 * 2. NO ROMPE. Cada resolutor corre aislado y con presupuesto de tiempo. Si
 *    falla o tarda, esa tira desaparece y la pantalla sigue. El análisis nunca
 *    puede ser la razón por la que alguien no puede cerrar un ticket.
 *
 * 3. NO REPITE TRABAJO. Los resolutores reciben lo que la pantalla YA cargó y
 *    consultan únicamente lo que es suyo —las predicciones—. Sin esta regla,
 *    cada tira añadiría su propio N+1 encima de la página.
 *
 * 4. NO INVENTA. Todo hallazgo carga su evidencia (`because`) y cuántos casos
 *    lo sostienen (`support`). Un aviso sin sustento es ruido, y el ruido se
 *    aprende a ignorar en dos semanas — momento en el que la capa deja de
 *    servir aunque siga funcionando.
 *
 * 5. NO SE ADELANTA. Solo lee modelos en producción. Un modelo entrenado y no
 *    promovido no habla en las pantallas de trabajo.
 */

export type InsightTone =
  /** Un hecho, sin juicio. */
  | "neutral"
  /** Va mejor de lo esperado. */
  | "good"
  /** Merece una mirada, todavía no es un problema. */
  | "watch"
  /** Hay que actuar. */
  | "risk";

export type Insight = {
  /** Estable entre renders: la pantalla lo usa como key. */
  id: string;
  /** La frase, en el lenguaje del negocio. Corta y afirmativa. */
  headline: string;
  /**
   * Por qué se afirma eso. NUNCA opcional.
   *
   * Es la diferencia entre un análisis y una corazonada: quien lee tiene que
   * poder discutirlo. «Tres servicios van por encima» es una opinión; «EVO-000412
   * lleva 9 h contra 4 estimadas» es algo que se puede verificar.
   */
  because: string;
  tone: InsightTone;
  /**
   * Casos históricos que sostienen la estimación, o `null` cuando el hallazgo
   * es un hecho medido y no una predicción. La distinción importa: «llevás 71
   * horas» y «vas a llevar 85» no merecen la misma confianza.
   */
  support: number | null;
  /** Cifra destacada, cuando hay una que valga leer sola. */
  value?: { n: number; unit: string };
  /** A dónde ir para actuar. */
  href?: string;
};

/* ------------------------- Aislamiento ------------------------- */

/** Presupuesto por resolutor. Ver la garantía 2. */
const BUDGET_MS = 1_500;

/**
 * Corre un resolutor sin que pueda tumbar la pantalla.
 *
 * El `race` contra el temporizador no cancela la consulta —Postgres la termina
 * igual— pero sí desacopla el render de ella: la página se pinta sin la tira en
 * vez de esperar. Es la decisión correcta porque el análisis es accesorio a la
 * operación, nunca al revés.
 */
async function guarded(
  id: string,
  fn: () => Promise<Insight[]>,
): Promise<Insight[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<Insight[]>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[insights] ${id} excedió ${BUDGET_MS} ms; se omite.`);
          resolve([]);
        }, BUDGET_MS);
      }),
    ]);
  } catch (e) {
    console.error(`[insights] ${id} falló; se omite.`, e);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------- Cola de servicios ------------------------- */

type OpenTicketRow = {
  id: string;
  reference: string;
  worked: number;
  estimate: number | null;
  support: number | null;
};

/**
 * La carga abierta contra lo que el modelo estimó.
 *
 * Contesta dos preguntas que hoy nadie puede responder sin abrir ticket por
 * ticket: cuánto trabajo hay comprometido, y cuáles se están yendo de las
 * manos. No hace falta ningún modelo nuevo — es la predicción que ya se
 * escribió al abrir el ticket, comparada con las horas de la bitácora.
 */
export async function openTicketsInsights(): Promise<Insight[]> {
  return guarded("tickets.carga", async () => {
    const template = await templateById("service_hours");
    if (!template) return [];
    const tolerance = template.tolerance;

    const db = await tenantDb();
    const rows = (await db.execute(sql`
      select t.id::text as id,
             t.reference as reference,
             coalesce(sum(c.hours), 0)::float8 as worked,
             p.value::float8 as estimate,
             p.support as support
        from tickets t
        left join ticket_comments c
               on c.ticket_id = t.id and c.hours is not null
        -- Lateral y no join directo: hace falta LA ÚLTIMA predicción de cada
        -- ticket, y solo de un modelo en producción. Ver la garantía 5.
        left join lateral (
          select pr.value, pr.support
            from ml_predictions pr
            join ml_models m
              on m.id = pr.model_id
             and m.template = 'service_hours'
             and m.status = 'production'
           where pr.subject_type = 'ticket'
             and pr.subject_id = t.id::text
           order by pr.created_at desc
           limit 1
        ) p on true
       where t.status in ('open', 'in_progress', 'waiting')
       group by t.id, t.reference, p.value, p.support
    `)) as unknown as Array<Record<string, unknown>>;

    const tickets: OpenTicketRow[] = rows.map((r) => ({
      id: String(r.id),
      reference: String(r.reference),
      worked: Number(r.worked ?? 0),
      estimate: r.estimate === null ? null : Number(r.estimate),
      support: r.support === null ? null : Number(r.support),
    }));

    const withEstimate = tickets.filter((t) => t.estimate !== null);
    if (withEstimate.length === 0) return [];

    const out: Insight[] = [];

    // ---- Cuánto trabajo hay comprometido -------------------------------
    //
    // Se suma lo que FALTA, no lo estimado completo: las horas ya trabajadas
    // están hechas y no ocupan agenda. Sumar el total daría un número mayor y
    // sin uso para planificar.
    const pending = withEstimate.reduce(
      (a, t) => a + Math.max((t.estimate as number) - t.worked, 0),
      0,
    );
    if (pending > 0) {
      out.push({
        id: "tickets.carga-pendiente",
        headline: `Quedan ~${pending.toFixed(0)} h de trabajo comprometido`,
        because:
          `${withEstimate.length} servicios abiertos con estimación, ` +
          `descontando las horas ya registradas en bitácora.`,
        tone: "neutral",
        support: withEstimate.length,
        value: { n: Math.round(pending), unit: "h" },
      });
    }

    // ---- Cuáles se están yendo -----------------------------------------
    //
    // El umbral es la tolerancia de la plantilla, no un número inventado: es
    // el margen que el propio negocio declaró útil al crear la pregunta. Un
    // servicio que se pasó por media hora no es noticia; uno que se pasó por
    // más de lo que se considera aceptable, sí.
    const over = withEstimate
      .filter((t) => t.worked > (t.estimate as number) + tolerance)
      .sort(
        (a, b) =>
          b.worked - (b.estimate as number) - (a.worked - (a.estimate as number)),
      );

    if (over.length > 0) {
      const worst = over[0];
      const excess = worst.worked - (worst.estimate as number);
      out.push({
        id: "tickets.sobre-estimacion",
        headline:
          over.length === 1
            ? "Un servicio abierto se pasó de lo estimado"
            : `${over.length} servicios abiertos se pasaron de lo estimado`,
        because:
          `El más desviado es ${worst.reference}: lleva ${worst.worked.toFixed(1)} h ` +
          `contra ${(worst.estimate as number).toFixed(1)} estimadas ` +
          `(${excess.toFixed(1)} h de más, con ±${tolerance} h de margen).`,
        tone: over.length > 2 ? "risk" : "watch",
        support: worst.support,
        href: `/tickets/${worst.id}`,
      });
    }

    return out;
  });
}

/* ------------------------- Contrato ------------------------- */

export type ContractInsightInput = {
  contractId: string;
  /** Valor del contrato en MXN, si está capturado. */
  amountMxn: number | null;
  /** Equipos amparados. Sin equipos no hay nada que proyectar. */
  equipmentIds: string[];
  /** Costo de servicio ya consumido, que la pantalla YA calculó. */
  consumedCost: number;
  /** Tarifa interna por hora, de la configuración. */
  laborCostPerHour: number;
};

/**
 * Lo que el contrato lleva consumido y a dónde va.
 *
 * Nota deliberada: `contracts` guarda un MONTO, no una bolsa de horas. Así que
 * la proyección honesta es de COSTO de servicio contra el valor del contrato,
 * no «te quedan N horas» — eso último sería inventar un campo que no existe.
 * El día que se agregue una bolsa contratada, este resolutor cambia; mientras
 * tanto dice lo que los datos permiten sostener.
 *
 * Recibe el costo ya consumido en vez de recalcularlo: la pantalla de contrato
 * ya lo tiene. Ver la garantía 3.
 */
export async function contractInsights(
  input: ContractInsightInput,
): Promise<Insight[]> {
  return guarded("contrato.proyeccion", async () => {
    const { amountMxn, equipmentIds, consumedCost, laborCostPerHour } = input;
    if (equipmentIds.length === 0) return [];

    const db = await tenantDb();
    const rows = (await db.execute(sql`
      select coalesce(sum(
               greatest(
                 p.value::float8 - coalesce(h.worked, 0),
                 0
               )
             ), 0)::float8 as pendientes,
             count(*)::int as abiertos,
             min(p.support)::int as soporte
        from tickets t
        join lateral (
          select pr.value, pr.support
            from ml_predictions pr
            join ml_models m
              on m.id = pr.model_id
             and m.template = 'service_hours'
             and m.status = 'production'
           where pr.subject_type = 'ticket'
             and pr.subject_id = t.id::text
           order by pr.created_at desc
           limit 1
        ) p on true
        left join lateral (
          select sum(c.hours)::float8 as worked
            from ticket_comments c
           where c.ticket_id = t.id and c.hours is not null
        ) h on true
       where t.status in ('open', 'in_progress', 'waiting')
         and t.equipment_id in (${sql.join(
           equipmentIds.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0];
    const pendingHours = Number(r?.pendientes ?? 0);
    const openCount = Number(r?.abiertos ?? 0);
    const support = r?.soporte === null ? null : Number(r?.soporte ?? 0);

    const out: Insight[] = [];

    // ---- Consumo medido: solo cuando hay algo que decidir --------------
    //
    // La pantalla de contrato YA muestra el porcentaje consumido. Repetirlo
    // aquí sería ruido, y el ruido es lo que enseña a ignorar la tira. Así que
    // este hallazgo solo aparece cuando el número cruza el umbral en que deja
    // de ser un dato y pasa a ser una decisión: seguir atendiendo un contrato
    // que ya se comió su margen.
    const consumedShare =
      amountMxn && amountMxn > 0 ? (consumedCost / amountMxn) * 100 : null;

    if (consumedShare !== null && consumedShare > 70) {
      out.push({
        id: "contrato.consumo",
        headline:
          consumedShare > 90
            ? "Este contrato ya casi no deja margen"
            : "Este contrato se está comiendo su margen",
        because:
          `${money(consumedCost)} de costo —horas de técnico más refacciones— ` +
          `contra ${money(amountMxn as number)} de valor contratado.`,
        tone: consumedShare > 90 ? "risk" : "watch",
        support: null,
        value: { n: Math.round(consumedShare), unit: "%" },
      });
    }

    // ---- Proyección: esto sí es estimación, y se dice ------------------
    if (pendingHours > 0) {
      const projected = pendingHours * laborCostPerHour;
      const total = consumedCost + projected;
      const share =
        amountMxn && amountMxn > 0 ? (total / amountMxn) * 100 : null;

      out.push({
        id: "contrato.proyeccion",
        headline:
          share !== null
            ? `Los servicios abiertos lo llevarían al ${share.toFixed(0)}%`
            : `Quedan ~${pendingHours.toFixed(0)} h comprometidas en este contrato`,
        because:
          `${openCount} servicio${openCount === 1 ? "" : "s"} abierto${
            openCount === 1 ? "" : "s"
          } sobre los equipos amparados suman ~${pendingHours.toFixed(1)} h ` +
          `estimadas, unos ${money(projected)} más de costo.`,
        tone: share !== null && share > 100 ? "risk" : share !== null && share > 85 ? "watch" : "neutral",
        support,
        value: { n: Math.round(pendingHours), unit: "h" },
      });
    }

    return out;
  });
}

/** Pesos sin decimales: en una tira de análisis los centavos son ruido. */
function money(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

/* ------------------------- Compras ------------------------- */

/**
 * Lo que está pedido, lo que se atrasó y lo que falta y nadie ha pedido.
 *
 * Es el resolutor que cruza dos módulos, y ahí está su valor: el inventario
 * sabe que faltan piezas y compras sabe qué viene en camino, pero por separado
 * ninguno de los dos puede contestar la única pregunta que importa —«¿esto ya
 * lo pedimos?»—. Sin ese cruce, la reacción natural ante un faltante es volver
 * a comprar lo que ya está por llegar.
 *
 * Todo aquí es HECHO MEDIDO, no estimación: `support` va en null a propósito.
 * No hay modelo de reposición todavía y fingir uno sería exactamente lo que la
 * garantía 4 prohíbe.
 */
export async function purchasingInsights(): Promise<Insight[]> {
  return guarded("compras.pendientes", async () => {
    const db = await tenantDb();

    const rows = (await db.execute(sql`
      with pendiente as (
        select l.part_id,
               sum(l.quantity - l.received_quantity)::int as piezas,
               sum((l.quantity - l.received_quantity) *
                   coalesce(l.unit_cost_mxn, 0))::float8 as valor,
               min(o.expected_at) as llega,
               bool_or(o.expected_at is not null
                       and o.expected_at < current_date) as atrasada,
               min(o.reference) as folio
          from purchase_order_lines l
          join purchase_orders o on o.id = l.order_id
         where o.status in ('sent', 'partial')
           and l.quantity > l.received_quantity
         group by l.part_id
      )
      select
        (select coalesce(sum(piezas), 0) from pendiente)::int      as en_camino,
        (select coalesce(sum(valor), 0) from pendiente)::float8    as valor,
        (select count(*) from pendiente where atrasada)::int       as atrasadas,
        (select min(folio) from pendiente where atrasada)          as folio_atrasado,
        (select min(llega) from pendiente where atrasada)          as fecha_atrasada,
        -- Faltantes sin nada en camino. El stock negativo es real: el ledger
        -- lo deja pasar justamente para que el faltante quede visible aquí.
        (select count(*) from spare_parts p
          where p.stock < 0
            and not exists (select 1 from pendiente q where q.part_id = p.id)
        )::int                                                     as descubiertas,
        (select p.part_number from spare_parts p
          where p.stock < 0
            and not exists (select 1 from pendiente q where q.part_id = p.id)
          order by p.stock asc limit 1)                            as peor_parte,
        (select p.stock from spare_parts p
          where p.stock < 0
            and not exists (select 1 from pendiente q where q.part_id = p.id)
          order by p.stock asc limit 1)::int                       as peor_stock
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0];
    if (!r) return [];

    const enCamino = Number(r.en_camino ?? 0);
    const valor = Number(r.valor ?? 0);
    const atrasadas = Number(r.atrasadas ?? 0);
    const descubiertas = Number(r.descubiertas ?? 0);

    const out: Insight[] = [];

    // ---- Faltantes que nadie pidió: lo primero, porque es lo accionable --
    if (descubiertas > 0) {
      const parte = r.peor_parte ? String(r.peor_parte) : null;
      const stock = Number(r.peor_stock ?? 0);
      out.push({
        id: "compras.descubiertas",
        headline:
          descubiertas === 1
            ? "Una refacción está en negativo y no se ha pedido"
            : `${descubiertas} refacciones están en negativo y no se han pedido`,
        because: parte
          ? `La más urgente es ${parte}: ${Math.abs(stock)} piezas por debajo ` +
            `de cero y ninguna orden de compra abierta que la traiga.`
          : "Hay consumo registrado por encima de las existencias sin orden que lo reponga.",
        tone: "risk",
        support: null,
        value: { n: descubiertas, unit: descubiertas === 1 ? "parte" : "partes" },
        href: "/admin/compras/nueva",
      });
    }

    // ---- Órdenes que se pasaron de su fecha ----------------------------
    if (atrasadas > 0) {
      const folio = r.folio_atrasado ? String(r.folio_atrasado) : null;
      const fecha = r.fecha_atrasada ? String(r.fecha_atrasada) : null;
      out.push({
        id: "compras.atrasadas",
        headline:
          atrasadas === 1
            ? "Una compra pasó su fecha de llegada"
            : `${atrasadas} compras pasaron su fecha de llegada`,
        because:
          folio && fecha
            ? `${folio} se esperaba para el ${fecha} y sigue con piezas por recibir.`
            : "Hay órdenes enviadas cuya fecha esperada ya pasó y siguen con pendientes.",
        tone: atrasadas > 2 ? "risk" : "watch",
        support: null,
        href: "/admin/compras",
      });
    }

    // ---- Lo que viene en camino ----------------------------------------
    if (enCamino > 0) {
      out.push({
        id: "compras.en-camino",
        headline: `${enCamino} piezas están por llegar`,
        because:
          valor > 0
            ? `Unos ${money(valor)} comprometidos en órdenes enviadas que ` +
              `todavía no se reciben completas.`
            : "Órdenes enviadas con piezas pendientes de recibir.",
        tone: "neutral",
        support: null,
        value: { n: enCamino, unit: "pzs" },
        href: "/admin/compras",
      });
    }

    return out;
  });
}

/* ------------------------- Cuentas por pagar ------------------------- */

/**
 * Lo que hay que atender en la deuda con proveedores.
 *
 * Tres cosas y en este orden: el dinero PARADO primero —porque es lo único
 * sobre lo que se puede actuar hoy y lo que se paga dos veces si se olvida—,
 * después lo vencido, y al final lo que viene. Un asistente que abre con «te
 * vencen 52 000 la semana que viene» y calla que hay 45 000 de anticipo sin
 * imputar tiene las prioridades al revés.
 *
 * Reusa las mismas consultas que pinta la pantalla de análisis, así que los dos
 * números no pueden divergir.
 */
export async function payablesInsights(conexion?: DbOrTx): Promise<Insight[]> {
  return guarded("pagar.saldos", async () => {
    const { getIdleMoney, getPayablesSummary } = await import("@/lib/data/payables");
    const [parado, resumen] = await Promise.all([
      getIdleMoney(conexion),
      getPayablesSummary(conexion),
    ]);
    const out: Insight[] = [];

    // ---- Anticipos entregados y sin imputar ------------------------------
    if (parado.advances.total > 0) {
      const dias = parado.advances.oldestDays;
      out.push({
        id: "pagar.anticipos-parados",
        headline: `${money(parado.advances.total)} en anticipos sin imputar`,
        because:
          `${parado.advances.count} ${parado.advances.count === 1 ? "anticipo ya salió" : "anticipos ya salieron"} ` +
          `del banco y no se ${parado.advances.count === 1 ? "ha aplicado" : "han aplicado"} a ninguna factura` +
          (dias !== null ? `; el más viejo lleva ${dias} días.` : ".") +
          " Si se olvida, se le vuelve a pagar al proveedor lo que ya se le adelantó.",
        // Un anticipo de más de dos meses sin factura suele ser que la factura
        // nunca llegó, que es un problema distinto y peor.
        tone: dias !== null && dias > 60 ? "risk" : "watch",
        support: null,
        value: { n: parado.advances.count, unit: parado.advances.count === 1 ? "anticipo" : "anticipos" },
        href: "/admin/compras/cuentas-por-pagar/analisis",
      });
    }

    // ---- Notas de crédito concedidas y sin aplicar -----------------------
    if (parado.creditNotes.total > 0) {
      const dias = parado.creditNotes.oldestDays;
      out.push({
        id: "pagar.notas-sin-aplicar",
        headline: `${money(parado.creditNotes.total)} de descuento sin usar`,
        because:
          `${parado.creditNotes.count} ${parado.creditNotes.count === 1 ? "nota de crédito" : "notas de crédito"} ` +
          `que el proveedor ya concedió y nadie aplicó` +
          (dias !== null ? `; la más vieja lleva ${dias} días.` : ".") +
          " Sin aplicarlas se paga íntegra una factura que traía rebaja.",
        tone: "watch",
        support: null,
        href: "/admin/compras/cuentas-por-pagar/analisis",
      });
    }

    // ---- Vencido, por moneda --------------------------------------------
    for (const r of resumen.byCurrency) {
      if (r.overdue <= 0) continue;
      const peso = r.balance > 0 ? Math.round((r.overdue / r.balance) * 100) : 0;
      out.push({
        id: `pagar.vencido.${r.currency}`,
        headline: `${fmt(r.overdue, r.currency)} vencidos`,
        because:
          `${r.overdueCount} ${r.overdueCount === 1 ? "factura" : "facturas"} con el plazo ya pasado, ` +
          `el ${peso} % de los ${fmt(r.balance, r.currency)} que se deben. ` +
          "Con parcialidades se cuenta cada vencimiento por su fecha, no la factura entera.",
        tone: peso > 40 ? "risk" : "watch",
        support: null,
        href: "/admin/compras/cuentas-por-pagar",
      });
    }

    // ---- Lo que vence esta semana ---------------------------------------
    for (const r of resumen.byCurrency) {
      if (r.dueSoon <= 0) continue;
      out.push({
        id: `pagar.por-vencer.${r.currency}`,
        headline: `${fmt(r.dueSoon, r.currency)} vencen en 7 días`,
        because:
          `${r.dueSoonCount} ${r.dueSoonCount === 1 ? "vencimiento" : "vencimientos"} dentro de la semana. ` +
          "Es la lista de pagos a programar, no un problema todavía.",
        tone: "neutral",
        support: null,
        href: "/admin/compras/cuentas-por-pagar/analisis",
      });
    }

    return out;
  });
}

/* ------------------------- Ficha de proveedor ------------------------- */

/**
 * Cómo va la relación con UN proveedor.
 *
 * Lo que contesta es la pregunta de antes de comprarle otra vez, y lo hace con
 * lo que ya se midió: cuánto se le debe, cómo se le ha pagado de verdad contra
 * lo pactado, y si tiene saldo a favor esperando.
 */
export async function supplierInsights(
  supplierId: string,
  conexion?: DbOrTx,
): Promise<Insight[]> {
  return guarded("proveedor.relacion", async () => {
    const { getSupplierCreditHistory } = await import("@/lib/data/payables");
    const h = await getSupplierCreditHistory(supplierId, conexion);
    if (!h) return [];

    const out: Insight[] = [];

    // ---- Suspensión ------------------------------------------------------
    // Va primero: es lo que cambia qué se puede hacer con este proveedor hoy,
    // y el resto de hallazgos se leen distinto sabiéndolo.
    const susp = (await (conexion ?? (await tenantDb())).execute(sql`
      select suspend_reason, (current_date - suspended_at::date)::int as dias
        from suppliers
       where id = ${supplierId}::uuid and suspended_at is not null`)) as unknown as Array<{
      suspend_reason: string | null;
      dias: number;
    }>;
    if (susp[0]) {
      out.push({
        id: "proveedor.suspendido",
        headline: "Compras suspendidas con este proveedor",
        because:
          // El motivo lo escribe una persona y casi nunca acaba en punto:
          // sin esto, la frase siguiente se pega a la suya.
          puntuar(susp[0].suspend_reason ?? "Sin motivo registrado") +
          ` Lleva ${susp[0].dias} ${susp[0].dias === 1 ? "día" : "días"} así. ` +
          "No se le pueden levantar órdenes ni dar anticipos; lo que ya se le debe se le sigue pagando.",
        tone: "risk",
        support: null,
      });
    }

    // ---- Desvío de pago real contra lo pactado --------------------------
    if (h.avgDaysToPay !== null && h.settledCount >= 2) {
      const desvio = h.avgDaysToPay - h.paymentTermsDays;
      const tarde = desvio > 0;
      out.push({
        id: "proveedor.desvio",
        headline: tarde
          ? `Le pagamos ${desvio} días tarde de media`
          : `Le pagamos ${Math.abs(desvio)} días antes de lo pactado`,
        because:
          `Pactado ${h.paymentTermsDays === 0 ? "de contado" : `a ${h.paymentTermsDays} días`}, ` +
          `real ${h.avgDaysToPay} días sobre ${h.settledCount} facturas saldadas` +
          (h.onTimePct !== null ? `, con ${h.onTimePct} % dentro del plazo.` : ".") +
          " El promedio va ponderado por importe, así que una factura grande pesa más que una chica.",
        // Los días se miden sobre facturas ya saldadas: son casos reales, no
        // una estimación, y por eso `support` lleva el número.
        support: h.settledCount,
        tone: !tarde ? "good" : desvio > 15 ? "risk" : desvio > 5 ? "watch" : "neutral",
        value: { n: h.avgDaysToPay, unit: "días" },
      });
    }

    // ---- Saldo a favor sin usar -----------------------------------------
    if (h.creditAvailable > 0) {
      out.push({
        id: "proveedor.a-favor",
        headline: `${money(h.creditAvailable)} a favor sin aplicar`,
        because:
          "Notas de crédito que este proveedor concedió y siguen sin usarse. " +
          "Aplícalas antes del próximo pago.",
        tone: "watch",
        support: null,
      });
    }

    // ---- Saldo abierto ---------------------------------------------------
    if (h.balance > 0) {
      out.push({
        id: "proveedor.saldo",
        headline: `${money(h.balance)} pendientes de pago`,
        because: `${h.openCount} ${h.openCount === 1 ? "factura abierta" : "facturas abiertas"}, ` +
          `sobre ${money(h.purchased12m)} comprados en los últimos doce meses.`,
        tone: "neutral",
        support: null,
      });
    }

    return out;
  });
}

/* ------------------------- Refacciones ------------------------- */

/**
 * Faltantes y su cobertura.
 *
 * El stock negativo es real y a propósito: el ledger lo deja pasar justamente
 * para que un faltante quede visible en vez de silenciarse en cero. Aquí es
 * donde se cobra esa decisión.
 */
export async function partsInsights(conexion?: DbOrTx): Promise<Insight[]> {
  return guarded("refacciones.faltantes", async () => {
    const db = conexion ?? (await tenantDb());

    const rows = (await db.execute(sql`
      select
        (select count(*) from spare_parts where stock < 0)::int            as negativas,
        (select count(*) from spare_parts p
          where p.stock < 0
            and not exists (
              select 1 from purchase_order_lines l
                join purchase_orders o on o.id = l.order_id
               where l.part_id = p.id and o.status in ('sent','partial')
                 and l.quantity > l.received_quantity))::int               as descubiertas,
        (select p.part_number from spare_parts p
          where p.stock < 0 order by p.stock asc limit 1)                  as peor,
        (select p.stock from spare_parts p
          where p.stock < 0 order by p.stock asc limit 1)::int             as peor_stock,
        (select count(*) from spare_parts where stock = 0)::int            as en_cero
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0];
    if (!r) return [];

    const negativas = Number(r.negativas ?? 0);
    const descubiertas = Number(r.descubiertas ?? 0);
    const enCero = Number(r.en_cero ?? 0);
    const out: Insight[] = [];

    if (descubiertas > 0) {
      const peor = r.peor ? String(r.peor) : null;
      out.push({
        id: "refacciones.descubiertas",
        headline:
          descubiertas === 1
            ? "Una refacción está en falta y nadie la ha pedido"
            : `${descubiertas} refacciones en falta sin nada en camino`,
        because: peor
          ? `${peor} está en ${r.peor_stock} y no aparece en ninguna orden viva.`
          : "Hay existencias negativas sin orden de compra que las cubra.",
        tone: "risk",
        support: null,
        value: { n: descubiertas, unit: descubiertas === 1 ? "parte" : "partes" },
        href: "/admin/compras/nueva",
      });
    }

    // Negativas CON orden en camino: es un aviso, no una urgencia.
    const cubiertas = negativas - descubiertas;
    if (cubiertas > 0) {
      out.push({
        id: "refacciones.cubiertas",
        headline: `${cubiertas} en falta, ya pedidas`,
        because:
          "Tienen existencia negativa pero hay una orden enviada que las cubre. " +
          "Conviene confirmar la fecha de llegada.",
        tone: "watch",
        support: null,
        href: "/admin/compras",
      });
    }

    if (enCero > 0 && negativas === 0) {
      out.push({
        id: "refacciones.en-cero",
        headline: `${enCero} ${enCero === 1 ? "refacción" : "refacciones"} en cero`,
        because: "Sin existencia, pero tampoco en falta: el próximo consumo las deja en negativo.",
        tone: "neutral",
        support: null,
      });
    }

    return out;
  });
}

/** Cierra con punto una frase escrita a mano, si no lo trae. */
function puntuar(t: string): string {
  const x = t.trim();
  return /[.!?…]$/.test(x) ? x : `${x}.`;
}

/**
 * Importe con su moneda, para cuando no es forzosamente MXN.
 *
 * Con el código y no con el símbolo: «$259,614» y «$11,600» se leen como la
 * misma divisa, y aquí conviven pesos y dólares en la misma lista.
 */
function fmt(n: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  }).format(n);
}

/* ================= Bloques de proyección y tendencia ================= */

/**
 * El calendario de pagos como PROYECCIÓN.
 *
 * No lleva banda y no puede llevarla: son vencimientos ya pactados, no una
 * estimación. Ver la nota de `blocks-types.ts` sobre por qué esa diferencia
 * está en el tipo y no en un comentario.
 */
export async function payablesProjection(
  conexion?: DbOrTx,
): Promise<ProjectionBlock[]> {
  const { getPaymentCalendar } = await import("@/lib/data/payables");
  const cal = await getPaymentCalendar(6, conexion);

  return cal
    .filter((c) => c.total > 0)
    .map((c) => ({
      kind: "projection" as const,
      id: `pagar.calendario.${c.currency}`,
      title: `Qué hay que pagar · ${c.currency}`,
      note:
        "Próximas seis semanas por vencimiento. Con parcialidades cuenta cada " +
        "una por su fecha, no la factura entera. Lo vencido va aparte porque no " +
        "tiene semana futura a la que pertenecer.",
      bars: c.weeks.map((w) => ({
        key: w.key,
        label: w.label,
        value: w.amount,
        alert: w.overdue,
      })),
      currency: c.currency,
      total: c.total,
      href: "/admin/compras/cuentas-por-pagar/analisis",
    }));
}

/** La salida de caja como TENDENCIA: historia real, nunca extrapolada. */
export async function payablesTrend(conexion?: DbOrTx): Promise<TrendBlock[]> {
  const { getCashOutByMonth } = await import("@/lib/data/payables");
  const caja = await getCashOutByMonth(12, conexion);
  if (!caja.data.some((d) => d.total > 0)) return [];

  return [
    {
      kind: "trend",
      id: "pagar.caja",
      title: `Salida de caja · ${caja.currency}`,
      note:
        "Doce meses. Suma pagos y anticipos porque los dos sacaron dinero del " +
        "banco; las notas de crédito no aparecen —bajan la deuda sin mover un " +
        "peso— y las imputaciones de anticipo tampoco, porque ese dinero ya se " +
        "contó el día que salió.",
      bars: caja.data.map((d) => ({
        key: d.month,
        label: d.label,
        value: d.payments,
        stacked: d.advances,
      })),
      currency: caja.currency,
      legend: ["Pagos a factura", "Anticipos"],
      href: "/admin/compras/cuentas-por-pagar/analisis",
    },
  ];
}

/**
 * La carga de servicio como PRONÓSTICO.
 *
 * Es el único sitio donde hoy hay un modelo en producción, y por eso el único
 * que puede producir este tipo. Que no aparezca en las demás pantallas no es
 * una carencia que haya que disimular: es la garantía 5 —solo hablan los
 * modelos promovidos— funcionando.
 */
export async function ticketsForecast(
  conexion?: DbOrTx,
): Promise<ForecastBlock[]> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    select mm.template, mm.version,
           sum(pr.value)::float8   as total,
           sum(pr.lower)::float8   as bajo,
           sum(pr.upper)::float8   as alto,
           count(*)::int           as n,
           min(pr.support)::int    as soporte
      from ml_predictions pr
      join ml_models mm on mm.id = pr.model_id
      join tickets t on t.id::text = pr.subject_id
     where mm.status = 'production'
       and pr.subject_type = 'ticket'
       -- Los mismos tres estados que la carga abierta: un ticket resuelto o
       -- cerrado ya no compromete horas.
       and t.status in ('open', 'in_progress', 'waiting')
       and pr.lower is not null and pr.upper is not null
     group by mm.template, mm.version`)) as unknown as Array<{
    template: string;
    version: number;
    total: number;
    bajo: number;
    alto: number;
    n: number;
    soporte: number | null;
  }>;

  const r = rows[0];
  // Sin banda o sin casos no se publica. El tipo lo exige y aquí se respeta en
  // vez de rellenar con ceros para que compile.
  if (!r || r.soporte === null || r.n === 0) return [];

  return [
    {
      kind: "forecast",
      id: "tickets.carga-estimada",
      title: "Horas comprometidas en la cola",
      note:
        `Suma de lo que el modelo estima para ${r.n} ${r.n === 1 ? "servicio abierto" : "servicios abiertos"}. ` +
        "Es una estimación: la banda dice entre qué valores se mueve, y puede fallar.",
      value: Math.round(r.total),
      unit: "h",
      band: { lower: Math.round(r.bajo), upper: Math.round(r.alto) },
      support: r.soporte,
      model: { template: r.template, version: r.version },
      href: "/admin/ml",
    },
  ];
}

/**
 * Las refacciones que el modelo estima que se van a volver a necesitar antes.
 *
 * Existe porque faltaba: hasta hoy `insights.ts` solo sabía leer predicciones
 * de `subject_type = 'ticket'`. La ontología tiene tres sujetos y dos de ellos
 * —refacciones y equipos— se podían entrenar, juzgar y promover a producción
 * para que sus predicciones no salieran POR NINGUNA PANTALLA. Un modelo
 * aprobado que nadie ve es trabajo tirado, y el fallo era invisible: todo el
 * laboratorio decía «en producción» y la producción no existía.
 *
 * El descuento del tiempo transcurrido no es un detalle. El modelo estima
 * «faltan 40 días» EN EL MOMENTO EN QUE PREDICE; leído dos meses después ese 40
 * ya no significa nada. Se descuenta contra `created_at`, y lo que ya venció se
 * enseña como vencido en vez de desaparecer: una refacción que debió reponerse
 * hace dos semanas es justo la que hay que mirar.
 */
export async function partsForecast(conexion?: DbOrTx): Promise<ForecastBlock[]> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    -- La última predicción de cada refacción: el modelo puede haber opinado
    -- varias veces sobre la misma pieza y solo la más reciente está vigente.
    select distinct on (pr.subject_id)
           pr.subject_id                                          as parte,
           pr.value::float8                                       as dias,
           pr.lower::float8                                       as bajo,
           pr.upper::float8                                       as alto,
           pr.support                                             as soporte,
           extract(epoch from (now() - pr.created_at)) / 86400    as transcurridos,
           mm.template, mm.version
      from ml_predictions pr
      join ml_models mm on mm.id = pr.model_id
     where mm.status = 'production'
       and pr.subject_type = 'part'
       and pr.lower is not null and pr.upper is not null
       and pr.support is not null
     order by pr.subject_id, pr.created_at desc`)) as unknown as Array<{
    parte: string;
    dias: number;
    bajo: number;
    alto: number;
    soporte: number;
    transcurridos: number;
    template: string;
    version: number;
  }>;

  return rows
    .map((r) => ({ ...r, restan: r.dias - r.transcurridos }))
    // Las cinco más apremiantes. Enseñar treinta convierte el panel en un
    // listado, y para listados ya está la pantalla de refacciones.
    .sort((a, b) => a.restan - b.restan)
    .slice(0, 5)
    .map((r): ForecastBlock => ({
      kind: "forecast",
      id: `parts.reorder.${r.parte}`,
      title:
        r.restan < 0
          ? `${r.parte} — debió reponerse hace ${Math.abs(Math.round(r.restan))} días`
          : `${r.parte} — en ${Math.round(r.restan)} días`,
      note:
        `El modelo estimó ${Math.round(r.dias)} días entre usos con ${r.soporte} ` +
        `consumo(s) detrás. Es una estimación sobre un patrón de consumo, no un ` +
        `compromiso: la banda dice entre qué valores se mueve.`,
      value: Math.round(r.restan),
      unit: "días",
      band: {
        lower: Math.round(r.bajo - r.transcurridos),
        upper: Math.round(r.alto - r.transcurridos),
      },
      support: r.soporte,
      model: { template: r.template, version: r.version },
      href: "/admin/refacciones",
    }));
}

/**
 * Los equipos que el modelo estima que van a pedir servicio antes.
 *
 * Mismo hueco y mismo descuento que `partsForecast`. Se une contra `equipment`
 * para poder nombrarlos: un uuid en el panel no le dice nada a nadie, y un
 * equipo que ya no existe se cae de la lista en vez de salir sin nombre.
 */
export async function equipmentForecast(conexion?: DbOrTx): Promise<ForecastBlock[]> {
  const db = conexion ?? (await tenantDb());

  const rows = (await db.execute(sql`
    select distinct on (pr.subject_id)
           e.brand, e.name, e.model,
           pr.value::float8                                       as dias,
           pr.lower::float8                                       as bajo,
           pr.upper::float8                                       as alto,
           pr.support                                             as soporte,
           extract(epoch from (now() - pr.created_at)) / 86400    as transcurridos,
           mm.template, mm.version
      from ml_predictions pr
      join ml_models mm on mm.id = pr.model_id
      join equipment e on e.id::text = pr.subject_id
     where mm.status = 'production'
       and pr.subject_type = 'equipment'
       and pr.lower is not null and pr.upper is not null
       and pr.support is not null
     order by pr.subject_id, pr.created_at desc`)) as unknown as Array<{
    brand: string;
    name: string;
    model: string | null;
    dias: number;
    bajo: number;
    alto: number;
    soporte: number;
    transcurridos: number;
    template: string;
    version: number;
  }>;

  return rows
    .map((r) => ({ ...r, restan: r.dias - r.transcurridos }))
    .sort((a, b) => a.restan - b.restan)
    .slice(0, 5)
    .map((r, i): ForecastBlock => {
      const nombre = [r.brand, r.name, r.model].filter(Boolean).join(" ");
      return {
        kind: "forecast",
        id: `equipment.maintenance.${i}`,
        title:
          r.restan < 0
            ? `${nombre} — lleva ${Math.abs(Math.round(r.restan))} días de retraso`
            : `${nombre} — en ${Math.round(r.restan)} días`,
        note:
          `El modelo estimó ${Math.round(r.dias)} días entre servicios con ` +
          `${r.soporte} servicio(s) detrás. Es una estimación sobre el historial ` +
          `del equipo, no un plan de mantenimiento pactado.`,
        value: Math.round(r.restan),
        unit: "días",
        band: {
          lower: Math.round(r.bajo - r.transcurridos),
          upper: Math.round(r.alto - r.transcurridos),
        },
        support: r.soporte,
        model: { template: r.template, version: r.version },
        href: "/admin/equipos",
      };
    });
}

/**
 * Cuentas por pagar del mes que viene.
 *
 * Es DOS cosas y se enseñan separadas, nunca sumadas. La distinción la impone
 * `blocks-types.ts` y aquí es donde más se nota por qué existe:
 *
 *   · LO COMPROMETIDO — facturas ya emitidas que vencen dentro del mes. Es
 *     aritmética sobre vencimientos pactados: va a ocurrir. Sale como
 *     `projection`, que por definición NO admite banda, porque no hay
 *     incertidumbre que declarar.
 *
 *   · LO ESTIMADO — lo que todavía no se ha facturado. Eso sí es pronóstico, y
 *     solo aparece cuando hay un modelo en producción que lo sostenga, con su
 *     banda y sus casos.
 *
 * Sumarlos daría un número más redondo y sería peor: escondería cuál de las dos
 * mitades puede fallar. El día que el pronóstico se equivoque se llevaría por
 * delante la credibilidad del calendario, que no tenía culpa.
 *
 * Mientras no haya modelo —hoy no lo hay, y con seis meses de historia no lo
 * habrá en años— la mitad estimada se calla en vez de rellenarse con una media
 * disfrazada de predicción. Un número inventado con aspecto de pronóstico es
 * peor que ningún número: el segundo se nota, el primero no.
 */
export async function payablesNextMonth(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const [{ inicio, fin }] = (await db.execute(sql`
    select (date_trunc('month', now()) + interval '1 month')::date as inicio,
           (date_trunc('month', now()) + interval '2 month')::date as fin
  `)) as unknown as Array<{ inicio: string; fin: string }>;

  // El nombre del mes se arma aquí y no con `to_char(..., 'TMMonth')`: esa
  // función depende del `lc_time` del servidor de base de datos, que en esta
  // instalación es inglés y produciría «September 2026» en un panel en
  // castellano. El idioma de la interfaz no puede depender de la configuración
  // regional de Postgres.
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const d0 = new Date(`${inicio}T00:00:00Z`);
  const etiqueta = `${MESES[d0.getUTCMonth()]} de ${d0.getUTCFullYear()}`;

  const out: Block[] = [];

  /* --- 1 · Lo comprometido: vencimientos ya pactados --- */
  const semanas = (await db.execute(sql`
    -- La semana se recorta al mes con greatest(): la que contiene el día 1 casi
    -- siempre empieza en el mes anterior, y etiquetarla con su lunes real ponía
    -- «31 ago» dentro de una proyección de septiembre. El tramo es correcto, la
    -- etiqueta era la que mentía.
    select to_char(greatest(date_trunc('week', si.due_at)::date, ${inicio}::date),
                   'DD/MM')                                            as label,
           date_trunc('week', si.due_at)::date::text                   as key,
           sum(si.total * coalesce(si.fx_rate, 1))::float8             as value,
           -- Lo ya vencido antes de que empiece el mes se marca aparte: no es
           -- una previsión, es una deuda que ya se pasó de fecha.
           bool_or(si.due_at < now()::date)                            as alert
      from supplier_invoices si
     where si.cancelled_at is null
       and si.status <> 'paid'
       and si.due_at >= ${inicio}::date
       and si.due_at <  ${fin}::date
     group by 1, 2
     order by 2
  `)) as unknown as Array<{ label: string; key: string; value: number; alert: boolean }>;

  const comprometido = semanas.reduce((a, s) => a + s.value, 0);

  if (semanas.length > 0) {
    out.push({
      kind: "projection",
      id: "payables.next-month.committed",
      title: `Comprometido para ${etiqueta}`,
      note:
        `${semanas.length} vencimiento(s) ya pactado(s) de facturas emitidas. ` +
        `No es una estimación: son fechas acordadas.`,
      bars: semanas.map((s) => ({
        key: s.key,
        label: s.label,
        value: Math.round(s.value),
        alert: s.alert,
      })),
      currency: "MXN",
      total: Math.round(comprometido),
      href: "/admin/compras/cuentas-por-pagar",
    });
  }

  /* --- 2 · Lo estimado: solo si hay modelo que lo sostenga --- */
  const est = (await db.execute(sql`
    select pr.value::float8 as valor, pr.lower::float8 as bajo, pr.upper::float8 as alto,
           pr.support as soporte, mm.template, mm.version
      from ml_predictions pr
      join ml_models mm on mm.id = pr.model_id
     where mm.status = 'production'
       and pr.subject_type = 'period'
       and pr.subject_id = ${inicio}
       and pr.lower is not null and pr.upper is not null and pr.support is not null
     order by pr.created_at desc
     limit 1
  `)) as unknown as Array<{
    valor: number; bajo: number; alto: number; soporte: number;
    template: string; version: number;
  }>;

  if (est[0]) {
    const e = est[0];
    out.push({
      kind: "forecast",
      id: "payables.next-month.estimated",
      title: `Estimado para ${etiqueta}`,
      note:
        `Lo que el modelo estima que se facturará en total durante el mes, ` +
        `incluyendo lo que todavía no se ha emitido. Es una estimación: la ` +
        `banda dice entre qué valores se mueve. NO se suma a lo comprometido — ` +
        `lo contiene.`,
      value: Math.round(e.valor),
      unit: "MXN",
      band: { lower: Math.round(e.bajo), upper: Math.round(e.alto) },
      support: e.soporte,
      model: { template: e.template, version: e.version },
      href: "/admin/ml",
    });
  }

  return out;
}
