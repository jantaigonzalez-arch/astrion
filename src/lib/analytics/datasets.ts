import "server-only";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import pl from "nodejs-polars";
import { absolute } from "./lake";
import type { Sample } from "@/lib/ml/core";

/**
 * Congelar el conjunto de entrenamiento de un modelo, y volver a leerlo.
 *
 * Es la pieza que hace **reproducible** al laboratorio. Antes un modelo
 * guardaba sus métricas y la fecha de su último caso, pero no los casos: correr
 * la misma consulta un mes después devuelve otro conjunto, porque el histórico
 * creció. Con eso, «este modelo acierta el 63 %» era una afirmación que nadie
 * —ni nosotros— podía volver a comprobar.
 *
 * **Se congela el DATASET, no las tablas de origen.** Es la decisión de fondo
 * de este archivo. Extraer tickets, comentarios y equipos al lago y recompilar
 * las plantillas contra parquet habría exigido una segunda implementación de
 * `compileQuery` —una para Postgres y otra para Polars— y dos definiciones del
 * mismo conjunto es la forma más fiable de que un día digan cosas distintas. El
 * conjunto ya viene resuelto de `datasetFor`; congelarlo ahí cuesta un archivo
 * y no duplica una sola línea de lógica.
 *
 * Los rasgos se guardan **aplanados**, una columna por rasgo con prefijo `f_`,
 * en vez de un JSON. Así el archivo es legible por cualquier motor sin conocer
 * este código: quien lo abra con Polars, DuckDB o pandas ve columnas, no una
 * cadena que hay que saber desarmar.
 */

const PREFIX = "f_";

/** Dónde vive el conjunto de un modelo dentro del lago. */
export function datasetPathFor(
  slug: string,
  template: string,
  version: number,
): string {
  const safe = template.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(
    `tenant=${slug}`,
    "training",
    `${safe}-v${String(version).padStart(4, "0")}.parquet`,
  );
}

/**
 * Escribe los casos tal como los vio el entrenamiento.
 *
 * El orden de las filas se conserva. No es cosmético: el backtest parte por
 * corte temporal sobre la secuencia ordenada, así que un archivo reordenado
 * daría otro corte y, con él, otras métricas — que es exactamente lo contrario
 * de reproducir.
 */
export async function freezeDataset(
  samples: Sample[],
  relative: string,
): Promise<{ path: string; rows: number; bytes: number }> {
  const file = absolute(relative);
  await mkdir(path.dirname(file), { recursive: true });

  // La unión de rasgos de TODAS las filas, no los de la primera: una fila puede
  // traer un rasgo que otra no, y tomar la primera como plantilla dejaría
  // columnas fuera sin avisar.
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s.features)))].sort();

  const columns: Record<string, unknown[]> = {
    at: samples.map((s) => s.at),
    target: samples.map((s) => s.target),
  };
  for (const k of keys) {
    // Ausente y vacío se guardan igual —cadena vacía—, que es como los trata
    // `train`: un rasgo desconocido no agrupa. Mantener la distinción en el
    // archivo insinuaría una diferencia que el algoritmo no hace.
    columns[PREFIX + k] = samples.map((s) => s.features[k] ?? "");
  }

  pl.DataFrame(columns).writeParquet(file, { compression: "zstd" });

  return { path: relative, rows: samples.length, bytes: (await stat(file)).size };
}

/**
 * Vuelve a leer un conjunto congelado.
 *
 * Devuelve exactamente la forma que consume `chooseLadder`, así que reentrenar
 * desde un snapshot es la misma llamada que entrenar en vivo — solo cambia de
 * dónde salieron los casos. Si hiciera falta adaptar algo, ya no sería
 * reproducir.
 */
export async function readDataset(relative: string): Promise<Sample[]> {
  const df = pl.readParquet(absolute(relative));

  const featureCols = df.columns.filter((c) => c.startsWith(PREFIX));
  const at = df.getColumn("at").toArray() as Array<Date | number>;
  const target = df.getColumn("target").toArray() as number[];
  const feats = featureCols.map(
    (c) => [c.slice(PREFIX.length), df.getColumn(c).toArray() as string[]] as const,
  );

  return at.map((rawAt, i) => {
    const features: Record<string, string> = {};
    for (const [name, values] of feats) features[name] = String(values[i] ?? "");
    return { at: new Date(rawAt), target: Number(target[i]), features };
  });
}
