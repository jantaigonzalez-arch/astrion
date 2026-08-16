/**
 * ¿Los rasgos derivados MEJORAN algo, o solo suenan bien?
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/measure-derived.ts
 *
 * Que no filtren el futuro (`check-leakage.ts`) solo dice que son legítimos. No
 * dice que sirvan. Esto los mide con el mismo examen que usa el laboratorio
 * —`chooseModel`, partición 55/15/30, tramo de prueba estrenado al final— sobre
 * el histórico real, y compara contra la plantilla como está hoy.
 *
 * ── LO QUE ESTA MEDICIÓN NO PUEDE DECIR ────────────────────────────────────
 *
 * Las variantes comparten el tramo de prueba. Comparar tres variantes sobre el
 * mismo tramo es exactamente la trampa contra la que advierte `chooseModel`:
 * cuantos más candidatos se miden contra un mismo conjunto, más probable es que
 * alguno gane por azar. Aquí es tolerable porque las variantes están decididas
 * de antemano y son pocas —tres, no treinta—, y porque la pregunta no es «cuál
 * es el mejor modelo» sino «¿esto aporta algo o no?».
 *
 * Si una variante ganara y se quisiera adoptar, su número honesto NO es el de
 * aquí: es el que salga de entrenarla por el camino normal, con su propio
 * examen. Este archivo sirve para decidir si vale la pena mirar, no para
 * publicar una cifra.
 *
 * ── POR QUÉ EL CÁLCULO NO CRUZA LA PARTICIÓN ───────────────────────────────
 *
 * Los derivados se calculan sobre el histórico completo ANTES de partirlo, y
 * eso parecería contaminar el tramo de prueba. No lo hace: el rasgo de la fila
 * i resume solo las filas anteriores a i de su misma entidad, estén donde
 * estén. En el instante en que esa fila ocurrió, todas ellas ya habían pasado.
 * Partir primero y calcular después daría un número DISTINTO y peor —las
 * primeras filas de cada tramo se quedarían sin historia que resumir— y además
 * sería mentir en la otra dirección: en producción esa historia sí existe.
 */
import "./_env";
import { sql } from "drizzle-orm";
import { tenantDbFor } from "@/lib/tenancy/context";
import { templateByIdIn } from "@/lib/ml/templates";
import { deriveFeatures, derivedFor } from "@/lib/analytics/features";
import { chooseModel } from "@/lib/ml/select";
import { verdictFor } from "@/lib/ml/core";
import type { Sample } from "@/lib/ml/core";

const SCHEMA = process.argv[2]?.startsWith("tenant_")
  ? process.argv[2]
  : "tenant_evoelution";

const db = tenantDbFor(SCHEMA);

async function medir(slug: string) {
  const t = await templateByIdIn(db, slug);
  if (!t) {
    console.log(`\n${slug}: no existe en ${SCHEMA}`);
    return;
  }

  const disponibles = derivedFor(t.subjectId);
  const base = Object.keys(t.featureLabels).filter(
    (id) => !disponibles.some((d) => d.id === id),
  );

  console.log(`\n${"─".repeat(74)}`);
  console.log(`${t.label}  ·  ${t.question}`);
  console.log(`  sujeto ${t.subjectId}  ·  tolerancia ±${t.tolerance} ${t.unit}`);

  if (disponibles.length === 0) {
    console.log("  este sujeto no admite rasgos derivados: cada entidad aparece una vez.");
    return;
  }

  // El histórico crudo, con la identidad de cada caso.
  const rows = (await db.execute(
    sql`select * from (${t.query}) d order by at`,
  )) as unknown as Array<Record<string, unknown>>;

  const crudo: Sample[] = rows.map((r) => {
    const features: Record<string, string> = {};
    for (const id of base) features[id] = String(r[id] ?? "");
    return {
      at: new Date(String(r.at)),
      key: r.subject_key == null ? undefined : String(r.subject_key),
      target: Number(r.target),
      features,
    };
  });

  const enriquecido = deriveFeatures(crudo, disponibles);
  const ids = disponibles.map((d) => d.id);

  // Tres variantes decididas de antemano. El tope de 4 rasgos es el mismo que
  // rige en la pantalla: una variante que lo pasara no se podría crear.
  const variantes: Array<{ nombre: string; feats: string[] }> = [
    { nombre: "como está hoy", feats: base },
    { nombre: "hoy + ritmo propio", feats: [...base, "ritmo_propio"].slice(0, 4) },
    { nombre: "solo derivados", feats: ids },
    // Sueltos, para saber a quién atribuirle el resultado. Sin esto, «solo
    // derivados» sale como un bloque y no se puede decir si arrastra uno o los
    // tres — que es justo lo que hay que saber para quitar o dejar.
    ...ids.map((id) => ({ nombre: `solo ${id}`, feats: [id] })),
  ];

  console.log(`  ${crudo.length} casos  ·  rasgos de hoy: ${base.join(", ")}`);
  console.log(
    `\n  ${"variante".padEnd(24)}${"n".padEnd(3)}${"algoritmo".padEnd(17)}` +
      `${"error".padEnd(9)}${"base".padEnd(9)}${"mejora".padEnd(9)}${"dentro".padEnd(8)}veredicto`,
  );

  for (const v of variantes) {
    const usa = v.feats.some((id) => ids.includes(id)) ? enriquecido : crudo;
    const r = chooseModel(usa, v.feats, { tolerance: t.tolerance });

    if (!r) {
      console.log(`  ${v.nombre.padEnd(24)}${String(v.feats.length).padEnd(3)}— no se pudo evaluar`);
      continue;
    }

    const b = r.backtest;
    const ver = verdictFor(b);
    // `withinTolerance` ya viene en porcentaje. Ver `backtestWith`.
    const cfg = r.config as { maxDepth?: number } | undefined;
    const quien = cfg?.maxDepth ? `${r.algorithmId}(≤${cfg.maxDepth})` : r.algorithmId;
    console.log(
      `  ${v.nombre.padEnd(24)}${String(v.feats.length).padEnd(3)}` +
        `${quien.padEnd(17)}` +
        `${b.mae.toFixed(2).padEnd(9)}` +
        `${b.baselineMae.toFixed(2).padEnd(9)}` +
        `${`${b.improvement.toFixed(1)}%`.padEnd(9)}` +
        `${`${b.withinTolerance.toFixed(0)}%`.padEnd(8)}` +
        (ver.approved ? "APROBADO" : "rechazado"),
    );
  }

  console.log(
    "\n  error = desviación media en " +
      `${t.unit}; base = la misma cifra prediciendo siempre la mediana; ` +
      `dentro = qué fracción cae a ±${t.tolerance}.`,
  );
}

async function main() {
  console.log("¿APORTAN LOS RASGOS DERIVADOS?");
  for (const slug of ["maintenance_interval", "part_reorder", "service_hours"]) {
    await medir(slug);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
