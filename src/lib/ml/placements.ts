import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import type { DbOrTx } from "@/lib/db";
import { analysisPlacements } from "@/lib/db/schema";
import {
  analysesAll,
  analysisByIdAll,
  SCREENS,
  placementError,
  screenByPrefix,
  type Analysis,
  type Screen,
} from "@/lib/ml/analyses";

/**
 * Qué análisis sale en qué pantalla — configurado por el usuario, o de fábrica.
 *
 * La regla de resolución tiene una sutileza que vale la pena dejar escrita: la
 * AUSENCIA de fila significa «usa el valor de fábrica», y por eso apagar un
 * análisis guarda una fila con `active = false` en vez de borrar. Si apagar
 * borrara, el análisis volvería solo en la siguiente carga y el usuario tendría
 * que apagarlo otra vez, para siempre. «No lo he tocado» y «lo quité» son
 * estados distintos y el sistema tiene que poder distinguirlos.
 *
 * De ahí sale la otra propiedad, la que hace que esto se pueda desplegar sin
 * miedo: una base sin ninguna fila se comporta EXACTAMENTE como el sistema
 * anterior. No hace falta semilla, ni migración de datos, ni un despliegue
 * coordinado. Las filas empiezan a existir cuando alguien configura algo.
 */

export type Placement = {
  analysis: Analysis;
  position: number;
  active: boolean;
  /** `true` cuando sale del catálogo y no de una fila. */
  factory: boolean;
  source: "user" | "system" | "factory";
};

type Row = {
  analysis: string;
  screen: string;
  position: number;
  active: boolean;
  source: string;
};

/*
  La conexión entra por parámetro, como en `insights.ts`, y no es solo simetría:
  `tenantDb()` se resuelve desde las cookies de la petición, así que sin esto
  nada de este módulo se puede ejercitar fuera de un navegador. Una capa de
  configuración que solo se puede probar haciendo clic es una capa que no se
  prueba.
*/
async function rowsFor(conexion: DbOrTx | undefined, screen?: string): Promise<Row[]> {
  const db = conexion ?? (await tenantDb());
  const q = db
    .select({
      analysis: analysisPlacements.analysis,
      screen: analysisPlacements.screen,
      position: analysisPlacements.position,
      active: analysisPlacements.active,
      source: analysisPlacements.source,
    })
    .from(analysisPlacements);
  return screen ? q.where(eq(analysisPlacements.screen, screen)) : q;
}

/**
 * Los análisis de una pantalla, ya ordenados y filtrados por activos.
 *
 * Mezcla las dos fuentes en vez de elegir una: un análisis que el usuario nunca
 * tocó sigue saliendo de fábrica aunque haya configurado los de al lado. Lo
 * contrario —que configurar UNO borre los demás— es el fallo clásico de este
 * patrón, y se nota tarde: alguien mueve el calendario de pagos y descubre a la
 * semana que los avisos llevan siete días sin salir.
 */
export async function placementsFor(
  screenPrefix: string,
  conexion?: DbOrTx,
): Promise<Placement[]> {
  const rows = await rowsFor(conexion, screenPrefix);
  const byId = new Map(rows.map((r) => [r.analysis, r]));

  const out: Placement[] = [];

  for (const a of await analysesAll(conexion)) {
    const row = byId.get(a.id);
    if (row) {
      out.push({
        analysis: a,
        position: row.position,
        active: row.active,
        factory: false,
        source: row.source === "system" ? "system" : "user",
      });
    } else if (a.defaultScreen === screenPrefix) {
      out.push({
        analysis: a,
        position: a.defaultPosition,
        active: true,
        factory: true,
        source: "factory",
      });
    }
  }

  return out.sort((x, y) => x.position - y.position || x.analysis.id.localeCompare(y.analysis.id));
}

/** Todo el mapa, para la pantalla de configuración. */
export async function placementMap(
  conexion?: DbOrTx,
): Promise<Array<{ screen: Screen; placements: Placement[] }>> {
  return Promise.all(
    SCREENS.map(async (screen) => ({
      screen,
      placements: await placementsFor(screen.prefix, conexion),
    })),
  );
}

/**
 * Coloca, mueve, apaga o enciende un análisis.
 *
 * Devuelve el motivo cuando no se puede en vez de lanzar: quien llama es una
 * acción de servidor que tiene que enseñárselo a alguien, y una excepción se
 * convierte en «algo salió mal», que no explica nada.
 */
export async function setPlacement(opts: {
  analysis: string;
  screen: string;
  active: boolean;
  position?: number;
  source?: "user" | "system";
  conexion?: DbOrTx;
}): Promise<{ ok: boolean; reason?: string }> {
  const error = placementError(opts.analysis, opts.screen);
  if (error) return { ok: false, reason: error };

  // `!` no: un análisis del usuario no está en la lista estática, y con la
  // aserción la colocación de su propio pronóstico reventaba al leer `.needsId`
  // de `undefined` — justo en la acción que se llama al moverlo de pantalla.
  const a = await analysisByIdAll(opts.analysis);
  if (!a) return { ok: false, reason: `No existe el análisis «${opts.analysis}».` };
  const db = opts.conexion ?? (await tenantDb());

  await db
    .insert(analysisPlacements)
    .values({
      analysis: opts.analysis,
      screen: opts.screen,
      position: opts.position ?? a.defaultPosition,
      active: opts.active,
      source: opts.source ?? "user",
    })
    .onConflictDoUpdate({
      target: [analysisPlacements.analysis, analysisPlacements.screen],
      set: {
        position: opts.position ?? a.defaultPosition,
        active: opts.active,
        source: opts.source ?? "user",
        updatedAt: new Date(),
      },
    });

  return { ok: true };
}

/**
 * Devuelve un análisis a como venía de fábrica, borrando su fila.
 *
 * Es distinto de apagarlo: apagar deja constancia de la decisión, restaurar la
 * retira. Sin esta operación no habría vuelta atrás de una configuración, y la
 * única forma de recuperar el valor de fábrica sería adivinarlo.
 */
export async function resetPlacement(
  analysis: string,
  screen: string,
  conexion?: DbOrTx,
): Promise<void> {
  const db = conexion ?? (await tenantDb());
  await db
    .delete(analysisPlacements)
    .where(
      and(eq(analysisPlacements.analysis, analysis), eq(analysisPlacements.screen, screen)),
    );
}

/* ------------------------- Lo que propone el sistema ------------------------- */

export type Recommendation = {
  analysis: Analysis;
  screen: Screen;
  /** Por qué se propone. Se enseña tal cual: una propuesta sin motivo es ruido. */
  because: string;
  /** Qué modelo la sostiene, cuando la sostiene uno. */
  model?: { template: string; version: number; label: string };
};

/**
 * Análisis que el sistema propone encender, y por qué.
 *
 * La recomendación que de verdad importa sale de un hueco real que había en el
 * producto: se podía entrenar un modelo, juzgarlo, aprobarlo y promoverlo a
 * producción, y sus predicciones NO SALÍAN POR NINGUNA PANTALLA si el sujeto no
 * era `ticket` — que era el único que `insights.ts` sabía leer. Todo el
 * laboratorio decía «en producción» y la producción no existía en ningún sitio
 * donde alguien la fuera a ver.
 *
 * Un modelo aprobado sin análisis que lo enseñe es, literalmente, una
 * recomendación esperando a hacerse. Eso es lo que esto busca: no adivina gustos
 * ni puntúa relevancia, comprueba un hecho —hay modelo, no hay salida— y lo
 * dice. Una propuesta que se puede justificar en una frase es una propuesta que
 * el usuario puede rechazar con criterio.
 */
export async function recommendations(conexion?: DbOrTx): Promise<Recommendation[]> {
  const db = conexion ?? (await tenantDb());

  // Los sujetos que HOY tienen un modelo en producción. Se lee de la plantilla
  // porque `ml_models` guarda el slug, no el sujeto.
  const modelos = (await db.execute(sql`
    select t.subject, t.label, m.template, max(m.version)::int as version
      from ml_models m
      join ml_templates t on t.slug = m.template
     where m.status = 'production'
     group by t.subject, t.label, m.template`)) as unknown as Array<{
    subject: string;
    label: string;
    template: string;
    version: number;
  }>;

  if (modelos.length === 0) return [];

  const rows = await rowsFor(conexion);
  const colocado = new Set(
    rows.filter((r) => r.active).map((r) => r.analysis),
  );
  // Los de fábrica cuentan como colocados: ya tienen por dónde salir.
  for (const a of await analysesAll(conexion)) {
    if (a.defaultScreen && !rows.some((r) => r.analysis === a.id)) colocado.add(a.id);
  }

  const out: Recommendation[] = [];

  for (const m of modelos) {
    // ¿Algún análisis lee este sujeto y está colocado en alguna parte?
    const lectores = (await analysesAll(conexion)).filter((a) => a.subject === m.subject);
    if (lectores.length === 0) continue;
    if (lectores.some((a) => colocado.has(a.id))) continue;

    for (const a of lectores) {
      // Se propone donde el catálogo dice, y si no lo dice, en la pantalla más
      // específica que lo admita. Nunca se coloca solo: se propone.
      const destino = a.defaultScreen
        ? screenByPrefix(a.defaultScreen)
        : SCREENS.find((s) => !placementError(a.id, s.prefix));
      if (!destino) continue;

      out.push({
        analysis: a,
        screen: destino,
        because:
          `Tienes «${m.label}» en producción (v${m.version}) y sus predicciones ` +
          `no salen por ninguna pantalla. «${a.label}» las enseñaría en ` +
          `${destino.label}.`,
        model: { template: m.template, version: m.version, label: m.label },
      });
    }
  }

  return out;
}
