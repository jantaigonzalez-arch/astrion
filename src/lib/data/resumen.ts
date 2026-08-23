import "server-only";
import { sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";

/**
 * La empresa entera en cifras, para la pantalla de llegada.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * El panel resumía SERVICIO y nada más: cuatro tarjetas de tickets, los tickets
 * sin asignar y los tickets recientes. El menú de al lado ofrece Ventas,
 * Clientes, Inventario y Compras, y en bajío eso son 2.618 negocios, 88
 * clientes, 320 refacciones y 2.612 órdenes de compra que la pantalla de
 * entrada no mencionaba.
 *
 * Para un miembro el sesgo se disimula —entra a lo suyo por el menú y no vuelve
 * a mirar el panel—. Para quien llega de visita es la pantalla que le explica la
 * empresa, y le contaba una séptima parte.
 *
 * ── UNA SOLA CONSULTA, Y ESO ES EL DISEÑO ─────────────────────────────────
 *
 * Cinco áreas serían cinco o seis viajes a la base si cada una llamara a su
 * función de datos, y esta pantalla es la primera de cada sesión — la que más
 * caro paga cada milisegundo. Todo son conteos sobre índices, así que caben en
 * una pasada con subconsultas escalares. Es el mismo patrón que `statsFor` usa
 * en la consola para cifrar un inquilino entero.
 *
 * Las tablas van SIN calificar: la conexión trae el `search_path` del esquema
 * activo, que es lo que hace que la misma consulta sirva a cualquier empresa
 * sin interpolar su nombre.
 *
 * ── SI EL ESQUEMA NO RESPONDE ─────────────────────────────────────────────
 *
 * Devuelve null en vez de lanzar. Una empresa recién aprovisionada puede tener
 * el esquema a medio migrar, y en esa ventana la pantalla de llegada tiene que
 * decir «todavía no hay nada que resumir» y no tumbar el portal entero.
 */
export type ResumenEmpresa = {
  servicio: { total: number; abiertos: number; sinAsignar: number };
  ventas: { abiertos: number; valorAbierto: number; ganados: number };
  clientes: { total: number; contratos: number; porVencer: number };
  inventario: { refacciones: number; sinExistencia: number };
  compras: { ordenes: number; porPagar: number; vencidas: number };
};

export async function resumenEmpresa(): Promise<ResumenEmpresa | null> {
  const db = await tenantDb();

  try {
    const filas = (await db.execute(sql`
      select
        (select count(*)::int from tickets)                                   as t_total,
        (select count(*)::int from tickets
          where status in ('open','in_progress','pending_review','waiting'))  as t_abiertos,
        (select count(*)::int from tickets
          where assigned_to_id is null
            and status in ('open','in_progress','pending_review','waiting'))  as t_sin_asignar,

        (select count(*)::int from crm_deals where status = 'open')           as v_abiertos,
        -- El importe comparable: un negocio en dólares cuenta por su valor al
        -- tipo de cambio con el que se guardó, igual que en los informes.
        (select coalesce(sum(coalesce(value_mxn, value_usd * fx_rate)), 0)::float8
           from crm_deals where status = 'open')                              as v_valor,
        (select count(*)::int from crm_deals where status = 'won')            as v_ganados,

        (select count(*)::int from crm_organizations)                         as c_total,
        (select count(*)::int from contracts where end_date >= current_date)  as c_contratos,
        (select count(*)::int from contracts
          where end_date between current_date and current_date + 60)          as c_por_vencer,

        (select count(*)::int from spare_parts where active)                  as i_refacciones,
        (select count(*)::int from spare_parts where active and stock <= 0)   as i_sin_existencia,

        (select count(*)::int from purchase_orders
          where status not in ('received','cancelled'))                       as p_ordenes,
        (select count(*)::int from supplier_invoices where status = 'pending') as p_por_pagar,
        (select count(*)::int from supplier_invoices
          where status = 'pending' and due_at < current_date)                 as p_vencidas
    `)) as unknown as Array<Record<string, unknown>>;

    const r = filas[0];
    if (!r) return null;
    const n = (k: string) => Number(r[k] ?? 0);

    return {
      servicio: {
        total: n("t_total"),
        abiertos: n("t_abiertos"),
        sinAsignar: n("t_sin_asignar"),
      },
      ventas: {
        abiertos: n("v_abiertos"),
        valorAbierto: n("v_valor"),
        ganados: n("v_ganados"),
      },
      clientes: {
        total: n("c_total"),
        contratos: n("c_contratos"),
        porVencer: n("c_por_vencer"),
      },
      inventario: {
        refacciones: n("i_refacciones"),
        sinExistencia: n("i_sin_existencia"),
      },
      compras: {
        ordenes: n("p_ordenes"),
        porPagar: n("p_por_pagar"),
        vencidas: n("p_vencidas"),
      },
    };
  } catch {
    return null;
  }
}
