/**
 * Extractor del plano analítico.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/extract.ts
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/extract.ts --estado
 *
 * Se corre a mano hoy y por cron cuando haya volumen. Es idempotente: correrlo
 * dos veces seguidas no duplica nada — la segunda no encuentra eventos nuevos.
 */
import "./_env";
import { getDb } from "@/lib/db";
import { analyticsSnapshots } from "@/lib/db/platform";
import { desc, eq, sql } from "drizzle-orm";
import { extractAll, LAKE_DIR } from "@/lib/analytics/extract";
import { lakeTenants } from "@/lib/analytics/lake";

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

async function estado() {
  console.log(`lago: ${LAKE_DIR}\n`);
  const ts = await lakeTenants();
  for (const t of ts) {
    const [row] = await getDb()
      .select({
        lotes: sql<number>`count(*)::int`,
        eventos: sql<number>`coalesce(sum(${analyticsSnapshots.rows}), 0)::int`,
        bytes: sql<number>`coalesce(sum(${analyticsSnapshots.bytes}), 0)::int`,
        hasta: sql<number>`coalesce(max(${analyticsSnapshots.toEventId}), 0)::int`,
      })
      .from(analyticsSnapshots)
      .where(eq(analyticsSnapshots.tenantId, t.tenantId));

    console.log(
      `  ${t.slug.padEnd(14)} ${String(row?.eventos ?? 0).padStart(7)} eventos` +
        ` · ${String(row?.lotes ?? 0).padStart(3)} lote(s)` +
        ` · ${kb(row?.bytes ?? 0).padStart(10)}` +
        ` · marca ${row?.hasta ?? 0}` +
        ` · ${t.consents ? "aporta a modelos globales" : "solo sus propios modelos"}`,
    );
  }

  const [ultimo] = await getDb()
    .select({ path: analyticsSnapshots.path, at: analyticsSnapshots.createdAt })
    .from(analyticsSnapshots)
    .orderBy(desc(analyticsSnapshots.id))
    .limit(1);
  if (ultimo) console.log(`\n  último archivo: ${ultimo.path}`);
}

async function main() {
  if (process.argv.includes("--estado")) {
    await estado();
    return;
  }

  console.log(`extrayendo hacia ${LAKE_DIR}\n`);
  const reportes = await extractAll();

  for (const r of reportes) {
    if (r.rows === 0 && !r.skipped) {
      console.log(`  ${r.slug.padEnd(14)} sin eventos nuevos (marca ${r.watermark})`);
      continue;
    }
    console.log(
      `  ${r.slug.padEnd(14)} ${String(r.rows).padStart(7)} eventos` +
        ` · ${r.files} archivo(s) · ${kb(r.bytes)} · marca ${r.watermark}` +
        (r.skipped ? `  [${r.skipped}]` : ""),
    );
  }

  const total = reportes.reduce((a, r) => a + r.rows, 0);
  console.log(`\n${total} evento(s) extraído(s).`);

  // Los inquilinos sin consentimiento igual se extraen: su lago es suyo y
  // alimenta sus propios modelos. Lo que la compuerta decide es otra cosa.
  const sin = (await lakeTenants()).filter((t) => !t.consents).length;
  if (sin > 0) {
    console.log(
      `${sin} inquilino(s) sin consentimiento: extraídos para sus propios ` +
        `modelos, fuera de cualquier entrenamiento global.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
