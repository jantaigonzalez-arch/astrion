/**
 * BORRAR UN ENTRENAMIENTO: QUÉ SE VA Y QUÉ SE QUEDA.
 *
 * Lo que hay que fijar aquí no es que borre —eso es un `delete`— sino sus dos
 * bordes: que lo que está SIRVIENDO no se pueda borrar, y que borrar se lleve
 * sus pronósticos y NADA MÁS. Un borrado que se lleva de más en una tabla de
 * modelos entrenados no se nota hasta que alguien busca el histórico.
 *
 *   npx tsx --tsconfig tsconfig.check.json probe-borrar-modelos.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
const { tenantDbFor } = await import("./src/lib/tenancy/context.ts");
const { mlModels, mlForecasts, mlTemplates } = await import("./src/lib/db/schema.ts");
const { eq, and, sql } = await import("drizzle-orm");

const db = tenantDbFor("tenant_evoelution");
let fallos = 0;
const ok = (l: string, c: boolean, e = "") => {
  if (!c) fallos++;
  console.log(`${c ? "✓" : "✗"} ${l}${e ? ` — ${e}` : ""}`);
};

const TAG = "PRB-BORRAR";
const limpiar = async () => {
  await db.delete(mlModels).where(eq(mlModels.template, TAG));
  await db.delete(mlTemplates).where(eq(mlTemplates.slug, TAG));
};
await limpiar();

/*
  Se monta una pregunta de prueba con tres entrenamientos —uno rechazado, uno
  probado y uno sirviendo— y el que sirve con pronósticos colgados. Es la forma
  real de una pregunta trabajada, y es donde el borrado puede hacer daño.
*/
await db.insert(mlTemplates).values({
  slug: TAG, label: "Prueba de borrado", module: "servicio",
  question: "?", subject: "x", target: "x", task: "forecast", horizon: 3, grain: "month",
  tolerance: "10", toleranceKind: "pct", algorithm: "auto",
} as never);

const crear = async (status: string, version: number) => {
  const [m] = await db.insert(mlModels).values({
    template: TAG, version, status, algorithm: "naive",
    metrics: {}, params: {}, dataProfile: {}, beatsBaseline: false,
  } as never).returning({ id: mlModels.id });
  return m.id;
};
const rechazado = await crear("rejected", 1);
const probado = await crear("backtested", 2);
const sirviendo = await crear("production", 3);

await db.insert(mlForecasts).values([
  { modelId: sirviendo, period: "2026-10-01", subjectKey: "x", value: "10" },
  { modelId: sirviendo, period: "2026-11-01", subjectKey: "x", value: "11" },
  { modelId: probado, period: "2026-10-01", subjectKey: "x", value: "9" },
] as never);

const cuantos = async (estado?: string) => {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(mlModels)
    .where(estado ? and(eq(mlModels.template, TAG), eq(mlModels.status, estado))
                  : eq(mlModels.template, TAG));
  return r[0].n;
};
const pronosticos = async (modelId: string) => {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(mlForecasts)
    .where(eq(mlForecasts.modelId, modelId));
  return r[0].n;
};

try {
  const { deleteModel, deleteRejectedModels } =
    await import("./src/lib/intelligence/questions.ts");

  console.log("── lo que está sirviendo NO se borra ──");
  const enProduccion = await deleteModel(sirviendo, db as never);
  ok("se rechaza", !enProduccion.ok);
  ok("y dice qué hacer antes", (enProduccion.reason ?? "").includes("Retíralo"),
     enProduccion.reason ?? "");
  ok("sigue ahí", (await cuantos("production")) === 1);
  ok("y sus pronósticos también", (await pronosticos(sirviendo)) === 2);

  console.log("\n── borrar uno probado se lleva SUS pronósticos y nada más ──");
  const antesOtros = await pronosticos(sirviendo);
  const r = await deleteModel(probado, db as never);
  ok("se borra", r.ok);
  ok("el modelo ya no está", (await cuantos()) === 2);
  ok("sus pronósticos se fueron por cascada", (await pronosticos(probado)) === 0);
  ok("los del que sirve siguen intactos", (await pronosticos(sirviendo)) === antesOtros,
     `${await pronosticos(sirviendo)} de ${antesOtros}`);

  console.log("\n── borrar el que ya no existe no revienta ──");
  const otra = await deleteModel(probado, db as never);
  ok("responde que no existe", !otra.ok && (otra.reason ?? "").includes("no existe"),
     otra.reason ?? "");

  // El caso más común de todos: un intento que salió rechazado y estorba.
  console.log("\n── un rechazado se borra de uno en uno ──");
  const suelto = await deleteModel(rechazado, db as never);
  ok("se borra sin preguntar nada", suelto.ok, suelto.reason ?? "");

  console.log("\n── limpiar rechazados: solo los rechazados ──");
  await crear("rejected", 4);
  await crear("rejected", 5);
  await crear("retired", 6);
  const limpieza = await deleteRejectedModels(TAG, db as never);
  ok("borra los dos rechazados que quedaban", limpieza.borrados === 2,
     `${limpieza.borrados}`);
  ok("no toca el retirado", (await cuantos("retired")) === 1);
  ok("ni el que sirve", (await cuantos("production")) === 1);

  /*
    ── QUE NO SE LLEVE LO DE AL LADO ─────────────────────────────────────

    `deleteRejectedModels` filtra por `template`, y un `and` mal puesto ahí
    borraría los rechazados de TODAS las preguntas de la empresa sin que nadie se
    entere hasta buscarlos. Así que se monta una segunda pregunta con su propio
    rechazado y se comprueba que sigue en pie.

    Aquí había un aserto que no servía: contaba los modelos ajenos y comprobaba
    `>= 0`, que es cierto siempre —y encima daba 0, así que ni siquiera había
    nada que proteger—. Un aserto que no puede fallar es peor que no tenerlo:
    ocupa el sitio del que sí comprobaría algo.
  */
  console.log("\n── y no toca los rechazados de OTRA pregunta ──");
  const VECINA = `${TAG}-VECINA`;
  await db.insert(mlTemplates).values({
    slug: VECINA, label: "Vecina", module: "servicio",
    question: "?", subject: "x", target: "x", task: "forecast", horizon: 3,
    grain: "month", tolerance: "10", toleranceKind: "pct", algorithm: "auto",
  } as never);
  await db.insert(mlModels).values({
    template: VECINA, version: 1, status: "rejected", algorithm: "naive",
    metrics: {}, params: {}, dataProfile: {}, beatsBaseline: false,
  } as never);

  await deleteRejectedModels(TAG, db as never);

  const vecinos = await db.select({ n: sql<number>`count(*)::int` }).from(mlModels)
    .where(eq(mlModels.template, VECINA));
  ok("el rechazado de la pregunta vecina sigue ahí", vecinos[0].n === 1,
     `${vecinos[0].n}`);

  await db.delete(mlModels).where(eq(mlModels.template, VECINA));
  await db.delete(mlTemplates).where(eq(mlTemplates.slug, VECINA));
} finally {
  await limpiar();
  console.log("— limpieza hecha —");
}

console.log(fallos === 0 ? "\n✅ sin discrepancias" : `\n✗ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
