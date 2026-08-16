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
