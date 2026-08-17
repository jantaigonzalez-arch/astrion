import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import { mlForecasts, mlModels, mlTemplates } from "@/lib/db/schema";
import type { Block, ForecastBlock } from "@/lib/ml/blocks-types";
import type { Analysis } from "@/lib/ml/analyses";

/**
 * Cada pregunta configurada, publicada como un ANÁLISIS de su módulo.
 *
 * ── EL HUECO QUE CIERRA ────────────────────────────────────────────────────
 *
 * Sin esto, la capa de inteligencia era un laboratorio: el usuario configuraba
 * una pregunta, la entrenaba, la aprobaba, la promovía… y el pronóstico solo
 * existía en la pantalla de administración donde lo había creado. Para verlo
 * había que ir a buscarlo, y nadie va a buscar un número que no sabe que está.
 *
 * Un modelo cuyas predicciones solo se ven en el panel de ML no cambia ninguna
 * decisión. Aparece donde alguien decide —en Refacciones cuando va a pedir, en
 * Cuentas por pagar cuando va a mover una línea de crédito— o no sirve de nada.
 *
 * ── POR QUÉ SON ANÁLISIS DE VERDAD Y NO UN CASO APARTE ─────────────────────
 *
 * Se generan como entradas del MISMO registro que los análisis escritos a mano
 * (`ANALYSES` en `analyses.ts`), con la misma forma: `watching`, `kind`,
 * `resolve`, `defaultScreen`. Eso las hace configurables por el mismo camino:
 * el usuario puede moverlas de pantalla, apagarlas y volverlas a encender desde
 * la misma pantalla de configuración, sin que haga falta una segunda.
 *
 * Y aparecen como SUYAS, que es lo que se pidió: el `label` es el que el usuario
 * escribió al crear la pregunta, no un nombre del sistema, y `source` sale como
 * de fábrica solo hasta que las toque.
 *
 * ── LA REGLA DE PUBLICACIÓN ────────────────────────────────────────────────
 *
 * Solo se publica lo que tiene modelo EN PRODUCCIÓN. Una pregunta entrenada y
 * no promovida no sale por ninguna pantalla de trabajo, y una rechazada tampoco:
 * es la misma garantía 5 de `insights.ts`. Que exista una pregunta no autoriza a
 * enseñar un número; autoriza a intentar producirlo.
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

type Fila = {
  slug: string;
  module: string;
  label: string;
  question: string;
  unit: string;
  tolerance: string;
  toleranceKind: string;
  horizon: number;
  modelId: string;
  version: number;
  metrics: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
};

/**
 * Las preguntas con modelo en producción, con lo que hace falta para publicarlas.
 *
 * Una sola consulta y no una por pregunta: esto se llama al resolver CADA
 * pantalla que admite análisis, así que un N+1 aquí se paga en todas.
 */
async function publicadas(conexion?: DbOrTx): Promise<Fila[]> {
  const db = conexion ?? (await tenantDb());
  const rows = await db
    .select({
      slug: mlTemplates.slug,
      module: mlTemplates.module,
      label: mlTemplates.label,
      question: mlTemplates.question,
      unit: mlTemplates.unit,
      tolerance: mlTemplates.tolerance,
      toleranceKind: mlTemplates.toleranceKind,
      horizon: mlTemplates.horizon,
      modelId: mlModels.id,
      version: mlModels.version,
      metrics: mlModels.metrics,
      profile: mlModels.dataProfile,
    })
    .from(mlTemplates)
    .innerJoin(
      mlModels,
      and(eq(mlModels.template, mlTemplates.slug), eq(mlModels.status, "production")),
    )
    .orderBy(asc(mlTemplates.module), asc(mlTemplates.label));

  return rows as Fila[];
}

/**
 * Los análisis que salen de las preguntas del usuario.
 *
 * `id` con prefijo `q.` para que no pueda chocar nunca con uno escrito a mano, y
 * para que se pueda reconocer de un vistazo en la tabla de colocaciones de dónde
 * salió cada fila.
 */
export async function questionAnalyses(conexion?: DbOrTx): Promise<Analysis[]> {
  const filas = await publicadas(conexion);

  return filas.map((f): Analysis => {
    const margen =
      f.toleranceKind === "relative"
        ? `±${Number(f.tolerance)} %`
        : `±${Number(f.tolerance)}`;

    return {
      id: `q.${f.slug}`,
      // El nombre que escribió el usuario, no uno del sistema. Es su análisis.
      label: f.label,
      watching: [
        f.question,
        `Estimado por el modelo v${f.version}, con margen ${margen}`,
      ],
      kind: "forecast",
      defaultScreen: MODULE_SCREEN[f.module] ?? null,
      // Detrás de los análisis escritos a mano de la pantalla: los hallazgos
      // piden acción hoy y un pronóstico es contexto. Cambiarlo es un arrastre
      // en la pantalla de configuración, no una decisión nuestra.
      defaultPosition: 50,
      // El permiso pertenece al DATO. Lo que sale de Cuentas por pagar son
      // saldos de proveedores, y eso no lo ve soporte viva donde viva el bloque.
      adminOnly: f.module === "pagos",
      resolve: async (ctx) => bloquesDe(f, ctx.db),
    };
  });
}

/**
 * El pronóstico guardado de una pregunta, como bloque.
 *
 * SE LEE, no se calcula. Las filas ya están escritas en `ml_forecasts` desde que
 * alguien promovió el modelo. Es la garantía 1 de la capa de análisis y aquí es
 * más necesaria que en ningún otro sitio: calcular una proyección en el render
 * significaría cruzar la red al servicio de Python para pintar una pantalla de
 * operación, con su latencia y su fallo colgando de una consulta de tickets.
 */
async function bloquesDe(f: Fila, conexion?: DbOrTx): Promise<Block[]> {
  const db = conexion ?? (await tenantDb());

  const futuro = await db
    .select({
      period: mlForecasts.period,
      value: mlForecasts.value,
      lower: mlForecasts.lower,
      upper: mlForecasts.upper,
    })
    .from(mlForecasts)
    .where(eq(mlForecasts.modelId, f.modelId))
    .orderBy(asc(mlForecasts.period));

  // La cola observada se escribió con el modelo al emitir el pronóstico. Se lee
  // de ahí y no se recalcula: ver la nota de `issueForecast`.
  const historia = (
    ((f.profile ?? {}) as { tail?: Array<{ at: string; value: number }> }).tail ?? []
  ).map((t) => ({ at: t.at, value: Number(t.value) }));

  if (futuro.length === 0) return [];

  const serie = futuro.map((r) => ({
    at: r.period,
    value: Number(r.value),
    lower: Number(r.lower ?? r.value),
    upper: Number(r.upper ?? r.value),
  }));
  const primero = serie[0];

  const bloque: ForecastBlock = {
    kind: "forecast",
    id: `q.${f.slug}`,
    title: f.label,
    note:
      `${f.question} Estimado sobre el histórico de esta empresa; la banda se ` +
      `abre con la distancia porque cada periodo usa como dato lo que estimó el ` +
      `anterior.`,
    // El PRIMER periodo es el valor destacado: es el que alguien lee si no mira
    // la gráfica, y el único que no arrastra el error de otra estimación.
    value: Math.round(primero.value),
    unit: f.unit,
    band: { lower: Math.round(primero.lower), upper: Math.round(primero.upper) },
    // Cuántos periodos de historia lo sostienen. Sale del perfilado guardado con
    // el modelo, no de contar filas hoy: es el número con el que se entrenó.
    support: Number((f.metrics as { n_train?: number } | null)?.n_train ?? 0),
    model: { template: f.slug, version: f.version },
    href: "/admin/inteligencia",
    series: serie,
    history: historia,
  };

  return [bloque];
}

