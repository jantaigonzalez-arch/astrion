/**
 * Peritaje de fuga temporal en los rasgos derivados.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/check-leakage.ts
 *
 * Un rasgo derivado resume el pasado de una entidad consigo misma, y esa es
 * justamente la clase de rasgo donde la fuga es más difícil de ver: no hay
 * ninguna columna sospechosa, el valor se calcula del propio objetivo,
 * correctamente, un instante demasiado tarde. Leer el código no alcanza.
 *
 * La prueba no lee: EXPERIMENTA. Altera el objetivo de ciertas filas y mira si
 * cambia algún rasgo que NO debería haberse enterado.
 *
 * ── SON DOS FUGAS DISTINTAS, NO UNA ────────────────────────────────────────
 *
 * La primera versión de este archivo probaba una sola cosa —corromper el futuro
 * y ver si cambiaba el pasado— y salió limpia también con la versión que se
 * suponía fugada. No era buena suerte: era que la prueba no servía. En Polars la
 * ventana rodante es TRASERA, así que quitarle el `shift(1)` no la hace mirar
 * hacia adelante; la hace incluir LA PROPIA FILA. Corromper lo que viene después
 * jamás iba a detectar eso, y un control que no puede fallar convierte toda la
 * prueba en un sello de goma.
 *
 * Así que hay dos experimentos, cada uno con su propio control fugado:
 *
 *   A · EL FUTURO   Se corrompe todo lo posterior a una fila y se exige que
 *                   ningún rasgo anterior se entere. Detecta la fuga por la
 *                   REFERENCIA del corte — comparar cada caso contra la mediana
 *                   de todo el histórico, que es el error que de verdad se
 *                   comete y que el `shift` de la expresión no evita.
 *                   Control: `refDeTodoElHistorico`.
 *
 *   B · EL PRESENTE Se corrompe el objetivo de UNA fila y se exige que su
 *                   propio rasgo no cambie. Detecta la fuga clásica: el rasgo
 *                   que se calcula incluyendo el valor que se quiere predecir.
 *                   Control: `medianaSinDesplazar`.
 */
import "./_env";
import { sql } from "drizzle-orm";
import pl from "nodejs-polars";
import { tenantDbFor } from "@/lib/tenancy/context";
import { templateByIdIn } from "@/lib/ml/templates";
import { deriveFeatures, derivedFor } from "@/lib/analytics/features";
import type { Sample } from "@/lib/ml/core";

const SCHEMA = process.argv[2]?.startsWith("tenant_")
  ? process.argv[2]
  : "tenant_evoelution";

const db = tenantDbFor(SCHEMA);

/** Lee el histórico de una plantilla, con la identidad de cada caso. */
async function historyOf(
  slug: string,
): Promise<{ samples: Sample[]; subject: string } | null> {
  const t = await templateByIdIn(db, slug);
  if (!t) return null;

  const rows = (await db.execute(
    sql`select * from (${t.query}) d order by at`,
  )) as unknown as Array<Record<string, unknown>>;

  const keys = Object.keys(t.featureLabels);
  const samples = rows.map((r) => {
    const features: Record<string, string> = {};
    for (const k of keys) features[k] = String(r[k] ?? "");
    return {
      at: new Date(String(r.at)),
      key: r.subject_key == null ? undefined : String(r.subject_key),
      target: Number(r.target),
      features,
    } satisfies Sample;
  });

  return { samples, subject: t.subjectId };
}

/* ------------------------- Los dos controles ------------------------- */

/**
 * CONTROL A — la referencia calculada sobre TODO el histórico.
 *
 * Es el error plausible, no un espantapájaros: la expresión del rasgo lleva su
 * `shift(1)` puesto y parece intachable, pero se compara contra la mediana
 * general del conjunto, que incluye los casos futuros. Basta con eso para que
 * cada fila del pasado quede medida contra información que en ese momento no
 * existía. Tiene que salir REPROBADO en el experimento A.
 */
function refDeTodoElHistorico(samples: Sample[]): Sample[] {
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const df = pl.DataFrame({
    key: ordered.map((s) => s.key as string),
    target: ordered.map((s) => s.target),
  });

  const propio = df
    .withColumn(
      pl
        .col("target")
        .shift(1)
        .rollingMedian({ windowSize: 3, minPeriods: 1 })
        .over("key")
        .alias("v"),
    )
    .getColumn("v")
    .toArray() as Array<number | null>;

  // Aquí está la fuga: una sola mediana para todos, la del conjunto completo.
  const ref = Number(df.getColumn("target").median());

  return ordered.map((s, i) => ({
    ...s,
    features: { ...s.features, control: banda(propio[i], ref) },
  }));
}

/**
 * CONTROL B — la mediana de la entidad SIN desplazar.
 *
 * La misma expresión del rasgo real quitándole el `shift(1)`: la mediana de los
 * intervalos de esa pieza incluyendo el intervalo que se quiere predecir. Tiene
 * que salir REPROBADO en el experimento B.
 */
function medianaSinDesplazar(samples: Sample[]): Sample[] {
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const df = pl.DataFrame({
    key: ordered.map((s) => s.key as string),
    target: ordered.map((s) => s.target),
  });

  const v = df
    .withColumn(
      pl
        .col("target")
        .rollingMedian({ windowSize: 3, minPeriods: 1 })
        .over("key")
        .alias("v"),
    )
    .getColumn("v")
    .toArray() as Array<number | null>;

  return ordered.map((s, i) => ({
    ...s,
    features: {
      ...s.features,
      control: v[i] === null ? "·" : String(Math.round(Number(v[i]))),
    },
  }));
}

function banda(v: number | null, ref: number): string {
  if (v === null || !Number.isFinite(v)) return "sin-historia";
  if (!Number.isFinite(ref) || ref <= 0) return "sin-referencia";
  if (v >= 1.25 * ref) return "mas-lento";
  if (v <= 0.75 * ref) return "mas-rapido";
  return "normal";
}

/* ------------------------- Las alteraciones ------------------------- */

/** Multiplica por mil el objetivo de las filas indicadas. Fechas intactas. */
const alterar = (samples: Sample[], toca: (i: number) => boolean): Sample[] =>
  samples.map((s, i) => (toca(i) ? { ...s, target: s.target * 1000 + 7 } : s));

type Resultado = {
  honesto: number;
  control: number;
  revisados: number;
  /** En cuántas sondas el control se delató. Ver `veredicto`. */
  sondasQueDelatan?: number;
  sondas?: number;
};

/** ¿Cuántos rasgos cambiaron entre dos versiones, en las filas indicadas? */
function diferencias(
  a: Sample[],
  b: Sample[],
  ids: string[],
  filas: number[],
): number {
  let n = 0;
  for (const j of filas) {
    for (const id of ids) if (a[j].features[id] !== b[j].features[id]) n++;
  }
  return n;
}

/**
 * A · EL FUTURO — corromper todo lo posterior a la sonda y revisar el pasado.
 */
function experimentoFuturo(
  ordered: Sample[],
  specs: Parameters<typeof deriveFeatures>[1],
  ids: string[],
  sondas: number[],
): Resultado {
  const base = deriveFeatures(ordered, specs);
  const baseCtl = refDeTodoElHistorico(ordered);
  let honesto = 0;
  let control = 0;
  let revisados = 0;

  for (const i of sondas) {
    const roto = alterar(ordered, (j) => j > i);
    const filas = Array.from({ length: i + 1 }, (_, j) => j);
    honesto += diferencias(base, deriveFeatures(roto, specs), ids, filas);
    control += diferencias(baseCtl, refDeTodoElHistorico(roto), ["control"], filas);
    revisados += filas.length * ids.length;
  }
  return { honesto, control, revisados };
}

/**
 * B · EL PRESENTE — corromper UNA fila y revisar su propio rasgo.
 *
 * Las sondas se eligen sobre filas cuya entidad ya tiene historia: en la primera
 * aparición de una entidad el rasgo vale `sin-historia` en ambas versiones y no
 * distingue nada, así que incluirlas solo diluiría el resultado.
 */
function experimentoPresente(
  ordered: Sample[],
  specs: Parameters<typeof deriveFeatures>[1],
  ids: string[],
  sondas: number[],
): Resultado {
  const base = deriveFeatures(ordered, specs);
  const baseCtl = medianaSinDesplazar(ordered);
  let honesto = 0;
  let control = 0;
  let delatan = 0;

  for (const i of sondas) {
    const roto = alterar(ordered, (j) => j === i);
    honesto += diferencias(base, deriveFeatures(roto, specs), ids, [i]);
    const d = diferencias(baseCtl, medianaSinDesplazar(roto), ["control"], [i]);
    control += d;
    if (d > 0) delatan++;
  }
  return {
    honesto,
    control,
    revisados: sondas.length * ids.length,
    sondasQueDelatan: delatan,
    sondas: sondas.length,
  };
}

/* ------------------------- Informe ------------------------- */

function veredicto(r: Resultado, queEsFuga: string, queDetecta: string) {
  console.log(
    `    versión honesta  → ${String(r.honesto).padStart(4)} cambios en ${r.revisados} valores   ` +
      (r.honesto === 0 ? `✓ ${queEsFuga}` : "✗ FUGA"),
  );
  // La tasa importa: un control que se delata en 2 de 6 sondas detecta la fuga,
  // sí, pero por poco. Con la ventana de 3, la mediana contaminada a veces
  // coincide por casualidad con la limpia, y eso hay que verlo, no promediarlo.
  const tasa =
    r.sondas === undefined
      ? ""
      : ` (se delató en ${r.sondasQueDelatan}/${r.sondas} sondas)`;
  console.log(
    `    control fugado   → ${String(r.control).padStart(4)} cambios${tasa}   ` +
      (r.control > 0 ? `✓ ${queDetecta}` : "✗ la prueba es un sello de goma"),
  );
}

async function periciar(slug: string) {
  const h = await historyOf(slug);
  if (!h) {
    console.log(`\n${slug}: no existe en ${SCHEMA}`);
    return;
  }

  const specs = derivedFor(h.subject);
  const ordered = [...h.samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const ids = specs.map((d) => d.id);

  console.log(`\n${slug}  ·  sujeto ${h.subject}  ·  ${ordered.length} casos`);
  console.log(`  entidades distintas : ${new Set(ordered.map((s) => s.key)).size}`);
  console.log(`  rasgos derivados    : ${ids.join(", ") || "(ninguno para este sujeto)"}`);
  if (specs.length === 0) return;

  // Sondas repartidas por todo el histórico, no solo al principio.
  const sondas = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((f) =>
    Math.floor(ordered.length * f),
  );

  // Para el experimento B, sondas sobre entidades que ya tienen historia.
  const vistas = new Set<string>();
  const conHistoria: number[] = [];
  ordered.forEach((s, i) => {
    if (vistas.has(s.key!)) conHistoria.push(i);
    vistas.add(s.key!);
  });
  // El experimento B necesita MÁS sondas que el A. En A cada sonda revisa
  // cientos de filas; en B revisa una sola, así que seis sondas son seis datos
  // y con eso no se distingue un control que detecta de uno que tuvo suerte.
  const PASO = Math.max(1, Math.floor(conHistoria.length / 60));
  const sondasB = conHistoria.filter((_, k) => k % PASO === 0);

  console.log(`\n  A · el futuro — se corrompe todo lo posterior a ${sondas.length} sondas:`);
  veredicto(
    experimentoFuturo(ordered, specs, ids, sondas),
    "el pasado no se entera de lo que viene después",
    "detectaría una referencia calculada sobre todo el histórico",
  );

  console.log(`\n  B · el presente — se corrompe el objetivo de ${sondasB.length} casos sueltos:`);
  veredicto(
    experimentoPresente(ordered, specs, ids, sondasB),
    "el rasgo no se calcula con el valor que quiere predecir",
    "detectaría una mediana sin desplazar",
  );

  // Cómo quedan repartidas las categorías: un rasgo que sale casi siempre igual
  // no agrupa nada, y eso hay que verlo antes de creerle al backtest.
  console.log("\n  reparto de categorías:");
  const base = deriveFeatures(ordered, specs);
  for (const id of ids) {
    const c = new Map<string, number>();
    for (const s of base) c.set(s.features[id], (c.get(s.features[id]) ?? 0) + 1);
    console.log(
      `    ${id.padEnd(18)} ${[...c.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}:${n}`)
        .join("  ")}`,
    );
  }
}

async function main() {
  console.log("PERITAJE DE FUGA TEMPORAL EN RASGOS DERIVADOS");
  for (const slug of ["maintenance_interval", "part_reorder", "service_hours"]) {
    await periciar(slug);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
