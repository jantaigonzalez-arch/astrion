import "server-only";
import { cache } from "react";
import type { Block, TrendBlock, ProjectionBlock } from "@/lib/ml/blocks-types";
import type { Insight } from "@/lib/ml/insights";
import type { DbOrTx } from "@/lib/db";
import { getProfitOverview, type Rates } from "@/lib/data/profitability";
import { getSettings } from "@/lib/data/settings";
import { etiquetaMes } from "@/lib/ml/meses";

/**
 * Rentabilidad, partida en unidades que se pueden mover.
 *
 * ── QUÉ CAMBIA Y POR QUÉ ───────────────────────────────────────────────────
 *
 * La pantalla de Rentabilidad eran cuatro gráficas y una tabla clavadas en un
 * archivo de 446 líneas. Funcionaba y tenía el mismo techo que tenía la capa de
 * análisis antes de `analyses.ts`: no se podía apagar una sin apagar la página,
 * ni llevarse «clientes más rentables» al módulo de Clientes —que es donde
 * alguien la buscaría— porque no existían como cosas separadas en ningún sitio.
 *
 * Aquí cada panel es un análisis con nombre propio, y por tanto se puede
 * colocar, ordenar, apagar y arrastrar a otro módulo como cualquier otro.
 *
 * ── LO QUE NO SE CONVIRTIÓ, Y NO ES UN OLVIDO ──────────────────────────────
 *
 * El detalle paginado por servicio se queda en la pantalla. Un análisis es una
 * AFIRMACIÓN sobre el negocio —«estos cinco clientes concentran el margen»— y
 * una tabla paginada no afirma nada: es una herramienta de consulta, con su
 * ordenamiento, su paginación y su estado en la URL. Meterla en un bloque de
 * dashboard habría producido una caja con veinte filas y un paginador dentro,
 * que es peor en los dos sitios.
 *
 * ── UNA SOLA CONSULTA PARA LOS CUATRO ──────────────────────────────────────
 *
 * `getProfitOverview` ya devolvía todo de un viaje —el histórico se recorre una
 * vez y los cuatro agregados salen del mismo CTE—. Si cada análisis la llamara
 * por su cuenta, un dashboard con los cuatro haría cuatro recorridos completos
 * del histórico para pintar una pantalla. Por eso los cuatro resolutores pasan
 * por `overview()`, que memoiza dentro de la misma petición.
 */

/* ------------------------- La lectura, una vez ------------------------- */

/**
 * El resumen de rentabilidad, calculado UNA vez por petición.
 *
 * ── POR QUÉ NO ES UNA VARIABLE DE MÓDULO ───────────────────────────────────
 *
 * Lo era, con una clave formada por las tarifas y el número de meses, y se
 * soltaba al terminar el ciclo de eventos. El razonamiento escrito entonces
 * decía que la clave impedía que dos empresas compartieran el resultado, y no
 * es así: las tarifas de mano de obra son un ajuste con valores redondos, dos
 * laboratorios pueden tener exactamente las mismas, y ahí la clave coincide.
 * Coincidiendo la clave, la segunda empresa recibía la utilidad de la primera.
 *
 * El ámbito correcto nunca fue temporal sino de petición, que es justo lo que
 * `cache` de React da: cada petición arranca vacía y no ve la de nadie más, así
 * que ninguna clave tiene que llevar el inquilino para estar a salvo.
 *
 * Sigue memoizando lo mismo: los cuatro resolutores comparten la lectura dentro
 * de la pantalla, y los dos horizontes que se piden —doce meses para la
 * tendencia, seis para el resto— son dos entradas distintas, como antes.
 */
const overview = cache(async (meses: number, conexion?: DbOrTx) => {
  const s = await getSettings(conexion);
  const rates: Rates = {
    laborRatePerHour: s.laborRatePerHour,
    laborCostPerHour: s.laborCostPerHour,
  };
  return getProfitOverview({ since: null }, rates, {
    months: meses,
    top: 6,
    conexion,
  });
});

const mes = etiquetaMes;

/* ------------------------- Los cuatro análisis ------------------------- */

/** 1 · La utilidad mes a mes. Historia real, nunca extrapolada. */
export async function profitTrend(conexion?: DbOrTx): Promise<Block[]> {
  const { monthly, totals } = await overview(12, conexion);
  if (monthly.length === 0) return [];
  /*
    El mismo guardia que `profitSplit`, y le faltaba a este.

    Sin él, una empresa recién estrenada dibuja doce barras en CERO con la nota
    puesta —«ingresos contra costos… valuadas con las tarifas vigentes»— y eso
    se lee como «no ganamos nada», que es una afirmación falsa sobre su negocio.
    La causa real es otra: no hay tarifas de mano de obra capturadas, o las
    refacciones consumidas entraron sin precio. Medido contra producción el
    2026-08-25: 3.032 horas de bitácora, tabla `settings` vacía, las 739 líneas
    de refacción importadas sin `unit_price_mxn`. Ingreso calculado: cero.

    Callarse es lo correcto: la caja vacía enseña `watching`, que dice qué
    vigila este análisis, y eso orienta a configurar las tarifas. Un cero no
    orienta a nada porque parece un dato.
  */
  if (totals.revenue <= 0) return [];

  const bloque: TrendBlock = {
    kind: "trend",
    id: "profit.trend",
    title: "Utilidad por mes",
    note:
      "Ingresos contra costos de los servicios facturables, mes a mes. Son " +
      "hechos registrados: horas de bitácora y refacciones consumidas, " +
      "valuadas con las tarifas vigentes.",
    bars: monthly.map((m) => ({
      key: m.month.toISOString(),
      label: mes(m.month),
      value: Math.round(m.revenue),
      stacked: Math.round(m.cost),
    })),
    currency: "MXN",
    legend: ["Ingresos", "Costos"],
    href: "/admin/rentabilidad",
  };
  return [bloque];
}

/** 2 · De dónde sale el margen: refacciones o mano de obra. */
export async function profitSplit(conexion?: DbOrTx): Promise<Block[]> {
  const { totals } = await overview(6, conexion);
  if (totals.revenue <= 0) return [];

  const refacciones = totals.partsRevenue - totals.partsCost;
  const mano = totals.laborRevenue - totals.laborCost;

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "profit.split",
    title: "Origen de la utilidad",
    // Sin banda porque no hay incertidumbre: es aritmética sobre lo registrado.
    // Ver la nota de `ProjectionBlock` sobre por qué eso NO es un pronóstico.
    note:
      "Cuánto del margen viene de vender refacciones y cuánto de las horas. " +
      "Es aritmética sobre lo ya registrado, no una estimación.",
    bars: [
      { key: "parts", label: "Refacciones", value: Math.round(refacciones) },
      { key: "labor", label: "Mano de obra", value: Math.round(mano) },
    ],
    currency: "MXN",
    total: Math.round(totals.profit),
    href: "/admin/rentabilidad",
  };
  return [bloque];
}

/** 3 · Qué clientes concentran el margen. */
export async function topClients(conexion?: DbOrTx): Promise<Block[]> {
  const { byClient } = await overview(6, conexion);
  const conMargen = byClient.filter((c) => c.profit > 0);
  if (conMargen.length === 0) return [];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "profit.clients",
    title: "Clientes más rentables",
    note:
      `Margen acumulado por cliente. ${conMargen.length} clientes con utilidad ` +
      `positiva en el periodo; el reparto dice de quién depende el resultado.`,
    bars: conMargen.slice(0, 6).map((c) => ({
      key: c.clientId,
      label: `${c.services} servicio${c.services === 1 ? "" : "s"}`,
      value: Math.round(c.profit),
    })),
    currency: "MXN",
    href: "/admin/rentabilidad",
  };
  return [bloque];
}

/**
 * 4 · Los servicios que pierden dinero.
 *
 * Este es el único de los cuatro que sale como HALLAZGO y no como gráfica, y la
 * diferencia es de naturaleza: los otros tres describen, este PIDE ACCIÓN. Un
 * servicio con margen negativo es algo que alguien tiene que mirar hoy —se
 * cotizó mal, se fueron las horas, o se regalaron refacciones— y esa clase de
 * afirmación es exactamente lo que el tipo `finding` existe para llevar.
 */
export async function worstServices(conexion?: DbOrTx): Promise<Block[]> {
  const { worst } = await overview(6, conexion);
  const perdidas = worst.filter((s) => s.profit < 0);
  if (perdidas.length === 0) return [];

  const total = perdidas.reduce((a, s) => a + s.profit, 0);

  const hallazgos: Insight[] = [
    {
      id: "profit.worst.total",
      headline: `${perdidas.length} servicio${perdidas.length === 1 ? "" : "s"} cerró con pérdida`,
      because:
        `Suman ${Math.round(Math.abs(total)).toLocaleString("es-MX")} MXN por debajo de costo. ` +
        `El peor es ${perdidas[0].reference}: ${perdidas[0].hours.toFixed(1)} h y ` +
        `${Math.round(perdidas[0].revenue).toLocaleString("es-MX")} MXN facturados contra ` +
        `${Math.round(perdidas[0].cost).toLocaleString("es-MX")} de costo.`,
      tone: "risk",
      // `null` porque es un hecho MEDIDO y no una estimación: estos servicios ya
      // ocurrieron y su margen está calculado, no inferido.
      support: null,
      value: { n: Math.round(Math.abs(total)), unit: "MXN" },
      href: "/admin/rentabilidad",
    },
  ];

  return hallazgos.map((insight) => ({ kind: "finding" as const, insight }));
}
