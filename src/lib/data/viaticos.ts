import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import {
  contractEquipment,
  contracts,
  crmOrganizations,
  equipment,
  equipmentModules,
  tickets,
  viaticoExpenses,
  viaticoModules,
  viaticos,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import type { ViaticoEstado } from "@/lib/viaticos";

/**
 * Lectura de viáticos.
 *
 * ── QUIÉN VE QUÉ SE DECIDE AQUÍ, UNA VEZ ───────────────────────────────────
 *
 * El ingeniero ve LOS SUYOS y General ve TODOS, y las dos cosas se piden por la
 * misma dirección. Acotar por ruta no serviría, así que el filtro tiene que
 * vivir en la consulta — y en un solo sitio, porque repartido por las pantallas
 * es cuestión de tiempo que una se olvide y enseñe los viáticos de todo el
 * mundo a quien solo debía ver los suyos.
 *
 * Por eso `soloDe` es un parámetro OBLIGATORIO y no opcional: quien llama tiene
 * que decir a nombre de quién pregunta. Con un opcional, olvidarlo daría la
 * lista completa, que es exactamente la falla que hay que hacer imposible.
 * `null` significa «ve todo» y se escribe a propósito.
 */

export type ViaticoFila = {
  id: string;
  reference: string;
  status: ViaticoEstado;
  destination: string;
  departsOn: string;
  returnsOn: string;
  estimatedMxn: string;
  authorizedMxn: string | null;
  contractNumber: string;
  solicitante: string | null;
  /** Para saber si le toca mover a quien mira. Ver la lista. */
  solicitanteId: string;
  /** Cuántos gastos lleva cargados y por cuánto. */
  gastos: number;
  gastadoMxn: number;
};

/**
 * ── LA LISTA SE PARTE EN DOS, Y LA MITAD DE ABAJO SE PAGINA ────────────────
 *
 * Lo ABIERTO —lo que espera que alguien haga algo— sale entero y sin tope: un
 * viático escondido detrás de un paginador es un viático que nadie firma, y esta
 * pantalla existe justamente para que eso no pase. Son unos pocos a la vez, y
 * cuando dejen de serlo el problema no es el paginador.
 *
 * Lo CERRADO es la mitad que crece para siempre. Una empresa con tres años aquí
 * dentro tiene miles de viajes liquidados y ninguna razón para leerlos todos de
 * una carga. Es el mismo reparto que ya hacen las cuentas por pagar, y por el
 * mismo motivo.
 *
 * Antes esto no tenía `limit` de ninguna clase: con dos filas no se notaba y con
 * cinco mil habría traído las cinco mil para pintar una pantalla.
 */
export type FiltrosViaticos = {
  estado?: ViaticoEstado;
  /** Solo lo que espera acción: borrador, enviado, autorizado, en revisión. */
  abiertos?: boolean;
  /** Solo el archivo: cerrado, rechazado, cancelado. */
  cerrados?: boolean;
};

const ABIERTOS = ["borrador", "enviado", "autorizado", "en_revision"] as const;
const CERRADOS = ["cerrado", "rechazado", "cancelado"] as const;

export async function listViaticos(
  soloDe: string | null,
  filtros?: FiltrosViaticos,
  page?: { limit: number; offset: number },
  conexion?: DbOrTx,
): Promise<ViaticoFila[]> {
  const db = conexion ?? (await tenantDb());
  const q = db
    .select({
      id: viaticos.id,
      reference: viaticos.reference,
      status: viaticos.status,
      destination: viaticos.destination,
      departsOn: viaticos.departsOn,
      returnsOn: viaticos.returnsOn,
      estimatedMxn: viaticos.estimatedMxn,
      authorizedMxn: viaticos.authorizedMxn,
      contractNumber: contracts.number,
      solicitante: users.name,
      solicitanteId: viaticos.requestedById,
      /*
        Subconsultas correlacionadas y no `left join` + `count`: con el join,
        cada viático se repetiría una vez por gasto antes de agrupar, y el
        importe del contrato se contaría tantas veces como renglones tenga. Es
        el mismo arreglo que ya llevan `getOrganizations` y el listado de
        equipos.
      */
      gastos: sql<number>`(
        select count(*)::int from ${viaticoExpenses} g
         where g.viatico_id = ${viaticos.id}
      )`,
      gastadoMxn: sql<number>`(
        select coalesce(sum(g.amount_mxn), 0)::float8 from ${viaticoExpenses} g
         where g.viatico_id = ${viaticos.id}
      )`,
    })
    .from(viaticos)
    .innerJoin(contracts, eq(contracts.id, viaticos.contractId))
    .leftJoin(users, eq(users.id, viaticos.requestedById))
    .where(
      and(
        soloDe ? eq(viaticos.requestedById, soloDe) : undefined,
        filtros?.estado ? eq(viaticos.status, filtros.estado) : undefined,
        filtros?.abiertos ? inArray(viaticos.status, [...ABIERTOS]) : undefined,
        filtros?.cerrados ? inArray(viaticos.status, [...CERRADOS]) : undefined,
      ),
    )
    // `id` de desempate: dos viáticos creados en el mismo instante —una carga,
    // una siembra— pueden intercambiarse entre páginas sin él.
    .orderBy(desc(viaticos.createdAt), desc(viaticos.id));

  return page ? q.limit(page.limit).offset(page.offset) : q;
}

/** Cuántos hay, para el paginador del archivo. Misma condición que la lista. */
export async function countViaticos(
  soloDe: string | null,
  filtros?: FiltrosViaticos,
  conexion?: DbOrTx,
): Promise<number> {
  const db = conexion ?? (await tenantDb());
  const [f] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(viaticos)
    .where(
      and(
        soloDe ? eq(viaticos.requestedById, soloDe) : undefined,
        filtros?.estado ? eq(viaticos.status, filtros.estado) : undefined,
        filtros?.abiertos ? inArray(viaticos.status, [...ABIERTOS]) : undefined,
        filtros?.cerrados ? inArray(viaticos.status, [...CERRADOS]) : undefined,
      ),
    );
  return f?.n ?? 0;
}

/** Cuántos hay en cada estado. Son las fichas de la cabecera del listado. */
export async function conteosViaticos(
  soloDe: string | null,
  conexion?: DbOrTx,
): Promise<Array<{ k: ViaticoEstado; n: number }>> {
  const db = conexion ?? (await tenantDb());
  const filas = await db
    .select({ k: viaticos.status, n: sql<number>`count(*)::int` })
    .from(viaticos)
    .where(soloDe ? eq(viaticos.requestedById, soloDe) : undefined)
    .groupBy(viaticos.status);
  return filas as Array<{ k: ViaticoEstado; n: number }>;
}

/**
 * Un viático entero.
 *
 * `soloDe` con el mismo contrato que el listado: devuelve `null` cuando el
 * viático es de otra persona y quien pregunta no puede ver los ajenos. Es lo
 * que impide que cambiar el uuid de la barra de direcciones abra el expediente
 * de un compañero — la misma protección que ya tiene `getTenantMember`.
 */
export async function getViatico(id: string, soloDe: string | null) {
  const db = await tenantDb();

  const [v] = await db
    .select({
      id: viaticos.id,
      reference: viaticos.reference,
      status: viaticos.status,
      contractId: viaticos.contractId,
      contractNumber: contracts.number,
      contractAmountMxn: contracts.amountMxn,
      requestedById: viaticos.requestedById,
      destination: viaticos.destination,
      purpose: viaticos.purpose,
      departsOn: viaticos.departsOn,
      returnsOn: viaticos.returnsOn,
      estimatedMxn: viaticos.estimatedMxn,
      submittedAt: viaticos.submittedAt,
      approvedById: viaticos.approvedById,
      approvedAt: viaticos.approvedAt,
      authorizedMxn: viaticos.authorizedMxn,
      approvalNote: viaticos.approvalNote,
      reportedAt: viaticos.reportedAt,
      closedById: viaticos.closedById,
      closedAt: viaticos.closedAt,
      closingNote: viaticos.closingNote,
      resolutionReason: viaticos.resolutionReason,
      createdAt: viaticos.createdAt,
    })
    .from(viaticos)
    .innerJoin(contracts, eq(contracts.id, viaticos.contractId))
    .where(
      and(
        eq(viaticos.id, id),
        soloDe ? eq(viaticos.requestedById, soloDe) : undefined,
      ),
    )
    .limit(1);

  if (!v) return null;

  const [gastos, modulos, gente] = await Promise.all([
    db
      .select({
        id: viaticoExpenses.id,
        category: viaticoExpenses.category,
        otherLabel: viaticoExpenses.otherLabel,
        description: viaticoExpenses.description,
        amountMxn: viaticoExpenses.amountMxn,
        spentOn: viaticoExpenses.spentOn,
        receiptPath: viaticoExpenses.receiptPath,
        ticketId: viaticoExpenses.ticketId,
        ticketReference: tickets.reference,
        ticketSubject: tickets.subject,
      })
      .from(viaticoExpenses)
      .innerJoin(tickets, eq(tickets.id, viaticoExpenses.ticketId))
      .where(eq(viaticoExpenses.viaticoId, id))
      .orderBy(asc(viaticoExpenses.spentOn)),
    db
      .select({
        id: equipmentModules.id,
        name: equipmentModules.name,
        brand: equipmentModules.brand,
        serialNumber: equipmentModules.serialNumber,
        equipmentName: equipment.name,
      })
      .from(viaticoModules)
      .innerJoin(equipmentModules, eq(equipmentModules.id, viaticoModules.moduleId))
      .innerJoin(equipment, eq(equipment.id, equipmentModules.equipmentId))
      .where(eq(viaticoModules.viaticoId, id)),
    nombresDe([v.requestedById, v.approvedById, v.closedById]),
  ]);

  return {
    ...v,
    gastos,
    modulos,
    solicitante: gente.get(v.requestedById) ?? null,
    autorizadoPor: v.approvedById ? (gente.get(v.approvedById) ?? null) : null,
    cerradoPor: v.closedById ? (gente.get(v.closedById) ?? null) : null,
  };
}

/** Nombres de un puñado de personas, en una sola consulta. */
async function nombresDe(ids: Array<string | null>): Promise<Map<string, string | null>> {
  const limpios = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (limpios.length === 0) return new Map();
  const { getDb } = await import("@/lib/db");
  const filas = await getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, limpios));
  return new Map(filas.map((f) => [f.id, f.name]));
}

/* ═══════════════ Lo que necesita el formulario ═══════════════ */

/**
 * Contratos para elegir a cuál se carga el viaje, CON EL DOMICILIO DEL CLIENTE.
 *
 * ── POR QUÉ VIAJA EL DOMICILIO ─────────────────────────────────────────────
 *
 * Porque el destino de un viático es, casi siempre, donde está el cliente. Que
 * el ingeniero lo teclee a mano es pedirle que copie un dato que el sistema ya
 * tiene, y cada copia a mano es una ciudad mal escrita que después no agrupa en
 * ningún informe.
 *
 * ── Y POR QUÉ EN TRES PIEZAS Y NO EN UNA ───────────────────────────────────
 *
 * Medido sobre los datos de hoy: de 54 contratos, 16 tienen municipio y estado
 * capturados, 17 más tienen el domicilio en TEXTO LIBRE sin desarmar, y el
 * resto no tiene nada. Una sola cadena obligaría a tratar los tres casos igual,
 * y el tercero se enseñaría como un hueco silencioso.
 *
 *   `sugerencia`  «Municipio, Estado» — solo cuando los dos están. Es lo único
 *                 que se puede meter en el campo Destino sin inventar nada.
 *   `completo`    la dirección legible, para que quien viaja sepa a dónde va.
 *   `crudo`       el domicilio sin desarmar, cuando es lo único que hay.
 *
 * El texto libre NO se parte aquí para sacarle el municipio. Ese trabajo lo
 * hace `scripts/domicilios.ts`, que deja incidencia de lo que no entiende;
 * repetirlo en una pantalla —con formatos de 2, 5, 6 y 8 comas conviviendo—
 * sería adivinar, y adivinar el destino de un viaje es justo lo que no puede
 * hacer un formulario de gastos.
 */
export async function contratosParaViatico() {
  const db = await tenantDb();
  const filas = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      cliente: users.name,
      endDate: contracts.endDate,
      street: crmOrganizations.street,
      extNumber: crmOrganizations.extNumber,
      neighborhood: crmOrganizations.neighborhood,
      municipality: crmOrganizations.municipality,
      state: crmOrganizations.state,
      postalCode: crmOrganizations.postalCode,
      addressReference: crmOrganizations.addressReference,
      address: crmOrganizations.address,
    })
    .from(contracts)
    .leftJoin(users, eq(users.id, contracts.clientId))
    // El domicilio vive en la ORGANIZACIÓN, que se ata al contrato por la
    // cuenta del cliente. `left` porque un contrato puede no tener ficha de
    // empresa todavía, y entonces se elige igual: sin sugerencia.
    .leftJoin(crmOrganizations, eq(crmOrganizations.clientId, contracts.clientId))
    .orderBy(desc(contracts.createdAt));

  const limpio = (v: string | null) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : null;
  };

  return filas.map((f) => {
    const municipio = limpio(f.municipality);
    const estado = limpio(f.state);
    const partes = [
      [limpio(f.street), limpio(f.extNumber)].filter(Boolean).join(" ") || null,
      limpio(f.neighborhood),
      limpio(f.postalCode) ? `C.P. ${limpio(f.postalCode)}` : null,
      municipio,
      estado,
    ].filter(Boolean);

    return {
      id: f.id,
      number: f.number,
      cliente: f.cliente,
      endDate: f.endDate,
      domicilio: {
        // Solo con los DOS. «Monterrey» sin estado no distingue entre el de
        // Nuevo León y cualquier homónimo, y un destino ambiguo en un viático
        // acaba siendo un vuelo a la ciudad equivocada.
        sugerencia: municipio && estado ? `${municipio}, ${estado}` : null,
        completo: partes.length > 0 ? partes.join(" · ") : null,
        crudo: partes.length === 0 ? limpio(f.address) : null,
        seña: limpio(f.addressReference),
      },
    };
  });
}

export type ModuloDelContrato = {
  id: string;
  name: string;
  brand: string;
  serialNumber: string | null;
  equipmentId: string;
  equipmentName: string;
};

/**
 * Los módulos de VARIOS contratos, en UNA consulta.
 *
 * ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * El formulario de «pedir viáticos» necesita los módulos de todos los contratos
 * a la vez, para poder llenar el segundo campo sin ir a la red cada vez que se
 * cambia el primero. Se resolvía llamando a `modulosDelContrato` una vez por
 * contrato dentro de un `Promise.all`, y eso son 55 consultas para pintar una
 * pantalla — una por contrato más la de contratos.
 *
 * Medido contra los datos de hoy: 55 consultas y 29,6 ms contra 2 consultas y
 * 6,5 ms. Cuatro veces y medio, y la distancia se abre con cada contrato nuevo
 * porque el costo crece UNA CONSULTA POR CONTRATO, no con el tamaño del
 * resultado. Con doscientos contratos serían doscientas una.
 *
 * El comentario que lo justificaba decía que era «a conciencia» y que se
 * cambiaría «si algún día esto crece». Estaba mal en las dos mitades: ya había
 * crecido, y el arreglo cuesta veinte líneas.
 */
export async function modulosPorContrato(
  contractIds: string[],
  conexion?: DbOrTx,
): Promise<Map<string, ModuloDelContrato[]>> {
  const agrupado = new Map<string, ModuloDelContrato[]>();
  if (contractIds.length === 0) return agrupado;

  const db = conexion ?? (await tenantDb());
  const filas = await db
    .select({
      contractId: contractEquipment.contractId,
      id: equipmentModules.id,
      name: equipmentModules.name,
      brand: equipmentModules.brand,
      serialNumber: equipmentModules.serialNumber,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
    })
    .from(contractEquipment)
    .innerJoin(equipment, eq(equipment.id, contractEquipment.equipmentId))
    .innerJoin(equipmentModules, eq(equipmentModules.equipmentId, equipment.id))
    .where(inArray(contractEquipment.contractId, contractIds))
    /*
      `id` DE DESEMPATE, y no es cosmético.

      Hay contratos con seis módulos que comparten equipo Y nombre —«SMH» del
      mismo parque WATERS, seis veces—. Sin un tercer criterio, Postgres puede
      devolverlos en cualquier orden, así que la lista de casillas se baraja
      entre una carga y la siguiente: se marca el tercer «SMH», se recarga, y el
      marcado es otro. Lo detectó el probe de rendimiento al comparar las dos
      formas de la consulta, que daban los mismos módulos en distinto orden.

      Es la misma lección que ya llevan los listados paginados de tickets,
      equipos y contratos.
    */
    .orderBy(asc(equipment.name), asc(equipmentModules.name), asc(equipmentModules.id));

  for (const f of filas) {
    const { contractId, ...modulo } = f;
    const lista = agrupado.get(contractId);
    if (lista) lista.push(modulo);
    else agrupado.set(contractId, [modulo]);
  }
  return agrupado;
}

/**
 * Los módulos amparados por UN contrato.
 *
 * Es lo que hace que elegir contrato acote la lista: contrato → equipos →
 * módulos. Sin este recorrido, el desplegable ofrecería los módulos de toda la
 * empresa y el ingeniero podría declarar que va a atender un equipo que ese
 * contrato no cubre.
 *
 * Para varios contratos NO se llama en un bucle: está `modulosPorContrato`, que
 * los trae todos de una vez. Ver la nota de ahí.
 */
export async function modulosDelContrato(contractId: string) {
  const db = await tenantDb();
  return db
    .select({
      id: equipmentModules.id,
      name: equipmentModules.name,
      brand: equipmentModules.brand,
      serialNumber: equipmentModules.serialNumber,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
    })
    .from(contractEquipment)
    .innerJoin(equipment, eq(equipment.id, contractEquipment.equipmentId))
    .innerJoin(equipmentModules, eq(equipmentModules.equipmentId, equipment.id))
    .where(eq(contractEquipment.contractId, contractId))
    // Mismo desempate que en `modulosPorContrato`: las dos tienen que dar el
    // mismo orden o el formulario enseñaría una cosa y la ficha otra.
    .orderBy(asc(equipment.name), asc(equipmentModules.name), asc(equipmentModules.id));
}

/**
 * Los tickets a los que se le puede cargar un gasto de este viático.
 *
 * Acotados a los equipos del contrato, por lo mismo que los módulos: un gasto
 * cargado a un ticket de otro contrato ensuciaría la utilidad de los dos —le
 * sumaría costo a uno y se lo quitaría al que de verdad lo generó—, y ese es
 * justo el error que este módulo existe para no cometer.
 */
export async function ticketsDelContrato(contractId: string) {
  const db = await tenantDb();
  return db
    .selectDistinct({
      id: tickets.id,
      reference: tickets.reference,
      subject: tickets.subject,
      status: tickets.status,
      createdAt: tickets.createdAt,
    })
    .from(contractEquipment)
    .innerJoin(tickets, eq(tickets.equipmentId, contractEquipment.equipmentId))
    .where(eq(contractEquipment.contractId, contractId))
    .orderBy(desc(tickets.createdAt));
}

/* ═══════════════ Lo que lee la utilidad ═══════════════ */

/**
 * COSTO DE VIAJE POR TICKET, y solo el de los viáticos CERRADOS.
 *
 * ── POR QUÉ SOLO LOS CERRADOS ──────────────────────────────────────────────
 *
 * Un anticipo autorizado todavía no es un costo: es dinero entregado que puede
 * volver si el viaje se cancela o si sobra. Y una comprobación en revisión
 * puede perder renglones cuando quien revisa la devuelva. Contar cualquiera de
 * las dos inflaría el costo de todo contrato con un viaje en curso, y —peor—
 * haría que la utilidad de un contrato cambiara sola, sin que nadie tocara nada,
 * el día que se devolviera una comprobación.
 *
 * Con el visto bueno el importe ya no se mueve. Es la misma disciplina que
 * `insights.ts`: solo se lee lo que está en producción.
 */
export async function viaticosPorTicket(
  ticketIds: string[],
  conexion?: DbOrTx,
): Promise<Map<string, number>> {
  if (ticketIds.length === 0) return new Map();
  const db = conexion ?? (await tenantDb());
  const filas = await db
    .select({
      ticketId: viaticoExpenses.ticketId,
      total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
    })
    .from(viaticoExpenses)
    .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
    .where(
      and(
        inArray(viaticoExpenses.ticketId, ticketIds),
        eq(viaticos.status, "cerrado"),
      ),
    )
    .groupBy(viaticoExpenses.ticketId);
  return new Map(filas.map((f) => [f.ticketId, Number(f.total)]));
}

/**
 * Costo de viaje de un contrato, con su desglose por categoría.
 *
 * Se pregunta por contrato y no sumando los tickets porque son dos preguntas
 * distintas: esto incluye TODOS los gastos del viático, y la suma por ticket
 * solo cubriría los que se cargaron a un ticket que además siga existiendo.
 * Hoy dan lo mismo —el ticket es obligatorio en cada gasto— y conviene que la
 * cifra del contrato no dependa de que eso siga siendo cierto.
 */
export async function viaticosDelContrato(contractId: string, conexion?: DbOrTx) {
  const db = conexion ?? (await tenantDb());
  const [[total], porCategoria] = await Promise.all([
    db
      .select({
        n: sql<number>`count(distinct ${viaticos.id})::int`,
        total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
      })
      .from(viaticoExpenses)
      .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
      .where(and(eq(viaticos.contractId, contractId), eq(viaticos.status, "cerrado"))),
    db
      .select({
        k: viaticoExpenses.category,
        total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
      })
      .from(viaticoExpenses)
      .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
      .where(and(eq(viaticos.contractId, contractId), eq(viaticos.status, "cerrado")))
      .groupBy(viaticoExpenses.category)
      .orderBy(desc(sql`sum(${viaticoExpenses.amountMxn})`)),
  ]);

  return {
    viajes: total?.n ?? 0,
    costo: Number(total?.total ?? 0),
    porCategoria: porCategoria.map((c) => ({ k: c.k, total: Number(c.total) })),
  };
}
