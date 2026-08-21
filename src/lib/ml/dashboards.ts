import "server-only";
import { cache } from "react";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { tenantDb } from "@/lib/tenancy/context";
import { tenantCache } from "@/lib/tenant-cache";
import { dashboardModules, dashboards } from "@/lib/db/schema";
import {
  MODULOS,
  analysesAll,
  dashboardScreen,
  moduloById,
  type Analysis,
} from "@/lib/ml/analyses";
import {
  placementsFor,
  placementsForMany,
  setPlacement,
  type Placement,
} from "@/lib/ml/placements";

/**
 * Los tableros: qué llevan, cómo se llaman y en qué módulos salen.
 *
 * ── UN TABLERO ES UNA PANTALLA ─────────────────────────────────────────────
 *
 * No hay tabla de bloques. Sus bloques son filas de `analysis_placements` con
 * `screen = 'dashboard:<slug>'`, exactamente igual que los de una pantalla de
 * trabajo, así que heredan sin tocar nada: la mezcla de fábrica con lo del
 * usuario, el orden por `position`, el encendido, el origen y las
 * recomendaciones. Una tabla propia de bloques habría duplicado toda esa lógica
 * para acabar haciendo lo mismo con otros nombres.
 *
 * ── Y YA NO PERTENECE A UN MÓDULO ──────────────────────────────────────────
 *
 * Antes había exactamente uno por módulo —siete como máximo— y el nombre nacía
 * impuesto: «Dashboard de Compras». Eso impedía lo que la gente acaba
 * queriendo: «Cierre de mes» y «Pendientes de la semana» como dos tableros
 * distintos, o uno que mezcle Ventas con Refacciones.
 *
 * Ahora un tablero tiene identidad (`slug`), un nombre que pone quien lo
 * compone, y DÓNDE aparece es una decisión aparte: puede publicarse en varios
 * módulos, en uno o en ninguno. Ver la migración 0018 y `dashboard_modules`.
 *
 * El slug de los siete de siempre es el id de su módulo, así que las
 * colocaciones que ya existían siguen apuntando donde apuntaban.
 *
 * ── QUÉ SIGNIFICA PUBLICAR ─────────────────────────────────────────────────
 *
 * Que el resto del equipo pueda verlo. Antes de publicarse solo aparece para
 * quien lo compone: nadie debería encontrarse un tablero a medio ordenar porque
 * alguien salió a comer. Es distinto de EN QUÉ MÓDULOS sale, que es la otra
 * decisión: un tablero puede estar publicado y no salir en ningún módulo —se
 * llega por el menú— o estar en tres módulos y seguir siendo borrador.
 *
 * Publicar NO congela una versión: editar después cambia lo que el equipo ve,
 * en el acto. Un borrador aparte —dos juegos de colocaciones— es una función de
 * verdad, con su propia manera de confundir («¿por qué no se ve mi cambio?»). A
 * este tamaño el gesto que hace falta es «esto ya está listo para que lo vean»,
 * y eso es una fecha, no una copia.
 */

/** El nombre del cacheado del menú de tableros. Ver `tenantCache`. */
export const TABLEROS_CACHE = "tableros";

export type DashboardView = {
  slug: string;
  title: string;
  publishedAt: Date | null;
  /** Los módulos donde sale. Puede estar vacío. */
  modules: string[];
  /** Bloques ya ordenados, con los apagados incluidos: el compositor los ve. */
  bloques: Placement[];
  /**
   * Lo que TODAVÍA no está en el tablero y se podría añadir.
   *
   * Sin esta lista el compositor solo sabía reordenar lo que ya estaba, y en un
   * tablero recién creado eso es reordenar nada. Peor: el usuario no tenía
   * forma de enterarse de qué análisis existen — el catálogo entero era
   * invisible desde el único sitio donde hace falta verlo.
   */
  disponibles: Analysis[];
};

/* ------------------------- Lectura ------------------------- */

export async function dashboardFor(
  slug: string,
  conexion?: DbOrTx,
): Promise<DashboardView | null> {
  const db = conexion ?? (await tenantDb());

  const [fila] = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.slug, slug))
    .limit(1);

  // Sin fila no hay tablero. Antes esto no podía pasar —los siete existían
  // siempre, aunque fuera como objeto inventado al vuelo— y ahora sí: un slug
  // en la URL que nadie creó tiene que dar «no existe» y no un tablero vacío.
  if (!fila) return null;

  const [mods, bloques, catalogo] = await Promise.all([
    db
      .select({ module: dashboardModules.module })
      .from(dashboardModules)
      .where(eq(dashboardModules.dashboardId, fila.id))
      .orderBy(asc(dashboardModules.position)),
    placementsFor(dashboardScreen(slug), conexion),
    analysesAll(conexion),
  ]);

  const puestos = new Set(bloques.map((b) => b.analysis.id));

  return {
    slug: fila.slug,
    title: fila.title,
    publishedAt: fila.publishedAt,
    modules: mods.map((m) => m.module),
    bloques,
    // Los de FICHA quedan fuera: necesitan un identificador en la dirección y un
    // tablero no lo lleva, así que ahí se quedarían mudos. Es la misma regla que
    // `placementError`, aplicada antes de ofrecerlos en vez de después de que
    // alguien los coloque y no entienda por qué no sale nada.
    disponibles: catalogo.filter((a) => !puestos.has(a.id) && !a.needsId),
  };
}

export type DashboardState = {
  slug: string;
  title: string;
  publishedAt: Date | null;
  /** Los módulos donde sale, en el orden en que se decidió. */
  modules: string[];
  /** Bloques encendidos. Cero significa que no hay tablero que enseñar. */
  bloques: number;
};

/**
 * TODOS los tableros de la empresa con su estado.
 *
 * Tres consultas para todos y no tres por tablero. `placementsForMany` lee las
 * dos fuentes de colocaciones una vez y reparte; antes esto pedía las
 * colocaciones tablero a tablero, y cada llamada releía además el catálogo
 * entero de análisis —que consulta las preguntas del usuario en la base—.
 * Catorce viajes para pintar una barra lateral, en cada navegación.
 *
 * Memoizada por petición. Quien la lee en una pantalla es `tablerosDelMenu`,
 * que además la guarda en caché entre peticiones; esto cubre el resto de
 * llamadas —el compositor, un script— para que ninguna pague dos veces la misma
 * lectura dentro de una petición.
 */
export const dashboardStates = cache(async (conexion?: DbOrTx): Promise<DashboardState[]> => {
  const db = conexion ?? (await tenantDb());

  const filas = await db
    .select({
      id: dashboards.id,
      slug: dashboards.slug,
      title: dashboards.title,
      publishedAt: dashboards.publishedAt,
    })
    .from(dashboards)
    .orderBy(asc(dashboards.title));

  if (filas.length === 0) return [];

  const [mods, porPantalla] = await Promise.all([
    db
      .select({
        dashboardId: dashboardModules.dashboardId,
        module: dashboardModules.module,
      })
      .from(dashboardModules)
      .where(
        inArray(
          dashboardModules.dashboardId,
          filas.map((f) => f.id),
        ),
      )
      .orderBy(asc(dashboardModules.position)),
    placementsForMany(filas.map((f) => dashboardScreen(f.slug)), conexion),
  ]);

  const porTablero = new Map<string, string[]>();
  for (const m of mods) {
    const lista = porTablero.get(m.dashboardId) ?? [];
    lista.push(m.module);
    porTablero.set(m.dashboardId, lista);
  }

  return filas.map((f) => ({
    slug: f.slug,
    title: f.title,
    publishedAt: f.publishedAt,
    modules: porTablero.get(f.id) ?? [],
    bloques: (porPantalla.get(dashboardScreen(f.slug)) ?? []).filter((b) => b.active)
      .length,
  }));
});

/* ------------------------- El menú, en caché ------------------------- */

/**
 * Un tablero tal como lo necesitan el menú lateral Y el botón del módulo.
 *
 * Solo cadenas y booleanos: es lo que sobrevive bien a una caché serializada, y
 * es todo lo que las dos superficies necesitan.
 */
export type TableroMenu = {
  slug: string;
  /** El nombre que le puso quien lo compuso. */
  title: string;
  /** Los módulos donde sale, en orden. El primero manda para el botón. */
  modules: string[];
  /** Las pantallas de esos módulos: es lo que decide si este rol lo ve. */
  homes: string[];
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
 * esta lista ES el tercer estado. Lo comprobé midiendo, y de la peor manera: al
 * cachear el menú, el botón dejó de compartir la lectura que antes reusaba y
 * volvió a consultar en cada pantalla de módulo. Una sola fuente lo cierra.
 *
 * ── POR QUÉ EN CACHÉ Y NO SOLO MEMOIZADO ───────────────────────────────────
 *
 * Cuelga del layout, así que se pagaba en las 68 pantallas del portal: medido,
 * 4 consultas y ~15 ms por navegación para pintar una sección que solo cambia
 * cuando alguien compone, publica o cambia dónde sale un tablero.
 *
 * Lo invalida `revalidateDashboards()` desde las acciones que lo cambian.
 */
const leerMenu = tenantCache(TABLEROS_CACHE, async (db): Promise<TableroMenu[]> =>
  (await dashboardStates(db))
    .filter((s) => s.bloques > 0 || s.publishedAt)
    .map((s) => ({
      slug: s.slug,
      title: s.title,
      modules: s.modules,
      homes: s.modules.map((m) => moduloById(m)?.home).filter((h): h is string => !!h),
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

/** El tablero por su slug, o el motivo por el que no se puede tocar. */
async function filaDe(slug: string, db: DbOrTx) {
  const [fila] = await db
    .select({ id: dashboards.id, slug: dashboards.slug })
    .from(dashboards)
    .where(eq(dashboards.slug, slug))
    .limit(1);
  return fila ?? null;
}

/**
 * Crea un tablero vacío con el nombre que le den.
 *
 * ── EL SLUG SE DERIVA DEL NOMBRE, Y DESPUÉS NO CAMBIA ──────────────────────
 *
 * Porque el slug es la dirección: está en la URL que alguien marca y en el
 * prefijo de las colocaciones de sus bloques. Renombrar un tablero de «Cierre
 * de mes» a «Cierre mensual» no puede romper el enlace que alguien mandó por
 * WhatsApp ni desconectar sus bloques. Así que el nombre se edita libremente y
 * el slug se queda como nació — igual que un número de folio.
 *
 * Si el slug ya existe se le agrega un sufijo. No se falla: dos tableros pueden
 * llamarse parecido y eso no es un error del usuario.
 */
export async function createDashboard(
  title: string,
  /**
   * El módulo desde el que se está creando, si se entró por el botón de una
   * pantalla. Siembra el tablero con los análisis de fábrica de ese módulo.
   */
  modulo?: string | null,
): Promise<{ ok: true; slug: string } | { ok: false; reason: string }> {
  const limpio = title.trim().slice(0, 120);
  if (!limpio) return { ok: false, reason: "El tablero necesita un nombre." };

  const db = await tenantDb();
  const base = slugify(limpio);

  const usados = new Set(
    (await db.select({ slug: dashboards.slug }).from(dashboards)).map((r) => r.slug),
  );
  // Los ids de módulo también están tomados: son los slugs de los siete de
  // siempre, y aunque no existieran, un tablero nuevo llamado «ventas» se
  // confundiría con el del módulo en cualquier URL.
  for (const m of MODULOS) usados.add(m.id);
  // Y `nuevo`, que es un segmento de ruta: `/admin/dashboard/nuevo` es la
  // pantalla de crear, y Next resuelve lo estático antes que lo dinámico. Un
  // tablero con ese slug existiría y no se podría abrir nunca.
  usados.add("nuevo");

  let slug = base;
  for (let i = 2; usados.has(slug); i++) slug = `${base}-${i}`;

  await db.insert(dashboards).values({ slug, title: limpio });
  if (modulo) await sembrarDesde(slug, modulo, db);
  return { ok: true, slug };
}

/**
 * Pone en el tablero nuevo los análisis de fábrica de un módulo.
 *
 * ── POR QUÉ HACE FALTA ESTO ────────────────────────────────────────────────
 *
 * El catálogo dice dónde nace cada análisis, y siete de ellos —los cuatro de
 * rentabilidad y los tres de clientes— solo nacen en un tablero: sus módulos no
 * tienen pantalla de trabajo que admita análisis. Mientras existían siete
 * tableros de fábrica eso funcionaba solo. Al borrarlos (migración 0019) esos
 * siete análisis se quedaron sin ningún sitio, disponibles pero no puestos.
 *
 * Sembrar al crear devuelve el estreno útil sin devolver el ruido: quien pulsa
 * «Crear tablero» en Rentabilidad recibe los cuatro de rentabilidad ya puestos,
 * y quien no lo pulsa no tiene siete tableros vacíos en su menú.
 *
 * Se copian como filas `factory`, no `user`: es el sistema quien las puso, y esa
 * distinción es la que enseña el compositor para que quien compone sepa qué
 * venía de fábrica y qué eligió él.
 */
async function sembrarDesde(slug: string, modulo: string, db: DbOrTx) {
  const origen = dashboardScreen(modulo);
  const deFabrica = (await analysesAll(db))
    .map((a) => ({ a, en: a.defaultOn.find((d) => d.screen === origen) }))
    .filter((x): x is { a: Analysis; en: NonNullable<typeof x.en> } => Boolean(x.en))
    .sort((x, y) => x.en.position - y.en.position);

  const destino = dashboardScreen(slug);
  for (const [i, { a, en }] of deFabrica.entries()) {
    await setPlacement({
      analysis: a.id,
      screen: destino,
      active: true,
      // Se renumera desde cero: las posiciones de fábrica tienen huecos —las
      // preguntas del usuario nacen en la 50— y copiarlas dejaría un tablero
      // nuevo con un salto que nadie pidió.
      position: i,
      width: en.width ?? "full",
      source: "system",
      conexion: db,
    });
  }
}

/** De «Cierre de mes» a `cierre-de-mes`. */
function slugify(s: string): string {
  const limpio = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  // Un nombre entero en otro alfabeto dejaría el slug vacío, y un slug vacío es
  // una URL que no se puede abrir.
  return limpio || "tablero";
}

/**
 * Guarda la COMPOSICIÓN completa: qué lleva, en qué orden y con qué ancho.
 *
 * Es el único camino de escritura de la composición. Hubo también un «agregar
 * este análisis», y sobraba desde que el compositor edita la lista entera y la
 * guarda de una vez: dos maneras de meter un bloque son dos maneras de que un
 * día metan cosas distintas.
 *
 * Recibe la lista entera y no «mueve el bloque N a la posición M», y es
 * deliberado: con un solo movimiento habría que recalcular en el servidor las
 * posiciones de todos los demás, y dos arrastres rápidos seguidos podrían
 * cruzarse y dejar el orden que ninguno de los dos pidió. Mandar la lista
 * completa hace que el último arrastre gane entero, que es lo que el usuario
 * espera de arrastrar.
 */
export async function reorderDashboard(
  slug: string,
  orden: Array<{ analysis: string; width: "full" | "half"; active: boolean }>,
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();
  if (!(await filaDe(slug, db))) return { ok: false, reason: "Ese tablero no existe." };
  const screen = dashboardScreen(slug);

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
    await tocar(slug, tx);
    return { ok: true };
  });
}

/** Publica el tablero: lo hace visible para el resto del equipo. */
export async function publishDashboard(
  slug: string,
  userId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();
  if (!(await filaDe(slug, db))) return { ok: false, reason: "Ese tablero no existe." };

  const bloques = await placementsFor(dashboardScreen(slug));
  if (bloques.filter((b) => b.active).length === 0) {
    return {
      ok: false,
      reason:
        "No hay ningún análisis encendido, así que publicarlo pondría un botón " +
        "que abre un tablero vacío. Agrega al menos uno.",
    };
  }

  await db
    .update(dashboards)
    .set({ publishedAt: new Date(), publishedById: userId, updatedAt: new Date() })
    .where(eq(dashboards.slug, slug));

  return { ok: true };
}

/** Lo retira de la vista del equipo. No borra nada de lo compuesto. */
export async function unpublishDashboard(slug: string): Promise<{ ok: boolean }> {
  const db = await tenantDb();
  await db
    .update(dashboards)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(eq(dashboards.slug, slug));
  return { ok: true };
}

export async function renameDashboard(
  slug: string,
  title: string,
): Promise<{ ok: boolean; reason?: string }> {
  const limpio = title.trim().slice(0, 120);
  if (!limpio) return { ok: false, reason: "El nombre no puede quedar vacío." };

  const db = await tenantDb();
  if (!(await filaDe(slug, db))) return { ok: false, reason: "Ese tablero no existe." };

  // El slug NO se recalcula: es la dirección. Ver `createDashboard`.
  await db
    .update(dashboards)
    .set({ title: limpio, updatedAt: new Date() })
    .where(eq(dashboards.slug, slug));
  return { ok: true };
}

/**
 * Decide en qué módulos sale el tablero.
 *
 * Recibe la lista COMPLETA y no «agrega este» / «quita aquel», por lo mismo que
 * el orden de los bloques: lo que llega de la pantalla es el estado que el
 * usuario quiere, y aplicarlo entero deja el resultado igual sin importar en
 * qué orden llegaron los clics.
 *
 * La posición sale del orden de la lista, y significa cuál manda: el botón
 * flotante de un módulo abre el tablero de menor posición. Los demás se llegan
 * por el menú lateral, que los lista todos.
 */
export async function setDashboardModules(
  slug: string,
  modulos: string[],
): Promise<{ ok: boolean; reason?: string }> {
  const db = await tenantDb();
  const fila = await filaDe(slug, db);
  if (!fila) return { ok: false, reason: "Ese tablero no existe." };

  // Se filtra contra el catálogo: la lista viene de un formulario, o sea de
  // fuera, y un módulo inventado dejaría una fila que no sale por ningún lado y
  // que nadie podría quitar desde la interfaz.
  const validos = modulos.filter((m) => moduloById(m));

  return db.transaction(async (tx) => {
    await tx.delete(dashboardModules).where(eq(dashboardModules.dashboardId, fila.id));
    if (validos.length > 0) {
      await tx.insert(dashboardModules).values(
        validos.map((module, position) => ({ dashboardId: fila.id, module, position })),
      );
    }
    await tocar(slug, tx);
    return { ok: true };
  });
}

/**
 * Los tableros que salen en un módulo, el que manda primero.
 *
 * ── QUÉ SIGNIFICA «EL QUE MANDA» ───────────────────────────────────────────
 *
 * El que tiene a ESE módulo como principal, o sea el primero de su propia lista
 * de módulos. Es lo que abre el botón flotante de la pantalla; el resto se llega
 * por el menú lateral, que los lista todos.
 *
 * La regla sale de un campo que ordena los módulos DE UN TABLERO, no los
 * tableros de un módulo — que es la confusión fácil y la que tuve yo al
 * diseñarlo. Leída así funciona y además es explicable: «este tablero es sobre
 * todo de Ventas, y de paso sale en Rentabilidad».
 *
 * El desempate es por nombre y no por fecha: si dos tableros reclaman el mismo
 * módulo como principal, el orden tiene que ser estable entre cargas o el botón
 * cambiaría de destino solo.
 *
 * Sale de la lista ya cacheada del menú, así que no cuesta una consulta.
 */
export function tablerosDelModulo(tableros: TableroMenu[], modulo: string) {
  return tableros
    .filter((t) => t.modules.includes(modulo))
    .sort((a, b) => {
      const pa = a.modules[0] === modulo ? 0 : 1;
      const pb = b.modules[0] === modulo ? 0 : 1;
      return pa - pb || a.title.localeCompare(b.title);
    });
}

/** Marca el tablero como tocado, sin cambiar su publicación. */
async function tocar(slug: string, db: DbOrTx) {
  await db
    .update(dashboards)
    .set({ updatedAt: sql`now()` })
    .where(eq(dashboards.slug, slug));
}
