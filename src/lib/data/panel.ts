import "server-only";
import { sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { getQueueCounts } from "@/lib/data/tickets";
import { getPayablesSummary } from "@/lib/data/payables";
import { getSettings } from "@/lib/data/settings";
import { getProfitOverview, type Rates } from "@/lib/data/profitability";

/**
 * EL PANEL DE INICIO, ARMADO PARA QUE ALGUIEN HAGA ALGO.
 *
 * ── LA PREGUNTA QUE DECIDE QUÉ ENTRA ───────────────────────────────────────
 *
 * «Si este número cambia, ¿alguien hace algo?». Lo que no la contesta no entra,
 * por interesante que sea. Es la diferencia entre un indicador y una métrica de
 * vanidad, y el panel anterior estaba lleno de las segundas: encabezaba con
 * «Total: 634 tickets», un número que solo sube, que nadie puede mover y ante el
 * que no hay nada que hacer.
 *
 * ── DOS PLANOS, Y EL ORDEN IMPORTA ─────────────────────────────────────────
 *
 * 1. ALERTAS — lo que está mal AHORA y tiene dueño. Van arriba del todo y solo
 *    aparecen si hay algo: un panel que enseña cuatro ceros en verde enseña a
 *    no mirarlo. Cuando no hay ninguna, el panel lo dice en una línea y calla.
 *
 * 2. INDICADORES — la salud del negocio, cada uno con su serie de doce meses y
 *    su variación contra el mes anterior. Un número sin comparación no dice si
 *    va bien: 180 000 de utilidad es excelente o preocupante según de dónde
 *    venga, y el panel no puede obligar a nadie a recordarlo.
 *
 * ── UNA SOLA LECTURA POR BLOQUE ────────────────────────────────────────────
 *
 * Todo lo de aquí se pide en paralelo y se arma una vez. La alternativa —cada
 * tarjeta con su consulta— recorre el histórico cuatro veces para pintar una
 * pantalla, que es exactamente lo que ya se corrigió en Rentabilidad.
 */

export type Alerta = {
  clave: string;
  /** Qué pasa, en una frase que empieza por el número. */
  titulo: string;
  /** Qué hacer al respecto. Sin esto no es una alerta, es una queja. */
  detalle: string;
  cantidad: number;
  /** Importe, cuando la alerta es de dinero. */
  importe?: number;
  moneda?: string;
  href: string;
  /** `critica` exige acción hoy; `atencion` esta semana. */
  tono: "critica" | "atencion";
};

export type Kpi = {
  clave: string;
  etiqueta: string;
  valor: number;
  formato: "dinero" | "entero" | "porcentaje";
  /** Variación contra el periodo anterior, en puntos porcentuales o %. */
  delta: number | null;
  /** Si subir es bueno. Decide el color del delta, no el signo. */
  subirEsBueno: boolean;
  /** Doce puntos para la línea de tendencia. */
  serie: number[];
  href: string;
};

export type PanelEjecutivo = {
  alertas: Alerta[];
  kpis: Kpi[];
  /** La serie mensual completa, para la gráfica grande. */
  tendencia: { label: string; revenue: number; cost: number; profit: number }[];
  /** Cuántos clientes hay y cuántos se pueden facturar. */
  facturables: { total: number; conExpediente: number };
};

/** Variación relativa entre dos valores, o `null` si no hay base con la que comparar. */
function variacion(actual: number, previo: number): number | null {
  // Sin mes anterior —o con un anterior en cero— no hay porcentaje que calcular.
  // Devolver 100 % o 0 % sería inventarse una tendencia donde no hay historia.
  if (!previo) return null;
  return ((actual - previo) / Math.abs(previo)) * 100;
}

export async function getPanelEjecutivo(): Promise<PanelEjecutivo> {
  const db = await tenantDb();
  const ajustes = await getSettings();
  const rates: Rates = {
    laborCostPerHour: Number(ajustes?.laborCostPerHour ?? 0),
    laborRatePerHour: Number(ajustes?.laborRatePerHour ?? 0),
  };

  const desde = new Date();
  desde.setMonth(desde.getMonth() - 11);
  desde.setDate(1);
  desde.setHours(0, 0, 0, 0);

  const [cola, pagos, overview, resueltos, clientes] = await Promise.all([
    getQueueCounts(),
    getPayablesSummary(),
    getProfitOverview({ since: desde }, rates, { months: 12 }),
    /*
      Tickets cerrados por mes, para la serie del indicador de servicio.

      ── EL PREDICADO VA POR RANGO, NO POR `date_trunc` ────────────────────

      La primera versión decía `date_trunc('month', t.resolved_at) = m.mes`, que
      se lee muy bien y es la razón por la que la pantalla de inicio recorría los
      14 151 tickets ENTEROS en cada carga: una función sobre la columna la
      esconde del índice, así que no hay índice que pueda ayudar. Medido con
      `explain analyze`: 28,85 ms y `Seq Scan`.

      Escrito como rango —`>= mes` y `< mes + 1 mes`— el predicado es indexable,
      y con el índice parcial de la migración 0035 pasa a `Index Scan` y 2,6 ms.
      Diez veces menos, en la pantalla que abre todo el mundo al entrar.

      El rango además es correcto donde `date_trunc` era frágil: no depende de
      que el huso del servidor coincida con el de la sesión.

      `date_trunc` sobre `now()` sí se conserva —para generar los meses— y no
      sobre `current_date`: sobre una fecha devuelve timestamp sin huso y la
      serie se corre un mes en cualquier huso con desfase, que son todos.
    */
    db.execute(sql`
      with meses as (
        select generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          interval '1 month'
        ) as mes
      )
      select to_char(m.mes, 'YYYY-MM') as mes,
             count(t.id)::int as n
        from meses m
        left join tickets t
          on t.resolved_at >= m.mes
         and t.resolved_at < m.mes + interval '1 month'
         and t.status in ('resolved','closed')
       group by m.mes
       order by m.mes
    `),
    /*
      Cuántos clientes se pueden facturar HOY.

      Un cliente sin expediente fiscal no es un dato incompleto: es una factura
      que no va a salir. Por eso es alerta y no una columna más en una tabla.
    */
    db.execute(sql`
      select count(*)::int as total,
             count(f.organization_id)::int as con_expediente,
             /*
               Los que están a UN PASO: tienen el RFC que trajo el padrón y solo
               les faltan el régimen y el código postal, que se copian de la
               Constancia. Se cuentan aparte porque la alerta sin ese número no
               dice por dónde empezar, y «23 clientes sin expediente» sin más es
               una cifra ante la que nadie sabe qué hacer primero.
             */
             count(*) filter (
               where f.organization_id is null and o.tax_id is not null
             )::int as con_rfc_del_padron
        from crm_organizations o
        left join cliente_fiscal f on f.organization_id = o.id
       where o.client_id is not null
    `),
  ]);

  /* ── Alertas ──────────────────────────────────────────────────────────── */
  const alertas: Alerta[] = [];

  if (cola.slaBreached > 0) {
    alertas.push({
      clave: "sla",
      titulo: `${cola.slaBreached} ticket(s) fuera de plazo`,
      detalle: "Pasaron su compromiso de primera respuesta.",
      cantidad: cola.slaBreached,
      href: "/admin/tickets",
      tono: "critica",
    });
  }
  if (cola.pending > 0) {
    alertas.push({
      clave: "revision",
      titulo: `${cola.pending} solicitud(es) sin revisar`,
      detalle: "Un cliente las mandó y todavía nadie las aprobó ni rechazó.",
      cantidad: cola.pending,
      href: "/admin/tickets",
      tono: "atencion",
    });
  }
  if (cola.unassigned > 0) {
    alertas.push({
      clave: "sin-asignar",
      titulo: `${cola.unassigned} ticket(s) sin asignar`,
      detalle: "Están abiertos y no son de nadie.",
      cantidad: cola.unassigned,
      href: "/admin/tickets",
      tono: "atencion",
    });
  }

  const vencido = pagos.byCurrency.find((c) => c.overdue > 0);
  if (vencido) {
    alertas.push({
      clave: "vencido",
      titulo: `${vencido.overdueCount} factura(s) de proveedor vencida(s)`,
      detalle: "Ya pasaron su fecha de pago.",
      cantidad: vencido.overdueCount,
      importe: vencido.overdue,
      moneda: vencido.currency,
      href: "/admin/compras/cuentas-por-pagar",
      tono: "critica",
    });
  }

  const fc = (clientes as unknown as Array<{
    total: number;
    con_expediente: number;
    con_rfc_del_padron: number;
  }>)[0] ?? { total: 0, con_expediente: 0, con_rfc_del_padron: 0 };
  const sinExpediente = Number(fc.total) - Number(fc.con_expediente);
  if (sinExpediente > 0) {
    alertas.push({
      clave: "sin-expediente",
      titulo: `${sinExpediente} cliente(s) sin expediente fiscal`,
      detalle: Number(fc.con_rfc_del_padron)
        ? `${fc.con_rfc_del_padron} ya tienen RFC: solo les falta el régimen y el código postal.`
        : "No se les puede timbrar una factura hasta capturarlo.",
      cantidad: sinExpediente,
      href: "/admin/clientes",
      tono: "atencion",
    });
  }

  /* ── Indicadores ──────────────────────────────────────────────────────── */
  const meses = overview.monthly;
  const ultimo = meses.at(-1);
  const previo = meses.at(-2);

  const serieResueltos = (resueltos as unknown as Array<{ mes: string; n: number }>).map((r) =>
    Number(r.n),
  );
  const resueltosMes = serieResueltos.at(-1) ?? 0;
  const resueltosPrevio = serieResueltos.at(-2) ?? 0;

  const kpis: Kpi[] = [
    {
      clave: "utilidad",
      etiqueta: "Utilidad del mes",
      valor: ultimo?.profit ?? 0,
      formato: "dinero",
      delta: variacion(ultimo?.profit ?? 0, previo?.profit ?? 0),
      subirEsBueno: true,
      serie: meses.map((m) => m.profit),
      href: "/admin/rentabilidad",
    },
    {
      clave: "ingreso",
      etiqueta: "Ingreso del mes",
      valor: ultimo?.revenue ?? 0,
      formato: "dinero",
      delta: variacion(ultimo?.revenue ?? 0, previo?.revenue ?? 0),
      subirEsBueno: true,
      serie: meses.map((m) => m.revenue),
      href: "/admin/rentabilidad",
    },
    {
      clave: "resueltos",
      etiqueta: "Servicios cerrados",
      valor: resueltosMes,
      formato: "entero",
      delta: variacion(resueltosMes, resueltosPrevio),
      subirEsBueno: true,
      serie: serieResueltos,
      href: "/admin/tickets",
    },
    {
      clave: "por-pagar",
      etiqueta: "Saldo por pagar",
      valor: pagos.byCurrency[0]?.balance ?? 0,
      formato: "dinero",
      // Deber más no es mejor. El delta se pinta al revés que los de arriba, y
      // por eso el color no puede salir del signo: sale de esta bandera.
      subirEsBueno: false,
      delta: null,
      serie: [],
      href: "/admin/compras/cuentas-por-pagar",
    },
  ];

  return {
    alertas,
    kpis,
    tendencia: meses.map((m) => ({
      label: new Date(m.month).toLocaleDateString("es-MX", { month: "short" }),
      revenue: m.revenue,
      cost: m.cost,
      profit: m.profit,
    })),
    facturables: { total: Number(fc.total), conExpediente: Number(fc.con_expediente) },
  };
}
