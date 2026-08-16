/**
 * Peritaje de la reproducibilidad del laboratorio.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-repro.ts
 *
 * Corre el ciclo completo sobre datos reales: arma el conjunto desde Postgres,
 * lo mide, lo congela en parquet, lo vuelve a leer y lo mide otra vez. Si las
 * dos mediciones no coinciden hasta el último bit, congelar no sirve de nada —
 * y esa es exactamente la afirmación que este script existe para sostener.
 */
import "./_env";
import { sql } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";
import { templateByIdIn } from "@/lib/ml/templates";
import { type Sample } from "@/lib/ml/core";
import { chooseModel } from "@/lib/ml/select";
import { freezeDataset, readDataset, datasetPathFor } from "@/lib/analytics/datasets";
import { absolute } from "@/lib/analytics/lake";
import { rm } from "node:fs/promises";

const SCHEMA = process.argv[2] ?? "tenant_evoelution";
const SLUG = SCHEMA.replace(/^tenant_/, "");

async function main() {
  const db = tenantDbFor(SCHEMA);

  for (const id of ["service_hours", "maintenance_interval", "part_reorder"]) {
    const t = await templateByIdIn(db, id);
    if (!t) {
      console.log(`\n${id}: no existe en ${SCHEMA}`);
      continue;
    }

    // Mismo cuerpo que `datasetFor`, con el esquema explícito porque esto corre
    // fuera de una petición y `tenantDb()` necesita la cookie del inquilino.
    const rows = (await db.execute(
      sql`select * from (${t.query}) d order by at`,
    )) as unknown as Array<Record<string, unknown>>;
    const keys = Object.keys(t.featureLabels);
    const samples: Sample[] = rows.map((r) => {
      const features: Record<string, string> = {};
      for (const k of keys) features[k] = String(r[k] ?? "");
      return { at: new Date(String(r.at)), target: Number(r.target), features };
    });

    console.log(`\n${id} — ${samples.length} casos`);

    const antes = chooseModel(samples, Object.keys(t.featureLabels), {
      tolerance: t.tolerance,
      toleranceKind: t.toleranceKind,
    });
    if (!antes) {
      console.log("  no alcanzan para un backtest; nada que peritar.");
      continue;
    }

    // Versión 9999: un número que ningún entrenamiento real va a alcanzar, para
    // que la sonda no se confunda nunca con el conjunto de un modelo de verdad.
    const rel = datasetPathFor(SLUG, id, 9999);
    const frozen = await freezeDataset(samples, rel);
    const releidos = await readDataset(rel);
    const despues = chooseModel(releidos, Object.keys(t.featureLabels), {
      tolerance: t.tolerance,
      toleranceKind: t.toleranceKind,
    });

    console.log(`  congelado: ${frozen.rows} filas · ${(frozen.bytes / 1024).toFixed(1)} kB`);
    console.log(`  algoritmo: original ${antes.algorithmId} · desde parquet ${despues?.algorithmId ?? "—"}`);
    console.log(`  releído:   ${releidos.length} filas`);

    if (!despues) {
      console.log("  ✗ el conjunto releído ya no permite backtest");
      continue;
    }

    const campos = ["mae", "baselineMae", "improvement", "withinTolerance"] as const;
    let iguales = true;
    for (const c of campos) {
      const a = antes.backtest[c];
      const b = despues.backtest[c];
      const ok = Math.abs(a - b) < 1e-9;
      if (!ok) iguales = false;
      console.log(
        `  ${c.padEnd(16)} original ${a.toFixed(6).padStart(12)}` +
          ` · desde parquet ${b.toFixed(6).padStart(12)}  ${ok ? "=" : "✗ DIFIEREN"}`,
      );
    }
    console.log(iguales ? "  ✓ reproducible" : "  ✗ NO reproducible");

    // El peritaje no deja rastro: el lago solo debe contener conjuntos de
    // modelos reales, o el día que alguien lo audite encontrará archivos que no
    // corresponden a ningún entrenamiento.
    await rm(absolute(rel), { force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
