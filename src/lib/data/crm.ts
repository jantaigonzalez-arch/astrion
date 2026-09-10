import "server-only";
import { ordenarPor } from "@/lib/data/orden";
import type { Orden } from "@/lib/listado";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import {
  clienteFiscal,
  clienteValidacionSat,
  contracts,
  crmActivities,
  crmContacts,
  crmDeals,
  crmOrganizations,
  crmPipelines,
  crmStages,
  equipment,
  tickets,
} from "@/lib/db/schema";
import { listTenantMembers } from "@/lib/data/people";
import { VALOR_MXN } from "@/lib/data/crm-insights";
import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES, type OrgKind } from "@/lib/crm";
import { cache } from "react";
import type { DbOrTx } from "@/lib/db";

/**
 * Garantiza que exista un embudo con etapas. Es idempotente: la primera vez
 * que alguien entra al tablero crea "Ventas Evoelution" con las etapas base,
 * después no hace nada. Evita depender de un seed manual.
 *
 * ── MEMOIZADA POR PETICIÓN ────────────────────────────────────────────────
 *
 * Porque «después no hace nada» costaba una consulta cada vez. Medido en el
 * tablero: `crm_pipelines` se leía CINCO veces para pintar una sola pantalla
 * —esta comprobación, `getPipelines()`, y las tres lecturas del tablero, las
 * estadísticas y los cerrados—. Con `cache()` la primera paga y las otras cuatro
 * reusan, dentro de la misma petición y solo dentro de ella.
 *
 * Que escriba la primera vez no lo impide: es idempotente, y dentro de una
 * petición se quiere exactamente una ejecución. Es el mismo recurso que ya usa
 * `dashboardStates` para la barra lateral, y por el mismo motivo.
 */
export const ensureDefaultPipeline = cache(async () => {
  const db = await tenantDb();
  const [existing] = await db
    .select({ id: crmPipelines.id })
    .from(crmPipelines)
    .orderBy(asc(crmPipelines.order))
    .limit(1);
  if (existing) return existing.id;

  const [pipeline] = await db
    .insert(crmPipelines)
    .values({ name: DEFAULT_PIPELINE_NAME, order: 0 })
    .returning({ id: crmPipelines.id });

  await db.insert(crmStages).values(
    DEFAULT_STAGES.map((s, i) => ({
      pipelineId: pipeline.id,
      name: s.name,
      probability: s.probability,
      order: i,
    })),
  );
  return pipeline.id;
});

/**
 * Los embudos con sus etapas. Memoizada por petición, como la de arriba: cuatro
 * pantallas la llaman y varias de ellas más de una vez.
 *
 * `cache()` distingue por argumentos, así que pasar una conexión explícita
 * —desde un script o una transacción— NO reusa la lectura de la petición: son
 * llaves distintas, que es justo lo correcto cuando la conexión es otra.
 */
export const getPipelines = cache(async (conexion?: DbOrTx) => {
  const db = conexion ?? (await tenantDb());
  return db.query.crmPipelines.findMany({
    where: eq(crmPipelines.active, true),
    orderBy: [asc(crmPipelines.order)],
    with: { stages: { orderBy: [asc(crmStages.order)] } },
  });
});

export async function getStages(pipelineId: string) {
  const db = await tenantDb();
  return db.query.crmStages.findMany({
    where: eq(crmStages.pipelineId, pipelineId),
    orderBy: [asc(crmStages.order)],
  });
}

/**
 * Tablero kanban: etapas del embudo con sus negocios abiertos.
 * `ownerId` limita la vista a la cartera de un vendedor.
 */
export async function getPipelineBoard(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  const stages = await getStages(pipelineId);

  const deals = await db.query.crmDeals.findMany({
    where: and(
      eq(crmDeals.pipelineId, pipelineId),
      eq(crmDeals.status, "open"),
      ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
    ),
    // El importe comparable se calcula en la base y no en la tarjeta: es la
    // MISMA definición que usan los informes (ver `VALOR_MXN`), y tenerla dos
    // veces era justamente lo que hacía que el tablero enseñara «—» en un
    // negocio en dólares mientras el informe lo contaba —o al revés—.
    extras: { valorMxn: VALOR_MXN.as("valor_mxn") },
    orderBy: [asc(crmDeals.position), desc(crmDeals.createdAt)],
    with: {
      organization: { columns: { id: true, name: true } },
      contact: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      labelLinks: { with: { label: true } },
    },
  });

  return stages.map((stage) => ({
    stage,
    deals: deals.filter((d) => d.stageId === stage.id),
  }));
}

/** Negocios cerrados (ganados/perdidos) del embudo. */
export async function getClosedDeals(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  return db.query.crmDeals.findMany({
    where: and(
      eq(crmDeals.pipelineId, pipelineId),
      or(eq(crmDeals.status, "won"), eq(crmDeals.status, "lost")),
      ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
    ),
    orderBy: [desc(crmDeals.closedAt)],
    limit: 50,
    with: {
      organization: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      stage: { columns: { id: true, name: true } },
    },
  });
}

/**
 * El libro de pedidos: los negocios GANADOS y cómo van de surtido.
 *
 * Hasta ahora un pedido no tenía dónde vivir. El tablero solo enseña lo
 * abierto, y al ganarlo el negocio caía en la lista de «cerrados» revuelto con
 * los perdidos, ordenado por fecha de cierre y cortado a 50. Para el vendedor
 * eso está bien —el negocio terminó—, pero para la operación es justo cuando
 * empieza el trabajo: hay que surtirlo.
 *
 * Lo que se responde aquí es «¿qué pedidos siguen debiendo algo?», y se
 * responde con hechos BARATOS y exactos: cuántos renglones tiene, cuántas
 * requisiciones salieron y cuántas piezas de ellas siguen sin convertirse en
 * orden.
 *
 * Lo que deliberadamente NO se calcula aquí es la resta contra existencias. Ese
 * neteo depende del orden en que se van gastando el almacén y lo que viene en
 * camino, así que no se puede agregar en SQL sin volverlo aproximado — y un
 * «faltan 3» aproximado en una lista es peor que no decirlo, porque nadie
 * vuelve a abrir el pedido a verificarlo. La resta exacta vive en el detalle
 * del negocio, que es donde además se puede actuar sobre ella. Por eso
 * `Sin requisitar` es un aviso de «entra a mirar» y no un «falta comprar».
 */
export async function getSalesOrders(page?: { limit: number; offset: number }) {
  const db = await tenantDb();

  const q = db
    .select({
      id: crmDeals.id,
      reference: crmDeals.reference,
      title: crmDeals.title,
      closedAt: crmDeals.closedAt,
      valueMxn: crmDeals.valueMxn,
      organization: crmOrganizations.name,
      lineas: sql<number>`(
        select count(*)::int from crm_deal_products dp
         where dp.deal_id = ${crmDeals.id}
      )`,
      requisiciones: sql<number>`(
        select count(*)::int from requisitions r
         where r.deal_id = ${crmDeals.id}
           and r.status not in ('rejected', 'cancelled')
      )`,
      // Piezas requisitadas que todavía no viajaron a una orden de compra.
      porComprar: sql<number>`(
        select coalesce(sum(rl.quantity - rl.ordered_quantity), 0)::int
          from requisition_lines rl
          join requisitions r on r.id = rl.requisition_id
         where r.deal_id = ${crmDeals.id}
           and r.status in ('draft', 'submitted', 'approved', 'partial')
      )`,
      // Renglones de requisición sin refacción del catálogo: son los que dejan
      // un pedido atorado sin que nada falle.
      sinIdentificar: sql<number>`(
        select count(*)::int
          from requisition_lines rl
          join requisitions r on r.id = rl.requisition_id
         where r.deal_id = ${crmDeals.id}
           and r.status in ('draft', 'submitted', 'approved', 'partial')
           and rl.part_id is null
      )`,
    })
    .from(crmDeals)
    .leftJoin(crmOrganizations, eq(crmOrganizations.id, crmDeals.organizationId))
    .where(eq(crmDeals.status, "won"))
    // Lo que sigue debiendo algo primero: es una lista de trabajo, no un
    // histórico. Dentro de cada grupo, lo más reciente arriba.
    .orderBy(
      sql`case when (
        select coalesce(sum(rl.quantity - rl.ordered_quantity), 0)
          from requisition_lines rl
          join requisitions r on r.id = rl.requisition_id
         where r.deal_id = ${crmDeals.id}
           and r.status in ('draft', 'submitted', 'approved', 'partial')
      ) > 0 then 0 else 1 end`,
      desc(crmDeals.closedAt),
      desc(crmDeals.createdAt),
    );

  return page ? q.limit(page.limit).offset(page.offset) : q;
}

/**
 * Cuántos pedidos hay y cuántos deben algo, sobre el conjunto COMPLETO.
 *
 * Existe porque el encabezado dice «N pedidos · M pendientes» y esas dos cifras
 * son del total, no de la página que se está viendo. Contarlas sobre las filas
 * ya traídas —que es lo que hacía la pantalla— dejó de valer en cuanto la lista
 * se paginó: «3 pendientes» habría significado «3 en esta página», que es una
 * frase distinta y peor, porque parece una cifra de negocio.
 *
 * Una sola consulta para las dos: son la misma pregunta sobre el mismo
 * conjunto, y separarlas permitiría que se contradijeran.
 */
export async function getSalesOrdersSummary(): Promise<{
  total: number;
  pendientes: number;
}> {
  const db = await tenantDb();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // La columna se califica A MANO. Dentro de un `filter (where …)` el
      // constructor de consultas pierde de vista la tabla y escribe `"id"` a
      // secas, que dentro de la subconsulta es ambiguo contra las suyas — y
      // Postgres lo rechaza. Es la misma expresión que la columna `porComprar`
      // de arriba; si una cambia, la otra también.
      pendientes: sql<number>`count(*) filter (where (
        select coalesce(sum(rl.quantity - rl.ordered_quantity), 0)
          from requisition_lines rl
          join requisitions r on r.id = rl.requisition_id
         where r.deal_id = crm_deals.id
           and r.status in ('draft', 'submitted', 'approved', 'partial')
      ) > 0)::int`,
    })
    .from(crmDeals)
    .where(eq(crmDeals.status, "won"));

  return { total: row?.total ?? 0, pendientes: row?.pendientes ?? 0 };
}

export type SalesOrderRow = Awaited<ReturnType<typeof getSalesOrders>>[number];

export async function getDealById(id: string) {
  const db = await tenantDb();
  return db.query.crmDeals.findFirst({
    where: eq(crmDeals.id, id),
    with: {
      pipeline: { with: { stages: { orderBy: [asc(crmStages.order)] } } },
      stage: true,
      organization: true,
      contact: true,
      owner: { columns: { id: true, name: true, email: true } },
      lead: { columns: { id: true, name: true, email: true, message: true } },
      activities: { orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)] },
      items: { orderBy: (p, { asc: a }) => [a(p.createdAt)] },
      labelLinks: { with: { label: true } },
      notes: {
        orderBy: (n, { desc: d }) => [d(n.createdAt)],
        with: { author: { columns: { id: true, name: true, email: true } } },
      },
      events: {
        orderBy: (e, { desc: d }) => [d(e.createdAt)],
        with: {
          fromStage: { columns: { name: true } },
          toStage: { columns: { name: true } },
          author: { columns: { name: true, email: true } },
        },
      },
    },
  });
}

/* ------------------------- Organizaciones ------------------------- */
/* ============================================================
   Cliente o lead
   ============================================================ */

/**
 * Una organización es **cliente** cuando ya compró; si no, es un **lead**.
 *
 * Esta expresión es la única definición del sistema, y la comparten el catálogo
 * de organizaciones y el selector del formulario de negocio. Tenerla escrita
 * dos veces sería garantizar que un día discrepen: la misma empresa saldría
 * como cliente en una pantalla y como prospecto en la otra.
 *
 * Cuenta como prueba de compra cualquiera de estas tres, y hacen falta las tres
 * porque el negocio llegó a este sistema por tres caminos distintos:
 *
 *  1. **Un negocio ganado.** Es lo que la operación llama «pedido» — no hay una
 *     tabla de pedidos: `/admin/pedidos` es exactamente `crm_deals` con
 *     `status = 'won'`. Este es el camino de todo lo que se venda desde hoy.
 *  2. **Un contrato firmado** que salió de un negocio de esta organización.
 *  3. **Una cuenta de portal enlazada** (`client_id`). Este es el camino de la
 *     historia: los clientes que venían del sistema anterior se importaron ya
 *     con su cuenta, sus equipos y sus tickets, pero SIN pasar por el embudo,
 *     que no existía cuando se ganaron.
 *
 * El punto 3 es el que hace que esto sea correcto y no solo elegante. Medido
 * sobre los datos reales: con la regla «negocio ganado» a secas quedaba **1**
 * cliente y 163 leads, y entre esos leads había 21 organizaciones con contrato
 * vigente y 20 con equipo instalado. Llamarle prospecto a quien tiene tu equipo
 * en su laboratorio no es un matiz de etiqueta: manda al vendedor a prospectar
 * a un cliente que ya paga.
 */
export const ES_CLIENTE = sql<boolean>`(
  ${crmOrganizations.clientId} is not null
  or exists (
    select 1 from ${crmDeals}
     where ${crmDeals}.organization_id = ${crmOrganizations}.id
       and ${crmDeals}.status = 'won'
  )
  or exists (
    select 1 from ${contracts}
      join ${crmDeals} on ${crmDeals}.id = ${contracts}.deal_id
     where ${crmDeals}.organization_id = ${crmOrganizations}.id
  )
)`;

/**
 * Cliente o prospecto, para UNA organización.
 *
 * ── POR QUÉ NO VA COMO `extras` DE LA CONSULTA RELACIONAL ─────────────────
 *
 * Porque `ES_CLIENTE` está escrito contra el nombre real de la tabla, y la API
 * relacional de Drizzle la alias a `"crmOrganizations"`: Postgres responde
 * «invalid reference to FROM-clause entry for table "crm_organizations"» y la
 * ficha entera se cae. Es el mismo tropiezo que ya está anotado en
 * `getClients`, ahí con los conteos de las subconsultas.
 *
 * Se resuelve con un `select` aparte, que sí usa el nombre real. Es una
 * consulta más por ficha, sobre la clave primaria; a cambio, la regla sigue
 * viviendo en UN solo sitio. Recalcularla a mano en JavaScript —«tiene cuenta o
 * algún negocio ganado»— sería más rápido y volvería a abrir la puerta a que la
 * ficha diga «prospecto» de alguien que la lista de Clientes cuenta como
 * cliente.
 */
export async function kindDeOrganizacion(id: string): Promise<OrgKind> {
  const db = await tenantDb();
  const [fila] = await db
    .select({ kind: ORG_KIND })
    .from(crmOrganizations)
    .where(eq(crmOrganizations.id, id))
    .limit(1);
  return fila?.kind ?? "lead";
}

/** `ES_CLIENTE` como el valor que viaja a la interfaz. Ver `OrgKind` en `lib/crm.ts`. */
export const ORG_KIND = sql<OrgKind>`(case when ${ES_CLIENTE} then 'client' else 'lead' end)`;

/**
 * Cartera de organizaciones, ya resumida.
 *
 * Antes traía cada organización **con todos sus contactos y todos sus
 * negocios** solo para contarlos en JavaScript: `contacts.length`,
 * `deals.filter(abierto).length` y la suma de sus importes. Medido, la pantalla
 * leía 7 690 filas de la base para pintar 164 tarjetas, y de esas 7 690 lo
 * único que sobrevivía al render eran tres números por organización.
 *
 * Ahora los tres números los calcula Postgres en subconsultas correlacionadas,
 * que es exactamente para lo que están los índices `crm_contacts_organization_idx`
 * y `crm_deals_pipeline_status_idx`. Lo que viaja es una fila por organización.
 *
 * Sigue sin paginar, y es deliberado: la búsqueda de esta pantalla es en
 * cliente sobre las filas ya cargadas (ver `organizations-list.tsx`), así que
 * paginar aquí dejaría la caja de búsqueda buscando dentro de una página. El
 * día que la cartera pase de unos pocos miles, lo que hay que mover al servidor
 * es la BÚSQUEDA, y la paginación viene con ella; hacerlo al revés rompe una
 * función que hoy funciona.
 *
 * **Qué ve un vendedor.** Su cartera Y lo que no es de nadie. Antes solo lo
 * suyo, y el efecto medido sobre estos datos era demoledor: de 164
 * organizaciones, 161 llegaron del sistema anterior sin responsable, así que la
 * pantalla le enseñaba **tres**. El CRM estaba vacío justo para el rol que
 * tiene que trabajarlo, y no había ni un mensaje que lo explicara: parecía que
 * no se habían importado los clientes.
 *
 * Lo sin asignar es de todos hasta que alguien lo toma —para eso está
 * `claimOrganization`—, que es como funciona una bandeja de prospectos. Lo que
 * sigue sin ver un vendedor es la cartera de OTRO vendedor, que es la línea que
 * de verdad importa mantener.
 */
export async function getOrganizations(
  ownerId?: string,
  /**
   * Acota a un solo tipo. Lo usa el módulo de Leads; sin él, devuelve todo —que
   * es lo que necesita el catálogo completo y el selector del negocio—.
   */
  opts?: { only?: OrgKind },
  conexion?: DbOrTx,
) {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN: una descarga corre por el pool
    de SOLO LECTURA para no ocupar una de las dos conexiones que la empresa tiene
    para su trabajo del día. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());

  const rows = await db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      taxId: crmOrganizations.taxId,
      industry: crmOrganizations.industry,
      address: crmOrganizations.address,
      phone: crmOrganizations.phone,
      ownerId: crmOrganizations.ownerId,
      clientId: crmOrganizations.clientId,
      kind: ORG_KIND,
      /*
        Cada subconsulta lleva alias propio (`k`, `d`) y referencia a la tabla
        de fuera POR SU NOMBRE (`${crmOrganizations}.id`), nunca por columna.

        No es manía: interpolar la columna —`${crmOrganizations.id}`— la escribe
        SIN calificar, y dentro de la subconsulta ese `"id"` pelado lo resuelve
        Postgres contra la tabla interior, no contra la de fuera. El predicado
        se convertía en `crm_deals.organization_id = crm_deals.id`, que nunca es
        cierto. Y como ambas columnas existen, Postgres no protesta: devuelve
        cero. Medido, las tarjetas mostraban «0 contacto(s), 0 negocio(s)» en
        organizaciones que tenían uno de cada, y el filtro «Con negocios» decía
        0 de 3.
      */
      contacts: sql<number>`(
        select count(*)::int from ${crmContacts}
         where ${crmContacts}.organization_id = ${crmOrganizations}.id
      )`,
      openDeals: sql<number>`(
        select count(*)::int from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'open'
      )`,
      // El importe usa `VALOR_MXN` para que un negocio en dólares cuente aquí
      // igual que en el embudo y en los informes. Es también la razón de no
      // poner alias a `crm_deals`: ese fragmento se escribe calificado con el
      // nombre real de la tabla, y un alias lo dejaría fuera de alcance
      // —Postgres responde «invalid reference to FROM-clause entry»—.
      openValue: sql<number>`(
        select coalesce(sum(${VALOR_MXN}), 0)::float8 from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'open'
      )`,
    })
    .from(crmOrganizations)
    .where(
      and(
        ownerId
          ? or(
              eq(crmOrganizations.ownerId, ownerId),
              isNull(crmOrganizations.ownerId),
            )
          : undefined,
        // La MISMA regla que clasifica, negada. Escribir aquí una condición
        // propia —«sin negocio ganado», por ejemplo— haría que una organización
        // pudiera no salir en Clientes y tampoco en Leads, o salir en ambas.
        opts?.only === "lead"
          ? sql`not ${ES_CLIENTE}`
          : opts?.only === "client"
            ? ES_CLIENTE
            : undefined,
      ),
    )
    .orderBy(asc(crmOrganizations.name));

  // El nombre del responsable se resuelve con UNA consulta al padrón, no con un
  // join: `users` es plano de control y se lee por membresía (ver `people.ts`),
  // que es lo que impide que aparezca gente de otra empresa. Se piden también
  // las bajas: una organización sigue siendo de quien la llevaba aunque esa
  // persona ya no trabaje aquí, y borrarle el nombre no la reasigna.
  const members = await listTenantMembers({ includeInactive: true });
  const nameById = new Map(members.map((m) => [m.id, m.name ?? m.email]));

  return rows.map((r) => ({
    ...r,
    ownerName: r.ownerId ? (nameById.get(r.ownerId) ?? null) : null,
    // Tener cuenta de portal y ser cliente dejaron de ser lo mismo: `kind` dice
    // si ya compró (ver `ES_CLIENTE`) y esto solo dice si puede entrar al
    // portal. Antes había un único `isClient` que significaba lo segundo y se
    // mostraba como lo primero.
    hasPortal: Boolean(r.clientId),
  }));
}

export async function getOrganizationById(id: string) {
  const db = await tenantDb();
  return db.query.crmOrganizations.findFirst({
    where: eq(crmOrganizations.id, id),
    with: {
      owner: { columns: { id: true, name: true, email: true } },
      client: { columns: { id: true, name: true, email: true } },
      contacts: { orderBy: [asc(crmContacts.name)] },
      deals: {
        orderBy: [desc(crmDeals.createdAt)],
        with: { stage: { columns: { name: true } } },
      },
      activities: {
        orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)],
        limit: 20,
      },
      notes: {
        orderBy: (n, { desc: d }) => [d(n.createdAt)],
        with: { author: { columns: { name: true, email: true } } },
      },
    },
  });
}

/**
 * El expediente fiscal de una organización, o `null` si todavía no tiene.
 *
 * ── POR QUÉ APARTE Y NO DENTRO DE `getOrganizationById` ────────────────────
 *
 * Aquélla usa la API de relaciones de Drizzle, que exige declarar la relación
 * en el grafo del esquema. Colgar de ahí dos tablas 1:1 nuevas obligaría a
 * tocar ese grafo —que lo comparten todas las consultas del CRM— para algo que
 * solo necesita una pantalla. Dos `left join` sueltos cuestan lo mismo y no le
 * cambian la forma a nada más.
 *
 * `null` significa «no tiene expediente», que NO es lo mismo que «tiene el
 * expediente vacío». La ficha enseña cosas distintas en cada caso, y por eso se
 * devuelve la ausencia en vez de una fila de campos nulos.
 */
export async function getExpedienteFiscal(organizationId: string) {
  const db = await tenantDb();
  const [fila] = await db
    .select({
      rfc: clienteFiscal.rfc,
      nombreFiscal: clienteFiscal.nombreFiscal,
      nombreCapturado: clienteFiscal.nombreCapturado,
      regimenFiscal: clienteFiscal.regimenFiscal,
      cpFiscal: clienteFiscal.cpFiscal,
      personaTipo: clienteFiscal.personaTipo,
      rolFiscal: clienteFiscal.rolFiscal,
      paisResidencia: clienteFiscal.paisResidencia,
      numRegIdTrib: clienteFiscal.numRegIdTrib,
      usoCfdiDefault: clienteFiscal.usoCfdiDefault,
      curp: clienteFiscal.curp,
      actualizadoEn: clienteFiscal.actualizadoEn,
      validacion: clienteValidacionSat.resultado,
      lista69b: clienteValidacionSat.lista69b,
      validadoEn: clienteValidacionSat.validadoEn,
      origenValidacion: clienteValidacionSat.origen,
    })
    .from(clienteFiscal)
    .leftJoin(
      clienteValidacionSat,
      eq(clienteValidacionSat.organizationId, clienteFiscal.organizationId),
    )
    .where(eq(clienteFiscal.organizationId, organizationId))
    .limit(1);

  return fila ?? null;
}

export type ExpedienteFiscal = NonNullable<Awaited<ReturnType<typeof getExpedienteFiscal>>>;

/**
 * Vista 360 del laboratorio: lo que ya existe en el resto del portal para la
 * cuenta de cliente enlazada (contratos, equipos y tickets). Devuelve listas
 * vacías si la organización todavía no está vinculada a una cuenta.
 */
export async function getOrganizationPortalData(clientId: string | null) {
  if (!clientId) return { contracts: [], equipment: [], tickets: [] };
  const db = await tenantDb();

  const [contractRows, equipmentRows, ticketRows] = await Promise.all([
    db.query.contracts.findMany({
      where: eq(contracts.clientId, clientId),
      orderBy: [desc(contracts.createdAt)],
      with: { salesRep: { columns: { name: true, email: true } } },
    }),
    db.query.equipment.findMany({
      where: eq(equipment.ownerId, clientId),
      orderBy: [asc(equipment.name)],
      with: { modules: { columns: { id: true } } },
    }),
    db
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(eq(tickets.createdById, clientId))
      .orderBy(desc(tickets.createdAt))
      .limit(10),
  ]);

  return { contracts: contractRows, equipment: equipmentRows, tickets: ticketRows };
}

/**
 * Organizaciones que ya están enlazadas a una cuenta de portal, indexadas por
 * esa cuenta. Sirve para avisar en la lista de usuarios cuáles faltan.
 */
export async function getOrganizationsByClient() {
  const db = await tenantDb();
  const rows = await db
    .select({
      clientId: crmOrganizations.clientId,
      id: crmOrganizations.id,
      name: crmOrganizations.name,
    })
    .from(crmOrganizations)
    .where(sql`${crmOrganizations.clientId} is not null`);

  return new Map(rows.map((r) => [r.clientId as string, r]));
}

/** Contrato generado a partir de un negocio (si ya existe). */
export async function getContractForDeal(dealId: string) {
  const db = await tenantDb();
  const [row] = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      amountMxn: contracts.amountMxn,
    })
    .from(contracts)
    .where(eq(contracts.dealId, dealId))
    .limit(1);
  return row ?? null;
}

/* ------------------------- Contactos ------------------------- */
/**
 * Por qué columnas se ordenan los contactos.
 *
 * Solo las de `crm_contacts`. Organización y responsable viven en otras tablas
 * y las trae el cargador de relaciones: ordenar por ellas exigiría un join
 * explícito y cambiar la forma de la consulta. Con contactos, además, la
 * operación que se hace con la organización es FILTRAR, no ordenar.
 */
const ORDEN_CONTACTOS = {
  nombre: crmContacts.name,
  puesto: crmContacts.position,
  correo: crmContacts.email,
} as const;
export type CampoOrdenContacto = keyof typeof ORDEN_CONTACTOS;
export const CAMPOS_ORDEN_CONTACTOS = Object.keys(
  ORDEN_CONTACTOS,
) as CampoOrdenContacto[];
export const ORDEN_CONTACTOS_DEFECTO: Orden<CampoOrdenContacto> = {
  campo: "nombre",
  dir: "asc",
};

export async function getContacts(
  ownerId?: string,
  orden?: Orden<CampoOrdenContacto>,
) {
  const db = await tenantDb();
  return db.query.crmContacts.findMany({
    where: ownerId ? eq(crmContacts.ownerId, ownerId) : undefined,
    orderBy: orden
      ? ordenarPor(orden, ORDEN_CONTACTOS, crmContacts.id)
      : [asc(crmContacts.name)],
    with: {
      organization: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
      deals: { columns: { id: true, status: true } },
    },
  });
}

/* ------------------------- Actividades ------------------------- */
/** Agenda: actividades pendientes primero, ordenadas por vencimiento. */
export async function getActivities(opts?: {
  ownerId?: string;
  onlyPending?: boolean;
}) {
  const db = await tenantDb();
  return db.query.crmActivities.findMany({
    where: and(
      opts?.ownerId ? eq(crmActivities.ownerId, opts.ownerId) : undefined,
      opts?.onlyPending ? eq(crmActivities.done, false) : undefined,
    ),
    orderBy: [asc(crmActivities.done), asc(crmActivities.dueAt)],
    limit: 200,
    with: {
      deal: { columns: { id: true, reference: true, title: true } },
      organization: { columns: { id: true, name: true } },
      contact: { columns: { id: true, name: true } },
      owner: { columns: { id: true, name: true, email: true } },
    },
  });
}

/* ------------------------- Métricas ------------------------- */
/** KPIs del embudo: abiertos, valor, ganados/perdidos y actividades vencidas. */
export async function getCrmStats(pipelineId: string, ownerId?: string) {
  const db = await tenantDb();
  const scope = and(
    eq(crmDeals.pipelineId, pipelineId),
    ownerId ? eq(crmDeals.ownerId, ownerId) : undefined,
  );

  const [totals] = await db
    .select({
      openCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'open')::int`,
      openValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'open'), 0)`,
      wonCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'won')::int`,
      wonValue: sql<string>`coalesce(sum(${crmDeals.valueMxn}) filter (where ${crmDeals.status} = 'won'), 0)`,
      lostCount: sql<number>`count(*) filter (where ${crmDeals.status} = 'lost')::int`,
    })
    .from(crmDeals)
    .where(scope);

  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.done, false),
        sql`${crmActivities.dueAt} < now()`,
        ownerId ? eq(crmActivities.ownerId, ownerId) : undefined,
      ),
    );

  const closed = (totals?.wonCount ?? 0) + (totals?.lostCount ?? 0);
  return {
    openCount: totals?.openCount ?? 0,
    openValue: totals?.openValue ?? "0",
    wonCount: totals?.wonCount ?? 0,
    wonValue: totals?.wonValue ?? "0",
    lostCount: totals?.lostCount ?? 0,
    overdueActivities: overdue?.n ?? 0,
    winRate: closed > 0 ? Math.round(((totals?.wonCount ?? 0) / closed) * 100) : null,
  };
}

/* ------------------------- Apoyo para formularios ------------------------- */
/** Responsables posibles de un negocio: vendedores, administradores y el dueño. */
export async function getCrmOwners() {
  return listTenantMembers({ roles: ["sales", "admin", "owner"] });
}

/** Cuentas de portal (laboratorios) para enlazar una organización ya cliente. */
export async function getClientAccounts() {
  return listTenantMembers({ roles: ["client"], orderBy: "company" });
}

/* ============================================================
   Clientes y leads: dos módulos, una sola tabla
   ============================================================

   La separación es de PANTALLAS, no de entidades, y esa distinción es toda la
   decisión de diseño.

   Partir `crm_organizations` en dos tablas parecía lo natural —son dos cosas
   muy distintas en la práctica: las 24 que son cliente cargan 21 contratos, 48
   equipos y 565 de los 602 tickets, mientras que las otras 141 no cargan nada
   más que un nombre—. Pero significaría:

    · Que ganar un negocio deje de convertir a la organización en cliente por sí
      solo y pase a ser un trámite de copiado que alguien tiene que recordar. El
      fallo clásico de CRM es la misma empresa existiendo dos veces, con su
      historia partida entre las copias.
    · Repuntar o duplicar las claves foráneas: contrato → negocio → organización,
      y equipos/tickets → cuenta de portal.

   Lo que de verdad difiere no es el dato: es el trabajo. A un lead se le llama,
   se le cotiza y se le da seguimiento; a un cliente se le administran contratos,
   equipos y tickets. Misma fila, dos oficios, dos pantallas. */

/**
 * Clientes: quien ya compró, visto desde el SERVICIO.
 *
 * Los conteos cuelgan de la cuenta de portal (`client_id`) y no de la
 * organización, porque así están enlazados equipos y tickets en este sistema.
 * Cuando esa cuenta falta, las subconsultas devuelven cero —comparar contra
 * `null` nunca es cierto— y eso es exactamente lo que hay que enseñar: no es
 * que el cliente no tenga equipos, es que **no hay por dónde encontrárselos**.
 * `hasPortal` permite decirlo en la pantalla en vez de mostrar un cero que
 * miente. Ocurre de verdad: Laboratorios Genoma es cliente por negocio ganado y
 * no tiene cuenta enlazada.
 *
 * ── LOS CONTEOS SE AGRUPAN UNA VEZ, NO UNO POR CLIENTE ─────────────────────
 *
 * Eran siete subconsultas CORRELACIONADAS, o sea siete recorridos por cada fila
 * de la lista: tres de ellos sobre `tickets`, que es la tabla que más crece. El
 * coste es clientes × tickets, así que no se nota hasta que se nota de golpe —
 * y esta pantalla ya era la más lenta del portal.
 *
 * Medido en bajío, 88 clientes: 33 ms → 8,3 ms, y comprobado campo a campo
 * contra la consulta vieja —las 88 filas idénticas en los siete conteos— antes
 * de tirarla.
 *
 * Ahora cada tabla se agrupa UNA vez por su clave y se pega con un `left join`.
 * Los tres conteos de tickets salen del mismo recorrido con `filter`, que es lo
 * que antes obligaba a leer la tabla tres veces para responder tres preguntas
 * sobre las mismas filas.
 *
 * El `left join` conserva la semántica que hacía falta conservar: cuando un
 * cliente no tiene cuenta de portal, `client_id` es nulo, y nulo no casa con
 * nada —tampoco con otro nulo— así que no encuentra pareja y el `coalesce` deja
 * el cero. Es el mismo cero que devolvía la subconsulta al no comparar nunca
 * cierto, y sigue significando «no hay por dónde encontrárselos», que es lo que
 * `hasPortal` traduce en la pantalla.
 */
/**
 * El plazo pactado con el cliente que levanta este ticket, en horas.
 *
 * `null` si no pactó ninguno —lo normal— y entonces rige el general. Ver
 * `slaDueFrom`.
 *
 * Se busca por `clientId` porque es lo que une la cuenta que abre el ticket con
 * su organización. Una cuenta sin organización vinculada devuelve nulo, que es
 * lo correcto: sin ficha comercial no hay contrato del que salga un plazo
 * propio.
 *
 * Se resuelve al CREAR el ticket y se congela en `sla_due_at`. Cambiar el plazo
 * de un cliente no debe mover el vencimiento de lo que ya entró: el compromiso
 * era el de ese día, y recalcularlo hacia atrás dejaría tickets que pasan de
 * cumplidos a vencidos sin que nadie hiciera nada.
 */
export async function slaHorasDelCliente(
  clientUserId: string,
  conexion?: DbOrTx,
): Promise<number | null> {
  const db = conexion ?? (await tenantDb());
  const [fila] = await db
    .select({ h: crmOrganizations.slaHours })
    .from(crmOrganizations)
    .where(eq(crmOrganizations.clientId, clientUserId))
    .limit(1);
  return fila?.h ?? null;
}

export async function getClients(conexion?: DbOrTx) {
  /*
    Conexión explícita para la CAPA DE EXTRACCIÓN: una descarga corre por el pool
    de SOLO LECTURA para no ocupar una de las dos conexiones que la empresa tiene
    para su trabajo del día. Ver `tenantDbReadOnly`.
  */
  const db = conexion ?? (await tenantDb());

  const porContrato = db
    .select({
      clientId: contracts.clientId,
      n: sql<number>`count(*)::int`.as("contratos_n"),
    })
    .from(contracts)
    .groupBy(contracts.clientId)
    .as("por_contrato");

  const porEquipo = db
    .select({
      ownerId: equipment.ownerId,
      n: sql<number>`count(*)::int`.as("equipos_n"),
    })
    .from(equipment)
    .groupBy(equipment.ownerId)
    .as("por_equipo");

  const porTicket = db
    .select({
      createdById: tickets.createdById,
      abiertos: sql<number>`count(*) filter (
        where ${tickets.status} in ('pending_review','open','in_progress','waiting')
      )::int`.as("tickets_abiertos"),
      total: sql<number>`count(*)::int`.as("tickets_total"),
      ultimo: sql<string | null>`max(${tickets.createdAt})`.as("tickets_ultimo"),
    })
    .from(tickets)
    .groupBy(tickets.createdById)
    .as("por_ticket");

  const porGanado = db
    .select({
      organizationId: crmDeals.organizationId,
      n: sql<number>`count(*)::int`.as("ganados_n"),
      valor: sql<number>`coalesce(sum(${VALOR_MXN}), 0)::float8`.as("ganados_valor"),
    })
    .from(crmDeals)
    .where(eq(crmDeals.status, "won"))
    .groupBy(crmDeals.organizationId)
    .as("por_ganado");

  const rows = await db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      taxId: crmOrganizations.taxId,
      industry: crmOrganizations.industry,
      phone: crmOrganizations.phone,
      ownerId: crmOrganizations.ownerId,
      clientId: crmOrganizations.clientId,
      /** Plazo propio de primera respuesta. Nulo = el general. Ver `slaDueFrom`. */
      slaHours: crmOrganizations.slaHours,
      /*
        Los contactos, también aquí.

        Vivían solo en el catálogo de organizaciones, que no está en el menú, y
        al mudar la ficha desaparecieron de la vista de todo el mundo. Son el
        dato con el que se empieza a trabajar a una empresa —a quién se llama—,
        y un cliente con cero contactos es una cuenta que no se puede atender
        sin salir a preguntar. La subconsulta es correlacionada por el mismo
        motivo que las de arriba: los `left join` con agregado multiplicaban
        filas entre sí.
      */
      contacts: sql<number>`(
        select count(*)::int from ${crmContacts}
         where ${crmContacts}.organization_id = ${crmOrganizations}.id
      )`,
      // Se piden en crudo y el cero se pone abajo, en JavaScript. Envolverlos
      // aquí en un `coalesce` obligaba a escribirlos dentro de una plantilla
      // `sql`, y ahí Drizzle pierde el prefijo de la subconsulta: dos de ellas
      // exponen una columna llamada `n` y Postgres rechazaba la consulta por
      // ambigua. Como campos, los cualifica solo.
      contracts: porContrato.n,
      equipment: porEquipo.n,
      openTickets: porTicket.abiertos,
      totalTickets: porTicket.total,
      lastTicketAt: porTicket.ultimo,
      wonDeals: porGanado.n,
      wonValue: porGanado.valor,

      /*
        ── EL EXPEDIENTE FISCAL, EN LA LISTA ────────────────────────────────

        `taxId` de arriba es el RFC que trajo el padrón de SAE: un texto suelto,
        sin validar y sin régimen ni código postal que lo acompañen. Sirve para
        buscar y no sirve para facturar.

        Estos cuatro campos son el expediente de verdad. Se traen a la LISTA —y
        no solo a la ficha— porque la pregunta que se hace facturación no es
        «¿cuál es el RFC de este cliente?», sino «¿a cuáles de mis clientes
        puedo facturarles?». Esa es una pregunta sobre la lista entera, y
        contestarla abriendo veintitrés fichas de una en una es lo que hace que
        no se conteste nunca.

        Dos `left join` a tablas 1:1, no subconsultas correlacionadas: aquí no
        hay nada que agregar, así que no pueden multiplicar filas —que es el
        motivo por el que las de arriba sí son subconsultas—.
      */
      rfcFiscal: clienteFiscal.rfc,
      cpFiscal: clienteFiscal.cpFiscal,
      regimenFiscal: clienteFiscal.regimenFiscal,
      validacion: clienteValidacionSat.resultado,
    })
    .from(crmOrganizations)
    .leftJoin(porContrato, eq(porContrato.clientId, crmOrganizations.clientId))
    .leftJoin(porEquipo, eq(porEquipo.ownerId, crmOrganizations.clientId))
    .leftJoin(porTicket, eq(porTicket.createdById, crmOrganizations.clientId))
    .leftJoin(porGanado, eq(porGanado.organizationId, crmOrganizations.id))
    .leftJoin(clienteFiscal, eq(clienteFiscal.organizationId, crmOrganizations.id))
    .leftJoin(
      clienteValidacionSat,
      eq(clienteValidacionSat.organizationId, crmOrganizations.id),
    )
    .where(ES_CLIENTE)
    .orderBy(asc(crmOrganizations.name));

  const members = await listTenantMembers({ includeInactive: true });
  const nameById = new Map(members.map((m) => [m.id, m.name ?? m.email]));

  return rows.map((r) => ({
    ...r,
    // Sin pareja en el `left join` no hay fila que contar, y eso es un cero: la
    // pantalla enseña «0 equipos», no un hueco. Ver la cabecera.
    contracts: r.contracts ?? 0,
    equipment: r.equipment ?? 0,
    openTickets: r.openTickets ?? 0,
    totalTickets: r.totalTickets ?? 0,
    wonDeals: r.wonDeals ?? 0,
    wonValue: r.wonValue ?? 0,
    ownerName: r.ownerId ? (nameById.get(r.ownerId) ?? null) : null,
    hasPortal: Boolean(r.clientId),
    lastTicketAt: r.lastTicketAt ? new Date(r.lastTicketAt) : null,
  }));
}

export type ClientRow = Awaited<ReturnType<typeof getClients>>[number];

/**
 * Leads: organizaciones sin ninguna compra registrada.
 *
 * Es `getOrganizations` con la regla invertida, y comparte con ella hasta el
 * criterio de visibilidad: el vendedor ve su cartera **y** lo que no es de
 * nadie, porque prospectar lo sin asignar es su trabajo, no una intromisión.
 */
export async function getLeadOrganizations(ownerId?: string) {
  return getOrganizations(ownerId, { only: "lead" });
}

/* ------------------------- Listas para formularios ------------------------- */

/**
 * Organizaciones para el selector del negocio, clasificadas y con con qué
 * buscarlas.
 *
 * Devuelve el tipo junto al nombre para separar «Clientes» de «Leads». La
 * distinción importa en el momento de capturar: no es lo mismo abrir una
 * oportunidad con quien ya te compró —y a quien le puedes mirar su historial,
 * sus equipos y sus contratos— que con alguien a quien todavía hay que
 * convencer.
 *
 * Los clientes van primero, y no es preferencia estética: son pocos frente a
 * los leads (24 de 164 aquí) y son los que más veces se eligen.
 *
 * **Por qué viaja más que el nombre.** El selector es un buscador, y un
 * buscador solo encuentra por lo que tiene. Facturación busca por RFC, quien
 * prospecta busca por giro, y quien acaba de colgar el teléfono busca por el
 * número desde el que le llamaron. Con solo `name` había que acertar el nombre
 * exacto —incluido si lleva «S.A. de C.V.»— o rendirse.
 *
 * El costo es acotado y medido: son 164 filas de campos cortos, del orden de lo
 * que ya envía la propia pantalla de organizaciones. Los conteos salen de
 * subconsultas correlacionadas sobre los índices que ya existen. Si la cartera
 * llegara a varios miles, esto deja de mandarse entero y la búsqueda pasa al
 * servidor — el selector ya está construido para eso, porque filtra sobre una
 * lista que recibe y no sobre una que él mismo consulta.
 */
export async function getOrgOptions() {
  const db = await tenantDb();
  return db
    .select({
      id: crmOrganizations.id,
      name: crmOrganizations.name,
      kind: ORG_KIND,
      taxId: crmOrganizations.taxId,
      industry: crmOrganizations.industry,
      phone: crmOrganizations.phone,
      // Mismo cuidado que en `getOrganizations`: la tabla de fuera se
      // referencia por su NOMBRE, nunca interpolando una columna suelta — eso
      // último drizzle lo escribe sin calificar y Postgres lo resuelve contra
      // la tabla de dentro, devolviendo cero en silencio.
      openDeals: sql<number>`(
        select count(*)::int from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'open'
      )`,
      wonDeals: sql<number>`(
        select count(*)::int from ${crmDeals}
         where ${crmDeals}.organization_id = ${crmOrganizations}.id
           and ${crmDeals}.status = 'won'
      )`,
    })
    .from(crmOrganizations)
    .orderBy(desc(ES_CLIENTE), asc(crmOrganizations.name));
}

export async function getContactOptions() {
  const db = await tenantDb();
  return db
    .select({
      id: crmContacts.id,
      name: crmContacts.name,
      organizationId: crmContacts.organizationId,
    })
    .from(crmContacts)
    .orderBy(asc(crmContacts.name));
}

/** Ids de leads que ya generaron un negocio (para no convertirlos dos veces). */
export async function getConvertedLeadIds() {
  const db = await tenantDb();
  const rows = await db
    .select({ leadId: crmDeals.leadId })
    .from(crmDeals)
    .where(sql`${crmDeals.leadId} is not null`);
  return new Set(rows.map((r) => r.leadId as string));
}

/** Leads del formulario web que aún no se convirtieron en negocio. */
export async function getUnconvertedLeads() {
  const db = await tenantDb();
  const converted = db
    .select({ leadId: crmDeals.leadId })
    .from(crmDeals)
    .where(sql`${crmDeals.leadId} is not null`);

  return db.query.leads.findMany({
    where: (l, { notInArray }) => notInArray(l.id, converted),
    orderBy: (l, { desc: d }) => [d(l.createdAt)],
    limit: 100,
  });
}

export { isNull };
