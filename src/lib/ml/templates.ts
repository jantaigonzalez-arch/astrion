import "server-only";
import { asc, eq, sql, type SQL } from "drizzle-orm";
import { tenantDb } from "@/lib/tenancy/context";
import { mlTemplates } from "@/lib/db/schema";
import type { Ladder, Sample } from "./core";
import {
  deriveFeatures,
  deriveForLive,
  derivedFor,
  type Derived,
} from "@/lib/analytics/features";
import {
  compileQuery,
  compileServingQuery,
  sqlFeatures,
  featureById,
  laddersFor,
  subjectById,
  targetById,
  type Definition,
} from "./blocks";

/**
 * Las plantillas de esta empresa, compiladas desde sus bloques.
 *
 * Antes eran dos constantes en este archivo. El techo era evidente: para
 * preguntar algo nuevo había que tocar el código y desplegar, así que el
 * laboratorio solo podía responder lo que alguien de Evoelution hubiera
 * previsto. Ahora las preguntas viven en `ml_templates` y cada empresa arma las
 * suyas.
 *
 * Lo que NO cambió, y es el punto: la consulta se sigue compilando desde un
 * vocabulario cerrado (`blocks.ts`). El usuario elige entre bloques revisados;
 * nunca escribe SQL, nunca elige el ancla temporal y no puede seleccionar un
 * rasgo del futuro porque no existe en el catálogo. La garantía contra la fuga
 * de información es la misma de antes, y por la misma razón de antes.
 *
 * Las consultas usan `tenantDb()`, así que solo alcanzan el esquema de la
 * empresa activa. Ni siquiera hay que acordarse de filtrar por inquilino: no
 * existe forma de nombrar el esquema de otro.
 */

export type Template = {
  id: string;
  label: string;
  question: string;
  unit: string;
  subjectType: "ticket" | "equipment" | "part" | "period";
  /**
   * Qué sujeto es, con el id de la ontología.
   *
   * `subjectType` dice a QUÉ se le pega la predicción —un equipo, una pieza— y
   * eso no alcanza: dos sujetos distintos pueden compartirlo. Lo necesita todo
   * el que tenga que volver a la ontología, y hasta ahora quien lo necesitaba
   * lo deducía del slug, que es adivinar.
   */
  subjectId: string;
  tolerance: number;
  /** Etiquetas legibles de los rasgos elegidos. Manda sobre qué se lee. */
  featureLabels: Record<string, string>;
  /** Las escaleras que van a competir. Ver `chooseLadder`. */
  ladders: Ladder[];
  /**
   * Los rasgos elegidos que se calculan con ventanas y no con SQL.
   *
   * Viaja en la plantilla porque el histórico y el caso vivo tienen que pasar
   * por la MISMA lista: si el entrenamiento calculara un rasgo que el servicio
   * no, el modelo pediría en producción una columna que nadie le da y caería
   * al peldaño más general de la escalera sin que nada lo denuncie.
   */
  derived: Derived[];
  query: SQL;
  featuresFor: (subjectId: string) => Promise<Record<string, string> | null>;
  predictOncePerSubject: boolean;
  /** De fábrica: no se puede borrar. */
  builtin: boolean;
};

/* ------------------------- Construcción ------------------------- */

type Row = {
  slug: string;
  label: string;
  question: string;
  subject: string;
  target: string;
  features: string[];
  tolerance: string;
  builtin: boolean;
};

/**
 * De una fila a una plantilla usable.
 *
 * Devuelve `null` si algún bloque ya no existe. Puede pasar de verdad: alguien
 * crea una plantilla con un rasgo que en una versión posterior se retira del
 * catálogo por dejar de ser seguro. Ante eso, la plantilla desaparece de la
 * pantalla en vez de compilar a medias — un modelo entrenado con un rasgo que
 * ya no se puede sostener es exactamente lo que este módulo no quiere producir.
 */
function build(r: Row): Template | null {
  const subject = subjectById(r.subject);
  const target = targetById(r.target);
  if (!subject || !target || target.subject !== subject.id) return null;

  const features = r.features.map(featureById).filter((f) => f !== undefined);
  if (features.length !== r.features.length || features.length === 0) return null;
  if (features.some((f) => !f.subjects.includes(subject.id))) return null;

  const def: Definition = { subject, target, features };

  // Los elegidos que son derivados, en el orden del catálogo. `derivedFor` da
  // los DISPONIBLES para el sujeto; aquí solo entran los que el usuario puso.
  const derived = derivedFor(subject.id).filter((d) =>
    features.some((f) => f.id === d.id),
  );
  const sqlIds = sqlFeatures(def).map((f) => f.id);

  return {
    id: r.slug,
    label: r.label,
    question: r.question,
    unit: target.unit,
    subjectType: subject.subjectType,
    subjectId: subject.id,
    derived,
    tolerance: Number(r.tolerance),
    featureLabels: Object.fromEntries(features.map((f) => [f.id, f.label])),
    ladders: laddersFor(features.map((f) => f.id)),
    query: compileQuery(def),
    predictOncePerSubject: subject.predictOnce,
    builtin: r.builtin,
    async featuresFor(subjectId: string) {
      const db = await tenantDb();
      const rows = (await db.execute(
        compileServingQuery(def, subjectId),
      )) as unknown as Array<Record<string, unknown>>;

      // Sin fila no hay entidad, y sobre algo que no existe no se predice.
      if (!rows[0]) return null;
      const base = readFeatures(sqlIds, rows[0]);
      if (derived.length === 0) return base;

      /*
        Los derivados salen de recorrer el histórico OTRA VEZ, en el momento de
        predecir, con la misma función que los calculó al entrenar.

        Cuesta una consulta más por predicción y se paga a gusto: la
        alternativa es guardar los valores calculados al entrenar y leerlos
        aquí, que es exactamente cómo se produce el desvío entre entrenamiento
        y servicio. Un rasgo guardado envejece en silencio; este se recalcula
        sobre lo que hay hoy, que es lo que el modelo va a ver de verdad.

        LO QUE CUESTA, medido sobre 508 consumos: 166 ms la consulta y 6 ms el
        cálculo. El 96 % del gasto es leer el histórico, no Polars. Hoy son
        cero porque ninguna plantilla de fábrica usa rasgos derivados y este
        bloque no se ejecuta; el día que alguien elija uno, ese cuarto de
        segundo se le añade al alta del ticket.

        Cuando estorbe, la salida está clara y no es quitar Polars: pedir solo
        las filas de ESA entidad más la mediana del pasado como agregado
        aparte, que son dos consultas baratas en vez de un histórico entero. Se
        deja sin hacer a propósito —hoy no lo paga nadie, y adelantarlo
        rompería la simetría de «una sola función para entrenar y para servir»
        justo cuando todavía no hay con qué comprobar que sigue dando lo mismo.
      */
      const history = await historyFrom(db, def);
      return { ...base, ...deriveForLive(history, subjectId, new Date(), derived) };
    },
  };
}

/* ------------------------- Catálogo de fábrica ------------------------- */

/**
 * Las dos que el sistema trae puestas.
 *
 * Se siembran como filas normales, no como un caso especial: una vez sembradas
 * son plantillas como cualquier otra y recorren el mismo camino. Los slugs son
 * los históricos a propósito — `ml_models.template` los referencia, y cambiarlos
 * desconectaría los modelos y las predicciones que ya existen.
 */
const BUILTIN: Array<Omit<Row, "builtin">> = [
  {
    slug: "service_hours",
    label: "Horas de un servicio",
    question: "¿Cuántas horas va a llevar esta visita?",
    subject: "ticket",
    target: "service_hours",
    features: ["category", "brand", "priority"],
    tolerance: "2",
  },
  {
    slug: "part_reorder",
    label: "Días hasta volver a usar una refacción",
    question: "¿Cada cuánto se consume esta refacción?",
    subject: "part_consumption",
    target: "days_to_next_use",
    /*
      Familia, proveedor y marca del equipo.

      El proveedor atraviesa la relación declarada hacia el ERP de compras y
      hoy no aporta NADA: está vacío en 503 de 508 casos, porque el historial
      de compras cubre 15 números de parte y el consumo cubre 145. Medido, las
      métricas son idénticas con él y sin él.

      Se deja igual, y a conciencia: no cuesta —el árbol simplemente no parte
      por un rasgo vacío— y el día que compras registre a quién se le compra
      cada pieza, el rasgo empieza a contribuir sin tocar una línea. Quitarlo
      habría escondido la conexión que el ERP todavía le debe al laboratorio.
    */
    features: ["part_family", "part_supplier", "brand"],
    tolerance: "15",
  },
  {
    slug: "maintenance_interval",
    label: "Días hasta el próximo servicio",
    question: "¿Cuándo vuelve a necesitar atención este equipo?",
    subject: "equipment_service",
    target: "days_to_next",
    features: ["brand", "category"],
    tolerance: "15",
  },
  {
    /*
      La primera pregunta del sistema sobre un PERIODO y no sobre una cosa.

      Se siembra sabiendo que hoy va a quedar RECHAZADA, y eso es exactamente
      lo que tiene que pasar: un mes de historia produce un caso, así que hay
      seis, y el laboratorio exige del orden de 150 para partir el histórico en
      entrenar / elegir / medir sin que el resultado sea azar. A doce casos por
      año, esta pregunta tarda años en tener respuesta.

      Sembrarla igual no es optimismo. Es lo mismo que se decidió con el bosque
      aleatorio: la capacidad se inscribe antes de que los datos la justifiquen,
      porque el orden inverso —darse cuenta de que hace falta y empezar a
      recolectar entonces— cuesta los mismos años otra vez. Mientras tanto la
      tarjeta dice cuántos casos hay y cuántos faltan, que es información útil y
      honesta, y la pantalla enseña la mitad que SÍ se puede afirmar hoy: lo ya
      comprometido por vencimientos, que es aritmética y no necesita modelo.
    */
    slug: "payables_next_month",
    label: "Lo que se va a facturar el mes que viene",
    question: "¿Cuánto nos van a facturar los proveedores el mes que viene?",
    subject: "payables_month",
    target: "payables_amount",
    features: ["month_of_year", "prev_month_level", "open_orders_level"],
    tolerance: "60000",
  },
];

/** Siembra las de fábrica si faltan. Idempotente: se puede llamar siempre. */
export async function ensureBuiltins(): Promise<void> {
  const db = await tenantDb();
  await db
    .insert(mlTemplates)
    .values(BUILTIN.map((b) => ({ ...b, builtin: true })))
    .onConflictDoNothing({ target: mlTemplates.slug });
}

/* ------------------------- Lectura ------------------------- */

export async function listTemplates(): Promise<Template[]> {
  await ensureBuiltins();
  const db = await tenantDb();
  const rows = await db
    .select()
    .from(mlTemplates)
    .orderBy(asc(mlTemplates.createdAt));

  return rows.map((r) => build(r as Row)).filter((t) => t !== null);
}

export async function templateById(slug: string): Promise<Template | undefined> {
  return templateByIdIn(await tenantDb(), slug);
}

/** Igual que la anterior con el cliente explícito. Ver `countForIn`. */
export async function templateByIdIn(
  db: Awaited<ReturnType<typeof tenantDb>>,
  slug: string,
): Promise<Template | undefined> {
  const [r] = await db
    .select()
    .from(mlTemplates)
    .where(eq(mlTemplates.slug, slug))
    .limit(1);

  return r ? (build(r as Row) ?? undefined) : undefined;
}

/* ------------------------- Lectura del histórico ------------------------- */

/**
 * Extrae los rasgos de una fila usando la lista de la plantilla como contrato.
 *
 * Lo usan el entrenamiento y la predicción, y esa es toda su razón de existir:
 * mientras ambos caminos pasen por aquí, es imposible que uno lea un rasgo que
 * el otro no. Un rasgo ausente queda como cadena vacía, que `train` y `predict`
 * ya tratan como "desconocido" y hace bajar un peldaño en la escalera.
 */
function readFeatures(
  keys: string[],
  row: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = row[k];
    out[k] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/**
 * El histórico CRUDO de una definición: lo que devuelve la consulta, sin los
 * rasgos derivados. Lo usan el entrenamiento y el servicio, por lados
 * distintos, y por eso vive suelto en vez de dentro de `datasetFor`.
 */
async function historyFrom(
  db: Awaited<ReturnType<typeof tenantDb>>,
  def: Definition,
): Promise<Sample[]> {
  const rows = (await db.execute(sql`
    select * from (${compileQuery(def)}) d order by at
  `)) as unknown as Array<Record<string, unknown>>;

  const keys = sqlFeatures(def).map((f) => f.id);
  return rows.map((r) => ({
    at: new Date(String(r.at)),
    key: r.subject_key == null ? undefined : String(r.subject_key),
    target: Number(r.target),
    features: readFeatures(keys, r),
  }));
}

/**
 * El histórico completo de una plantilla, listo para entrenar.
 *
 * Los rasgos derivados se añaden AQUÍ y no en la consulta. El orden importa y
 * es el único posible: para resumir el pasado de una entidad hay que tener
 * primero todas sus filas, ordenadas, en un sitio donde se pueda mirar hacia
 * atrás. Ver `analytics/features.ts`.
 */
export async function datasetFor(t: Template): Promise<Sample[]> {
  const db = await tenantDb();
  const rows = (await db.execute(sql`
    select * from (${t.query}) d order by at
  `)) as unknown as Array<Record<string, unknown>>;

  const keys = Object.keys(t.featureLabels);
  const samples = rows.map((r) => ({
    at: new Date(String(r.at)),
    key: r.subject_key == null ? undefined : String(r.subject_key),
    target: Number(r.target),
    features: readFeatures(keys, r),
  }));

  return deriveFeatures(samples, t.derived);
}

/**
 * Cuánta historia hay, SIN traerla.
 *
 * Es la misma consulta del dataset envuelta en un agregado. Que salga del mismo
 * `query` no es una comodidad: si fueran dos SQL distintos, la pantalla podría
 * anunciar 400 casos y el entrenamiento encontrar 380, y nadie sabría cuál de
 * los dos está mal.
 */
export async function countFor(t: Template): Promise<{
  n: number;
  from: Date | null;
  to: Date | null;
  /**
   * Cuántos valores DISTINTOS toma el objetivo.
   *
   * Se mide junto al conteo porque un objetivo constante es indistinguible de
   * uno sano mirando solo cuántos casos hay, y produce el peor fallo posible
   * del laboratorio: un histórico grande donde todos los casos valen lo mismo.
   * Encontrado de verdad en estos datos —los 456 tickets con `resolved_at`
   * importados lo traen igual a `created_at`, así que "días hasta resolverse"
   * vale cero en todos—. Sin esta columna, el usuario habría entrenado, le
   * habría salido "la mediana funciona igual de bien", y el motivo real —la
   * columna no varía— no aparecía por ningún lado.
   */
  distinct: number;
}> {
  return countForIn(await tenantDb(), t);
}

/**
 * Igual que la anterior con el cliente de base explícito.
 *
 * Existe para que el conteo se pueda ejecutar dentro de una caché, donde no hay
 * petición y por tanto `tenantDb()` —que lee la cookie del inquilino— no puede
 * usarse. Mismo par que `tenantDb()` / `tenantDbFor()`.
 */
export async function countForIn(
  db: Awaited<ReturnType<typeof tenantDb>>,
  t: Template,
) {
  const rows = (await db.execute(sql`
    select count(*)::int as n,
           count(distinct target)::int as distinct_targets,
           min(at) as from_at,
           max(at) as to_at
      from (${t.query}) d
  `)) as unknown as Array<Record<string, unknown>>;

  const r = rows[0];
  return {
    n: Number(r?.n ?? 0),
    distinct: Number(r?.distinct_targets ?? 0),
    from: r?.from_at ? new Date(String(r.from_at)) : null,
    to: r?.to_at ? new Date(String(r.to_at)) : null,
  };
}
