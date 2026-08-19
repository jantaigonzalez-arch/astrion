import "server-only";
import type { DbOrTx } from "@/lib/db";
import { sql, type SQL } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";

/**
 * Rentabilidad, calculada en la base.
 *
 * Antes este módulo tenía una sola función —`getTicketsWithCostData`— que traía
 * TODOS los tickets del histórico con todos sus comentarios y todas sus
 * refacciones, sin un solo `where`, y la página hacía el resto en JavaScript:
 * filtrar el periodo, sumar ingreso y costo, agrupar por mes, agrupar por
 * cliente y ordenar por margen. Dos consecuencias:
 *
 *  1. Pedir "este mes" costaba exactamente lo mismo que pedir "todo". El filtro
 *     de periodo era una ilusión: se leía el histórico completo y se descartaba
 *     después. El botón cambiaba lo que se veía, no lo que se trabajaba.
 *  2. El costo crecía con el histórico ×  comentarios × refacciones. Medido:
 *     1 176 escaneos de tabla para pintar una pantalla de seis gráficas.
 *
 * Ahora el corte por fecha va en el `where` —usa `tickets_created_at_idx`— y
 * cada agregado lo resuelve Postgres. Lo que viaja a Node son las filas que se
 * dibujan: cuatro indicadores, seis meses, seis clientes, seis servicios y una
 * página de detalle.
 *
 * La aritmética de `lib/profit.ts` se replica aquí en SQL, y eso es una
 * duplicación real que conviene tener a la vista: `computeProfit` sigue siendo
 * la fuente para UN ticket (la ficha de servicio, el contrato), y esto es la
 * misma fórmula para agregados. Las dos tienen que decir lo mismo —ingreso =
 * venta de refacciones + horas × tarifa; costo = costo de refacciones + horas ×
 * costo hora— y por eso la fórmula está escrita una sola vez, en `montos()`.
 */

export type Rates = {
  laborCostPerHour: number;
  laborRatePerHour: number;
};

/** Periodo pedido por la pantalla, ya resuelto a una fecha de corte. */
export type Period = { since: Date | null };

/**
 * Horas y refacciones por ticket, DENTRO DEL PERIODO.
 *
 * ── DOS RAMAS SEPARADAS ────────────────────────────────────────────────────
 *
 * Se agregan en dos ramas y no en un join encadenado. Con
 * `tickets ⋈ comentarios ⋈ refacciones` en una sola pasada, un comentario de
 * dos horas con tres refacciones aporta seis horas: el join multiplica las
 * filas y la suma cuenta cada hora tantas veces como refacciones cuelguen de
 * ella. Es el error clásico de este tipo de consulta y no se nota mirando el
 * total —solo sale un poco alto—, así que vale la pena el CTE extra.
 *
 * ── Y POR QUÉ EL PERIODO ENTRA AQUÍ Y NO SOLO DESPUÉS ──────────────────────
 *
 * Porque si no, no sirve de nada. El periodo se aplicaba únicamente al elegir
 * los tickets, ya con las dos ramas calculadas sobre el histórico ENTERO: pedir
 * «este mes» agregaba igualmente los 19 073 comentarios y los 6 216 consumos de
 * toda la vida de la empresa para después quedarse con los de treinta días.
 * Medido: 45 369 filas leídas para responder por 1 007 tickets, y 44 362 de
 * ellas no dependían del periodo pedido.
 *
 * `tix` fija el conjunto UNA vez y las dos ramas se cuelgan de él, así que
 * ahora las tres partes miran lo mismo. La nota de `periodOf` en la pantalla
 * decía que «este mes de verdad lee un mes»; a partir de aquí es cierto.
 *
 * Con el periodo en «Todo» se conserva la forma de antes, y está medido por
 * qué: ver el comentario dentro de la función. `tix` existe igual en los dos
 * caminos para que la consulta de arriba no tenga que saber cuál le tocó.
 */
function base(period: Period): SQL {
  /*
    Sin corte no hay nada que recortar, y entonces `tix` solo estorba: hay que
    materializar los 14 151 tickets y volver a cruzarlos contra los comentarios
    en las dos ramas. Medido, ese camino leía 119 745 filas contra las 77 292
    de recorrer los comentarios directo — casi el doble de trabajo para no
    descartar nada, y ~2× más lento.

    Así que «Todo» conserva la forma de siempre. No es un caso especial por
    comodidad: es que la pregunta es literalmente distinta, y la forma barata de
    contestar «cuánto de esto» no es la misma que la de «cuánto de todo».
  */
  if (!period.since) {
    return sql`
  tix as (
    select t.id, t.reference, t.subject, t.created_by_id, t.created_at
      from tickets t
  ),
  horas as (
    select ticket_id, coalesce(sum(hours), 0) as h
      from ticket_comments
     group by ticket_id
  ),
  refa as (
    select c.ticket_id,
           coalesce(sum(p.quantity * coalesce(p.unit_price_mxn, 0)), 0) as venta,
           coalesce(sum(p.quantity * coalesce(p.unit_cost_mxn, 0)), 0)  as costo
      from ticket_comment_parts p
      join ticket_comments c on c.id = p.comment_id
     group by c.ticket_id
  )
`;
  }

  return sql`
  tix as (
    select t.id, t.reference, t.subject, t.created_by_id, t.created_at
      from tickets t
      ${desde(period)}
  ),
  horas as (
    select tc.ticket_id, coalesce(sum(tc.hours), 0) as h
      from ticket_comments tc
      join tix on tix.id = tc.ticket_id
     group by tc.ticket_id
  ),
  refa as (
    select c.ticket_id,
           coalesce(sum(p.quantity * coalesce(p.unit_price_mxn, 0)), 0) as venta,
           coalesce(sum(p.quantity * coalesce(p.unit_cost_mxn, 0)), 0)  as costo
      from ticket_comment_parts p
      join ticket_comments c on c.id = p.comment_id
      join tix on tix.id = c.ticket_id
     group by c.ticket_id
  )
`;
}

/**
 * La fórmula, una sola vez.
 *
 * `billable` marca los servicios con algo que cobrar: sin actividad registrada
 * un ticket no aporta ni ingreso ni costo, y contarlo hundiría el margen medio
 * con ceros que no son pérdidas.
 */
function montos(r: Rates): SQL {
  return sql`
    coalesce(refa.venta, 0)                          as parts_revenue,
    coalesce(refa.costo, 0)                          as parts_cost,
    coalesce(horas.h, 0) * ${r.laborRatePerHour}     as labor_revenue,
    coalesce(horas.h, 0) * ${r.laborCostPerHour}     as labor_cost,
    coalesce(horas.h, 0)                             as hours,
    coalesce(refa.venta, 0) + coalesce(horas.h, 0) * ${r.laborRatePerHour} as revenue,
    coalesce(refa.costo, 0) + coalesce(horas.h, 0) * ${r.laborCostPerHour} as cost
  `;
}

/** `created_at >= corte`, o nada si el periodo es "todo". */
function desde(period: Period): SQL {
  return period.since
    ? sql`where t.created_at >= ${period.since.toISOString()}::timestamptz`
    : sql``;
}

/** Solo lo facturable: al menos un peso de ingreso o de costo. */
const FACTURABLE = sql`where b.revenue > 0 or b.cost > 0`;

type Row = Record<string, unknown>;
const rows = (r: unknown) => r as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);

/* ============================================================
   Indicadores
   ============================================================ */

export type ProfitTotals = {
  partsRevenue: number;
  partsCost: number;
  laborRevenue: number;
  laborCost: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  hours: number;
  /** Cuántos servicios entraron en la cuenta. */
  services: number;
};

function totalsFrom(t: Row): ProfitTotals {
  const revenue = n(t.revenue);
  const cost = n(t.cost);
  const profit = revenue - cost;

  return {
    partsRevenue: n(t.parts_revenue),
    partsCost: n(t.parts_cost),
    laborRevenue: n(t.labor_revenue),
    laborCost: n(t.labor_cost),
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    hours: n(t.hours),
    services: n(t.services),
  };
}

/* ============================================================
   Serie mensual
   ============================================================ */

export type MonthlyPoint = {
  month: Date;
  revenue: number;
  cost: number;
  profit: number;
};

export type ClientProfit = {
  clientId: string;
  services: number;
  profit: number;
  margin: number;
};

export type ServiceProfit = {
  id: string;
  reference: string;
  subject: string;
  clientId: string;
  hours: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

function serviceRow(s: Row): ServiceProfit {
  const revenue = n(s.revenue);
  const cost = n(s.cost);
  const profit = revenue - cost;
  return {
    id: String(s.id),
    reference: String(s.reference),
    subject: String(s.subject),
    clientId: String(s.created_by_id),
    hours: n(s.hours),
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
  };
}

export type ProfitOverview = {
  totals: ProfitTotals;
  monthly: MonthlyPoint[];
  byClient: ClientProfit[];
  worst: ServiceProfit[];
};

/**
 * Todo lo que la pantalla resume, en UN viaje a la base.
 *
 * Empezó siendo cuatro funciones —totales, serie mensual, ranking de clientes y
 * peores márgenes—, que es como se lee mejor. Medido, era peor: cada una
 * repetía por su cuenta la agregación de horas y refacciones, así que el
 * periodo "todo" se recorría cuatro veces para pintar una sola pantalla.
 *
 * Aquí el CTE `b` se declara una vez y lo consultan los cuatro `select`.
 * Postgres materializa un CTE referenciado más de una vez, así que el histórico
 * se recorre UNA y los cuatro agregados se calculan sobre el resultado.
 *
 * Cada bloque llega como JSON en una sola fila. Es lo que permite devolver
 * cuatro formas distintas sin cuatro viajes, y a cambio hay que reconstruir los
 * tipos en TypeScript — que es justo lo que hacen `totalsFrom` y `serviceRow`.
 *
 * La serie mensual mira SIEMPRE los últimos `months` meses, aunque el periodo
 * pedido sea más largo: son los puntos que la gráfica sabe dibujar. Por eso su
 * filtro es propio y no el del periodo.
 */
export async function getProfitOverview(
  period: Period,
  r: Rates,
  { months = 6, top = 6, conexion }: { months?: number; top?: number; conexion?: DbOrTx } = {},
): Promise<ProfitOverview> {
  const db = conexion ?? (await tenantDb());

  const res = await db.execute(sql`
    with ${base(period)},
    b as (
      select t.id, t.reference, t.subject, t.created_by_id, t.created_at,
             ${montos(r)}
        from tix t
        left join horas on horas.ticket_id = t.id
        left join refa  on refa.ticket_id  = t.id
    ),
    fact as (select * from b ${FACTURABLE}),
    -- now() y no current_date: date_trunc sobre una fecha devuelve timestamp
    -- SIN zona, y los tickets la llevan. Mezclar los dos tipos rompía el join
    -- de meses en cualquier huso con desfase, que son todos.
    meses as (
      select generate_series(
        date_trunc('month', now()) - make_interval(months => ${months - 1}),
        date_trunc('month', now()),
        interval '1 month'
      ) as mes
    ),
    por_mes as (
      select date_trunc('month', fact.created_at) as mes,
             sum(fact.revenue)::float8 as revenue,
             sum(fact.cost)::float8    as cost
        from fact
       where fact.created_at >= date_trunc('month', now())
                                - make_interval(months => ${months - 1})
       group by 1
    )
    select
      (select json_build_object(
          'parts_revenue', coalesce(sum(parts_revenue), 0)::float8,
          'parts_cost',    coalesce(sum(parts_cost), 0)::float8,
          'labor_revenue', coalesce(sum(labor_revenue), 0)::float8,
          'labor_cost',    coalesce(sum(labor_cost), 0)::float8,
          'revenue',       coalesce(sum(revenue), 0)::float8,
          'cost',          coalesce(sum(cost), 0)::float8,
          'hours',         coalesce(sum(hours), 0)::float8,
          'services',      count(*)::int)
         from fact) as totals,

      (select coalesce(json_agg(json_build_object(
          'mes',     meses.mes,
          'revenue', coalesce(por_mes.revenue, 0),
          'cost',    coalesce(por_mes.cost, 0)) order by meses.mes), '[]'::json)
         from meses left join por_mes on por_mes.mes = meses.mes) as monthly,

      (select coalesce(json_agg(c), '[]'::json) from (
          select created_by_id::text as client_id,
                 count(*)::int       as services,
                 sum(revenue)::float8 as revenue,
                 sum(cost)::float8    as cost
            from fact
           group by created_by_id
           order by (sum(revenue) - sum(cost)) desc
           limit ${top}
       ) c) as by_client,

      (select coalesce(json_agg(w), '[]'::json) from (
          select id::text as id, reference, subject,
                 created_by_id::text as created_by_id,
                 hours::float8 as hours,
                 revenue::float8 as revenue,
                 cost::float8 as cost
            from b
           where revenue > 0
           order by (revenue - cost) / revenue asc
           limit ${top}
       ) w) as worst
  `);

  const row = rows(res)[0] ?? {};
  const monthly = (row.monthly ?? []) as Array<Record<string, unknown>>;
  const byClient = (row.by_client ?? []) as Array<Record<string, unknown>>;
  const worst = (row.worst ?? []) as Row[];

  return {
    totals: totalsFrom((row.totals ?? {}) as Row),
    monthly: monthly.map((m) => {
      const revenue = n(m.revenue);
      const cost = n(m.cost);
      return {
        month: new Date(String(m.mes)),
        revenue,
        cost,
        profit: revenue - cost,
      };
    }),
    byClient: byClient.map((c) => {
      const revenue = n(c.revenue);
      const profit = revenue - n(c.cost);
      return {
        clientId: String(c.client_id),
        services: n(c.services),
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      };
    }),
    worst: worst.map(serviceRow),
  };
}

/* ============================================================
   Detalle
   ============================================================ */

/** Una página del detalle por servicio, con el total para paginar. */
export async function getProfitDetail(
  period: Period,
  r: Rates,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ rows: ServiceProfit[]; total: number }> {
  const db = await tenantDb();
  const res = await db.execute(sql`
    with ${base(period)},
    b as (
      select t.id, t.reference, t.subject, t.created_by_id, t.created_at, ${montos(r)}
        from tix t
        left join horas on horas.ticket_id = t.id
        left join refa  on refa.ticket_id  = t.id
    )
    select b.*, count(*) over ()::int as total
      from b ${FACTURABLE}
     order by b.created_at desc
     limit ${limit} offset ${offset}
  `);

  const list = rows(res);
  return {
    rows: list.map(serviceRow),
    total: n(list[0]?.total),
  };
}
