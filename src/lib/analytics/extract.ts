import "server-only";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import pl from "nodejs-polars";
import { and, eq, desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { analyticsSnapshots } from "@/lib/db/platform";
import { tenantDbFor } from "@/lib/tenancy/context";
import { LAKE_DIR, absolute, batchPath, lakeTenants, type LakeTenant } from "./lake";

/**
 * Extractor incremental: del esquema de cada inquilino al lago, por `id`.
 *
 * `domain_events.id` es `bigserial` y no uuid **exactamente para esto** — lo
 * dice el propio documento de arquitectura—. Un entero que solo crece da un
 * marcador de agua exacto: «ya me llevé hasta el 1 175». Con uuid habría que
 * paginar por fecha, y una fecha no distingue dos eventos del mismo instante ni
 * sobrevive a un reloj que se corrige hacia atrás.
 *
 * Tres propiedades que sostienen todo lo que se construya encima:
 *
 * **Solo-anexado.** Un lote escrito no se toca nunca más. Reprocesar es leer
 * otra vez, no reescribir — que es lo que permite responder «¿con qué datos se
 * entrenó este modelo?» con una lista de archivos.
 *
 * **Idempotente.** El rango se reserva en Postgres con un índice único antes de
 * que nadie lea el archivo. Dos corridas simultáneas no duplican: la segunda
 * choca y se detiene.
 *
 * **Aislado por construcción.** Cada inquilino se lee con `tenantDbFor(su
 * esquema)` y se escribe a `tenant=<slug>/`. No hay un solo punto donde los
 * datos de dos inquilinos estén en la misma estructura en memoria.
 */

/** Eventos por archivo. Ver la nota de `BATCH`. */
const BATCH = 50_000;

export type ExtractReport = {
  slug: string;
  /** Eventos escritos en esta corrida. */
  rows: number;
  files: number;
  bytes: number;
  /** Hasta dónde quedó el marcador de agua. */
  watermark: number;
  skipped?: string;
};

/** Hasta dónde se extrajo ya este inquilino. Cero si nunca. */
async function watermarkOf(tenantId: string): Promise<number> {
  const [row] = await getDb()
    .select({ to: analyticsSnapshots.toEventId })
    .from(analyticsSnapshots)
    .where(eq(analyticsSnapshots.tenantId, tenantId))
    .orderBy(desc(analyticsSnapshots.toEventId))
    .limit(1);
  return row?.to ?? 0;
}

/**
 * Un lote de eventos, ya en forma de columnas.
 *
 * `payload` viaja como TEXTO JSON y no como estructura anidada. Es una decisión,
 * no una limitación: el payload de un evento cambia de forma con cada tipo
 * —`ticket.created` no se parece a `part.consumed`— y forzar todos a un esquema
 * común obligaría a un tipo unión gigante que se rompe cada vez que alguien
 * añade un evento. Como texto, el archivo nunca deja de escribirse; quien
 * consulte lo abre con las funciones JSON del motor, que Polars y DuckDB tienen.
 */
type EventRow = {
  id: bigint;
  aggregate_type: string;
  aggregate_id: string | null;
  event_type: string;
  payload: string;
  actor_id: string | null;
  company_id: string | null;
  occurred_at: Date;
};

async function readBatch(
  schemaName: string,
  after: number,
  limit: number,
): Promise<EventRow[]> {
  const db = tenantDbFor(schemaName);
  const rows = (await db.execute(sql`
    select id, aggregate_type, aggregate_id::text as aggregate_id, event_type,
           payload::text as payload, actor_id::text as actor_id,
           company_id::text as company_id, occurred_at
      from domain_events
     where id > ${after}
     order by id
     limit ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: BigInt(String(r.id)),
    aggregate_type: String(r.aggregate_type),
    aggregate_id: r.aggregate_id ? String(r.aggregate_id) : null,
    event_type: String(r.event_type),
    payload: String(r.payload ?? "{}"),
    actor_id: r.actor_id ? String(r.actor_id) : null,
    company_id: r.company_id ? String(r.company_id) : null,
    occurred_at: new Date(String(r.occurred_at)),
  }));
}

/** Escribe el lote como parquet y devuelve su tamaño en disco. */
async function writeParquet(rows: EventRow[], relative: string): Promise<number> {
  const file = absolute(relative);
  await mkdir(path.dirname(file), { recursive: true });

  const df = pl.DataFrame({
    id: rows.map((r) => r.id),
    aggregate_type: rows.map((r) => r.aggregate_type),
    aggregate_id: rows.map((r) => r.aggregate_id),
    event_type: rows.map((r) => r.event_type),
    payload: rows.map((r) => r.payload),
    actor_id: rows.map((r) => r.actor_id),
    company_id: rows.map((r) => r.company_id),
    occurred_at: rows.map((r) => r.occurred_at),
  });

  // zstd y no snappy: comprime bastante mejor sobre texto repetitivo —que es
  // justo lo que son estos payloads— y lo leen todos los motores modernos.
  df.writeParquet(file, { compression: "zstd" });

  return (await stat(file)).size;
}

/**
 * Extrae lo pendiente de UN inquilino.
 *
 * El orden importa y es el inverso del intuitivo: primero se reserva el rango
 * en Postgres, después se escribe el archivo. Al revés, una corrida que muere
 * entre escribir y registrar dejaría un parquet huérfano que la siguiente
 * corrida volvería a generar con otro nombre — dos archivos con los mismos
 * eventos y nadie sabiendo cuál vale. Así, el peor caso es una fila registrada
 * cuyo archivo falta: ruidoso, detectable y corregible.
 */
export async function extractTenant(t: LakeTenant): Promise<ExtractReport> {
  const report: ExtractReport = {
    slug: t.slug,
    rows: 0,
    files: 0,
    bytes: 0,
    watermark: await watermarkOf(t.tenantId),
  };

  for (;;) {
    const rows = await readBatch(t.schemaName, report.watermark, BATCH);
    if (rows.length === 0) break;

    const from = report.watermark;
    const to = Number(rows[rows.length - 1].id);
    const relative = batchPath(t.slug, from, to);

    try {
      await getDb().insert(analyticsSnapshots).values({
        tenantId: t.tenantId,
        fromEventId: from,
        toEventId: to,
        rows: rows.length,
        path: relative,
        bytes: 0,
        // Se congela lo que era cierto AL EXTRAER, para poder auditarlo. Quién
        // puede leerlo después lo decide el consentimiento vigente. Ver `lake.ts`.
        consentedAtExtraction: t.consents,
      });
    } catch {
      // El índice único rechazó el rango: otra corrida ya lo tomó. No es un
      // error de datos, es el mecanismo funcionando.
      report.skipped = `el rango ${from + 1}–${to} ya estaba registrado`;
      break;
    }

    const bytes = await writeParquet(rows, relative);
    await getDb()
      .update(analyticsSnapshots)
      .set({ bytes })
      .where(
        and(
          eq(analyticsSnapshots.tenantId, t.tenantId),
          eq(analyticsSnapshots.toEventId, to),
        ),
      );

    report.rows += rows.length;
    report.files += 1;
    report.bytes += bytes;
    report.watermark = to;

    // Un lote incompleto significa que ya no queda nada por leer.
    if (rows.length < BATCH) break;
  }

  return report;
}

/** Extrae todos los inquilinos aprovisionados. */
export async function extractAll(): Promise<ExtractReport[]> {
  const out: ExtractReport[] = [];
  // En serie y no en paralelo: cada inquilino abre su propio pool contra
  // Postgres, y lanzarlos todos a la vez agotaría las conexiones justo cuando
  // el número de inquilinos crezca — que es cuando esto empieza a importar.
  for (const t of await lakeTenants()) {
    out.push(await extractTenant(t));
  }
  return out;
}

export { LAKE_DIR };
