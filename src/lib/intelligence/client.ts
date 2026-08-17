import "server-only";
import { requireTenant } from "@/lib/tenancy/context";
import type {
  Catalogo,
  Classification,
  DataProfile,
  ForecastResult,
  Question,
  TrainResult,
} from "./contracts";

/**
 * El cliente de la capa de inteligencia.
 *
 * Cuatro reglas, y son lo que impide que un servicio de modelos se convierta en
 * un punto único de fallo del ERP:
 *
 * 1 · SE DEGRADA, NO ROMPE. Si el servicio no responde, cada llamada devuelve
 *     `null` y quien la hizo enseña la pantalla sin la parte de inteligencia.
 *     Un pronóstico caído no puede ser la razón por la que alguien no puede
 *     cerrar un ticket. Es la misma garantía 2 de `insights.ts`, aplicada un
 *     nivel más abajo — y aquí hace más falta, porque el fallo ya no es una
 *     consulta lenta sino un contenedor entero.
 *
 * 2 · TIENE PRESUPUESTO DE TIEMPO. Entrenar tarda; una pantalla no espera. El
 *     presupuesto es distinto por operación y explícito, porque un mismo
 *     `timeout` para clasificar (milisegundos) y para entrenar (decenas de
 *     segundos) obliga a elegir entre cortar entrenamientos válidos o dejar una
 *     pantalla colgada medio minuto.
 *
 * 3 · SOLO ALCANZA EL ESQUEMA DE LA EMPRESA ACTIVA. El inquilino no lo elige
 *     quien llama: se lee del contexto de la petición, igual que en `tenantDb`.
 *     Un parámetro habría sido más flexible y también la forma de que un día
 *     una pantalla pida el histórico de otra empresa por un `slug` mal pasado.
 *
 * 4 · NO EJECUTA ACCIONES. El servicio no expone escritura y este cliente no
 *     la busca. Lo que hay que escribir en el ERP lo escribe el ERP, detrás de
 *     sus permisos.
 */

const BASE = process.env.INTELLIGENCE_URL ?? "http://intelligence:8000";

/** Presupuestos por operación, en milisegundos. Ver la regla 2. */
const T_RAPIDO = 4_000;
const T_LECTURA = 15_000;
const T_ENTRENAR = 180_000;

type Fallo = { ok: false; reason: string };
type Exito<T> = { ok: true; value: T };
export type Resultado<T> = Exito<T> | Fallo;

async function llamar<T>(
  ruta: string,
  opciones: { method?: string; body?: unknown; timeout: number },
): Promise<Resultado<T>> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), opciones.timeout);

  try {
    const r = await fetch(`${BASE}${ruta}`, {
      method: opciones.method ?? "GET",
      headers: opciones.body ? { "content-type": "application/json" } : undefined,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
      signal: ctrl.signal,
      // Nunca se cachea: el histórico cambia con cada ticket, y una respuesta
      // cacheada de `entrenar` sería un modelo viejo presentado como nuevo.
      cache: "no-store",
    });

    if (!r.ok) {
      // El cuerpo del error viaja: FastAPI pone en `detail` el motivo real
      // —«la tarea classification todavía no está implementada»— y tirarlo
      // dejaría al usuario con un 500 genérico sobre algo perfectamente
      // explicable.
      const detalle = await r.text().catch(() => "");
      return {
        ok: false,
        reason: `La capa de inteligencia respondió ${r.status}. ${detalle.slice(0, 300)}`,
      };
    }
    return { ok: true, value: (await r.json()) as T };
  } catch (e) {
    const abortado = e instanceof Error && e.name === "AbortError";
    console.error(`[intelligence] ${ruta} falló`, e);
    return {
      ok: false,
      reason: abortado
        ? `La capa de inteligencia no respondió en ${opciones.timeout / 1000} s.`
        : "La capa de inteligencia no está disponible.",
    };
  } finally {
    clearTimeout(reloj);
  }
}

/* ------------------------- Las operaciones ------------------------- */

/**
 * Qué quiere saber la persona y con qué método se contesta. No ejecuta nada.
 *
 * Es la primera llamada de cualquier flujo y la más importante: es la que
 * decide si hace falta un modelo o basta una consulta. Ver `intents.py`.
 */
export async function clasificar(
  question: string,
  module?: string,
): Promise<Resultado<Classification>> {
  const ctx = await requireTenant();
  return llamar<Classification>("/clasificar", {
    method: "POST",
    body: { question, tenant: ctx.slug, module: module ?? null },
    timeout: T_RAPIDO,
  });
}

/** Qué se puede preguntar en cada módulo. Sin SQL: ver `/catalogo`. */
export async function catalogo(): Promise<Resultado<Catalogo>> {
  return llamar<Catalogo>("/catalogo", { timeout: T_RAPIDO });
}

/**
 * Qué hay en los datos, sin entrenar.
 *
 * Se llama ANTES de ofrecer el botón de entrenar. La mitad de los veredictos
 * negativos se explican aquí —seis periodos de historia, un valor constante— y
 * enseñarlo antes evita que el usuario gaste un entrenamiento para recibir un
 * «no alcanza» que ya se podía anticipar.
 */
export async function perfilar(serieId: string): Promise<Resultado<DataProfile>> {
  const ctx = await requireTenant();
  return llamar<DataProfile>(
    `/perfil/${encodeURIComponent(ctx.slug)}/${encodeURIComponent(serieId)}`,
    { timeout: T_LECTURA },
  );
}

/**
 * Busca el mejor modelo para una pregunta y lo evalúa. NO lo guarda.
 *
 * Devuelve también los rechazados con su motivo: saber que una pregunta no se
 * puede responder con estos datos es información, y evita que alguien lo
 * reintente en seis meses sin saber que ya se probó.
 */
export async function entrenar(question: Question): Promise<Resultado<TrainResult>> {
  const ctx = await requireTenant();
  return llamar<TrainResult>("/entrenar", {
    method: "POST",
    body: { tenant: ctx.slug, question },
    timeout: T_ENTRENAR,
  });
}

/**
 * Extiende una serie hacia el futuro con un modelo ya entrenado.
 *
 * `modelBlob` sale de `ml_models` del inquilino y viaja en cada llamada. Es la
 * consecuencia de que el servicio no guarde estado, y el precio correcto: el
 * modelo vive donde viven los datos del cliente.
 *
 * `mae` es el error medido en el backtest y de ahí sale el ancho de la banda.
 * Sin él la proyección saldría sin incertidumbre, que es la forma más eficaz
 * de que alguien lea un pronóstico como una promesa.
 */
export async function pronosticar(args: {
  serieId: string;
  modelBlob: string;
  periods?: number;
  mae: number;
}): Promise<Resultado<ForecastResult>> {
  const ctx = await requireTenant();
  return llamar<ForecastResult>("/pronosticar", {
    method: "POST",
    body: {
      tenant: ctx.slug,
      serie_id: args.serieId,
      model_blob: args.modelBlob,
      periods: args.periods ?? 6,
      mae: args.mae,
    },
    timeout: T_LECTURA,
  });
}

/** ¿Está viva la capa? Para la pantalla de administración. */
export async function salud(): Promise<Resultado<{ ok: boolean }>> {
  return llamar<{ ok: boolean }>("/salud", { timeout: T_RAPIDO });
}
