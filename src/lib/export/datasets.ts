import "server-only";
import { dataset, type Dataset } from "./registro";
import { TOPE_FILAS } from "./registro";
import { parseFiltro, parseOrden } from "@/lib/listado";
import { diaCivil } from "@/lib/fechas";

/**
 * LOS DATASETS DE CADA MÓDULO.
 *
 * Cada uno interpreta los `searchParams` con los MISMOS ayudantes que su
 * pantalla y llama a la MISMA función de datos. Ver la cabecera de `registro`:
 * es lo que hace que «descargar» signifique «lo que estoy viendo» y no «algo
 * parecido a lo que estoy viendo».
 *
 * `limit: TOPE_FILAS` en vez de la página: la pantalla enseña veinticinco, la
 * descarga se lleva todo lo que casa con el filtro hasta el tope.
 */

/** Fecha civil de México, no UTC: ver `lib/fechas`. */
const dia = (d: Date | string | null | undefined) =>
  d ? (typeof d === "string" ? d : diaCivil(d)) : null;

const num = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v);

/* ───────────────────────────── Servicio ───────────────────────────── */

const tickets = dataset({
  id: "tickets",
  modulo: "servicio",
  nombre: "Cola de tickets",
  filas: async ({ sp, db }) => {
    const { getQueuePage, CAMPOS_ORDEN_COLA, ORDEN_COLA_DEFECTO } = await import(
      "@/lib/data/tickets"
    );
    const { STAFF_SETTABLE_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES } =
      await import("@/lib/tickets");
    return getQueuePage(
      {
        limit: TOPE_FILAS,
        offset: 0,
        orden: parseOrden(sp, CAMPOS_ORDEN_COLA, ORDEN_COLA_DEFECTO),
        estado: parseFiltro(sp.estado, STAFF_SETTABLE_STATUSES),
        prioridad: parseFiltro(sp.prioridad, TICKET_PRIORITIES),
        categoria: parseFiltro(sp.categoria, TICKET_CATEGORIES),
        tecnico: sp.tecnico,
        onlyBreached: sp.sla === "vencido",
      },
      db,
    );
  },
  columnas: [
    { titulo: "Folio", tipo: "texto", valor: (t) => t.reference, ancho: 14 },
    { titulo: "Asunto", tipo: "texto", valor: (t) => t.subject, ancho: 40 },
    { titulo: "Estado", tipo: "texto", valor: (t) => t.status },
    { titulo: "Prioridad", tipo: "texto", valor: (t) => t.priority },
    { titulo: "Categoría", tipo: "texto", valor: (t) => t.category },
    { titulo: "Cliente", tipo: "texto", valor: (t) => t.createdBy?.company ?? t.createdBy?.name, ancho: 30 },
    { titulo: "Técnico", tipo: "texto", valor: (t) => t.assignedTo?.name ?? t.assignedTo?.email, ancho: 26 },
    { titulo: "Creado", tipo: "fecha", valor: (t) => dia(t.createdAt) },
    { titulo: "Resuelto", tipo: "fecha", valor: (t) => dia(t.resolvedAt) },
  ],
});

const equipos = dataset({
  id: "equipos",
  modulo: "servicio",
  nombre: "Parque instalado",
  filas: async ({ sp, db }) => {
    const {
      getEquipmentList,
      CAMPOS_ORDEN_EQUIPOS,
      ORDEN_EQUIPOS_DEFECTO,
      CONTRATO_FILTROS,
    } = await import("@/lib/data/equipment");
    return getEquipmentList(
      {
        limit: TOPE_FILAS,
        offset: 0,
        orden: parseOrden(sp, CAMPOS_ORDEN_EQUIPOS, ORDEN_EQUIPOS_DEFECTO),
        filtros: {
          marca: sp.marca,
          laboratorio: sp.laboratorio,
          contrato: parseFiltro(sp.contrato, CONTRATO_FILTROS),
        },
      },
      db,
    );
  },
  columnas: [
    { titulo: "Equipo", tipo: "texto", valor: (e) => e.name, ancho: 32 },
    { titulo: "Marca", tipo: "texto", valor: (e) => e.brand },
    { titulo: "Modelo", tipo: "texto", valor: (e) => e.model },
    { titulo: "Laboratorio", tipo: "texto", valor: (e) => e.ownerName, ancho: 32 },
    { titulo: "Módulos", tipo: "numero", valor: (e) => e.modulos },
    { titulo: "Servicios", tipo: "numero", valor: (e) => e.servicios },
    { titulo: "En contrato", tipo: "si-no", valor: (e) => e.enContrato },
    { titulo: "Alta", tipo: "fecha", valor: (e) => dia(e.createdAt) },
  ],
});

/* ───────────────────────────── Clientes ───────────────────────────── */

const clientes = dataset({
  id: "clientes",
  modulo: "clientes",
  nombre: "Clientes",
  filas: async ({ db }) => {
    const { getClients } = await import("@/lib/data/crm");
    return getClients(db);
  },
  columnas: [
    { titulo: "Nombre", tipo: "texto", valor: (c) => c.name, ancho: 34 },
    { titulo: "RFC", tipo: "texto", valor: (c) => c.taxId, ancho: 16 },
    { titulo: "Giro", tipo: "texto", valor: (c) => c.industry },
    { titulo: "Teléfono", tipo: "texto", valor: (c) => c.phone },
    { titulo: "Contratos", tipo: "numero", valor: (c) => c.contracts },
    { titulo: "Equipos", tipo: "numero", valor: (c) => c.equipment },
    { titulo: "Tickets abiertos", tipo: "numero", valor: (c) => c.openTickets },
    { titulo: "Tickets totales", tipo: "numero", valor: (c) => c.totalTickets },
    { titulo: "Último ticket", tipo: "fecha", valor: (c) => dia(c.lastTicketAt) },
    { titulo: "Negocios ganados", tipo: "numero", valor: (c) => c.wonDeals },
    { titulo: "Valor ganado", tipo: "moneda", valor: (c) => c.wonValue },
    { titulo: "SLA (horas)", tipo: "numero", valor: (c) => c.slaHours },
    { titulo: "Responsable", tipo: "texto", valor: (c) => c.ownerName },
    { titulo: "Portal", tipo: "si-no", valor: (c) => c.hasPortal },
  ],
});

const contratos = dataset({
  id: "contratos",
  modulo: "clientes",
  nombre: "Contratos",
  filas: async ({ sp, db, userId, administra }) => {
    const {
      getContracts,
      CAMPOS_ORDEN_CONTRATOS,
      ORDEN_CONTRATOS_DEFECTO,
      VIGENCIAS,
    } = await import("@/lib/data/contracts");
    // Mismo acotado que la pantalla: quien no administra solo se lleva los
    // suyos. Sin esto, el botón de descarga sería la puerta de atrás al padrón
    // completo para alguien que en pantalla solo ve su cartera.
    const deQuien = administra ? undefined : (userId ?? undefined);
    return getContracts(
      deQuien,
      db,
      { limit: TOPE_FILAS, offset: 0 },
      parseOrden(sp, CAMPOS_ORDEN_CONTRATOS, ORDEN_CONTRATOS_DEFECTO),
      {
        vigencia: parseFiltro(sp.vigencia, VIGENCIAS),
        vendedor: administra ? sp.vendedor : undefined,
      },
    );
  },
  columnas: [
    { titulo: "Número", tipo: "texto", valor: (c) => c.number, ancho: 20 },
    { titulo: "Cliente", tipo: "texto", valor: (c) => c.client?.company ?? c.client?.name, ancho: 32 },
    { titulo: "Vendedor", tipo: "texto", valor: (c) => c.salesRep?.name ?? c.salesRep?.email },
    { titulo: "Monto MXN", tipo: "moneda", valor: (c) => num(c.amountMxn) },
    { titulo: "Monto USD", tipo: "moneda", valor: (c) => num(c.amountUsd) },
    { titulo: "Inicio", tipo: "fecha", valor: (c) => dia(c.startDate) },
    { titulo: "Fin", tipo: "fecha", valor: (c) => dia(c.endDate) },
    { titulo: "Equipos", tipo: "numero", valor: (c) => c.equipmentLinks?.length ?? 0 },
  ],
});

/* ───────────────────────────── Ventas ───────────────────────────── */

const organizaciones = dataset({
  id: "organizaciones",
  modulo: "ventas",
  nombre: "Organizaciones",
  filas: async ({ db, userId, administra }) => {
    const { getOrganizations } = await import("@/lib/data/crm");
    return getOrganizations(administra ? undefined : (userId ?? undefined), undefined, db);
  },
  columnas: [
    { titulo: "Nombre", tipo: "texto", valor: (o) => o.name, ancho: 34 },
    /*
      TEXTO y no número, aunque un RFC de persona moral sean doce caracteres
      con dígitos dentro. Es la razón de que este formato exista: dejado al
      criterio de Excel, un identificador así acaba en notación científica o
      pierde los ceros de la izquierda, y el dato ya no se recupera.
    */
    { titulo: "RFC", tipo: "texto", valor: (o) => o.taxId, ancho: 16 },
    { titulo: "Giro", tipo: "texto", valor: (o) => o.industry },
    { titulo: "Teléfono", tipo: "texto", valor: (o) => o.phone },
    { titulo: "Domicilio", tipo: "texto", valor: (o) => o.address, ancho: 40 },
    { titulo: "Tipo", tipo: "texto", valor: (o) => o.kind },
    { titulo: "Contactos", tipo: "numero", valor: (o) => o.contacts },
    { titulo: "Responsable", tipo: "texto", valor: (o) => o.ownerName },
    { titulo: "Portal", tipo: "si-no", valor: (o) => o.hasPortal },
  ],
});

/* ───────────────────────── Inventario y compras ───────────────────────── */

const refacciones = dataset({
  id: "refacciones",
  modulo: "inventario",
  nombre: "Refacciones",
  filas: async ({ db }) => {
    const { getSpareParts } = await import("@/lib/data/parts");
    return getSpareParts(false, db);
  },
  columnas: [
    { titulo: "N.º de parte", tipo: "texto", valor: (p) => p.partNumber, ancho: 20 },
    { titulo: "Descripción", tipo: "texto", valor: (p) => p.description, ancho: 44 },
    { titulo: "Marca", tipo: "texto", valor: (p) => p.brand },
    { titulo: "Existencias", tipo: "numero", valor: (p) => p.stock },
    { titulo: "Costo MXN", tipo: "moneda", valor: (p) => num(p.costMxn) },
    { titulo: "Precio MXN", tipo: "moneda", valor: (p) => num(p.priceMxn) },
    { titulo: "Activa", tipo: "si-no", valor: (p) => p.active },
  ],
});

const compras = dataset({
  id: "compras",
  modulo: "compras",
  nombre: "Órdenes de compra",
  filas: async ({ sp, db }) => {
    const {
      getPurchaseOrders,
      CAMPOS_ORDEN_ORDENES,
      ORDEN_ORDENES_DEFECTO,
    } = await import("@/lib/data/purchasing");
    const { purchaseOrderStatus } = await import("@/lib/db/schema");
    const { rows } = await getPurchaseOrders(
      { limit: TOPE_FILAS, offset: 0 },
      parseOrden(sp, CAMPOS_ORDEN_ORDENES, ORDEN_ORDENES_DEFECTO),
      {
        estado: parseFiltro(sp.estado, purchaseOrderStatus.enumValues),
        proveedor: sp.proveedor,
      },
      db,
    );
    return rows;
  },
  columnas: [
    { titulo: "Folio", tipo: "texto", valor: (o) => o.reference, ancho: 18 },
    { titulo: "Proveedor", tipo: "texto", valor: (o) => o.supplierName, ancho: 32 },
    { titulo: "Estado", tipo: "texto", valor: (o) => o.status },
    { titulo: "Moneda", tipo: "texto", valor: (o) => o.currency, ancho: 10 },
    { titulo: "Renglones", tipo: "numero", valor: (o) => o.lines },
    { titulo: "Piezas", tipo: "numero", valor: (o) => o.units },
    { titulo: "Recibidas", tipo: "numero", valor: (o) => o.received },
    { titulo: "Total", tipo: "moneda", valor: (o) => o.total },
    { titulo: "Esperada", tipo: "fecha", valor: (o) => dia(o.expectedAt) },
    { titulo: "Creada", tipo: "fecha", valor: (o) => dia(o.createdAt) },
  ],
});

const cuentasPorPagar = dataset({
  id: "cuentas-por-pagar",
  modulo: "pagar",
  nombre: "Cuentas por pagar",
  filas: async ({ sp, db }) => {
    const { getPayables } = await import("@/lib/data/payables");
    // La pantalla enseña dos listas —lo abierto y el archivo—; la descarga se
    // lleva la que se esté mirando, y sin `?archivo=1` lo que se está mirando
    // es lo que se debe.
    return getPayables(
      sp.archivo === "1"
        ? { onlyClosed: true, limit: TOPE_FILAS, offset: 0 }
        : { onlyOpen: true },
      db,
    );
  },
  columnas: [
    { titulo: "Folio", tipo: "texto", valor: (f) => f.reference, ancho: 18 },
    { titulo: "Folio del proveedor", tipo: "texto", valor: (f) => f.supplierFolio, ancho: 20 },
    { titulo: "Proveedor", tipo: "texto", valor: (f) => f.supplierName, ancho: 32 },
    { titulo: "Estado", tipo: "texto", valor: (f) => f.status },
    { titulo: "Moneda", tipo: "texto", valor: (f) => f.currency, ancho: 10 },
    { titulo: "Total", tipo: "moneda", valor: (f) => f.total },
    { titulo: "Pagado", tipo: "moneda", valor: (f) => f.paid },
    // Las tres formas de bajar el saldo van por separado porque son cosas
    // distintas: el pago sale de caja, la nota de crédito no, y el anticipo
    // salió antes de que existiera la factura. Sumarlas en una columna
    // «cubierto» perdería justo la distinción que hace útil el archivo.
    { titulo: "Notas de crédito", tipo: "moneda", valor: (f) => f.credited },
    { titulo: "Anticipos", tipo: "moneda", valor: (f) => f.advanced },
    { titulo: "Saldo", tipo: "moneda", valor: (f) => f.balance },
    { titulo: "Días de atraso", tipo: "numero", valor: (f) => f.daysLate },
    { titulo: "Emitida", tipo: "fecha", valor: (f) => dia(f.issuedAt) },
    { titulo: "Vence", tipo: "fecha", valor: (f) => dia(f.dueAt) },
  ],
});

/* ───────────────────────────── Viáticos ───────────────────────────── */

const viaticos = dataset({
  id: "viaticos",
  modulo: "viaticos",
  nombre: "Viáticos",
  filas: async ({ sp, db, userId, administra }) => {
    const { listViaticos } = await import("@/lib/data/viaticos");
    // El mismo acotado que la pantalla: el ingeniero se lleva los suyos.
    const soloDe = administra ? null : userId;
    return listViaticos(
      soloDe,
      sp.archivo === "1" ? { cerrados: true } : { abiertos: true },
      { limit: TOPE_FILAS, offset: 0 },
      db,
    );
  },
  columnas: [
    { titulo: "Folio", tipo: "texto", valor: (v) => v.reference, ancho: 18 },
    { titulo: "Solicitante", tipo: "texto", valor: (v) => v.solicitante, ancho: 28 },
    /*
      DOS COLUMNAS Y NO UNA «asunto» combinada.

      Quien se lleva esto a Excel filtra por una o por la otra —el contralor
      mira contratos, Ventas mira prospección—, y una sola columna con las dos
      cosas mezcladas obliga a partirla con una fórmula antes de poder usarla.
      Vacío significa «este viaje no era de eso», que es una respuesta.
    */
    { titulo: "Contrato", tipo: "texto", valor: (v) => v.contractNumber, ancho: 20 },
    { titulo: "Prospecto", tipo: "texto", valor: (v) => v.prospecto, ancho: 28 },
    { titulo: "Autoriza", tipo: "texto", valor: (v) => v.aprobador, ancho: 24 },
    { titulo: "Destino", tipo: "texto", valor: (v) => v.destination, ancho: 28 },
    { titulo: "Estado", tipo: "texto", valor: (v) => v.status },
    { titulo: "Salida", tipo: "fecha", valor: (v) => dia(v.departsOn) },
    { titulo: "Regreso", tipo: "fecha", valor: (v) => dia(v.returnsOn) },
    { titulo: "Estimado", tipo: "moneda", valor: (v) => num(v.estimatedMxn) },
    { titulo: "Autorizado", tipo: "moneda", valor: (v) => num(v.authorizedMxn) },
    { titulo: "Comprobado", tipo: "moneda", valor: (v) => v.gastadoMxn },
    { titulo: "Gastos", tipo: "numero", valor: (v) => v.gastos },
  ],
});

/* ═══════════════════════════ El registro ═══════════════════════════ */

export const DATASETS: Dataset[] = [
  tickets,
  equipos,
  clientes,
  contratos,
  organizaciones,
  refacciones,
  compras,
  cuentasPorPagar,
  viaticos,
];

export function datasetPorId(id: string): Dataset | null {
  return DATASETS.find((d) => d.id === id) ?? null;
}
