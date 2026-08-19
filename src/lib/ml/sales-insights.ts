import "server-only";
import type { Block, ProjectionBlock, TrendBlock } from "@/lib/ml/blocks-types";
import type { Insight } from "@/lib/ml/insights";
import { getPipelines } from "@/lib/data/crm";
import {
  getFunnelByStage,
  getMonthlyClosed,
  getRottingDeals,
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
