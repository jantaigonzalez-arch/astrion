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

/**
 * La caja de un bloque en el lienzo: dónde empieza y cuánto ocupa.
 *
 *   x  0..23   columna, sobre una retícula de 24
 *   y  0..     fila, en unidades de 32 px
 *   w  1..24   columnas de ancho
 *   h  3..     filas de alto
 *
 * Números y no una unión de literales: son 24 valores de ancho y cuarenta de
 * alto, y una unión de sesenta y cuatro miembros no protege de nada que estos
 * saneadores no cubran mejor.
 */
export type Caja = { x: number; y: number; w: number; h: number };

/*
  Todo esto viene de la base o del catálogo, o sea de fuera del compilador. Un
  valor imposible —un 99 escrito a mano, un 0 de una versión vieja— tiene que
  caer en el más cercano y no romper la pantalla: el layout de un tablero no es
  sitio para fallar fuerte.
*/
export const COLUMNAS = 24;
/** Alto mínimo en filas. Por debajo, la tarjeta no cabe ni con su título. */
export const ALTO_MIN = 4;
/** Tope de alto. Un bloque de doscientas filas es un dedo resbalado. */
export const ALTO_MAX = 60;

const lim = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

export const ancho = (n: number | undefined): number => lim(n ?? 12, 1, COLUMNAS);
export const alto = (n: number | undefined): number => lim(n ?? 8, ALTO_MIN, ALTO_MAX);
export const coordX = (n: number | undefined): number => lim(n ?? 0, 0, COLUMNAS - 1);
export const coordY = (n: number | undefined): number => lim(n ?? 0, 0, 400);

/**
 * La caja saneada, con el ancho recortado para que no se salga por la derecha.
 *
 * Un bloque que empieza en la 20 y mide 12 se saldría del lienzo; el navegador
 * lo dibujaría cortado y quien compone no entendería por qué. Se recorta el
 * ANCHO y no la posición: mover un bloque que alguien colocó a propósito es más
 * sorprendente que estrecharlo.
 */
export function caja(v: Partial<Caja> | undefined): Caja {
  const x = coordX(v?.x);
  return {
    x,
    y: coordY(v?.y),
    w: Math.min(ancho(v?.w), COLUMNAS - x),
    h: alto(v?.h),
  };
}

export type Placement = {
  analysis: Analysis;
  position: number;
  active: boolean;
  /** Dónde y cuánto ocupa en un tablero. Ver `analysisPlacements.x`. */
  caja: Caja;
  /**
   * La forma elegida a mano, o `null` para «la que recomiende el sistema».
   *
   * No se valida contra el catálogo de formas al leer: un nombre que la
   * aplicación no conozca —una forma retirada, una fila escrita por una versión
   * más nueva— tiene que degradar a recomendación, no tumbar la pantalla. De
   * eso se encarga `formaEfectiva`, que además comprueba que la forma siga
   * siendo APTA para los datos de hoy.
   */
  viz: string | null;
  /** `true` cuando sale del catálogo y no de una fila. */
  factory: boolean;
  source: "user" | "system" | "factory";
};

type Row = {
  analysis: string;
  screen: string;
  position: number;
  x: number;
  y: number;
  w: number;
  h: number;
  viz: string | null;
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
      x: analysisPlacements.x,
      y: analysisPlacements.y,
      w: analysisPlacements.w,
      h: analysisPlacements.h,
      viz: analysisPlacements.viz,
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
  return mezclar(
    await analysesAll(conexion),
    await rowsFor(conexion, screenPrefix),
    screenPrefix,
  );
}

/**
 * Lo mismo para VARIAS pantallas, con una sola lectura de cada fuente.
 *
 * Existe por una razón medida y no por simetría: `placementsFor` lee las filas
 * Y el catálogo completo —que a su vez consulta las preguntas del usuario en la
 * base—. Pedirlo pantalla por pantalla multiplica las dos consultas por el
 * número de pantallas, y quien necesita el estado de VARIAS a la vez es
 * precisamente quien lo hace en cada navegación: la barra lateral.
 *
 * Devuelve un mapa y no una lista para que quien llama no tenga que volver a
 * casar prefijos con resultados por posición.
 */
export async function placementsForMany(
  screenPrefixes: string[],
  conexion?: DbOrTx,
): Promise<Map<string, Placement[]>> {
  const [analyses, rows] = await Promise.all([
    analysesAll(conexion),
    rowsFor(conexion),
  ]);

  return new Map(
    screenPrefixes.map((prefix) => [
      prefix,
      mezclar(
        analyses,
        rows.filter((r) => r.screen === prefix),
        prefix,
      ),
    ]),
  );
}

/**
 * La mezcla en sí, sobre datos ya leídos.
 *
 * Separada de la lectura para que las dos formas de pedirla —una pantalla o
 * varias— compartan la regla en vez de copiarla. Es la parte que no se puede
 * duplicar sin que se desincronice: aquí vive lo que significa la ausencia de
 * fila.
 */
function mezclar(analyses: Analysis[], rows: Row[], screenPrefix: string): Placement[] {
  const byId = new Map(rows.map((r) => [r.analysis, r]));
  const out: Placement[] = [];

  for (const a of analyses) {
    const row = byId.get(a.id);
    if (row) {
      out.push({
        analysis: a,
        position: row.position,
        active: row.active,
        caja: caja(row),
        viz: row.viz,
        factory: false,
        source: row.source === "system" ? "system" : "user",
      });
      continue;
    }

    const fabrica = a.defaultOn.find((d) => d.screen === screenPrefix);
    if (fabrica) {
      out.push({
        analysis: a,
        position: fabrica.position,
        active: true,
        caja: caja(fabrica),
        // De fábrica nadie eligió forma: se recomienda.
        viz: null,
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
  const porPantalla = await placementsForMany(
    SCREENS.map((s) => s.prefix),
    conexion,
  );
  return SCREENS.map((screen) => ({
    screen,
    placements: porPantalla.get(screen.prefix) ?? [],
  }));
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
  /** Solo en dashboards. Ausente conserva la que tuviera. */
  caja?: Caja;
  /**
   * La forma elegida. Tres estados, y los tres hacen falta:
   *
   *   ausente  conservar la que la fila ya tenga (mover un bloque no le
   *            cambia el dibujo)
   *   null     volver a la recomendación automática — es una elección de la
   *            persona, «que lo decida el sistema», y por eso tiene que poder
   *            escribirse y no solo omitirse
   *   valor    fijarla
   */
  viz?: string | null;
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

  // Lo de fábrica DE ESTA PANTALLA, no lo de fábrica a secas: un análisis puede
  // nacer en su pantalla de trabajo y en un dashboard con sitio y ancho
  // distintos, y usar los de la otra al colocarlo aquí lo mandaría a un puesto
  // que nadie eligió.
  const fabrica = a.defaultOn.find((d) => d.screen === opts.screen);

  await db
    .insert(analysisPlacements)
    .values({
      analysis: opts.analysis,
      screen: opts.screen,
      position: opts.position ?? fabrica?.position ?? 0,
      active: opts.active,
      ...caja(opts.caja ?? fabrica),
      viz: opts.viz ?? null,
      source: opts.source ?? "user",
    })
    .onConflictDoUpdate({
      target: [analysisPlacements.analysis, analysisPlacements.screen],
      set: {
        position: opts.position ?? fabrica?.position ?? 0,
        active: opts.active,
        // `sql` y no el valor: sin `width` en la llamada hay que CONSERVAR el
        // que la fila ya tenía, no volver al de fábrica. Mover un bloque de
        // sitio no debería devolverle el ancho, y con un valor plano lo haría
        // en cada arrastre.
        ...(opts.caja ? caja(opts.caja) : {}),
        // Igual que `width`, pero con `undefined` como única señal de «no
        // tocar»: aquí `null` es un valor que SÍ se escribe —«volvé a
        // recomendar»— así que no se puede usar el truco de la falsedad.
        ...(opts.viz !== undefined ? { viz: opts.viz } : {}),
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
    if (a.defaultOn.length > 0 && !rows.some((r) => r.analysis === a.id)) colocado.add(a.id);
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
      const destino = a.defaultOn[0]
        ? screenByPrefix(a.defaultOn[0].screen)
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
