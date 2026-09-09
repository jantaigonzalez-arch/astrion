import "server-only";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tenants, tenantSchemas } from "@/lib/db/platform";

/**
 * El lago: dónde viven los parquet y quién puede leer los de quién.
 *
 * Es el plano analítico que `docs/ARQUITECTURA-SAAS.md` describe en la Fase 3.
 * Existe porque el aislamiento por esquema —que es lo que hace vendible el
 * producto ante un laboratorio farmacéutico— hace imposible aprender de muchos
 * inquilinos a la vez en el plano transaccional. La salida no es relajar el
 * aislamiento: es extraer al lago, y poner ahí la compuerta.
 *
 * **Formato: parquet suelto, particionado al estilo Hive** (`tenant=<slug>/…`).
 * No es un paso previo a Iceberg por accidente: es exactamente el layout que
 * `add_files` de Iceberg registra sin reescribir un solo byte, el día que
 * alguno de los tres disparadores del documento se cumpla. Hoy no se cumple
 * ninguno: un catálogo REST arbitrando entre un escritor y un lector no arbitra
 * nada.
 */

/**
 * Raíz del lago.
 *
 * Fuera del árbol de la aplicación a propósito: en producción es un volumen
 * montado, y dejarlo bajo `public/` lo habría publicado por HTTP — el error
 * más caro imaginable en esta tabla concreta.
 */
export const LAKE_DIR =
  process.env.ANALYTICS_LAKE_DIR ?? path.join(process.cwd(), ".lake");

/** Un inquilino visto desde el extractor. */
export type LakeTenant = {
  tenantId: string;
  slug: string;
  schemaName: string;
  /** Consentimiento VIGENTE para entrenar modelos globales. */
  consents: boolean;
};

/**
 * Los inquilinos aprovisionados, con su consentimiento actual.
 *
 * Solo los que tienen esquema: un inquilino dado de alta pero sin aprovisionar
 * no tiene de dónde extraer, y pedirle eventos daría un error de relación
 * inexistente en vez de una lista vacía.
 */
export async function lakeTenants(): Promise<LakeTenant[]> {
  const rows = await getDb()
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      schemaName: tenantSchemas.schemaName,
      consents: tenants.mlContribution,
    })
    .from(tenants)
    .innerJoin(tenantSchemas, eq(tenantSchemas.tenantId, tenants.id))
    .orderBy(tenants.slug);

  return rows.filter((r): r is LakeTenant => Boolean(r.schemaName));
}

/**
 * Ruta relativa del archivo de un lote. Relativa, nunca absoluta: el lago se
 * mueve entre el portátil y el volumen de producción, y una ruta absoluta
 * guardada en la base convertiría ese movimiento en una migración de datos.
 *
 * El nombre lleva el rango de eventos que contiene y va rellenado con ceros
 * para que el orden alfabético coincida con el cronológico — que es como lo va
 * a listar cualquier motor que lea el directorio.
 */
export function batchPath(slug: string, fromId: number, toId: number): string {
  const pad = (n: number) => String(n).padStart(12, "0");
  return path.join(
    `tenant=${slug}`,
    "domain_events",
    `${pad(fromId + 1)}-${pad(toId)}.parquet`,
  );
}

/** La misma ruta, absoluta, para abrir el archivo. */
export function absolute(relative: string): string {
  return path.join(LAKE_DIR, relative);
}

/**
 * Qué inquilinos pueden entrar a un entrenamiento GLOBAL.
 *
 * El consentimiento se evalúa aquí, al leer, y no se hereda de lo que se grabó
 * al extraer. Es deliberado: si la elegibilidad quedara congelada en el archivo,
 * revocar el consentimiento exigiría borrar parquet —y un consentimiento que
 * solo se puede revocar borrando datos no es revocable, es una promesa—. Así,
 * revocar es un `UPDATE` y surte efecto en el siguiente entrenamiento.
 *
 * Lo que un inquilino entrena con SUS PROPIOS datos nunca pasa por esta puerta:
 * su lago es suyo, con consentimiento o sin él.
 */
export async function consentingTenants(): Promise<LakeTenant[]> {
  return (await lakeTenants()).filter((t) => t.consents);
}

/**
 * CUÁNTO PESA EL LAGO, para el tablero de capacidad.
 *
 * ── POR QUÉ ESTO NO ESTABA EN EL CÁLCULO DE CAPACIDAD ──────────────────────
 *
 * Porque hoy el lago está VACÍO —nadie ha corrido el extractor en producción— y
 * un tablero que solo mira la base transaccional da una cifra tranquilizadora
 * de un sistema al que le falta arrancar una capa entera. La cifra no estaba
 * mal: estaba incompleta, que en un tablero de capacidad es lo mismo que estar
 * mal.
 *
 * ── SE RECORRE EL DIRECTORIO, Y CON TOPE ──────────────────────────────────
 *
 * No hay índice de esto en ninguna parte: son ficheros. Se camina el árbol con
 * un tope de archivos para que la pantalla no se quede colgada el día que el
 * lago tenga cientos de miles de parquet — cuando eso pase, el número aproximado
 * y un aviso valen más que una pantalla que no carga. `parcial` lo dice.
 */
export type PesoDelLago = {
  bytes: number;
  archivos: number;
  /** Se alcanzó el tope y el número es un piso, no un total. */
  parcial: boolean;
};

export async function pesoDelLago(tope = 20_000): Promise<PesoDelLago> {
  const { stat, readdir } = await import("node:fs/promises");
  let bytes = 0;
  let archivos = 0;
  let parcial = false;

  async function caminar(dir: string): Promise<void> {
    if (archivos >= tope) {
      parcial = true;
      return;
    }
    let entradas;
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      // El volumen puede no estar montado —en desarrollo casi nunca lo está—.
      // Devolver cero es correcto: no hay lago que medir.
      return;
    }
    for (const e of entradas) {
      if (archivos >= tope) {
        parcial = true;
        return;
      }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await caminar(p);
      else {
        archivos++;
        bytes += (await stat(p)).size;
      }
    }
  }

  await caminar(LAKE_DIR);
  return { bytes, archivos, parcial };
}

/**
 * EL DISCO DE VERDAD, visto desde dentro del contenedor.
 *
 * ── POR QUÉ ESTO SÍ SE PUEDE Y YO DIJE QUE NO ─────────────────────────────
 *
 * Se dio por imposible: «la aplicación corre en un contenedor y desde ahí solo
 * ve el suyo». Es cierto para CPU y memoria —`/proc` está acotado por cgroups—
 * y FALSO para el disco: los volúmenes montados viven en el sistema de archivos
 * del anfitrión, así que `statfs` sobre uno devuelve el tamaño y el hueco
 * REALES de esa partición. Comprobado contra `df` en el servidor: 74,8 GB de
 * 74,8 y 42,5 libres de 43.
 *
 * La lección es la de siempre en este repositorio: se comprobó ejecutando, no
 * razonando. El razonamiento era plausible y costaba un tablero incompleto.
 *
 * ── SOBRE `LAKE_DIR` Y NO SOBRE `/` ───────────────────────────────────────
 *
 * Porque es lo que está montado, y porque es la partición que importa: ahí
 * viven el volumen de Postgres, el lago y los comprobantes subidos. Si algún
 * día se separan en discos distintos, esta cifra dejará de ser la única que
 * hace falta — y entonces se notará, porque el número dejará de cuadrar con lo
 * que crece.
 */
export type EspacioEnDisco = {
  totalBytes: number;
  libresBytes: number;
  /** Falso cuando no hay volumen montado —desarrollo—: mide el disco local. */
  desdeElVolumen: boolean;
};

export async function espacioEnDisco(): Promise<EspacioEnDisco | null> {
  const { statfs } = await import("node:fs/promises");
  for (const [ruta, delVolumen] of [
    [LAKE_DIR, true],
    [process.cwd(), false],
  ] as const) {
    try {
      const s = await statfs(ruta);
      return {
        totalBytes: s.blocks * s.bsize,
        // `bavail` y no `bfree`: hay bloques reservados para root que una
        // aplicación no puede usar, y contarlos prometería un hueco que no
        // existe justo cuando el disco se está llenando.
        libresBytes: s.bavail * s.bsize,
        desdeElVolumen: delVolumen,
      };
    } catch {
      /* se prueba la siguiente */
    }
  }
  return null;
}
