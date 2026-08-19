import "server-only";
import { cache } from "react";
import type { Block, ProjectionBlock } from "@/lib/ml/blocks-types";
import type { Insight } from "@/lib/ml/insights";
import { getClients, type ClientRow } from "@/lib/data/crm";
import { getContracts } from "@/lib/data/contracts";
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
