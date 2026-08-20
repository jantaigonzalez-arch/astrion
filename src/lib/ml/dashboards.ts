import "server-only";
import { cache } from "react";
import { asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import { tenantCache } from "@/lib/tenant-cache";
import { dashboards } from "@/lib/db/schema";
import {
  MODULOS,
  analysesAll,
  dashboardScreen,
  moduloById,
  type Analysis,
  type Modulo,
} from "@/lib/ml/analyses";
import {
  placementsFor,
  placementsForMany,
  setPlacement,
  type Placement,
} from "@/lib/ml/placements";

/**
 * El dashboard de un módulo: qué lleva, en qué orden y si está publicado.
 *
 * ── UN DASHBOARD ES UNA PANTALLA ───────────────────────────────────────────
 *
 * No hay tabla de bloques. Sus bloques son filas de `analysis_placements` con
 * `screen = 'dashboard:<modulo>'`, exactamente igual que los de una pantalla de
 * trabajo, así que heredan sin tocar nada: la mezcla de fábrica con lo del
 * usuario, el orden por `position`, el encendido, el origen y las
 * recomendaciones. Una tabla propia de bloques habría duplicado toda esa lógica
 * para acabar haciendo lo mismo con otros nombres.
 *
 * Lo único que la tabla `dashboards` guarda es lo que un placement no sabe: el
 * nombre del tablero y si ya se publicó.
 *
 * ── QUÉ SIGNIFICA PUBLICAR ─────────────────────────────────────────────────
 *
 * Que el resto del equipo pueda verlo. Antes de publicarse, el botón solo
 * aparece para quien lo compone: nadie debería encontrarse un tablero a medio
 * ordenar porque alguien salió a comer.
 *
 * Publicar NO congela una versión, y conviene decirlo porque es la pregunta que
 * sigue: editar después de publicar cambia lo que el equipo ve, en el acto. Un
 * borrador aparte —dos juegos de colocaciones, uno vivo y otro en edición— es
 * una función de verdad, con su propia manera de confundir («¿por qué no se ve
 * mi cambio?»). A este tamaño el gesto que hace falta es «esto ya está listo
 * para que lo vean», y eso es una fecha, no una copia.
 */

export type DashboardView = {
  modulo: Modulo;
  title: string;
  publishedAt: Date | null;
  /** Bloques ya ordenados, con los apagados incluidos: el compositor los ve. */
  bloques: Placement[];
  /**
   * Lo que TODAVÍA no está en el tablero y se podría añadir.
   *
   * Sin esta lista el compositor solo sabía reordenar lo que ya estaba, y en un
   * módulo recién estrenado eso es reordenar nada. Peor: el usuario no tenía
   * forma de enterarse de qué análisis existen — el catálogo entero era
   * invisible desde el único sitio donde hace falta verlo.
   */
  disponibles: Analysis[];
};

/**
 * Cómo se llama un tablero mientras nadie lo bautice.
 *
 * En una función y no repetido en los cuatro sitios que lo escriben: es el
 * valor contra el que se compara para saber si alguien le puso nombre, así que
 * una copia que se desviara una coma haría que un tablero sin bautizar pareciera
 * bautizado para siempre.
 */
const tituloPorDefecto = (modulo: Modulo) => `Dashboard de ${modulo.label}`;

/* ------------------------- Lectura ------------------------- */

export async function dashboardFor(
  moduloId: string,
  conexion?: DbOrTx,
): Promise<DashboardView | null> {
  const modulo = moduloById(moduloId);
  if (!modulo) return null;

  const db = conexion ?? (await tenantDb());
  const [fila] = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.module, moduloId))
    .limit(1);

  const screen = dashboardScreen(moduloId);
  const bloques = await placementsFor(screen, conexion);
  const puestos = new Set(bloques.map((b) => b.analysis.id));

  return {
    modulo,
    title: fila?.title ?? tituloPorDefecto(modulo),
    publishedAt: fila?.publishedAt ?? null,
    bloques,
    // Los de FICHA quedan fuera: necesitan un identificador en la dirección y un
    // dashboard no lo lleva, así que ahí se quedarían mudos. Es la misma regla
    // que `placementError`, aplicada antes de ofrecerlos en vez de después de
    // que alguien los coloque y no entienda por qué no sale nada.
    disponibles: (await analysesAll(conexion)).filter(
      (a) => !puestos.has(a.id) && !a.needsId,
    ),
  };
}

/**
 * El nombre del cacheado del menú de tableros.
 *
 * Una constante y no la cadena suelta en dos archivos: la escriben el layout
 * —al declarar la caché— y las acciones del compositor —al invalidarla—, y si
 * las dos se desviaran una letra el menú se quedaría con el tablero viejo sin
 * que nada falle. Ver `tenantCache`.
 */
export const TABLEROS_CACHE = "tableros";

export type DashboardState = {
  modulo: Modulo;
  /** Cómo se llama hoy, bautizado o no. */
  title: string;
  /** El nombre puesto por alguien. `null` si todavía se llama como nació. */
  nombre: string | null;
  publishedAt: Date | null;
  /** Bloques encendidos. Cero significa que no hay tablero que enseñar. */
  bloques: number;
};

/**
 * Los módulos con dashboard y su estado, para el menú y la administración.
 *
 * Dos consultas para todos y no dos por módulo, que es lo que decía esta nota
 * cuando el cuerpo hacía lo contrario: pedía las colocaciones módulo a módulo,
 * y cada una de esas llamadas releía además el catálogo entero de análisis —que
 * consulta las preguntas del usuario en la base—. Catorce viajes para pintar una
 * barra lateral, en cada navegación. `placementsForMany` lee las dos fuentes una
 * vez y reparte.
 *
 * ── Y MEMOIZADA POR PETICIÓN ───────────────────────────────────────────────
 *
 * Quien la lee en una pantalla es `tablerosDelMenu`, que ya la guarda en caché
 * entre peticiones; la memoización de aquí cubre el resto de llamadas —la
 * pantalla de administración, un script— para que ninguna pague dos veces la
 * misma lectura dentro de una petición.
 *
 * Se memoiza esta y NO `placementsFor`, aunque tenga la misma pinta. La
 * diferencia es quién escribe: las colocaciones las cambia el compositor dentro
 * de la misma petición que luego las relee —agregar un bloque lee la lista para
 * saber en qué posición ponerlo—, y congelarlas ahí daría un tablero que ignora
 * lo que se acaba de guardar. Esto, en cambio, solo lo leen pantallas.
 */
export const dashboardStates = cache(async (conexion?: DbOrTx): Promise<DashboardState[]> => {
  const db = conexion ?? (await tenantDb());

  const [filas, porPantalla] = await Promise.all([
    db
      .select({
        module: dashboards.module,
        title: dashboards.title,
        publishedAt: dashboards.publishedAt,
      })
      .from(dashboards)
      .orderBy(asc(dashboards.module)),
    placementsForMany(MODULOS.map((m) => dashboardScreen(m.id)), conexion),
  ]);

  const porModulo = new Map(filas.map((f) => [f.module, f]));

  return MODULOS.map((modulo) => {
    const fila = porModulo.get(modulo.id);
    return {
      modulo,
      title: fila?.title ?? tituloPorDefecto(modulo),
      // Se compara contra el nombre de nacimiento para poder distinguir «se
      // llama así porque alguien lo decidió» de «se llama así porque nadie lo
      // ha tocado». El menú usa esa diferencia: un tablero sin bautizar se
      // anuncia con el nombre de su módulo, que es más corto y dice lo mismo.
      nombre: fila && fila.title !== tituloPorDefecto(modulo) ? fila.title : null,
      publishedAt: fila?.publishedAt ?? null,
      bloques: (porPantalla.get(dashboardScreen(modulo.id)) ?? []).filter((b) => b.active)
        .length,
    };
  });
});

/* ------------------------- El menú, en caché ------------------------- */

/**
 * Un tablero tal como lo necesitan el menú lateral Y el botón del módulo.
 *
 * Solo cadenas y booleanos: es lo que sobrevive bien a una caché serializada, y
 * es todo lo que las dos superficies necesitan.
 */
export type TableroMenu = {
  id: string;
  /** Cómo anunciarlo: el nombre puesto por alguien, o el del módulo. */
  label: string;
  /** El nombre completo del tablero, para el `title` del botón. */
  title: string;
  /** La pantalla del módulo. Es lo que decide si este rol lo ve. */
  home: string;
  publicado: boolean;
};

/**
 * Los tableros que tienen algo que enseñar, en caché por empresa.
 *
 * ── LA LISTA YA CODIFICA LOS TRES ESTADOS ──────────────────────────────────
 *
 * Se filtra aquí lo que no tiene nada —cero bloques encendidos y sin publicar—,
 * y esa sola decisión deja la lista diciendo todo lo que hay que saber:
 *
 *   está y publicado      → hay tablero y el equipo lo ve
 *   está y sin publicar   → hay bloques compuestos, falta publicar
 *   NO está               → no hay nada compuesto
 *
 * Por eso el botón del módulo no necesita su propia lectura: la ausencia en
 * esta lista ES el tercer estado. Lo comprobé midiendo, y de la peor manera:
 * al cachear el menú, el botón dejó de compartir la lectura que antes reusaba y
 * volvió a consultar en cada pantalla de módulo. Una sola fuente lo cierra.
 *
 * ── POR QUÉ EN CACHÉ Y NO SOLO MEMOIZADO ───────────────────────────────────
 *
 * Cuelga del layout, así que se pagaba en las 68 pantallas del portal: medido,
 * 4 consultas y ~15 ms por navegación para pintar una sección que solo cambia
 * cuando alguien compone o publica un tablero. Memoizar por petición evita
 * pedirlo dos veces en la misma pantalla y no evita nada entre navegaciones.
 *
 * Lo invalida `revalidateDashboards()` desde las acciones que lo cambian.
 */
const leerMenu = tenantCache(TABLEROS_CACHE, async (db): Promise<TableroMenu[]> =>
  (await dashboardStates(db))
    .filter((s) => s.bloques > 0 || s.publishedAt)
    .map((s) => ({
      id: s.modulo.id,
      // El nombre de nacimiento —«Dashboard de Compras»— sobra bajo un
      // encabezado que ya dice «Tableros»; ahí se anuncia con el del módulo.
      label: s.nombre ?? s.modulo.label,
      title: s.title,
      home: s.modulo.home,
      publicado: Boolean(s.publishedAt),
    })),
);

/**
 * Lo anterior sin poder tumbar la pantalla que lo pide.
 *
 * Es la misma garantía que el tablero se da a sí mismo resolviendo bloque a
 * bloque con `allSettled`, y aquí pesa más: esto cuelga del layout, así que una
 * consulta rota —una migración que todavía no corrió en un despliegue, por
 * ejemplo— dejaría sin portal a todo el mundo por no poder pintar una sección
 * del menú.
 */
export async function tablerosDelMenu(): Promise<TableroMenu[]> {
  try {
    return await leerMenu();
  } catch (e) {
    console.error("[tableros] no se pudo leer el menú de tableros", e);
    return [];
  }
}

/* ------------------------- Escritura ------------------------- */

/**
 * Guarda el ORDEN completo tras un arrastre.
 *
 * Recibe la lista entera y no «mueve el bloque N a la posición M», y es
 * deliberado: con un solo movimiento habría que recalcular en el servidor las
 * posiciones de todos los demás, y dos arrastres rápidos seguidos podrían
 * cruzarse y dejar el orden que ninguno de los dos pidió. Mandar la lista
 * completa hace que el último arrastre gane entero, que es lo que el usuario
 * espera de arrastrar.
 */
export async function reorderDashboard(
  moduloId: string,
  orden: Array<{ analysis: string; width: "full" | "half"; active: boolean }>,
): Promise<{ ok: boolean; reason?: string }> {
  if (!moduloById(moduloId)) return { ok: false, reason: "Ese módulo no existe." };
  const screen = dashboardScreen(moduloId);
  const db = await tenantDb();

  // En UNA transacción: si se cae a la mitad, el tablero queda con la mitad del
  // orden nuevo y la mitad del viejo, que es peor que no haber movido nada.
  return db.transaction(async (tx) => {
    for (const [i, b] of orden.entries()) {
      const r = await setPlacement({
        analysis: b.analysis,
        screen,
        active: b.active,
        position: i,
        width: b.width,
        conexion: tx,
      });
      if (!r.ok) return r;
    }
    await tocar(moduloId, tx);
    return { ok: true };
  });
}

/**
 * Añade un análisis al tablero, al final y encendido.
 *
 * Al final y no al principio: quien añade algo nuevo no está diciendo que sea
 * lo más importante del tablero, solo que lo quiere ahí. Moverlo arriba es un
 * arrastre; adivinar que quería el primer puesto no se puede deshacer sin uno.
 */
export async function addToDashboard(
  moduloId: string,
  analysis: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!moduloById(moduloId)) return { ok: false, reason: "Ese módulo no existe." };
  const screen = dashboardScreen(moduloId);
  const actuales = await placementsFor(screen);

  const r = await setPlacement({
    analysis,
    screen,
    active: true,
    position: actuales.length,
  });
  if (!r.ok) return r;

  await tocar(moduloId, await tenantDb());
  return { ok: true };
}

/** Publica el dashboard: lo hace visible para el resto del equipo. */
export async function publishDashboard(
  moduloId: string,
  userId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const modulo = moduloById(moduloId);
  if (!modulo) return { ok: false, reason: "Ese módulo no existe." };

  const bloques = await placementsFor(dashboardScreen(moduloId));
  if (bloques.filter((b) => b.active).length === 0) {
    return {
      ok: false,
      reason:
        "No hay ningún análisis encendido, así que publicarlo pondría un botón " +
        "que abre un tablero vacío. Agrega al menos uno.",
    };
  }

  const db = await tenantDb();
  await db
    .insert(dashboards)
    .values({
      module: moduloId,
      title: tituloPorDefecto(modulo),
      publishedAt: new Date(),
      publishedById: userId,
    })
    .onConflictDoUpdate({
      target: dashboards.module,
      set: { publishedAt: new Date(), publishedById: userId, updatedAt: new Date() },
    });

  return { ok: true };
}

/** Lo retira de la vista del equipo. No borra nada de lo compuesto. */
export async function unpublishDashboard(moduloId: string): Promise<{ ok: boolean }> {
  const db = await tenantDb();
  await db
    .update(dashboards)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(eq(dashboards.module, moduloId));
  return { ok: true };
}

export async function renameDashboard(
  moduloId: string,
  title: string,
): Promise<{ ok: boolean; reason?: string }> {
  const modulo = moduloById(moduloId);
  if (!modulo) return { ok: false, reason: "Ese módulo no existe." };
  const limpio = title.trim().slice(0, 120);
  if (!limpio) return { ok: false, reason: "El nombre no puede quedar vacío." };

  const db = await tenantDb();
  await db
    .insert(dashboards)
    .values({ module: moduloId, title: limpio })
    .onConflictDoUpdate({
      target: dashboards.module,
      set: { title: limpio, updatedAt: new Date() },
    });
  return { ok: true };
}

/**
 * Marca el dashboard como tocado sin cambiar su publicación.
 *
 * Existe la fila aunque nunca se haya publicado: sin ella, un tablero compuesto
 * y no publicado no tendría dónde guardar su nombre, y el módulo se vería
 * idéntico a uno que nadie ha tocado.
 */
async function tocar(moduloId: string, db: DbOrTx) {
  const modulo = moduloById(moduloId)!;
  await db
    .insert(dashboards)
    .values({ module: moduloId, title: tituloPorDefecto(modulo) })
    .onConflictDoUpdate({
      target: dashboards.module,
      set: { updatedAt: sql`now()` },
    });
}
