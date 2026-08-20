import "server-only";
import { cache } from "react";
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
import type { DbOrTx } from "@/lib/db";
import type { Insight } from "@/lib/ml/insights";
import {
  profitSplit,
  profitTrend,
  topClients,
  worstServices,
} from "@/lib/ml/profitability-insights";
import { rottingDeals, salesFunnel, salesTrend } from "@/lib/ml/sales-insights";
import {
  clientConcentration,
  expiringContracts,
  quietClients,
} from "@/lib/ml/client-insights";

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
   * De trabajo o dashboard.
   *
   * Un dashboard NO es una ruta: su prefijo es `dashboard:<modulo>` y no casa
   * con ninguna URL. Se marca para que `screenFor()` —que enruta por dirección—
   * no lo considere nunca, y para que la pantalla de configuración pueda
   * separarlos: son dos superficies con propósitos distintos, y mezclarlas en
   * una sola lista obligaría a leer el prefijo para saber cuál es cuál.
   */
  kind?: "work" | "dashboard";
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

/**
 * Los MÓDULOS del ERP que admiten dashboard.
 *
 * Uno por dominio de negocio, con el mismo nombre que la sección del menú:
 * quien compone un dashboard piensa «el de Ventas», no «el de /admin/crm».
 *
 * `home` es a dónde vuelve el botón de la pantalla, y es lo que conecta el
 * dashboard con el trabajo: un tablero al que se entra desde ningún sitio es
 * un informe, no un dashboard.
 */
export type Modulo = { id: string; label: string; home: string };

export const MODULOS: Modulo[] = [
  { id: "servicio", label: "Servicio", home: "/admin/tickets" },
  { id: "ventas", label: "Ventas", home: "/admin/crm" },
  { id: "clientes", label: "Clientes", home: "/admin/clientes" },
  { id: "refacciones", label: "Refacciones", home: "/admin/refacciones" },
  { id: "compras", label: "Compras", home: "/admin/compras" },
  { id: "pagos", label: "Cuentas por pagar", home: "/admin/compras/cuentas-por-pagar" },
  { id: "rentabilidad", label: "Rentabilidad", home: "/admin/rentabilidad" },
];

/**
 * El prefijo de pantalla de un tablero, a partir de su SLUG.
 *
 * Recibía el id del módulo, y la firma no cambió porque el slug de los siete
 * tableros de siempre ES el id de su módulo — ver la migración 0018. Lo que
 * cambió es el significado: `dashboard:ventas` ya no es «el tablero del módulo
 * ventas» sino «el tablero que se llama ventas», y ese tablero puede
 * publicarse en varios módulos o en ninguno.
 */
export const dashboardScreen = (slug: string) => `dashboard:${slug}`;

export const moduloById = (id: string) => MODULOS.find((m) => m.id === id);

/** El slug de un prefijo `dashboard:…`, o `null` si no es de un tablero. */
export function slugDeScreen(prefix: string): string | null {
  return prefix.startsWith("dashboard:") ? prefix.slice("dashboard:".length) : null;
}

export const SCREENS: Screen[] = [
  { prefix: "/admin/compras/cuentas-por-pagar", label: "Cuentas por pagar" },
  { prefix: "/admin/compras/proveedores/", label: "Ficha de proveedor", providesId: true },
  { prefix: "/admin/compras", label: "Compras" },
  { prefix: "/admin/refacciones", label: "Refacciones" },
  { prefix: "/admin/tickets", label: "Cola de servicio" },
  // Ventas entra con la capa de inteligencia: sin una pantalla que admita
  // análisis, una pregunta del módulo de ventas no tendría dónde publicarse y el
  // usuario vería «configurada» un pronóstico que no sale por ningún lado.
  { prefix: "/admin/crm", label: "Embudo de ventas" },
];

/**
 * La pantalla de un prefijo: de trabajo o de tablero.
 *
 * ── POR QUÉ LOS TABLEROS YA NO SON UNA LISTA ───────────────────────────────
 *
 * Había una constante `DASHBOARDS` derivada de `MODULOS`: siete tableros fijos,
 * uno por módulo. Desde que un tablero tiene nombre propio y se crea cuando
 * alguien quiere, esa lista no puede existir en código — los tableros son filas,
 * no constantes, y validar contra una lista estática habría rechazado colocar
 * un análisis en cualquier tablero nuevo.
 *
 * Así que un prefijo `dashboard:*` se acepta por su FORMA. Que ese tablero
 * exista de verdad lo comprueba quien lo abre, contra la tabla; aquí solo se
 * responde si el prefijo designa una superficie que admite análisis, que es la
 * pregunta que hace `placementError`.
 *
 * La etiqueta sale de `MODULOS` cuando el slug coincide con un módulo —los siete
 * de siempre— para que los mensajes sigan diciendo «Tablero de Ventas» y no
 * «Tablero «ventas»».
 */
export function screenByPrefix(prefix: string): Screen | undefined {
  const slug = slugDeScreen(prefix);
  if (slug !== null) {
    const m = moduloById(slug);
    return {
      prefix,
      label: m ? `Tablero de ${m.label}` : `Tablero «${slug}»`,
      kind: "dashboard",
    };
  }
  return SCREENS.find((s) => s.prefix === prefix);
}

export type AnalysisContext = {
  /** El identificador de la URL, cuando la pantalla lo lleva. */
  id?: string;
  /**
   * La conexión al esquema de la empresa, cuando quien llama ya la tiene.
   *
   * Opcional porque los resolutores escritos a mano la piden por su cuenta con
   * `tenantDb()`, y eso funciona: dentro de una petición está memoizada, así que
   * no cuesta nada. Existe por dos razones concretas:
   *
   *   · para poder EJERCITAR un análisis desde un script, contra una base real,
   *     sin petición HTTP delante. Sin esto, `resolve()` revienta con «headers
   *     was called outside a request scope» y la única forma de comprobar que un
   *     análisis produce lo que dice es abrir el navegador.
   *   · para el día que un análisis haya que resolverlo dentro de una
   *     transacción, donde `tenantDb()` devolvería otra conexión y no vería lo
   *     que la transacción escribió.
   */
  db?: DbOrTx;
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
  /**
   * Dónde sale de fábrica, y en qué sitio de cada sitio. Vacío si el sistema
   * aún no lo coloca solo.
   *
   * ── POR QUÉ ES UNA LISTA Y NO UNA PANTALLA ───────────────────────────────
   *
   * Un análisis vive en DOS superficies a la vez, y son distintas por
   * naturaleza: la pantalla donde se trabaja —donde el aviso sale al lado de la
   * cola de tickets que hay que atender— y el tablero del módulo, donde el
   * mismo aviso se lee junto a los otros para saber cómo va la semana. «Avisos
   * de cuentas por pagar» pertenece a las dos, y con una sola pantalla de
   * fábrica había que elegir: o el aviso no salía al trabajar, o el tablero
   * nacía vacío y cada empresa tenía que componerlo a mano antes de que
   * sirviera para algo.
   *
   * ── Y POR QUÉ SITIO Y ANCHO VIVEN DENTRO ─────────────────────────────────
   *
   * Porque no significan lo mismo en cada superficie. En una pantalla de
   * trabajo los análisis van uno debajo de otro y a ancho completo —compiten
   * con el trabajo por la atención, y media caja los vuelve decoración—; en un
   * tablero, media fila es la mitad del valor. Y el orden tampoco se hereda: el
   * tercero de la pantalla de pagos puede ser el primero de su tablero.
   *
   * Eran tres campos sueltos (`defaultScreen`, `defaultPosition`,
   * `defaultWidth`) que solo sabían describir un sitio. Juntarlos en uno es lo
   * que impide la falla de siempre de los campos paralelos: que alguien añada
   * una pantalla y se olvide de la posición.
   */
  defaultOn: Array<{
    screen: string;
    /** Su sitio dentro de esa pantalla. Menor primero. */
    position: number;
    /** Cuánto ocupa. Solo cuenta en un dashboard. */
    width?: "full" | "half";
  }>;
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

/**
 * La pantalla de trabajo de un módulo y su tablero, a la vez.
 *
 * Casi todos los análisis escritos a mano pertenecen a los dos sitios, y
 * escribir las dos entradas a mano en cada uno invitaba justo al error que
 * `defaultOn` existe para evitar: poner la de trabajo y olvidar la del tablero,
 * dejando el módulo con un botón de «Crear tablero» y nada que crear.
 *
 * El ancho se declara aquí porque solo cuenta en el tablero; en la pantalla de
 * trabajo se ignora.
 */
const enModuloY = (
  screen: string,
  modulo: string,
  position: number,
  width: "full" | "half" = "full",
) => [
  { screen, position },
  { screen: dashboardScreen(modulo), position, width },
];

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
    defaultOn: enModuloY("/admin/compras/cuentas-por-pagar", "pagos", 0),
    adminOnly: true,
    resolve: async () => hallazgos(await payablesInsights()),
  },
  {
    id: "payables.calendar",
    label: "Calendario de pagos comprometidos",
    watching: ["Vencimientos pactados de las próximas seis semanas"],
    kind: "projection",
    defaultOn: enModuloY("/admin/compras/cuentas-por-pagar", "pagos", 1, "half"),
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
    defaultOn: enModuloY("/admin/compras/cuentas-por-pagar", "pagos", 3),
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
    defaultOn: enModuloY("/admin/compras/cuentas-por-pagar", "pagos", 2, "half"),
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
    // Solo la ficha: un análisis de un proveedor concreto en el tablero del
    // módulo se quedaría mudo, porque un tablero no lleva identificador en la
    // dirección. Es la misma regla que `needsId`, aplicada al catálogo.
    defaultOn: [{ screen: "/admin/compras/proveedores/", position: 0 }],
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
    defaultOn: enModuloY("/admin/compras", "compras", 0),
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
    defaultOn: enModuloY("/admin/refacciones", "refacciones", 0),
    resolve: async () => hallazgos(await partsInsights()),
  },
  {
    id: "parts.reorder",
    label: "Refacciones que se van a volver a necesitar",
    watching: ["Días estimados hasta el próximo consumo de cada refacción"],
    kind: "forecast",
    // Sin sitio de fábrica a propósito: hasta que no haya un modelo de
    // `part_consumption` en producción no tiene nada que enseñar, y colocarlo
    // vacío enseñaría una caja muerta. El sistema lo RECOMIENDA en cuanto ese
    // modelo se aprueba — ver `recommendations()` en `placements.ts`.
    defaultOn: [],
    subject: "part_consumption",
    resolve: async () => partsForecast(),
  },

  /* --- Cola de servicio --- */
  {
    id: "tickets.findings",
    label: "Avisos de la cola de servicio",
    watching: ["Carga abierta comprometida", "Tickets que se pasan de lo estimado"],
    kind: "finding",
    defaultOn: enModuloY("/admin/tickets", "servicio", 0),
    resolve: async () => hallazgos(await openTicketsInsights()),
  },
  {
    id: "tickets.forecast",
    label: "Horas estimadas en la cola",
    watching: ["Horas que el modelo estima para los servicios abiertos"],
    kind: "forecast",
    defaultOn: enModuloY("/admin/tickets", "servicio", 1),
    subject: "ticket",
    resolve: async () => ticketsForecast(),
  },
  /* --- Ventas: el embudo, dicho en tres afirmaciones --- */
  {
    id: "sales.rotting",
    label: "Negocios que se están enfriando",
    watching: [
      "Negocios abiertos parados más días de los que su etapa admite",
      "Cuánto dinero está detenido en ellos",
    ],
    kind: "finding",
    defaultOn: enModuloY("/admin/crm", "ventas", 0),
    resolve: async (ctx) => rottingDeals(ctx.db),
  },
  {
    id: "sales.funnel",
    label: "Lo que hay abierto, por etapa",
    watching: [
      "Valor y número de negocios abiertos en cada etapa del embudo",
      "El mismo total ponderado por la probabilidad de cada etapa",
      "Negocios en dólares que no se pueden convertir y quedan fuera de la suma",
    ],
    kind: "projection",
    defaultOn: enModuloY("/admin/crm", "ventas", 1, "half"),
    resolve: async (ctx) => salesFunnel(ctx.db),
  },
  {
    id: "sales.trend",
    label: "Valor ganado por mes",
    watching: ["Valor ganado mes a mes", "Tasa de cierre de los últimos doce meses"],
    kind: "trend",
    defaultOn: enModuloY("/admin/crm", "ventas", 2, "half"),
    resolve: async (ctx) => salesTrend(ctx.db),
  },

  /* --- Clientes: la post-venta ---

     Los tres nacen SOLO en el tablero: `/admin/clientes` no está en `SCREENS`,
     así que no hay pantalla de trabajo donde publicarlos. Es la misma forma que
     los de rentabilidad, y ver la cabecera de `client-insights.ts` sobre por
     qué la cartera entera se lee ahí y no en la ficha de nadie. */
  {
    id: "clients.expiring",
    label: "Contratos por vencer",
    watching: [
      "Contratos que terminan dentro de los próximos 60 días",
      "Equipos que esos contratos amparan",
    ],
    kind: "finding",
    defaultOn: [{ screen: dashboardScreen("clientes"), position: 0, width: "full" }],
    resolve: async (ctx) => expiringContracts(ctx.db),
  },
  {
    id: "clients.quiet",
    label: "Clientes que se quedaron callados",
    watching: [
      "Clientes con equipo instalado y medio año sin pedir servicio",
      "Equipos instalados que llevan ese tiempo sin visitas",
    ],
    kind: "finding",
    defaultOn: [{ screen: dashboardScreen("clientes"), position: 1, width: "half" }],
    resolve: async () => quietClients(),
  },
  {
    id: "clients.concentration",
    label: "De qué clientes viene el negocio",
    watching: [
      "Valor comprado acumulado por cliente",
      "Qué parte de la cartera concentran los primeros",
    ],
    kind: "projection",
    defaultOn: [{ screen: dashboardScreen("clientes"), position: 2, width: "half" }],
    resolve: async () => clientConcentration(),
  },

  /* --- Rentabilidad: la pantalla, partida en piezas --- */
  {
    id: "profit.trend",
    label: "Utilidad por mes",
    watching: ["Ingresos y costos de los servicios facturables, mes a mes"],
    kind: "trend",
    defaultOn: [{ screen: dashboardScreen("rentabilidad"), position: 0, width: "full" }],
    adminOnly: true,
    resolve: async (ctx) => profitTrend(ctx.db),
  },
  {
    id: "profit.split",
    label: "Origen de la utilidad",
    watching: ["Cuánto del margen viene de refacciones y cuánto de horas"],
    kind: "projection",
    defaultOn: [{ screen: dashboardScreen("rentabilidad"), position: 1, width: "half" }],
    adminOnly: true,
    resolve: async (ctx) => profitSplit(ctx.db),
  },
  {
    id: "profit.clients",
    label: "Clientes más rentables",
    watching: ["Margen acumulado por cliente y de quién depende el resultado"],
    kind: "projection",
    defaultOn: [{ screen: dashboardScreen("rentabilidad"), position: 2, width: "half" }],
    adminOnly: true,
    resolve: async (ctx) => topClients(ctx.db),
  },
  {
    id: "profit.worst",
    label: "Servicios que perdieron dinero",
    watching: ["Servicios cerrados por debajo de costo, y cuánto suman"],
    // HALLAZGO y no gráfica: los otros tres describen, este pide acción. Ver
    // la nota de `worstServices`.
    kind: "finding",
    defaultOn: [{ screen: dashboardScreen("rentabilidad"), position: 3, width: "full" }],
    adminOnly: true,
    resolve: async (ctx) => worstServices(ctx.db),
  },

  {
    id: "equipment.maintenance",
    label: "Equipos próximos a requerir servicio",
    watching: ["Días estimados hasta el próximo servicio de cada equipo"],
    kind: "forecast",
    // Como `parts.reorder`: sin modelo de `equipment_service` en producción no
    // tiene nada que decir, así que el sistema lo propone en vez de colocarlo.
    defaultOn: [],
    subject: "equipment_service",
    resolve: async () => equipmentForecast(),
  },
];

/**
 * Presupuesto de tiempo de UN análisis.
 *
 * El mismo número que `insights.ts` usaba para los suyos, y ahora el único: ver
 * `resolveAnalysis`.
 */
export const ANALYSIS_BUDGET_MS = 1_500;

/**
 * Resuelve un análisis sin que pueda dejar colgada la pantalla que lo enseña.
 *
 * ── POR QUÉ EL PRESUPUESTO SUBIÓ AQUÍ ──────────────────────────────────────
 *
 * Vivía dentro de `guarded()`, en `insights.ts`, así que protegía a los
 * análisis ESCRITOS EN ESE ARCHIVO y a nadie más. Mientras todos vivían allí la
 * distinción no existía; hoy hay tres familias fuera —rentabilidad, ventas y
 * clientes— y ninguna lo tenía. La sección de análisis, en cambio, sí prometía
 * en su cabecera que «cada resolutor corre aislado y con presupuesto», y desde
 * que los análisis de Ventas salen en el embudo esa promesa era falsa
 * justamente donde importa: una pantalla de trabajo.
 *
 * El presupuesto pertenece a QUIEN ENSEÑA, no a quien escribe la consulta. Aquí
 * lo hereda cualquier análisis nuevo sin que su autor tenga que acordarse — que
 * es exactamente la clase de acuerdo que nadie recuerda.
 *
 * ── QUÉ HACE Y QUÉ NO ──────────────────────────────────────────────────────
 *
 * El `race` NO cancela la consulta: Postgres la termina igual. Lo que hace es
 * desacoplar el render de ella, y esa es la decisión correcta porque el análisis
 * es accesorio a la operación, nunca al revés.
 *
 * Los errores NO se atrapan: se dejan subir a quien llama, que ya los recoge
 * con `allSettled` y sabe decir cuál falló. Atraparlos aquí convertiría un
 * análisis roto en uno que simplemente no dice nada, que es la forma más cara
 * de fallar — nadie se entera nunca.
 */
export async function resolveAnalysis(
  a: Analysis,
  ctx: AnalysisContext,
): Promise<Block[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      a.resolve(ctx),
      new Promise<Block[]>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[análisis] ${a.id} excedió ${ANALYSIS_BUDGET_MS} ms; se omite.`);
          resolve([]);
        }, ANALYSIS_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * TODOS los análisis: los escritos a mano y los que salen de las preguntas del
 * usuario.
 *
 * Es asíncrono porque la segunda mitad se lee de la base, y eso es lo que le
 * costó al registro dejar de ser una constante. Vale la pena: hasta aquí «qué
 * puede decir el sistema» era una decisión de producto que solo cambiaba
 * desplegando, y las preguntas que el usuario configura son exactamente eso —
 * cosas que el sistema puede decir— creadas sin desplegar nada.
 *
 * Las del usuario van DETRÁS: en un empate de posición, los análisis de fábrica
 * mandan. Son los hallazgos que piden acción hoy, y un pronóstico es contexto.
 *
 * ── MEMOIZADO POR PETICIÓN ─────────────────────────────────────────────────
 *
 * Medido: pintar `/admin/crm` lo llamaba CUATRO veces —el menú de tableros, el
 * botón del módulo dos veces y la sección de análisis— y cada llamada son dos
 * consultas, así que ocho de los trece viajes a la base de esa pantalla eran
 * releer el mismo catálogo. No es un accidente de estas pantallas: `analysesAll`
 * está debajo de todo lo que coloca análisis, y cada superficie nueva lo vuelve
 * a pedir sin saber que alguien ya lo pidió.
 *
 * `cache` de React y no un mapa de módulo, que es la diferencia que importa
 * aquí: el ámbito es LA PETICIÓN, así que dos empresas atendidas a la vez por el
 * mismo servidor no pueden compartir catálogo — con un singleton, una de ellas
 * vería las preguntas configuradas por la otra. Y dentro de una petición el
 * catálogo no cambia: ninguna acción crea una pregunta y vuelve a leerlo, y
 * publicar una invalida por `revalidateTenant()`, que es otra petición.
 *
 * Fuera de una petición —un script— `cache` no memoiza y cada llamada lee. Es
 * lo correcto: un proceso largo no debe congelar el catálogo para siempre.
 */
export const analysesAll = cache(
  async (conexion?: DbOrTx): Promise<Analysis[]> => {
    // Importación diferida a propósito: `intelligence/published.ts` importa el
    // tipo `Analysis` de este archivo, así que un import normal cerraría el
    // ciclo. El tipo va en una dirección y el valor en la otra.
    const { questionAnalyses } = await import("@/lib/intelligence/published");
    return [...ANALYSES, ...(await questionAnalyses(conexion))];
  },
);

/** Solo los escritos a mano. Búsqueda sincrónica, para validaciones. */
export function analysisById(id: string): Analysis | undefined {
  return ANALYSES.find((a) => a.id === id);
}

/** Cualquiera, incluidos los del usuario. */
export async function analysisByIdAll(
  id: string,
  conexion?: DbOrTx,
): Promise<Analysis | undefined> {
  return (await analysesAll(conexion)).find((a) => a.id === id);
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
  // Los del usuario (`q.…`) no están en `ANALYSES` y son legales en cualquier
  // pantalla: pronostican una serie del negocio entero, no una ficha, así que la
  // única restricción del sistema —necesitar identificador— no les aplica.
  if (analysisId.startsWith("q.")) {
    return screenByPrefix(screenPrefix) ? null : `No existe la pantalla «${screenPrefix}».`;
  }
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
