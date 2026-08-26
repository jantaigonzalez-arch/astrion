import "server-only";
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { DbOrTx } from "@/lib/db";
import type { Orden } from "@/lib/listado";
import {
  contracts,
  contractEquipment,
  tickets,
  ticketComments,
} from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import { users } from "@/lib/db/platform";

/**
 * Contratos, opcionalmente de un vendedor y opcionalmente una página.
 *
 * `page` es OPCIONAL y no obligatorio a propósito: esta función la usan tres
 * sitios con necesidades distintas. El listado quiere una página; el panel
 * quiere los del vendedor para contarlos; y «contratos por vencer», en la capa
 * de análisis, necesita mirarlos TODOS —un contrato que vence en 40 días puede
 * estar en cualquier página, y paginarlo ahí convertiría el aviso en una
 * lotería—. Obligar a paginar habría roto justo al que no puede paginar.
 */
/**
 * Por qué columnas se puede ordenar la lista de contratos. Lista BLANCA: ver
 * la cabecera de `lib/listado.ts`.
 *
 * `monto` ordena por el importe en PESOS. Los contratos en dólares tienen ese
 * campo vacío, así que caen al final —`nulls last`— en vez de mezclarse como
 * ceros: un contrato de 22.000 USD no vale menos que uno de 3.000 MXN, y
 * ponerlo abajo con un cero al lado sería afirmarlo. Convertirlo aquí exigiría
 * una paridad que la fila no siempre trae.
 */
const ORDEN_CONTRATOS = {
  numero: contracts.number,
  monto: contracts.amountMxn,
  inicio: contracts.startDate,
  fin: contracts.endDate,
  creado: contracts.createdAt,
} as const;

export type CampoOrdenContratos = keyof typeof ORDEN_CONTRATOS;
export const CAMPOS_ORDEN_CONTRATOS = Object.keys(
  ORDEN_CONTRATOS,
) as CampoOrdenContratos[];

/** Lo más reciente primero, como estaba antes de que se pudiera ordenar. */
export const ORDEN_CONTRATOS_DEFECTO: Orden<CampoOrdenContratos> = {
  campo: "creado",
  dir: "desc",
};

export type FiltrosContratos = {
  /** Quién lo firmó. */
  vendedor?: string;
  /**
   * Su momento respecto de hoy: `vigente`, `por-vencer` (60 días) o `vencido`.
   *
   * Sesenta días es el mismo umbral que usa el análisis «contratos por vencer»,
   * y comparte el motivo: es el aviso con tiempo suficiente para renovar sin
   * que la lista se llene de contratos que aún no preocupan. Si los dos números
   * divergieran, el tablero y la lista dirían cosas distintas sobre el mismo
   * contrato.
   */
  vigencia?: "vigente" | "por-vencer" | "vencido";
};

export const VIGENCIAS = ["vigente", "por-vencer", "vencido"] as const;

/** La condición, compartida por la lista y su conteo. */
function whereContratos(salesRepId: string | undefined, f: FiltrosContratos = {}) {
  const cond: SQL[] = [];
  if (salesRepId) cond.push(sql`${contracts.salesRepId} = ${salesRepId}::uuid`);
  if (f.vendedor) cond.push(sql`${contracts.salesRepId} = ${f.vendedor}::uuid`);

  if (f.vigencia === "vencido") {
    cond.push(sql`${contracts.endDate} is not null and ${contracts.endDate} < current_date`);
  } else if (f.vigencia === "por-vencer") {
    cond.push(sql`${contracts.endDate} is not null
      and ${contracts.endDate} >= current_date
      and ${contracts.endDate} < current_date + interval '60 days'`);
  } else if (f.vigencia === "vigente") {
    // Sin fecha de fin cuenta como vigente: es un contrato abierto, no uno
    // caducado. Tratarlo como vencido lo escondería del filtro que sí se mira.
    cond.push(sql`${contracts.endDate} is null or ${contracts.endDate} >= current_date`);
  }

  return cond.length ? sql.join(cond, sql` and `) : undefined;
}

export async function getContracts(
  salesRepId?: string,
  conexion?: DbOrTx,
  page?: { limit: number; offset: number },
  orden: Orden<CampoOrdenContratos> = ORDEN_CONTRATOS_DEFECTO,
  filtros: FiltrosContratos = {},
) {
  const db = conexion ?? (await tenantDb());
  const col = ORDEN_CONTRATOS[orden.campo];
  return db.query.contracts.findMany({
    where: whereContratos(salesRepId, filtros),
    // `id` de desempate, por lo mismo que en la cola de servicio: sin él, dos
    // contratos con la misma fecha pueden cambiar de página entre una petición
    // y la siguiente.
    orderBy: [
      sql`${col} ${orden.dir === "asc" ? sql`asc` : sql`desc`} nulls last`,
      desc(contracts.id),
    ],
    ...(page ? { limit: page.limit, offset: page.offset } : {}),
    with: {
      client: { columns: { id: true, name: true, email: true, company: true } },
      salesRep: { columns: { id: true, name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/**
 * Cuántos contratos hay, para el paginador.
 *
 * Consulta aparte y no una ventana dentro de la anterior: aquella usa el API
 * relacional —trae equipos y sus enlaces— y ahí no cabe un `count(*) over ()`.
 * Se lanzan en paralelo, así que cuesta latencia cero; lo que se acepta es que
 * entre las dos alguien firme un contrato y el recuento quede corto por uno
 * durante un instante. En un paginador eso es tolerable; en un total de dinero
 * no lo sería.
 */
export async function countContracts(
  salesRepId?: string,
  conexion?: DbOrTx,
  filtros: FiltrosContratos = {},
): Promise<number> {
  const db = conexion ?? (await tenantDb());
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contracts)
    // La MISMA condición que la lista. Si el conteo ignorara los filtros, el
    // paginador ofrecería páginas que no existen.
    .where(whereContratos(salesRepId, filtros));
  return row?.n ?? 0;
}

/**
 * Cuántos contratos caen en cada opción de cada filtro, para las fichas.
 *
 * Cada dimensión se cuenta sin su propio filtro, igual que en la cola de
 * servicio: el número junto a «Por vencer» dice cuántos habría si se pulsara,
 * no cuántos hay ya filtrando por eso.
 */
export async function conteosContratos(
  salesRepId: string | undefined,
  filtros: FiltrosContratos,
  conexion?: DbOrTx,
) {
  const db = conexion ?? (await tenantDb());

  const [vigencia, vendedor] = await Promise.all([
    db
      .select({
        k: sql<string>`case
          when ${contracts.endDate} is null or ${contracts.endDate} >= current_date then
            case when ${contracts.endDate} is not null
                  and ${contracts.endDate} < current_date + interval '60 days'
                 then 'por-vencer' else 'vigente' end
          else 'vencido' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(contracts)
      .where(whereContratos(salesRepId, { ...filtros, vigencia: undefined }))
      .groupBy(sql`1`)
      .then((f) => new Map(f.map((r) => [r.k, r.n]))),
    /*
      Los vendedores salen de los CONTRATOS y no del rol de las cuentas.

      Se armaba con `getSalesReps()`, que lista a quien tiene rol de vendedor,
      admin o dueño, y eso dejaba fuera a quien tiene contratos SIN ese rol:
      Aneth atiende servicios —es agente— y además firmó dos contratos, así que
      sus contratos existían y no había ficha para encontrarlos. Al revés
      también fallaba, ofreciendo vendedores con cero.

      Preguntándoselo a los datos, la lista es exactamente la de quien aparece.
    */
    db
      .select({
        k: sql<string>`coalesce(${contracts.salesRepId}::text, 'sin')`,
        nombre: sql<string | null>`max(${users.name})`,
        n: sql<number>`count(*)::int`,
      })
      .from(contracts)
      .leftJoin(users, eq(users.id, contracts.salesRepId))
      .where(whereContratos(salesRepId, { ...filtros, vendedor: undefined }))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`)),
  ]);

  return {
    vigencia,
    vendedor: vendedor.map((v) => ({
      id: v.k,
      nombre: v.k === "sin" ? "Sin vendedor" : (v.nombre ?? "—"),
      n: v.n,
    })),
  };
}

/** Detalle completo: equipos amparados con sus módulos y submódulos. */
export async function getContractById(id: string) {
  const db = await tenantDb();
  return db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: {
      client: {
        columns: {
          id: true,
          name: true,
          email: true,
          company: true,
          phone: true,
        },
      },
      salesRep: { columns: { id: true, name: true, email: true } },
      // Negocio del CRM que originó el contrato (trazabilidad comercial).
      deal: { columns: { id: true, reference: true, title: true } },
      equipmentLinks: {
        with: {
          equipment: {
            with: { modules: { with: { submodules: true } } },
          },
        },
      },
    },
  });
}

/** Horas y refacciones de cada ticket, para calcular utilidad consolidada. */
export async function getProfitInputsForTickets(ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  const db = await tenantDb();
  const rows = await db.query.ticketComments.findMany({
    where: inArray(ticketComments.ticketId, ticketIds),
    columns: { id: true, ticketId: true, hours: true },
    with: {
      parts: {
        columns: { quantity: true, unitCostMxn: true, unitPriceMxn: true },
      },
    },
  });

  // Agrupa por ticket.
  const byTicket = new Map<
    string,
    {
      hours: number;
      parts: {
        quantity: number;
        unitCostMxn: string | null;
        unitPriceMxn: string | null;
      }[];
    }
  >();
  for (const r of rows) {
    const cur = byTicket.get(r.ticketId) ?? { hours: 0, parts: [] };
    cur.hours += Number(r.hours ?? 0);
    cur.parts.push(...r.parts);
    byTicket.set(r.ticketId, cur);
  }
  return Array.from(byTicket.entries()).map(([ticketId, v]) => ({
    ticketId,
    ...v,
  }));
}

/** Tickets de los equipos amparados por el contrato. */
export async function getTicketsForEquipmentIds(equipmentIds: string[]) {
  if (equipmentIds.length === 0) return [];
  const db = await tenantDb();
  return db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      equipmentId: tickets.equipmentId,
    })
    .from(tickets)
    .where(inArray(tickets.equipmentId, equipmentIds))
    .orderBy(desc(tickets.createdAt));
}

/** Contratos de un laboratorio (para su ficha). */
export async function getContractsForClient(clientId: string) {
  const db = await tenantDb();
  return db.query.contracts.findMany({
    where: eq(contracts.clientId, clientId),
    orderBy: [desc(contracts.createdAt)],
    with: {
      salesRep: { columns: { name: true, email: true } },
      equipmentLinks: { with: { equipment: true } },
    },
  });
}

/** Vendedores activos (y admins/dueño, que también pueden figurar como responsables). */
export async function getSalesReps() {
  return listTenantMembers({ roles: ["sales", "admin", "owner"] });
}

export { contractEquipment };
