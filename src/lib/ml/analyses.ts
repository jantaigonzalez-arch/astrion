import "server-only";
import type { Block, BlockKind } from "@/lib/ml/blocks-types";
import {
  equipmentForecast,
  openTicketsInsights,
  partsForecast,
  partsInsights,
  payablesInsights,
  payablesNextMonth,
  payablesProjection,
  payablesTrend,
  purchasingInsights,
  supplierInsights,
  ticketsForecast,
} from "@/lib/ml/insights";
import type { Insight } from "@/lib/ml/insights";

/**
 * El vocabulario de análisis: qué puede decir el sistema, unidad por unidad.
 *
 * Antes esto vivía dentro de `assistant.ts` agrupado POR PANTALLA, y ése era el
 * problema. «Cuentas por pagar» era un solo bloque de código que resolvía tres
 * cosas distintas —hallazgos, calendario y tendencia— pegadas: no se podía
 * apagar la tendencia sin apagar las tres, ni llevarse el calendario a otra
 * pantalla, porque no existían como cosas separadas en ningún sitio.
 *
 * Aquí cada análisis es una unidad con nombre propio. Lo que antes era «el
 * ámbito de compras» ahora es una LISTA de análisis colocados en la pantalla de
 * compras, y esa lista es configurable (ver `placements.ts`) precisamente
 * porque sus elementos ya existen por separado.
 *
 * Lo que NO se vuelve configurable, y es deliberado: `resolve` es código. Nadie
 * escribe consultas desde la interfaz. Es la misma disciplina que `blocks.ts`
 * —un vocabulario curado, cada entrada revisada— y por la misma razón: un
 * catálogo abierto se llena de análisis que nadie sabe justificar, y el día que
 * uno da un número raro no hay a quién preguntarle por qué.
 */

function hallazgos(list: Insight[]): Block[] {
  return list.map((insight) => ({ kind: "finding" as const, insight }));
}

/**
 * Las pantallas que admiten análisis, DE LA MÁS ESPECÍFICA A LA MÁS GENERAL.
 *
 * El orden es la regla de casado y por eso sigue en código: `/admin/compras/
 * cuentas-por-pagar` tiene que probarse antes que `/admin/compras`, o toda la
 * sección caería en el ámbito general. Eso es correctitud, no preferencia, y
 * configurarlo solo daría la posibilidad de romperlo.
 */
export type Screen = {
  prefix: string;
  label: string;
  /**
   * Si la ruta lleva el identificador de una ficha (`…/proveedores/<uuid>`).
   *
   * Un prefijo terminado en barra exige que haya algo DESPUÉS: cubre la ficha
   * de uno, no el listado. Sin esa distinción el listado caía en el ámbito de
   * ficha, que sin id no tiene nada que decir — y el panel enseñaba «vigilando
   * los días de pago de este proveedor» sin proveedor a la vista.
   */
  providesId?: boolean;
};

export const SCREENS: Screen[] = [
  { prefix: "/admin/compras/cuentas-por-pagar", label: "Cuentas por pagar" },
  { prefix: "/admin/compras/proveedores/", label: "Ficha de proveedor", providesId: true },
  { prefix: "/admin/compras", label: "Compras" },
  { prefix: "/admin/refacciones", label: "Refacciones" },
  { prefix: "/admin/tickets", label: "Cola de servicio" },
];

export function screenByPrefix(prefix: string): Screen | undefined {
  return SCREENS.find((s) => s.prefix === prefix);
}

export type AnalysisContext = {
  /** El identificador de la URL, cuando la pantalla lo lleva. */
  id?: string;
};

export type Analysis = {
  id: string;
  label: string;
  /**
   * Qué vigila. Se enseña cuando no encuentra nada que decir.
   *
   * Es tan importante como `resolve`: una caja vacía enseña que no vale la pena
   * volver a abrir el panel, y esa lección no se revierte. La lista dice qué le
   * está cubriendo el sistema aunque hoy no haya nada que reportar.
   */
  watching: string[];
  /** De qué tipo son los bloques que produce. Para explicarlo al configurar. */
  kind: BlockKind;
  /** Dónde sale de fábrica. `null` si el sistema aún no lo coloca solo. */
  defaultScreen: string | null;
  /** Su sitio dentro de la pantalla de fábrica. Menor primero. */
  defaultPosition: number;
  /**
   * Exige un identificador en la URL. Es la ÚNICA restricción de colocación, y
   * existe porque es correctitud: un análisis de ficha en una pantalla sin
   * ficha no se ve mal, se queda mudo. Todo lo demás se puede colocar donde el
   * usuario quiera, aunque a nosotros nos parezca raro.
   */
  needsId?: boolean;
  /**
   * Exige rol de administración, VIVA DONDE VIVA.
   *
   * Antes esta regla estaba en la pantalla («si el ámbito es cuentas por pagar,
   * exige administrador»), y con las colocaciones fijas bastaba. Deja de bastar
   * en cuanto el usuario puede mover un análisis: colocar el calendario de pagos
   * en la cola de servicio —que soporte sí ve— habría enseñado saldos de
   * proveedores a quien no debe verlos, sin que nadie tocara un permiso.
   *
   * El permiso pertenece al DATO, no al sitio donde se enseña. Que la regla
   * viviera en el sitio era un acierto por accidente: funcionaba porque el sitio
   * no se movía.
   */
  adminOnly?: boolean;
  /**
   * El sujeto de `blocks.ts` cuyas predicciones lee, cuando lee alguna.
   *
   * Es lo que conecta el laboratorio con la pantalla: sirve para responder
   * «este modelo aprobado, ¿tiene por dónde salir?», que es la pregunta que
   * convierte al sistema en algo que RECOMIENDA análisis en vez de esperar a
   * que alguien se acuerde de configurarlos.
   */
  subject?: string;
  resolve: (ctx: AnalysisContext) => Promise<Block[]>;
};

export const ANALYSES: Analysis[] = [
  /* --- Cuentas por pagar: tres análisis, antes inseparables --- */
  {
    id: "payables.findings",
    label: "Avisos de cuentas por pagar",
    watching: [
      "Anticipos entregados que siguen sin imputarse a una factura",
      "Notas de crédito concedidas y sin aplicar",
      "Saldo vencido y su peso sobre el total, por moneda",
      "Vencimientos de los próximos siete días",
    ],
    kind: "finding",
    defaultScreen: "/admin/compras/cuentas-por-pagar",
    defaultPosition: 0,
    adminOnly: true,
    resolve: async () => hallazgos(await payablesInsights()),
  },
  {
    id: "payables.calendar",
    label: "Calendario de pagos comprometidos",
    watching: ["Vencimientos pactados de las próximas seis semanas"],
    kind: "projection",
    defaultScreen: "/admin/compras/cuentas-por-pagar",
    defaultPosition: 1,
    adminOnly: true,
    resolve: async () => payablesProjection(),
  },
  {
    id: "payables.next-month",
    label: "Cuentas por pagar del mes que viene",
    watching: [
      "Vencimientos ya pactados que caen dentro del mes que viene",
      "Lo que el modelo estima que se facturará y aún no se ha emitido",
    ],
    // Se declara como `forecast` porque es el bloque de MAYOR incertidumbre que
    // puede producir. El análisis devuelve dos bloques —una proyección y, si hay
    // modelo, un pronóstico— y quien configura tiene que saber que aquí puede
    // aparecer una estimación, no solo aritmética.
    kind: "forecast",
    defaultScreen: "/admin/compras/cuentas-por-pagar",
    defaultPosition: 3,
    adminOnly: true,
    // El sujeto que lo conecta con el laboratorio: en cuanto haya un modelo de
    // `payables_month` en producción, la mitad estimada aparece sola.
    subject: "payables_month",
    resolve: async () => payablesNextMonth(),
  },
  {
    id: "payables.trend",
    label: "Evolución de lo facturado y lo vencido",
    watching: ["Facturado y vencido mes a mes"],
    kind: "trend",
    defaultScreen: "/admin/compras/cuentas-por-pagar",
    defaultPosition: 2,
    adminOnly: true,
    resolve: async () => payablesTrend(),
  },

  /* --- Ficha de proveedor --- */
  {
    id: "supplier.findings",
    label: "Avisos del proveedor",
    watching: [
      "Días reales de pago contra los que se pactaron",
      "Saldo a favor sin aplicar",
      "Saldo abierto frente a lo comprado en el año",
    ],
    kind: "finding",
    defaultScreen: "/admin/compras/proveedores/",
    defaultPosition: 0,
    adminOnly: true,
    needsId: true,
    resolve: async (ctx) => (ctx.id ? hallazgos(await supplierInsights(ctx.id)) : []),
  },

  /* --- Compras --- */
  {
    id: "purchasing.findings",
    label: "Avisos de compras",
    watching: [
      "Refacciones en falta sin orden que las cubra",
      "Órdenes que pasaron su fecha de llegada",
      "Piezas y dinero comprometidos en camino",
    ],
    kind: "finding",
    defaultScreen: "/admin/compras",
    defaultPosition: 0,
    resolve: async () => hallazgos(await purchasingInsights()),
  },

  /* --- Refacciones --- */
  {
    id: "parts.findings",
    label: "Avisos de refacciones",
    watching: [
      "Existencias negativas sin cobertura",
      "Faltantes ya pedidos, pendientes de llegada",
      "Refacciones en cero",
    ],
    kind: "finding",
    defaultScreen: "/admin/refacciones",
    defaultPosition: 0,
    resolve: async () => hallazgos(await partsInsights()),
  },
  {
    id: "parts.reorder",
    label: "Refacciones que se van a volver a necesitar",
    watching: ["Días estimados hasta el próximo consumo de cada refacción"],
    kind: "forecast",
    // Sin pantalla de fábrica a propósito: hasta que no haya un modelo de
    // `part_consumption` en producción no tiene nada que enseñar, y colocarlo
    // vacío enseñaría una caja muerta. El sistema lo RECOMIENDA en cuanto ese
    // modelo se aprueba — ver `recommendations()` en `placements.ts`.
    defaultScreen: null,
    defaultPosition: 0,
    subject: "part_consumption",
    resolve: async () => partsForecast(),
  },

  /* --- Cola de servicio --- */
  {
    id: "tickets.findings",
    label: "Avisos de la cola de servicio",
    watching: ["Carga abierta comprometida", "Tickets que se pasan de lo estimado"],
    kind: "finding",
    defaultScreen: "/admin/tickets",
    defaultPosition: 0,
    resolve: async () => hallazgos(await openTicketsInsights()),
  },
  {
    id: "tickets.forecast",
    label: "Horas estimadas en la cola",
    watching: ["Horas que el modelo estima para los servicios abiertos"],
    kind: "forecast",
    defaultScreen: "/admin/tickets",
    defaultPosition: 1,
    subject: "ticket",
    resolve: async () => ticketsForecast(),
  },
  {
    id: "equipment.maintenance",
    label: "Equipos próximos a requerir servicio",
    watching: ["Días estimados hasta el próximo servicio de cada equipo"],
    kind: "forecast",
    defaultScreen: null,
    defaultPosition: 0,
    subject: "equipment_service",
    resolve: async () => equipmentForecast(),
  },
];

export function analysisById(id: string): Analysis | undefined {
  return ANALYSES.find((a) => a.id === id);
}

/**
 * Si una colocación es legal.
 *
 * Una sola regla, y es de correctitud: un análisis de ficha necesita una
 * pantalla que traiga identificador. Lo demás se permite — colocar el
 * calendario de pagos en la cola de servicio es raro, pero es decisión de quien
 * configura, no nuestra.
 */
export function placementError(analysisId: string, screenPrefix: string): string | null {
  const a = analysisById(analysisId);
  if (!a) return `No existe el análisis «${analysisId}».`;
  const s = screenByPrefix(screenPrefix);
  if (!s) return `No existe la pantalla «${screenPrefix}».`;
  if (a.needsId && !s.providesId) {
    return (
      `«${a.label}» analiza una ficha concreta y «${s.label}» no lleva ` +
      `identificador en la dirección: quedaría mudo.`
    );
  }
  return null;
}
