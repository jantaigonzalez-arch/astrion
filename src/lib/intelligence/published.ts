import "server-only";
import type { DbOrTx } from "@/lib/db";
import type { Block, ForecastBlock } from "@/lib/ml/blocks-types";
import type { Analysis } from "@/lib/ml/analyses";
import type { Insight } from "@/lib/ml/insights";
import { servedQuestions, tieneCifra, type PreguntaServida } from "./serving";

/**
 * Cada pregunta del usuario, publicada como ANÁLISIS de su módulo.
 *
 * Este archivo es el lado de Análisis de la frontera que define `serving.ts`:
 * recibe hechos y los convierte en bloques con la certeza que les corresponde.
 * No consulta tablas de modelos ni sabe de estados de entrenamiento — pregunta
 * una vez y traduce.
 *
 * ── SE PUBLICA DESDE QUE SE CREA ───────────────────────────────────────────
 *
 * Antes solo salían las preguntas con modelo en producción, y el resto no
 * existía para el resto del sistema. Era coherente y era poco útil: quien
 * configuraba una pregunta la perdía de vista hasta que alguien la entrenara y
 * la promoviera, y mientras tanto la pantalla del módulo no daba ninguna señal
 * de que hubiera algo en camino.
 *
 * Ahora se publica siempre, y lo que cambia con el estado es QUÉ SE DICE:
 *
 *   sirviendo     → un pronóstico, con su banda y su gráfica.
 *   vencido       → el mismo pronóstico, marcado como caducado.
 *   lista         → un hecho: está aprobada y espera decisión.
 *   sin-datos     → un hecho: falta historia, y cuánta.
 *   no-responde   → un hecho: se midió y no aporta.
 *   sin-entrenar  → un hecho: está configurada y sin entrenar.
 *
 * ── Y NUNCA SE INVENTA UNA CIFRA PARA RELLENAR ─────────────────────────────
 *
 * Los cuatro estados sin pronóstico salen como HALLAZGO (`finding`) y no como
 * pronóstico vacío. No es una decisión de dibujo: en la taxonomía de bloques,
 * `forecast` obliga a llevar banda y casos que la sostienen, y `finding` con
 * `support: null` significa «esto es un hecho medido, no una estimación».
 *
 * «Tu pregunta necesita ocho meses más de historia» ES un hecho medido. Meterlo
 * en un pronóstico con valor cero y banda cero habría sido usar el tipo que
 * promete certeza para decir que no hay ninguna — exactamente lo que la
 * taxonomía existe para impedir.
 */

/** Módulo del catálogo → pantalla donde se publica. */
export const MODULE_SCREEN: Record<string, string> = {
  pagos: "/admin/compras/cuentas-por-pagar",
  refacciones: "/admin/refacciones",
  servicio: "/admin/tickets",
  ventas: "/admin/crm",
  // `equipos` no tiene listado propio —solo la ficha `/admin/equipos/<id>`— y un
  // pronóstico de flota no pertenece a la ficha de un equipo. Se publica en la
  // cola de servicio, que es donde alguien decide a qué equipo ir. El día que
  // haya una pantalla de parque instalado, esto se mueve aquí y en un solo sitio.
  equipos: "/admin/tickets",
};

/**
 * Los análisis que salen de las preguntas del usuario.
 *
 * `id` con prefijo `q.` para que no pueda chocar con uno escrito a mano y para
 * reconocer de un vistazo, en la tabla de colocaciones, de dónde salió cada fila.
 */
export async function questionAnalyses(conexion?: DbOrTx): Promise<Analysis[]> {
  const preguntas = await servedQuestions(conexion);

  return preguntas.map((q): Analysis => {
    const margen =
      q.toleranceKind === "relative" ? `±${q.tolerance} %` : `±${q.tolerance} ${q.unit}`;

    return {
      id: `q.${q.slug}`,
      // El nombre que escribió el usuario, no uno del sistema. Es su análisis.
      label: q.label,
      watching: [q.question, `Margen declarado: ${margen}`],
      // El TIPO declarado es el de mayor incertidumbre que PUEDE producir, no el
      // que produce hoy. Quien configura tiene que saber que aquí puede aparecer
      // una estimación, aunque ahora mismo solo salga un aviso de que falta
      // historia — si no, el día que empiece a estimar sería una sorpresa.
      kind: "forecast",
      defaultScreen: MODULE_SCREEN[q.module] ?? null,
      // Detrás de los análisis escritos a mano de la pantalla: los hallazgos
      // piden acción hoy y un pronóstico es contexto. Se puede arrastrar desde
      // la pantalla de configuración.
      defaultPosition: 50,
      // El permiso pertenece al DATO. Lo que sale de Cuentas por pagar son
      // saldos de proveedores, y eso no lo ve soporte viva donde viva el bloque.
      adminOnly: q.module === "pagos",
      resolve: async () => bloquesDe(q),
    };
  });
}

/* ------------------------- La traducción ------------------------- */

async function bloquesDe(q: PreguntaServida): Promise<Block[]> {
  return tieneCifra(q.estado) && q.puntos.length > 0
    ? [pronostico(q)]
    : [{ kind: "finding", insight: pendiente(q) }];
}

function pronostico(q: PreguntaServida): ForecastBlock {
  const primero = q.puntos[0];
  const vencido = q.estado === "vencido";

  const serie = q.puntos.map((p) => ({
    at: p.period,
    value: p.value,
    lower: p.lower ?? p.value,
    upper: p.upper ?? p.value,
  }));

  return {
    kind: "forecast",
    id: `q.${q.slug}`,
    title: q.label,
    note: [
      q.question,
      vencido
        ? `⚠ ${q.porque}`
        : "La banda se abre con la distancia: cada periodo usa como dato lo que estimó el anterior.",
      // El CUMPLIMIENTO va en la nota y no en una esquina: es lo que convierte
      // el número en algo con historial. «Acertó 4 de 5» dice más sobre si
      // creerle que cualquier métrica del backtest, porque es sobre periodos que
      // ya ocurrieron DESPUÉS de haberlos prometido.
      q.cumplimiento
        ? `De los ${q.cumplimiento.medidos} periodos ya cerrados, acertó ${q.cumplimiento.dentro} dentro del margen.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    // El PRIMER periodo es el valor destacado: es el que alguien lee si no mira
    // la gráfica, y el único que no arrastra el error de otra estimación.
    value: Math.round(primero.value),
    unit: q.unit,
    band: {
      lower: Math.round(primero.lower ?? primero.value),
      upper: Math.round(primero.upper ?? primero.value),
    },
    support: Number(q.metrics?.n_train ?? q.historia?.periodos ?? 0),
    model: { template: q.slug, version: q.model?.version ?? 0 },
    href: "/admin/inteligencia",
    series: serie,
    history: q.cola,
  };
}

/**
 * Lo que se dice cuando todavía no hay número.
 *
 * `support: null` a propósito: marca que esto es un HECHO MEDIDO y no una
 * estimación. Es la misma distinción que el tipo `Insight` ya hacía para todo lo
 * demás, y aquí es justo la que hay que respetar — el estado de una pregunta se
 * sabe con certeza, aunque la pregunta todavía no se pueda contestar.
 */
function pendiente(q: PreguntaServida): Insight {
  const tono = {
    "sin-entrenar": "neutral",
    "sin-datos": "neutral",
    "no-responde": "watch",
    lista: "good",
    sirviendo: "neutral",
    vencido: "watch",
  } as const;

  const titular = {
    "sin-entrenar": `«${q.label}» está configurada y sin entrenar`,
    "sin-datos": `«${q.label}» todavía no se puede responder`,
    "no-responde": `«${q.label}» no se puede responder con estos datos`,
    lista: `«${q.label}» está lista para ponerse a servir`,
    sirviendo: `«${q.label}» está sirviendo, sin pronóstico emitido`,
    vencido: `«${q.label}» tiene el pronóstico caducado`,
  }[q.estado];

  // La historia disponible entra en el motivo cuando la hay: «faltan datos» sin
  // cifra no le dice a nadie si esperar dos meses o dos años.
  const conHistoria =
    q.historia && q.historia.periodos > 0
      ? `${q.porque} Hoy hay ${q.historia.periodos} periodos de historia.`
      : q.porque;

  return {
    id: `q.${q.slug}.estado`,
    headline: titular,
    because: conHistoria,
    tone: tono[q.estado],
    support: null,
    href: "/admin/inteligencia",
  };
}
