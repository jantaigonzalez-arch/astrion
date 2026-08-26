import "server-only";
import { cache } from "react";
import type { Block, ProjectionBlock } from "@/lib/ml/blocks-types";
import type { Insight } from "@/lib/ml/insights";
import { getClients, type ClientRow } from "@/lib/data/crm";
import { getContracts } from "@/lib/data/contracts";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { contracts, equipment } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import type { DbOrTx } from "@/lib/db";

/**
 * Clientes: la post-venta, dicha en análisis.
 *
 * Como Ventas, este módulo no tenía ningún análisis escrito a mano. Y a
 * diferencia de Ventas, tampoco tiene pantalla en `SCREENS`: `/admin/clientes`
 * es un listado sin sección de análisis, así que estos tres nacen SOLO en el
 * tablero del módulo. Es la misma forma que ya tienen los de rentabilidad, y el
 * motivo es el mismo: son la lectura de la cartera entera, no una nota al pie de
 * la fila que alguien está mirando.
 *
 * ── QUÉ PREGUNTAS CONTESTAN ────────────────────────────────────────────────
 *
 * Las tres que la post-venta se hace y hoy exigen leer la tabla entera a mano:
 * qué se me vence, quién se quedó callado, y de quién dependo.
 *
 * ── DE QUÉ NO HABLAN, PARA NO CHOCAR CON RENTABILIDAD ──────────────────────
 *
 * «Clientes más rentables» ya existe y vive en el tablero de Rentabilidad: mide
 * MARGEN de servicios facturables —ingresos menos costos, con las tarifas
 * vigentes—. El de aquí mide otra cosa, el valor GANADO en el CRM, que es lo que
 * el cliente ha comprado. Un cliente puede encabezar una lista y no aparecer en
 * la otra, y ese contraste es informativo; lo que no puede es que las dos se
 * llamen igual, así que ésta se llama por lo que mide.
 *
 * ── CUÁL SE PUEDE EJERCITAR SIN NAVEGADOR, Y CUÁLES NO ─────────────────────
 *
 * Solo «contratos por vencer» acepta la conexión por parámetro y por tanto se
 * puede correr desde un script contra una base real. Los otros dos salen de
 * `getClients()`, que además de leer del esquema de la empresa resuelve el
 * nombre del responsable de cada cliente contra la tabla de personas de la
 * PLATAFORMA, y ese camino exige el ámbito de la petición. Abrirlo es un cambio
 * de la capa de datos compartida, no de ésta, así que aquí queda escrito en vez
 * de disimulado: estos dos hoy se comprueban en el navegador.
 */

/* ------------------------- La lectura, una vez ------------------------- */

/**
 * La cartera, leída UNA vez por petición.
 *
 * Dos de los tres análisis salen de `getClients()`, que es una consulta con
 * cinco subconsultas correlacionadas por fila. Sin esto, un tablero con los dos
 * la corre dos veces enteras para pintar una pantalla.
 *
 * ── EL ÁMBITO ES LA PETICIÓN, Y NO ES UN DETALLE ───────────────────────────
 *
 * La primera versión de esto era una variable de módulo que se soltaba al
 * terminar el ciclo de eventos. Memoizaba igual de bien y estaba mal: una
 * variable de módulo vive en el PROCESO, y este servidor atiende a varias
 * empresas a la vez. Entre que una petición llena la variable y el temporizador
 * la limpia, el servidor sigue atendiendo — y la petición de otra empresa que
 * cayera en esa ventana habría recibido la cartera de clientes de la primera.
 *
 * `cache` de React no tiene esa ventana porque el ámbito no es temporal sino de
 * petición: cada una arranca con la caché vacía y no ve la de nadie más. Que la
 * corrección salga gratis en rendimiento es la razón para no dudarlo.
 */
const cartera = cache((): Promise<ClientRow[]> => getClients());

const mxn = (n: number) => Math.round(n).toLocaleString("es-MX");

/** El nombre del cliente en un contrato, con los tres sitios donde puede estar. */
const nombreEnContrato = (c: {
  client: { company: string | null; name: string | null; email: string } | null;
}) => c.client?.company ?? c.client?.name ?? c.client?.email ?? "sin cliente";

/* ------------------------- 1 · Lo que se vence ------------------------- */

/** Cuántos días faltan para una fecha `YYYY-MM-DD`, contados en días enteros. */
function diasHasta(fecha: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  // Partida a mano y no `new Date(fecha)`: una fecha ISO suelta se interpreta
  // en UTC, y en un huso al oeste «2026-09-01» se convierte en el 31 de agosto.
  // Un día de menos basta para que un contrato aparezca vencido la víspera.
  const [a, m, d] = fecha.split("-").map(Number);
  return Math.round((new Date(a, m - 1, d).getTime() - hoy.getTime()) / 86_400_000);
}

/**
 * Contratos que vencen pronto.
 *
 * Sesenta días y no treinta: renovar un contrato de servicio exige hablar con
 * el cliente, cotizar y firmar, y avisar con un mes deja la conversación
 * empezando tarde. Sesenta es el plazo en el que todavía se puede perder sin
 * que sea una urgencia.
 *
 * Los ya vencidos quedan fuera a propósito. Son un problema distinto —no se
 * previene, se resuelve— y mezclarlos aquí subiría el conteo con casos que no
 * se arreglan renovando. El día que haga falta, es su propio análisis.
 */
export async function expiringContracts(conexion?: DbOrTx): Promise<Block[]> {
  const contratos = await getContracts(undefined, conexion);

  const porVencer = contratos
    .filter((c) => c.endDate)
    .map((c) => ({ c, dias: diasHasta(c.endDate!) }))
    .filter(({ dias }) => dias >= 0 && dias <= 60)
    .sort((x, y) => x.dias - y.dias);

  if (porVencer.length === 0) return [];

  const primero = porVencer[0];
  const equipos = porVencer.reduce((a, { c }) => a + c.equipmentLinks.length, 0);

  const insight: Insight = {
    id: "clients.expiring",
    headline:
      `${porVencer.length} contrato${porVencer.length === 1 ? "" : "s"} vence` +
      `${porVencer.length === 1 ? "" : "n"} en los próximos 60 días`,
    because:
      `El más próximo es ${primero.c.number}, de ${nombreEnContrato(primero.c)}, ` +
      (primero.dias === 0 ? "que vence hoy." : `en ${primero.dias} día${primero.dias === 1 ? "" : "s"}.`) +
      (equipos > 0
        ? ` Entre todos amparan ${equipos} equipo${equipos === 1 ? "" : "s"}.`
        : ""),
    tone: "watch",
    support: null,
    value: { n: porVencer.length, unit: "contratos" },
    href: "/admin/contratos",
  };

  return [{ kind: "finding", insight }];
}

/* ------------------------- 2 · Quién se quedó callado ------------------------- */

/**
 * Clientes con equipo instalado que llevan medio año sin abrir un servicio.
 *
 * El silencio de un cliente con equipo NO es una buena noticia y es invisible en
 * cualquier listado: no aparece en la cola porque justamente no hay tickets, y
 * en la tabla de clientes hay que ordenar por última visita y saber qué se
 * busca. O el equipo dejó de usarse, o lo está atendiendo alguien más.
 *
 * Se exige equipo instalado para no delatar como «callado» a quien nunca tuvo
 * nada que reportar: un cliente sin parque instalado no tiene por qué llamar, y
 * meterlo aquí llenaría el hallazgo de casos que no son nada.
 */
export async function quietClients(): Promise<Block[]> {
  const clientes = await cartera();
  const corte = new Date();
  corte.setMonth(corte.getMonth() - 6);

  const callados = clientes
    .filter((c) => c.equipment > 0 && c.openTickets === 0)
    .filter((c) => !c.lastTicketAt || c.lastTicketAt < corte)
    .sort((a, b) => {
      // Los que nunca abrieron uno van primero: es el caso más extremo del
      // mismo silencio, y ordenarlos por una fecha que no existe los mandaría
      // al final justo por eso.
      if (!a.lastTicketAt) return -1;
      if (!b.lastTicketAt) return 1;
      return a.lastTicketAt.getTime() - b.lastTicketAt.getTime();
    });

  if (callados.length === 0) return [];

  const primero = callados[0];
  const equipos = callados.reduce((a, c) => a + c.equipment, 0);

  const insight: Insight = {
    id: "clients.quiet",
    headline:
      `${callados.length} cliente${callados.length === 1 ? "" : "s"} con equipo ` +
      "instalado lleva medio año sin pedir servicio",
    because:
      `${primero.name} tiene ${primero.equipment} equipo${primero.equipment === 1 ? "" : "s"} y ` +
      (primero.lastTicketAt
        ? `su último servicio fue el ${primero.lastTicketAt.toLocaleDateString("es-MX")}.`
        : "nunca ha abierto un servicio.") +
      ` Entre todos suman ${equipos} equipo${equipos === 1 ? "" : "s"} sin visitas.`,
    tone: "watch",
    support: null,
    value: { n: callados.length, unit: "clientes" },
    href: "/admin/clientes",
  };

  return [{ kind: "finding", insight }];
}

/* ------------------------- 3 · De quién depende la cartera ------------------------- */

/**
 * Cuánto ha comprado cada cliente, y cuán repartido está.
 *
 * La cifra es el valor GANADO en el CRM, no el margen: ver la nota de cabecera
 * sobre por qué no es «clientes más rentables». Lo que contesta es de quién
 * depende el negocio, que es una pregunta de riesgo antes que de utilidad.
 */
export async function clientConcentration(): Promise<Block[]> {
  const clientes = await cartera();
  const conCompra = clientes
    .filter((c) => c.wonValue > 0)
    .sort((a, b) => b.wonValue - a.wonValue);

  if (conCompra.length === 0) return [];

  const total = conCompra.reduce((a, c) => a + c.wonValue, 0);
  const primeros = conCompra.slice(0, 6);
  const peso = Math.round((primeros.reduce((a, c) => a + c.wonValue, 0) / total) * 100);

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "clients.concentration",
    title: "De qué clientes viene el negocio",
    note:
      `Valor ganado acumulado por cliente. ${conCompra.length} cliente` +
      `${conCompra.length === 1 ? "" : "s"} con compra registrada, ` +
      `${mxn(total)} MXN en total` +
      (conCompra.length > primeros.length
        ? `; los ${primeros.length} de la gráfica concentran el ${peso} %.`
        : ".") +
      " Es lo comprado, no el margen que dejó.",
    bars: primeros.map((c) => ({
      key: c.id,
      label: c.name,
      value: Math.round(c.wonValue),
    })),
    currency: "MXN",
    total: Math.round(total),
    href: "/admin/clientes",
  };

  return [bloque];
}

/* ------------------------- 4 · De qué es el parque instalado ------------------------- */

/**
 * Las marcas de los equipos que la empresa tiene bajo su cuidado.
 *
 * El «¿de qué?» de la post-venta, y en una empresa de cromatografía decide
 * cosas concretas: a qué capacitación se manda al equipo, qué refacciones tiene
 * sentido tener en almacén y con qué fabricante conviene negociar.
 *
 * Cuenta EQUIPOS y no módulos. Un equipo es lo que se atiende y lo que se
 * contrata; los módulos son sus piezas, y contarlos pondría arriba a la marca
 * que más piezas monta por sistema en vez de a la más instalada.
 */
export async function installedBase(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  // Se agrupa por la marca EN MAYÚSCULAS y se etiqueta con la grafía más larga
  // de cada grupo. Las altas manuales usan el catálogo `EQUIPMENT_BRANDS`, pero
  // las importadas traen lo que viniera en el CSV, y «Waters» y «WATERS» como
  // dos barras contiguas no son un dato: son la misma marca contada dos veces.
  //
  // No se va más allá de las mayúsculas a propósito. En esta base conviven
  // «COPLEY» y «Copley Scientific», que un parecido difuso fusionaría — y el
  // día que fusione dos marcas que sí son distintas, el error es invisible.
  // Eso se corrige en el catálogo de equipos, no adivinando aquí.
  const filas = await db
    .select({
      marca: sql<string>`max(${equipment.brand})`,
      total: sql<number>`count(*)::int`,
    })
    .from(equipment)
    .groupBy(sql`upper(${equipment.brand})`)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  const conMarca = filas.filter((f) => f.marca && f.marca !== "N/D");
  if (conMarca.length === 0) return [];

  const total = conMarca.reduce((a, f) => a + f.total, 0);
  const primera = conMarca[0];
  const sinMarca = filas.filter((f) => !f.marca || f.marca === "N/D").reduce((a, f) => a + f.total, 0);

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "clients.installed-base",
    title: "De qué marcas es el parque instalado",
    note:
      `${total} equipo${total === 1 ? "" : "s"} con marca identificada. ` +
      `${primera.marca} es ${Math.round((primera.total / total) * 100)} % del parque ` +
      `(${primera.total}).` +
      (sinMarca > 0 ? ` Otros ${sinMarca} no la traen capturada.` : ""),
    bars: conMarca.map((f) => ({
      key: f.marca ?? "—",
      label: f.marca ?? "—",
      value: f.total,
    })),
    total,
    href: "/admin/equipos",
  };
  return [bloque];
}

/* ------------------------- 5 · Quién trajo la cartera ------------------------- */

/**
 * Los contratos vigentes, por el vendedor que los firmó.
 *
 * El «¿quién?» de la post-venta: quién sostiene la cartera, que no es lo mismo
 * que quién vendió este trimestre —eso lo dice «quién está vendiendo», en el
 * módulo de Ventas—. Un vendedor puede no cerrar nada nuevo y seguir siendo el
 * responsable de la mitad de los contratos vivos.
 *
 * ── POR QUÉ HASTA HOY ESTABA MUDO ──────────────────────────────────────────
 *
 * `sales_rep_id` estaba en 0 de 54 contratos. El dato SÍ venía en el volcado
 * del sistema anterior —la columna «Vendedor»— pero el importador lo escribía
 * dentro de las NOTAS del contrato, como texto: «Vendedor: Rodrigo Montero
 * Mondragón». Legible para una persona, invisible para una consulta.
 *
 * Es el mismo patrón que dejó 633 tickets sin técnico: la dimensión llegó como
 * prosa y nunca se volvió columna. Se corrigió el 2026-08-25 en
 * `scripts/import-legacy.ts`; este bloque empieza a hablar con la reimportación.
 */
export async function contractsByRep(conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: contracts.salesRepId,
      nombre: users.name,
      total: sql<number>`count(*)::int`,
      importe: sql<number>`coalesce(sum(${contracts.amountMxn}), 0)::float`,
    })
    .from(contracts)
    .leftJoin(users, eq(contracts.salesRepId, users.id))
    .where(isNotNull(contracts.salesRepId))
    .groupBy(contracts.salesRepId, users.name)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  if (filas.length === 0) return [];

  const [{ huerfanos = 0 } = {}] = await db
    .select({ huerfanos: sql<number>`count(*)::int` })
    .from(contracts)
    .where(sql`${contracts.salesRepId} is null`);

  const total = filas.reduce((a, f) => a + f.total, 0);
  const dinero = filas.reduce((a, f) => a + f.importe, 0);
  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "clients.by-rep",
    title: "Quién sostiene la cartera",
    note: [
      `${total} contrato${total === 1 ? "" : "s"} con vendedor asignado` +
        (dinero > 0 ? `, ${Math.round(dinero).toLocaleString("es-MX")} MXN` : "") +
        `. ${primero.nombre ?? "—"} lleva ${primero.total}.`,
      huerfanos > 0
        ? `${huerfanos} contrato${huerfanos === 1 ? "" : "s"} sin vendedor no entra${huerfanos === 1 ? "" : "n"} en el reparto.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    bars: filas.map((f) => ({
      key: f.id ?? "—",
      label: (f.nombre ?? "—").split(" ")[0],
      value: f.total,
    })),
    total,
    href: "/admin/contratos",
  };
  return [bloque];
}
