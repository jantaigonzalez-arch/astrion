import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import {
  contractEquipment,
  contracts,
  crmDeals,
  crmOrganizations,
  viaticoRubros,
  viaticoDestinos,
  equipment,
  equipmentModules,
  tickets,
  viaticoExpenses,
  viaticoModules,
  viaticos,
} from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { alias } from "drizzle-orm/pg-core";
import type { ViaticoEstado } from "@/lib/viaticos";

/** Cómo viaja un destino a la interfaz. Ver la 0037. */
export type TipoDestino = "contrato" | "visita" | "prospecto";
export type DestinoResumen = { tipo: TipoDestino; nombre: string };

/**
 * `users` otra vez, con otro nombre.
 *
 * Un viático nombra a dos personas —quien pide y quien firma— y las dos salen
 * de la misma tabla. Sin alias, el segundo `join` chocaría con el primero y
 * Postgres devolvería el nombre de quien pidió en las dos columnas: un fallo
 * que no rompe nada y que en pantalla se lee como que todo el mundo se autoriza
 * sus propios viajes.
 */
const aprobador = alias(users, "aprobador");

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
  /**
   * A DÓNDE VA, en orden: el número de cada contrato y el nombre de cada
   * empresa. Uno o varios desde la 0037; nunca vacío, porque el alta lo exige.
   */
  destinos: DestinoResumen[];
  solicitante: string | null;
  /** Para saber si le toca mover a quien mira. Ver la lista. */
  solicitanteId: string;
  /** A quién le toca firmar. Nulo en los anteriores a la 0028. */
  aprobadorId: string | null;
  aprobador: string | null;
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
      destinos: RESUMEN_DE_DESTINOS,
      solicitante: users.name,
      solicitanteId: viaticos.requestedById,
      aprobadorId: viaticos.approverId,
      aprobador: aprobador.name,
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
    // El aprobador va `left` porque las filas anteriores a la 0028 no tienen.
    .leftJoin(users, eq(users.id, viaticos.requestedById))
    .leftJoin(aprobador, eq(aprobador.id, viaticos.approverId))
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

/**
 * LOS DESTINOS DE CADA VIÁTICO, en una sola columna JSON.
 *
 * Subconsulta correlacionada y no `join`: con el join, un viaje de tres
 * destinos saldría tres veces en el listado —y el importe gastado, que también
 * es una subconsulta, se leería bien pero la fila no—. `json_agg` los devuelve
 * ya en orden de visita, y el contrato por su número y la empresa por su nombre
 * en el mismo campo, que es lo único que el listado enseña.
 */
const RESUMEN_DE_DESTINOS = sql<DestinoResumen[]>`(
  select coalesce(
    json_agg(
      json_build_object('tipo', d.tipo, 'nombre', coalesce(c.number, o.name, '—'))
      order by d.position, d.created_at
    ),
    '[]'::json
  )
    from ${viaticoDestinos} d
    left join ${contracts} c on c.id = d.contract_id
    left join ${crmOrganizations} o on o.id = d.organization_id
   where d.viatico_id = ${viaticos.id}
)`;

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
      requestedById: viaticos.requestedById,
      approverId: viaticos.approverId,
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
    .where(
      and(
        eq(viaticos.id, id),
        soloDe ? eq(viaticos.requestedById, soloDe) : undefined,
      ),
    )
    .limit(1);

  if (!v) return null;

  const [destinos, gastos, modulos, gente] = await Promise.all([
    db
      .select({
        id: viaticoDestinos.id,
        tipo: viaticoDestinos.tipo,
        contractId: viaticoDestinos.contractId,
        contractNumber: contracts.number,
        contractAmountMxn: contracts.amountMxn,
        organizationId: viaticoDestinos.organizationId,
        organizacion: crmOrganizations.name,
        dealId: viaticoDestinos.dealId,
        negocio: crmDeals.title,
      })
      .from(viaticoDestinos)
      // `left` los tres: cada destino usa solo una de las llaves.
      .leftJoin(contracts, eq(contracts.id, viaticoDestinos.contractId))
      .leftJoin(crmOrganizations, eq(crmOrganizations.id, viaticoDestinos.organizationId))
      .leftJoin(crmDeals, eq(crmDeals.id, viaticoDestinos.dealId))
      .where(eq(viaticoDestinos.viaticoId, id))
      .orderBy(asc(viaticoDestinos.position), asc(viaticoDestinos.createdAt)),
    db
      .select({
        id: viaticoExpenses.id,
        /** A qué destino del viaje va. Nulo = gasto general. Ver la 0037. */
        destinoId: viaticoExpenses.destinoId,
        rubroId: viaticoExpenses.rubroId,
        rubro: viaticoRubros.name,
        rubroPresupuesto: viaticoRubros.dailyBudgetMxn,
        note: viaticoExpenses.note,
        description: viaticoExpenses.description,
        amountMxn: viaticoExpenses.amountMxn,
        spentOn: viaticoExpenses.spentOn,
        receiptPath: viaticoExpenses.receiptPath,
        ticketId: viaticoExpenses.ticketId,
        ticketReference: tickets.reference,
        ticketSubject: tickets.subject,
        dealId: viaticoExpenses.dealId,
        dealTitle: crmDeals.title,
        reclassifiedById: viaticoExpenses.reclassifiedById,
        reclassifiedAt: viaticoExpenses.reclassifiedAt,
      })
      .from(viaticoExpenses)
      /*
        AQUÍ ESTABA EL `inner` MÁS CARO DE LOS TRES.

        Un gasto comercial no tiene ticket, así que con el join interior no
        aparecía en la pantalla —pero SÍ en la suma del cuadre, que se calcula
        aparte—. El resultado habría sido una comprobación cuyos renglones no
        suman el total que la propia pantalla muestra al lado, y ese es
        exactamente el tipo de descuadre que nadie sabe explicar después.
      */
      .leftJoin(tickets, eq(tickets.id, viaticoExpenses.ticketId))
      .leftJoin(crmDeals, eq(crmDeals.id, viaticoExpenses.dealId))
      // `inner` y no `left`: el rubro es obligatorio desde la 0029 y un gasto
      // sin él no puede existir. Con `left` se escondería una fila corrupta en
      // vez de que la pantalla la delatara.
      .innerJoin(viaticoRubros, eq(viaticoRubros.id, viaticoExpenses.rubroId))
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
    nombresDe([v.requestedById, v.approvedById, v.closedById, v.approverId]),
  ]);

  return {
    ...v,
    destinos,
    gastos,
    modulos,
    solicitante: gente.get(v.requestedById) ?? null,
    autorizadoPor: v.approvedById ? (gente.get(v.approvedById) ?? null) : null,
    cerradoPor: v.closedById ? (gente.get(v.closedById) ?? null) : null,
    /** A quién le toca firmar HOY, que no es lo mismo que quién firmó. */
    aprobador: v.approverId ? (gente.get(v.approverId) ?? null) : null,
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

/* ═══════════════ Los rubros y su presupuesto ═══════════════ */

export type RubroFila = {
  id: string;
  key: string;
  name: string;
  dailyBudgetMxn: number | null;
  requiresNote: boolean;
  /** ¿Su tope se hace cumplir, o solo se marca? Ver la 0031. */
  blocksOverBudget: boolean;
  active: boolean;
  position: number;
  /** Cuántos gastos lo usan. Es lo que decide si se puede borrar. */
  usos: number;
};

/**
 * El catálogo de rubros.
 *
 * `soloActivos` para el formulario de captura —donde ofrecer un rubro retirado
 * sería invitar a seguir usándolo— y la lista completa para la pantalla que lo
 * administra, que necesita ver lo desactivado justamente para reactivarlo.
 *
 * `usos` viaja siempre y no solo cuando se administra: es lo que permite que la
 * pantalla diga «no se puede borrar, tiene 14 gastos» ANTES de que alguien
 * pulse y se lleve un error de llave foránea, que no explica nada.
 */
export async function listRubros(
  soloActivos = false,
  conexion?: DbOrTx,
): Promise<RubroFila[]> {
  const db = conexion ?? (await tenantDb());
  const filas = await db
    .select({
      id: viaticoRubros.id,
      key: viaticoRubros.key,
      name: viaticoRubros.name,
      dailyBudgetMxn: viaticoRubros.dailyBudgetMxn,
      requiresNote: viaticoRubros.requiresNote,
      blocksOverBudget: viaticoRubros.blocksOverBudget,
      active: viaticoRubros.active,
      position: viaticoRubros.position,
      // Subconsulta correlacionada y no `left join` + `count`: con el join, un
      // rubro con gastos se repetiría una vez por gasto. Mismo arreglo que en
      // el listado de viáticos.
      usos: sql<number>`(
        select count(*)::int from ${viaticoExpenses} g
         where g.rubro_id = ${viaticoRubros.id}
      )`,
    })
    .from(viaticoRubros)
    .where(soloActivos ? eq(viaticoRubros.active, true) : undefined)
    .orderBy(asc(viaticoRubros.position), asc(viaticoRubros.name));

  return filas.map((f) => ({
    ...f,
    // El importe llega como cadena de `numeric`. Se convierte aquí, una vez, y
    // no en cada pantalla que lo pinte: es la misma razón por la que el cuadre
    // vive en `lib/viaticos.ts`.
    dailyBudgetMxn: f.dailyBudgetMxn == null ? null : Number(f.dailyBudgetMxn),
  }));
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

  return filas.map((f) => ({
    id: f.id,
    number: f.number,
    cliente: f.cliente,
    endDate: f.endDate,
    domicilio: armarDomicilio(f),
  }));
}

/**
 * PROSPECTOS PARA ELEGIR A CUÁL SE VIAJA, con el mismo domicilio que arriba.
 *
 * Se apoya en `ES_CLIENTE`, la misma regla que reparte las dos pantallas de
 * Ventas y Clientes, negada. Que sea la misma expresión y no una copia es lo que
 * garantiza que ninguna empresa quede fuera de las dos listas ni salga en las
 * dos: el día que cambie qué cuenta como cliente, cambia aquí también.
 *
 * El domicilio se arma exactamente igual que en `contratosParaViatico`, y por la
 * misma razón —que nadie teclee a mano una ciudad que el sistema ya tiene—. Se
 * comparte el armador en vez de repetirlo: dos copias de esta lógica darían dos
 * formatos de destino y ningún informe los agruparía.
 */
export async function prospectosParaViatico() {
  const db = await tenantDb();
  const { ES_CLIENTE } = await import("@/lib/data/crm");
  const filas = await db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      street: crmOrganizations.street,
      extNumber: crmOrganizations.extNumber,
      neighborhood: crmOrganizations.neighborhood,
      municipality: crmOrganizations.municipality,
      state: crmOrganizations.state,
      postalCode: crmOrganizations.postalCode,
      addressReference: crmOrganizations.addressReference,
      address: crmOrganizations.address,
    })
    .from(crmOrganizations)
    .where(sql`not ${ES_CLIENTE}`)
    .orderBy(asc(crmOrganizations.name));

  return filas.map((f) => ({
    id: f.id,
    name: f.name,
    domicilio: armarDomicilio(f),
  }));
}

/**
 * CLIENTES QUE SE PUEDEN VISITAR: los que ya compraron y NO tienen contrato
 * vigente (0037).
 *
 * `ES_CLIENTE` y no `TIENE_CONTRATO_VIGENTE`, las dos expresiones con las que el
 * dominio valida el destino (`vetoClasificacion`): si la lista y la validación
 * se escribieran por separado, el formulario ofrecería clientes que el servidor
 * después rechaza. Al que sí tiene contrato vigente se le viaja por su
 * contrato, que es donde su gasto se mide.
 */
export async function visitasParaViatico() {
  const db = await tenantDb();
  const { ES_CLIENTE, TIENE_CONTRATO_VIGENTE } = await import("@/lib/data/crm");
  const filas = await db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      street: crmOrganizations.street,
      extNumber: crmOrganizations.extNumber,
      neighborhood: crmOrganizations.neighborhood,
      municipality: crmOrganizations.municipality,
      state: crmOrganizations.state,
      postalCode: crmOrganizations.postalCode,
      addressReference: crmOrganizations.addressReference,
      address: crmOrganizations.address,
    })
    .from(crmOrganizations)
    .where(and(ES_CLIENTE, sql`not ${TIENE_CONTRATO_VIGENTE}`))
    .orderBy(asc(crmOrganizations.name));

  return filas.map((f) => ({
    id: f.id,
    name: f.name,
    domicilio: armarDomicilio(f),
  }));
}

/**
 * Los negocios abiertos de un prospecto, para colgarle el viaje a uno.
 *
 * Solo los ABIERTOS: cargarle el costo de un viaje a una oportunidad que ya se
 * ganó o se perdió cambia un número que alguien ya informó. Si de verdad el
 * viaje fue por una oportunidad cerrada, va como gasto comercial, que es lo que
 * de hecho fue.
 */
export async function negociosDelProspecto(organizationId: string) {
  const db = await tenantDb();
  return db
    .select({
      id: crmDeals.id,
      reference: crmDeals.reference,
      title: crmDeals.title,
    })
    .from(crmDeals)
    .where(
      and(eq(crmDeals.organizationId, organizationId), eq(crmDeals.status, "open")),
    )
    .orderBy(desc(crmDeals.createdAt));
}

/**
 * Los negocios abiertos de VARIOS prospectos, en UNA consulta.
 *
 * Misma razón y misma forma que `modulosPorContrato`: el formulario los quiere
 * cargados para llenar el selector sin ir a la red al cambiar de prospecto.
 * Pedirlos uno por uno serían tantas consultas como prospectos tenga la empresa
 * —ciento sesenta y uno hoy— para pintar una pantalla que se usa una vez.
 */
export async function negociosPorProspecto(
  organizationIds: string[],
): Promise<Map<string, Array<{ id: string; reference: string; title: string }>>> {
  if (organizationIds.length === 0) return new Map();
  const db = await tenantDb();
  const filas = await db
    .select({
      organizationId: crmDeals.organizationId,
      id: crmDeals.id,
      reference: crmDeals.reference,
      title: crmDeals.title,
    })
    .from(crmDeals)
    .where(
      and(
        inArray(crmDeals.organizationId, organizationIds),
        eq(crmDeals.status, "open"),
      ),
    )
    .orderBy(desc(crmDeals.createdAt));

  const out = new Map<string, Array<{ id: string; reference: string; title: string }>>();
  for (const f of filas) {
    if (!f.organizationId) continue;
    const lista = out.get(f.organizationId) ?? [];
    lista.push({ id: f.id, reference: f.reference, title: f.title });
    out.set(f.organizationId, lista);
  }
  return out;
}

/**
 * El domicilio en las tres piezas que usa el formulario.
 *
 * Sale de `contratosParaViatico`, donde estaba escrito a mano, en cuanto los
 * prospectos necesitaron lo mismo. Ver allí por qué son tres y no una.
 */
function armarDomicilio(f: {
  street: string | null;
  extNumber: string | null;
  neighborhood: string | null;
  municipality: string | null;
  state: string | null;
  postalCode: string | null;
  addressReference: string | null;
  address: string | null;
}) {
  const limpio = (v: string | null) => {
    const t = (v ?? "").trim();
    return t.length > 0 ? t : null;
  };
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
    // Solo con los DOS. «Monterrey» sin estado no distingue entre el de Nuevo
    // León y cualquier homónimo, y un destino ambiguo en un viático acaba
    // siendo un vuelo a la ciudad equivocada.
    sugerencia: municipio && estado ? `${municipio}, ${estado}` : null,
    completo: partes.length > 0 ? partes.join(" · ") : null,
    crudo: partes.length === 0 ? limpio(f.address) : null,
    seña: limpio(f.addressReference),
  };
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
  // El `inArray` de arriba ya deja fuera los gastos sin ticket —los comerciales,
  // desde la 0028—, así que aquí no queda ninguno nulo. El filtro está para
  // decírselo al compilador, que solo ve una columna nulable.
  return new Map(
    filas
      .filter((f): f is typeof f & { ticketId: string } => f.ticketId !== null)
      .map((f) => [f.ticketId, Number(f.total)]),
  );
}

/**
 * COSTO DE VIAJE DE UN NEGOCIO: lo que llevamos gastado en cerrarlo.
 *
 * Suma los gastos que quien firmó cargó a esa oportunidad, y solo de viáticos
 * cerrados —misma disciplina que `viaticosPorTicket`, y por la misma razón: un
 * anticipo todavía no es un costo—.
 *
 * Se pregunta por el GASTO y no por el viático: un viaje de prospección puede
 * cargarle una comida a la oportunidad y dejar el hotel como gasto comercial, y
 * lo que la ficha del negocio tiene que enseñar es lo primero. Sumar el viático
 * entero le cargaría al negocio el viaje completo, que es justo la mentira que
 * el reparto por renglón vino a evitar.
 */
export async function viaticosPorNegocio(
  dealIds: string[],
  conexion?: DbOrTx,
): Promise<Map<string, number>> {
  if (dealIds.length === 0) return new Map();
  const db = conexion ?? (await tenantDb());
  const filas = await db
    .select({
      dealId: viaticoExpenses.dealId,
      total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
    })
    .from(viaticoExpenses)
    .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
    .where(and(inArray(viaticoExpenses.dealId, dealIds), eq(viaticos.status, "cerrado")))
    .groupBy(viaticoExpenses.dealId);
  return new Map(
    filas
      .filter((f): f is typeof f & { dealId: string } => f.dealId !== null)
      .map((f) => [f.dealId, Number(f.total)]),
  );
}

/**
 * Costo de viaje de una EMPRESA —prospecto o cliente visitado—: todo lo que se
 * gastó yendo a verla.
 *
 * A diferencia del negocio, aquí entra también lo que no se apuntó a ninguna
 * oportunidad, porque la pregunta es otra: cuánto llevamos invertido en esta
 * empresa. Desde la 0037 se suma POR DESTINO y no por viaje: de una gira a tres
 * empresas, a ésta le toca lo que se le cargó a ella, no el viaje entero; el
 * gasto general de la gira no es de ninguna. Los viajes de un solo destino dan
 * lo mismo que antes, porque la 0037 pasó todos sus gastos a ese destino.
 */
export async function viaticosDelProspecto(
  organizationId: string,
  conexion?: DbOrTx,
) {
  const db = conexion ?? (await tenantDb());
  const [[total], porCategoria] = await Promise.all([
    db
      .select({
        n: sql<number>`count(distinct ${viaticos.id})::int`,
        total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
      })
      .from(viaticoExpenses)
      .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
      .innerJoin(viaticoDestinos, eq(viaticoDestinos.id, viaticoExpenses.destinoId))
      .where(
        and(
          eq(viaticoDestinos.organizationId, organizationId),
          eq(viaticos.status, "cerrado"),
        ),
      ),
    db
      .select({
        k: viaticoRubros.name,
        total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
      })
      .from(viaticoExpenses)
      .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
      .innerJoin(viaticoDestinos, eq(viaticoDestinos.id, viaticoExpenses.destinoId))
      .innerJoin(viaticoRubros, eq(viaticoRubros.id, viaticoExpenses.rubroId))
      .where(
        and(
          eq(viaticoDestinos.organizationId, organizationId),
          eq(viaticos.status, "cerrado"),
        ),
      )
      .groupBy(viaticoRubros.name)
      .orderBy(desc(sql`sum(${viaticoExpenses.amountMxn})`)),
  ]);

  return {
    viajes: total?.n ?? 0,
    costo: Number(total?.total ?? 0),
    porCategoria: porCategoria.map((c) => ({ k: c.k, total: Number(c.total) })),
  };
}

/**
 * Costo de viaje de un contrato, con su desglose por categoría.
 *
 * Se pregunta por contrato y no sumando los tickets porque son dos preguntas
 * distintas: esto incluye TODOS los gastos del viático, y la suma por ticket
 * solo cubriría los que se cargaron a un ticket que además siga existiendo.
 *
 * Desde la 0037 se suma lo cargado AL DESTINO de este contrato, no el viaje
 * entero: una gira que pasó por dos contratos le carga a cada uno lo suyo, y el
 * gasto general del viaje no entra en ninguno —repartirlo sería inventar un
 * costo—. Un destino de contrato sigue exigiendo ticket en cada gasto (lo hace
 * cumplir `resolverDestino()`), así que para los viajes de un solo contrato la
 * cifra es la misma de antes.
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
      .innerJoin(viaticoDestinos, eq(viaticoDestinos.id, viaticoExpenses.destinoId))
      .where(and(eq(viaticoDestinos.contractId, contractId), eq(viaticos.status, "cerrado"))),
    db
      .select({
        k: viaticoRubros.name,
        total: sql<number>`coalesce(sum(${viaticoExpenses.amountMxn}), 0)::float8`,
      })
      .from(viaticoExpenses)
      .innerJoin(viaticos, eq(viaticos.id, viaticoExpenses.viaticoId))
      .innerJoin(viaticoDestinos, eq(viaticoDestinos.id, viaticoExpenses.destinoId))
      .innerJoin(viaticoRubros, eq(viaticoRubros.id, viaticoExpenses.rubroId))
      .where(and(eq(viaticoDestinos.contractId, contractId), eq(viaticos.status, "cerrado")))
      .groupBy(viaticoRubros.name)
      .orderBy(desc(sql`sum(${viaticoExpenses.amountMxn})`)),
  ]);

  return {
    viajes: total?.n ?? 0,
    costo: Number(total?.total ?? 0),
    porCategoria: porCategoria.map((c) => ({ k: c.k, total: Number(c.total) })),
  };
}

/**
 * A QUÉ SE PUEDE CARGAR UN GASTO DE ESTE VIAJE, como opciones de un selector.
 *
 * Una sola lista para capturar y para reclasificar, y por destino (0037):
 *
 *   ticket:<id>    un ticket de un contrato del viaje
 *   negocio:<id>   un negocio abierto de una visita o un prospecto del viaje
 *   destino:<id>   la visita o el prospecto a secas, sin negocio
 *   general        el gasto general del viaje —solo con varios destinos—
 *
 * El valor lleva el tipo delante porque es lo único que la acción necesita para
 * saber qué es; el dominio vuelve a comprobar que cada cosa sea de este viaje
 * (`resolverDestino`), así que la lista es una comodidad y no la regla.
 *
 * Con un solo destino no se ofrece «general»: el general ES de ese destino, y
 * ofrecer las dos sería ofrecer dos maneras de decir lo mismo.
 */
export async function opcionesDeGasto(
  destinos: Array<{
    id: string;
    tipo: TipoDestino;
    contractId: string | null;
    contractNumber: string | null;
    organizationId: string | null;
    organizacion: string | null;
  }>,
): Promise<Array<{ value: string; label: string; detalle?: string }>> {
  const deEmpresa = destinos.filter((d) => d.tipo !== "contrato" && d.organizationId);
  const [ticketsPorContrato, negocios] = await Promise.all([
    Promise.all(
      destinos
        .filter((d) => d.tipo === "contrato" && d.contractId)
        .map(async (d) => ({ d, tickets: await ticketsDelContrato(d.contractId!) })),
    ),
    negociosPorProspecto(deEmpresa.map((d) => d.organizationId!)),
  ]);

  const opciones: Array<{ value: string; label: string; detalle?: string }> = [];
  for (const { d, tickets: ts } of ticketsPorContrato) {
    for (const t of ts) {
      opciones.push({
        value: `ticket:${t.id}`,
        label: t.reference,
        detalle: `Contrato ${d.contractNumber ?? "—"} · ${t.subject}`,
      });
    }
  }
  for (const d of deEmpresa) {
    const tipo = d.tipo === "visita" ? "Visita" : "Prospecto";
    opciones.push({
      value: `destino:${d.id}`,
      label: d.organizacion ?? "—",
      detalle: `${tipo} · sin negocio concreto`,
    });
    for (const n of negocios.get(d.organizationId!) ?? []) {
      opciones.push({
        value: `negocio:${n.id}`,
        label: n.title,
        detalle: `${d.organizacion ?? "—"} · ${n.reference}`,
      });
    }
  }
  if (destinos.length > 1) {
    opciones.push({
      value: "general",
      label: "Gasto general del viaje",
      detalle: "Sirvió para todo el viaje: no se carga a ningún destino",
    });
  }
  return opciones;
}
