/**
 * Qué ve el laboratorio en un inquilino, plantilla por plantilla.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/lab-report.ts tenant_bajio
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/lab-report.ts tenant_evoelution
 *
 * Corre el examen completo —los tres algoritmos, la partición 55/15/30, el
 * tramo de prueba estrenado al final— sin escribir nada. Es el mismo camino que
 * `trainTemplate`, sin guardar modelo: para revisar la capa de ML hace falta
 * poder mirarla sin dejar rastro en `ml_models`.
 *
 * Enseña la TABLA DE LA COMPETENCIA, no solo al ganador. Un informe que dice
 * «ganó la mediana por grupo» esconde lo único interesante: por cuánto, y si
 * los otros llegaron a presentarse.
 */
import "./_env";
import { sql } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";
import { listTemplatesIn, countForIn, datasetForIn } from "@/lib/ml/templates";
import { chooseModel } from "@/lib/ml/select";
import { toleranceLabel, verdictFor } from "@/lib/ml/core";
import { ALGORITHMS } from "@/lib/ml/algorithms";

const SCHEMA = process.argv[2]?.startsWith("tenant_") ? process.argv[2] : "tenant_evoelution";
const db = tenantDbFor(SCHEMA);

async function main() {
  console.log(`\nINFORME DEL LABORATORIO · ${SCHEMA}\n`);

  const plantillas = await listTemplatesIn(db);
  if (plantillas.length === 0) {
    console.log("  No hay plantillas. ¿Se sembraron las de fábrica?");
    return;
  }

  for (const t of plantillas) {
    const { n, from, to, distinct } = await countForIn(db, t);
    const fechas =
      from && to ? `${from.toISOString().slice(0, 7)} → ${to.toISOString().slice(0, 7)}` : "—";

    console.log(`${"─".repeat(78)}`);
    console.log(`${t.label}`);
    console.log(`  ${t.question}`);
    console.log(
      `  ${n} casos · ${distinct} valores distintos · ${fechas} · tolerancia ` +
        toleranceLabel(t.tolerance, t.toleranceKind, t.unit),
    );
    console.log(`  rasgos: ${Object.values(t.featureLabels).join(" · ")}`);

    if (distinct <= 1) {
      console.log(`  ⚠ el valor a predecir es idéntico en todos los casos: no hay nada que aprender.\n`);
      continue;
    }

    // Quién alcanza su propio umbral con este volumen. El tramo de
    // entrenamiento es el 55 %, que es contra lo que se mide el umbral.
    const tramo = Math.floor(n * 0.55);
    const presentan = ALGORITHMS.filter((a) => tramo >= a.minSamples);
    const fuera = ALGORITHMS.filter((a) => tramo < a.minSamples);
    if (fuera.length) {
      console.log(
        `  no se presentan: ${fuera
          .map((a) => `${a.label} (necesita ${a.minSamples}, hay ${tramo})`)
          .join(" · ")}`,
      );
    }
    if (presentan.length === 0) {
      console.log("");
      continue;
    }

    const samples = await datasetForIn(db, t);
    const r = chooseModel(samples, Object.keys(t.featureLabels), {
      tolerance: t.tolerance,
      toleranceKind: t.toleranceKind,
    });
    if (!r) {
      console.log(`  ⚠ no alcanza para emitir un veredicto honesto.\n`);
      continue;
    }

    const b = r.backtest;
    const v = verdictFor(b);
    console.log(`\n  competencia (error sobre el tramo de VALIDACIÓN):`);
    for (const c of r.leaderboard) {
      const marca = c.algorithm === r.algorithmId ? "→" : " ";
      console.log(`    ${marca} ${c.label.padEnd(22)}${c.mae.toFixed(2)}`);
    }
    console.log(`    ${r.backtest.candidates} candidatos evaluados`);

    console.log(`\n  medición del ganador (tramo de PRUEBA, estrenado aquí):`);
    console.log(`    error            ${b.mae.toFixed(2)} ${t.unit}`);
    console.log(`    línea base       ${b.baselineMae.toFixed(2)} ${t.unit}  (predecir siempre la mediana)`);
    console.log(`    mejora           ${b.improvement.toFixed(1)} %`);
    const margen = toleranceLabel(t.tolerance, t.toleranceKind, t.unit);
    console.log(
      `    dentro de ${margen}   ${b.withinTolerance.toFixed(0)} %` +
        (b.baselineWithinTolerance === undefined
          ? ""
          : `   (la línea base acierta ${b.baselineWithinTolerance.toFixed(0)} %)`),
    );
    console.log(`    casos de prueba  ${b.nTest}`);
    console.log(`\n    ${v.approved ? "✓ APROBADO" : "✗ RECHAZADO"} — ${v.reason}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
