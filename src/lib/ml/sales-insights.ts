import "server-only";
import type { Block, ProjectionBlock, TrendBlock } from "@/lib/ml/blocks-types";
import type { Insight } from "@/lib/ml/insights";
import { getPipelines } from "@/lib/data/crm";
import {
  getAvgCycleDays,
  getFunnelByStage,
  getLostReasons,
  getMonthlyClosed,
  getOwnerRanking,
  getRottingDeals,
  getSourceBreakdown,
} from "@/lib/data/crm-insights";
import { etiquetaMesISO } from "@/lib/ml/meses";
import type { DbOrTx } from "@/lib/db";

/**
 * Ventas, dicho en análisis.
 *
 * El módulo de Ventas era el único del catálogo sin un solo análisis escrito a
 * mano: su pantalla y su tablero solo tenían lo que el usuario configurara como
 * pregunta en Inteligencia. Eso deja el peor estreno posible —un botón de
 * «Crear tablero» que lleva a una lista vacía— justo en el módulo donde más
 * gente entra a preguntarse cómo va el mes.
 *
 * ── DE DÓNDE SALE EL EMBUDO, Y POR QUÉ NO SE CREA NADA ─────────────────────
 *
 * El embudo se lee del PRIMER pipeline activo, con `getPipelines()`. Existe
 * `ensureDefaultPipeline()`, que además lo crea si falta, y usarla aquí habría
 * sido el error: un análisis es una lectura, y resolver el tablero de Ventas no
 * puede tener como efecto secundario escribir un pipeline y seis etapas en la
 * base de una empresa que todavía no usa el CRM. Sin pipeline, estos análisis
 * no dicen nada — que es exactamente lo que hay que decir.
 *
 * ── POR QUÉ NINGUNO ES UN PRONÓSTICO ───────────────────────────────────────
 *
 * Ni siquiera el embudo ponderado, que es lo más parecido a uno. Multiplicar el
 * valor de cada negocio por la probabilidad de su etapa es ARITMÉTICA sobre
 * hechos registrados: no hay modelo detrás, ni banda, ni casos históricos que la
 * sostengan. En la taxonomía de `blocks-types.ts` eso es una proyección, y
 * declararla `forecast` habría exigido inventarle una banda — enseñar certeza
 * medida donde solo hay una regla de tres.
 *
 * ── SE PUEDEN EJERCITAR SIN NAVEGADOR ──────────────────────────────────────
 *
 * Los tres aceptan la conexión y la bajan hasta la consulta, así que se pueden
 * correr desde un script contra una base real. Es lo mismo que hace la capa de
 * colocaciones y por el mismo motivo: un análisis que solo se puede comprobar
 * haciendo clic es un análisis que no se comprueba, y estos afirman cosas sobre
 * el dinero abierto de una empresa.
 *
 * ── LA MONEDA SE DICE, NO SE ESCONDE ───────────────────────────────────────
 *
 * Las consultas del CRM suman en pesos y DEJAN FUERA los negocios en dólares
 * sin tipo de cambio capturado —no se pueden convertir sin inventar la cifra—.
 * Un total que calla esa exclusión es un total que miente por omisión, así que
 * cuando hay negocios sin convertir la nota lo dice y da el número.
 */

/** El embudo vive en un pipeline. Sin ninguno, no hay nada que contar. */
async function pipelineId(conexion?: DbOrTx): Promise<string | null> {
  const [primero] = await getPipelines(conexion);
  return primero?.id ?? null;
}

const mxn = (n: number) => Math.round(n).toLocaleString("es-MX");

/**
 * Cuántos negocios quedaron fuera del total por no poderse convertir.
 *
 * En una función porque las tres consultas del CRM devuelven el mismo contador
 * con el mismo nombre, y la frase que lo explica tiene que ser la misma en los
 * tres bloques: si un tablero avisa de la exclusión con dos redacciones
 * distintas, parecen dos problemas.
 */
function avisoDeMoneda(sinConvertir: number): string | null {
  if (sinConvertir <= 0) return null;
  return (
    `${sinConvertir} negocio${sinConvertir === 1 ? "" : "s"} en dólares sin tipo de ` +
    `cambio capturado queda${sinConvertir === 1 ? "" : "n"} fuera de la suma.`
  );
}

/* ------------------------- 1 · El embudo abierto ------------------------- */

/**
 * Cuánto hay abierto y en qué etapa está.
 *
 * Enseña el valor CRUDO por etapa y reserva el ponderado para la nota, no al
 * revés. El ponderado es mejor estimador del cierre, pero peor gráfica: dos
 * etapas con el mismo dinero abierto salen de alturas distintas y la forma del
 * embudo —que es lo que se viene a ver— deja de leerse. El número que corrige
 * el optimismo va escrito al lado, que es donde no engaña a nadie.
 */
export async function salesFunnel(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const etapas = await getFunnelByStage(id, undefined, conexion);
  const conNegocios = etapas.filter((e) => e.count > 0);
  if (conNegocios.length === 0) return [];

  const total = conNegocios.reduce((a, e) => a + Number(e.value), 0);
  const ponderado = conNegocios.reduce((a, e) => a + e.weighted, 0);
  const negocios = conNegocios.reduce((a, e) => a + e.count, 0);
  const aviso = avisoDeMoneda(conNegocios.reduce((a, e) => a + e.sinConvertir, 0));

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "sales.funnel",
    title: "Lo que hay abierto, por etapa",
    note: [
      `${negocios} negocio${negocios === 1 ? "" : "s"} abierto${negocios === 1 ? "" : "s"} ` +
        `por ${mxn(total)} MXN. Ponderado por la probabilidad de cada etapa, ${mxn(ponderado)}.`,
      "Es aritmética sobre lo registrado, no una estimación de un modelo.",
      aviso,
    ]
      .filter(Boolean)
      .join(" "),
    bars: conNegocios.map((e) => ({
      key: e.stageId,
      label: e.name,
      value: Math.round(Number(e.value)),
    })),
    currency: "MXN",
    total: Math.round(total),
    href: "/admin/crm",
  };
  return [bloque];
}

/* ------------------------- 2 · Lo que se cierra ------------------------- */

/**
 * El valor ganado mes a mes.
 *
 * Solo lo GANADO en las barras, con lo perdido contado en la nota. Apilar las
 * dos series habría sido tentador y equivocado: lo ganado es dinero y lo
 * perdido, tal como lo devuelve la consulta, es un conteo de negocios. Dos
 * unidades en una barra apilada producen una altura que no significa nada.
 */
export async function salesTrend(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const meses = await getMonthlyClosed(id, undefined, conexion);
  if (meses.length === 0) return [];

  const ganados = meses.reduce((a, m) => a + m.wonCount, 0);
  const perdidos = meses.reduce((a, m) => a + m.lostCount, 0);
  const cerrados = ganados + perdidos;

  const bloque: TrendBlock = {
    kind: "trend",
    id: "sales.trend",
    title: "Valor ganado por mes",
    note:
      `Últimos doce meses: ${ganados} negocio${ganados === 1 ? "" : "s"} ganado` +
      `${ganados === 1 ? "" : "s"} y ${perdidos} perdido${perdidos === 1 ? "" : "s"}` +
      (cerrados > 0
        ? `, una tasa de cierre del ${Math.round((ganados / cerrados) * 100)} %.`
        : ".") +
      " Las barras son solo lo ganado; lo perdido no tiene un importe comparable.",
    bars: meses.map((m) => ({
      key: m.month,
      label: etiquetaMesISO(m.month),
      value: Math.round(Number(m.wonValue)),
    })),
    currency: "MXN",
    href: "/admin/crm/informes",
  };
  return [bloque];
}

/* ------------------------- 3 · Lo que se está enfriando ------------------------- */

/**
 * Negocios parados más tiempo del que su etapa admite.
 *
 * Sale como HALLAZGO y no como gráfica por la misma razón que «servicios que
 * perdieron dinero» en rentabilidad: los otros dos describen, este pide acción
 * hoy. Y el umbral no lo pone este código —lo pone `rottingDays` de cada
 * etapa—, así que la afirmación es del negocio y no nuestra: cuánto puede estar
 * quieta una cotización lo decide quien configuró el embudo.
 */
export async function rottingDeals(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const parados = await getRottingDeals(id, undefined, conexion);
  if (parados.length === 0) return [];

  // Vienen ordenados por antigüedad de movimiento: el primero es el más quieto.
  const peor = parados[0];
  const total = parados.reduce((a, d) => a + Number(d.valueMxn ?? 0), 0);

  const insight: Insight = {
    id: "sales.rotting",
    headline:
      `${parados.length} negocio${parados.length === 1 ? "" : "s"} lleva` +
      `${parados.length === 1 ? "" : "n"} parado${parados.length === 1 ? "" : "s"} ` +
      "más de lo que su etapa admite",
    because:
      `El más quieto es ${peor.reference}: ${peor.idleDays} días sin movimiento en ` +
      `«${peor.stageName}», que admite ${peor.rottingDays}.` +
      (total > 0 ? ` Entre todos suman ${mxn(total)} MXN abiertos.` : ""),
    tone: "risk",
    // Un hecho medido —los días de quietud están registrados—, no una
    // estimación. Ver la nota de `Insight.support`.
    support: null,
    ...(total > 0 ? { value: { n: Math.round(total), unit: "MXN" } } : {}),
    href: "/admin/crm",
  };

  return [{ kind: "finding", insight }];
}

/* =========================================================================
 * Lo que estaba clavado en `/admin/crm/informes`
 *
 * Cuatro informes escritos hace tiempo, correctos, y encerrados en una página:
 * ranking de vendedores, motivos de pérdida, origen de las oportunidades y
 * duración del ciclo. Quien componía un tablero de Ventas no podía ponerlos, y
 * quien los quería tenía que acordarse de que esa página existe.
 *
 * Es exactamente el caso que ya se resolvió con Rentabilidad —«cuatro gráficas
 * clavadas en un archivo de 446 líneas»— y se resuelve igual: la consulta no se
 * toca, se le pone nombre propio y se la deja colocar. La página sigue como
 * está; estos bloques la leen, no la sustituyen.
 * ========================================================================= */

/* ------------------------- 4 · Quién vende ------------------------- */

/**
 * El ranking de vendedores por monto ganado.
 *
 * Primero de su clase en el catálogo junto con los de Servicio: hasta hoy
 * ningún análisis agrupaba por persona. La consulta ya existía y llevaba meses
 * contestando esta pregunta en una página que casi nadie abre.
 *
 * Ordena por MONTO y no por número de negocios, y la nota da los dos. Son
 * rankings distintos —quien cierra muchos negocios pequeños no es quien más
 * factura— y elegir uno solo para la gráfica obliga a decir cuál: el dinero,
 * que es de lo que responde un vendedor.
 */
export async function salesByOwner(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const filas = await getOwnerRanking(id, conexion);
  const conGanados = filas.filter((f) => Number(f.wonValue) > 0);
  if (conGanados.length === 0) return [];

  const total = conGanados.reduce((a, f) => a + Number(f.wonValue), 0);
  const primero = conGanados[0];
  const abiertos = filas.reduce((a, f) => a + f.openCount, 0);

  const bloque: ProjectionBlock = {
    kind: "projection",
    title: "Quién está vendiendo",
    id: "sales.by-owner",
    note:
      `${mxn(total)} MXN ganados entre ${conGanados.length} vendedor` +
      `${conGanados.length === 1 ? "" : "es"}. ${primero.name ?? "Sin dueño"} lleva ` +
      `${mxn(Number(primero.wonValue))} en ${primero.wonCount} negocio` +
      `${primero.wonCount === 1 ? "" : "s"}.` +
      (abiertos > 0 ? ` Quedan ${abiertos} negocios abiertos sin cerrar.` : ""),
    bars: conGanados.map((f) => ({
      key: f.ownerId ?? "—",
      label: (f.name ?? "Sin dueño").split(" ")[0],
      value: Math.round(Number(f.wonValue)),
    })),
    currency: "MXN",
    total: Math.round(total),
    href: "/admin/crm/informes",
  };
  return [bloque];
}

/* ------------------------- 5 · Por qué se pierde ------------------------- */

/**
 * Los motivos de pérdida, por frecuencia.
 *
 * Es el análisis más incómodo del módulo y por eso vale: un embudo enseña lo
 * que entra, este enseña por dónde se va. La nota da el DINERO perdido además
 * del conteo, porque diez negocios pequeños perdidos por precio y uno grande
 * perdido por plazo piden decisiones opuestas.
 *
 * Solo cuenta los perdidos CON motivo capturado. Los que se cerraron sin
 * escribir por qué no se reparten entre los motivos conocidos —sería inventar
 * la razón— y la nota dice cuántos son: si son la mayoría, el bloque está
 * describiendo una minoría y hay que saberlo.
 */
export async function salesLostReasons(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const filas = await getLostReasons(id, undefined, conexion);
  if (filas.length === 0) return [];

  const conMotivo = filas.reduce((a, f) => a + f.count, 0);
  const dinero = filas.reduce((a, f) => a + Number(f.value), 0);
  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "sales.lost-reasons",
    title: "Por qué se pierden los negocios",
    note:
      `${conMotivo} negocio${conMotivo === 1 ? "" : "s"} perdido` +
      `${conMotivo === 1 ? "" : "s"} con motivo capturado, ${mxn(dinero)} MXN. ` +
      `El más repetido es «${primero.reason}» (${primero.count}). ` +
      "Los perdidos sin motivo escrito no se reparten aquí.",
    bars: filas.map((f) => ({
      key: f.reason ?? "—",
      label: f.reason ?? "—",
      value: f.count,
      // Perder no es una serie más: se pinta como estado. Ver `Bar.alert`.
      alert: true,
    })),
    href: "/admin/crm/informes",
  };
  return [bloque];
}

/* ------------------------- 6 · De dónde salen ------------------------- */

/**
 * De dónde vienen las oportunidades.
 *
 * Contesta la pregunta que decide el presupuesto de marketing: si el 70 % nace
 * de referencias y nada de la web, el sitio no está trayendo negocio por más
 * visitas que reporte.
 */
export async function salesBySource(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const filas = (await getSourceBreakdown(id, conexion)).filter((f) => f.source);
  if (filas.length === 0) return [];

  const total = filas.reduce((a, f) => a + f.count, 0);
  const primero = filas[0];

  const bloque: ProjectionBlock = {
    kind: "projection",
    id: "sales.by-source",
    title: "De dónde vienen las oportunidades",
    note:
      `${total} negocio${total === 1 ? "" : "s"} con origen capturado. ` +
      `${Math.round((primero.count / total) * 100)} % viene de «${primero.source}», ` +
      `y suma ${mxn(Number(primero.value))} MXN.`,
    bars: filas.map((f) => ({
      key: f.source ?? "—",
      label: f.source ?? "—",
      value: f.count,
    })),
    href: "/admin/crm/informes",
  };
  return [bloque];
}

/* ------------------------- 7 · Cuánto tarda ------------------------- */

/**
 * Cuántos días tarda un negocio en cerrarse.
 *
 * Sale como HALLAZGO y no como gráfica porque es UN número, y un número solo no
 * es una barra: dibujar una sola columna es enseñar un dato con la ceremonia de
 * una serie. Como hallazgo se lee en una línea, que es lo que es.
 *
 * `tone: "neutral"` y no una alerta: no hay umbral que decida cuándo un ciclo
 * es demasiado largo —depende del producto y del sector— y pintar de rojo un
 * número sin criterio es inventar una alarma.
 */
export async function salesCycle(conexion?: DbOrTx): Promise<Block[]> {
  const id = await pipelineId(conexion);
  if (!id) return [];

  const dias = await getAvgCycleDays(id, undefined, conexion);
  if (dias <= 0) return [];

  const insight: Insight = {
    id: "sales.cycle",
    headline: `Un negocio tarda ${dias} día${dias === 1 ? "" : "s"} en cerrarse, de media`,
    because:
      "Promedio entre la creación y el cierre de los negocios ya cerrados, " +
      "ganados y perdidos. Es una media sobre hechos, no una estimación.",
    tone: "neutral",
    support: null,
    value: { n: dias, unit: "días" },
    href: "/admin/crm/informes",
  };
  return [{ kind: "finding", insight }];
}
