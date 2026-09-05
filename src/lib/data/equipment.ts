import "server-only";
import { asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { equipment, equipmentModules, tickets } from "@/lib/db/schema";
import { getTenantMember, listTenantMembers } from "@/lib/data/people";
import { users } from "@/lib/db/platform";
import type { Orden } from "@/lib/listado";

// Null si el id es de alguien de OTRA empresa: el uuid viaja en la URL, así que
// sin esta comprobación la ficha de un cliente ajeno estaba a un cambio de
// dirección de distancia.
export async function getOwner(ownerId: string) {
  return getTenantMember(ownerId);
}

// Historial de tickets de un equipo (para la ficha del equipo).
export async function getTicketsByEquipment(equipmentId: string) {
  const db = await tenantDb();
  return db
    .select({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.equipmentId, equipmentId))
    .orderBy(desc(tickets.createdAt));
}

/**
 * Laboratorios (clientes) con su inventario, para que el staff levante un
 * servicio a nombre de uno de ellos.
 *
 * Dos consultas fijas, no una por laboratorio.
 *
 * Antes esto era un `Promise.all` sobre `getEquipmentTree(c.id)`: una consulta
 * de inventario **por cada cliente**. Medido en `/admin/tickets/new`, 23 de las
 * 27 consultas de la pantalla eran la misma, cambiando solo el uuid del dueño.
 * El `Promise.all` disimulaba el síntoma —salían en paralelo, así que la
 * latencia parecía constante— pero el trabajo del servidor y las conexiones
 * ocupadas crecían con el padrón: con 200 laboratorios son 200 consultas para
 * llenar dos desplegables.
 *
 * Ahora se piden todos los equipos de esos dueños de una vez y se agrupan
 * aquí. Lo que crece con el padrón es el tamaño del resultado, que es lo que
 * de verdad hay que enseñar, y no el número de viajes a la base.
 */
export async function getClientsWithEquipment() {
  const clients = await listTenantMembers({
    roles: ["client"],
    orderBy: "company",
  });
  if (clients.length === 0) return [];

  const trees = await getEquipmentTreesFor(clients.map((c) => c.id));

  return clients.map((c) => ({ ...c, equipment: trees.get(c.id) ?? [] }));
}

/** El inventario de varios dueños de una sola vez, indexado por dueño. */
export async function getEquipmentTreesFor(ownerIds: readonly string[]) {
  const ids = [...new Set(ownerIds)];
  const grouped = new Map<string, EquipmentTree>();
  if (ids.length === 0) return grouped;

  const db = await tenantDb();
  const rows = await db.query.equipment.findMany({
    where: inArray(equipment.ownerId, ids),
    orderBy: [asc(equipment.createdAt)],
    with: {
      modules: {
        orderBy: [asc(equipmentModules.createdAt)],
        with: { submodules: true },
      },
    },
  });

  // El orden por `createdAt` de la consulta se conserva dentro de cada grupo:
  // recorrer en orden y empujar al final mantiene lo que pidió el `orderBy`.
  for (const row of rows) {
    const bucket = grouped.get(row.ownerId);
    if (bucket) bucket.push(row);
    else grouped.set(row.ownerId, [row]);
  }
  return grouped;
}

type EquipmentTree = Awaited<ReturnType<typeof getEquipmentTree>>;

export async function getEquipmentTree(ownerId: string) {
  const db = await tenantDb();
  return db.query.equipment.findMany({
    where: eq(equipment.ownerId, ownerId),
    orderBy: [asc(equipment.createdAt)],
    with: {
      modules: {
        orderBy: [asc(equipmentModules.createdAt)],
        with: { submodules: true },
      },
    },
  });
}

/* ===================== El parque completo, en una lista ===================== */

/**
 * El inventario de equipos de TODA la empresa, no el de un cliente.
 *
 * Faltaba, y se notaba de una forma concreta: `/admin/equipos` daba 404 y tres
 * análisis enlazaban ahí —«equipos próximos a requerir servicio», «de qué
 * marcas es el parque instalado» y «equipos que más servicio consumen»—. El
 * único inventario que existía era el de la ficha de cada laboratorio, así que
 * para responder «¿cuántos Waters tenemos?» había que abrir los veinticuatro.
 *
 * Se consulta con un `select` a mano y no con el API relacional porque hay que
 * ORDENAR por el nombre del laboratorio, que vive en otra tabla: el cargador de
 * relaciones trae los datos pero no deja ordenar por ellos.
 */
/*
  LOS DOS CONTEOS, COMO SUBCONSULTA Y NO COMO JOIN CON AGREGADO.

  Estaban escritos como `left join` a módulos y a tickets más un
  `count(distinct …)`. Da el número correcto y multiplica filas antes de
  agrupar: cada equipo se repite una vez por cada módulo POR cada ticket suyo.
  Medido sobre los datos de hoy —97 equipos, 171 módulos, 635 tickets— Postgres
  materializaba y ORDENABA 2 700 filas para devolver 97.

  Y crece multiplicando, no sumando. Con veinte veces estos datos, medido en un
  esquema de ensayo: 28 000 filas intermedias y 30,7 ms contra 7,1 ms de esta
  forma. Cuatro veces, y la distancia se abre a cada equipo nuevo.

  Es el mismo arreglo que ya lleva `getOrganizations` —donde leía 7 690 filas
  para pintar 164 tarjetas— y el mismo que su propio `enContrato` de aquí abajo
  ya usaba con un `exists`. Faltaba aplicárselo a los conteos.

  El join a `users` se queda: es de uno a muchos al revés —un equipo tiene un
  dueño— así que no multiplica nada, y hace falta para ordenar por laboratorio.
*/
const N_MODULOS = sql<number>`(
  select count(*)::int from ${equipmentModules}
   where ${equipmentModules}.equipment_id = ${equipment}.id
)`;
const N_SERVICIOS = sql<number>`(
  select count(*)::int from ${tickets}
   where ${tickets}.equipment_id = ${equipment}.id
)`;

const ORDEN_EQUIPOS = {
  nombre: equipment.name,
  marca: equipment.brand,
  laboratorio: users.name,
  modulos: N_MODULOS,
  servicios: N_SERVICIOS,
  alta: equipment.createdAt,
} as const;

export type CampoOrdenEquipos = keyof typeof ORDEN_EQUIPOS;
export const CAMPOS_ORDEN_EQUIPOS = Object.keys(ORDEN_EQUIPOS) as CampoOrdenEquipos[];

/** Los que más servicio consumen primero: es la pregunta que trae a esta lista. */
export const ORDEN_EQUIPOS_DEFECTO: Orden<CampoOrdenEquipos> = {
  campo: "servicios",
  dir: "desc",
};

export type FiltrosEquipos = {
  marca?: string;
  laboratorio?: string;
  /** `con` = amparado por algún contrato; `sin` = a la intemperie. */
  contrato?: "con" | "sin";
};

export const CONTRATO_FILTROS = ["con", "sin"] as const;

function whereEquipos(f: FiltrosEquipos) {
  const cond: SQL[] = [];
  if (f.marca) cond.push(sql`${equipment.brand} = ${f.marca}`);
  if (f.laboratorio) cond.push(sql`${equipment.ownerId} = ${f.laboratorio}::uuid`);
  if (f.contrato) {
    const existe = sql`exists (select 1 from contract_equipment ce where ce.equipment_id = ${equipment.id})`;
    cond.push(f.contrato === "con" ? existe : sql`not ${existe}`);
  }
  return cond.length ? sql.join(cond, sql` and `) : undefined;
}

export async function getEquipmentList({
  limit,
  offset,
  orden = ORDEN_EQUIPOS_DEFECTO,
  filtros = {},
}: {
  limit: number;
  offset: number;
  orden?: Orden<CampoOrdenEquipos>;
  filtros?: FiltrosEquipos;
}) {
  const db = await tenantDb();
  const col = ORDEN_EQUIPOS[orden.campo];
  return db
    .select({
      id: equipment.id,
      name: equipment.name,
      brand: equipment.brand,
      model: equipment.model,
      createdAt: equipment.createdAt,
      ownerId: equipment.ownerId,
      ownerName: users.name,
      modulos: N_MODULOS,
      servicios: N_SERVICIOS,
      // Amparado por contrato: se resuelve en la misma pasada con un `exists`
      // en vez de un join más, que multiplicaría filas antes de agrupar.
      enContrato: sql<boolean>`exists (
        select 1 from contract_equipment ce where ce.equipment_id = ${equipment.id})`,
    })
    .from(equipment)
    .leftJoin(users, eq(users.id, equipment.ownerId))
    .where(whereEquipos(filtros))
    // `id` de desempate: sin él, dos equipos con el mismo número de servicios
    // pueden intercambiarse entre páginas. Ver la nota de la cola de servicio.
    .orderBy(sql`${col} ${orden.dir === "asc" ? sql`asc` : sql`desc`} nulls last`, desc(equipment.id))
    .limit(limit)
    .offset(offset);
}

export async function countEquipment(filtros: FiltrosEquipos = {}): Promise<number> {
  const db = await tenantDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(equipment)
    .where(whereEquipos(filtros));
  return row?.n ?? 0;
}

/** Las opciones de cada filtro con su conteo, cada una sin su propio filtro. */
export async function conteosEquipos(filtros: FiltrosEquipos) {
  const db = await tenantDb();

  const [marca, laboratorio, contrato] = await Promise.all([
    db
      .select({ k: sql<string>`coalesce(${equipment.brand}, '—')`, n: sql<number>`count(*)::int` })
      .from(equipment)
      .where(whereEquipos({ ...filtros, marca: undefined }))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        k: sql<string>`${equipment.ownerId}::text`,
        nombre: sql<string | null>`max(${users.name})`,
        n: sql<number>`count(*)::int`,
      })
      .from(equipment)
      .leftJoin(users, eq(users.id, equipment.ownerId))
      .where(whereEquipos({ ...filtros, laboratorio: undefined }))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        k: sql<string>`case when exists (
          select 1 from contract_equipment ce where ce.equipment_id = ${equipment.id}
        ) then 'con' else 'sin' end`,
        n: sql<number>`count(*)::int`,
      })
      .from(equipment)
      .where(whereEquipos({ ...filtros, contrato: undefined }))
      .groupBy(sql`1`),
  ]);

  return {
    marca,
    laboratorio: laboratorio.map((l) => ({ id: l.k, nombre: l.nombre ?? "—", n: l.n })),
    contrato: new Map(contrato.map((c) => [c.k, c.n])),
  };
}
