/**
 * Viáticos — lo que se puede calcular sin base de datos.
 *
 * Mismo criterio que `lib/profit.ts`: aritmética y etiquetas puras, sin
 * `server-only`, para que la pantalla y el servidor cuenten lo mismo. Un cuadre
 * que se calcula en dos sitios acaba dando dos números, y el que ve el
 * ingeniero no es el que ve quien autoriza.
 */

/**
 * LOS RUBROS YA NO VIVEN AQUÍ: los manda la empresa.
 *
 * Estaban como una lista fija con sus etiquetas y su ayuda, porque el rubro era
 * un enum del código. Desde la 0029 es un catálogo en la base (`viatico_rubros`)
 * que administran administrador y General, así que el nombre y la explicación
 * salen de la fila, no de aquí.
 *
 * Lo que sí se queda en esta capa es la ARITMÉTICA del presupuesto, por el
 * mismo criterio de siempre en este archivo: la pantalla y el servidor tienen
 * que contar lo mismo, y un cálculo hecho en dos sitios acaba dando dos
 * números.
 */

/** Lo mínimo de un rubro que necesitan la pantalla y el cálculo. */
export type Rubro = {
  id: string;
  name: string;
  /** Autorizado por DÍA. `null` = sin tope. */
  dailyBudgetMxn: number | null;
  requiresNote: boolean;
  /** ¿Pasarse impide guardar, o solo se marca? Decisión de cada rubro (0031). */
  blocksOverBudget: boolean;
};

/**
 * Días de viaje, contando salida y regreso.
 *
 * Un viaje que sale y vuelve el mismo día es UN día, no cero: se durmió fuera o
 * no, pero se comió. Con cero, el tope de cualquier rubro sería cero y todo
 * gasto de un viaje relámpago saldría marcado en rojo.
 */
export function diasDeViaje(departsOn: string, returnsOn: string): number {
  const a = Date.parse(`${departsOn}T00:00:00Z`);
  const b = Date.parse(`${returnsOn}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export type ConsumoDeRubro = {
  rubroId: string;
  nombre: string;
  /** Lo comprobado en ese rubro, en todo el viaje. */
  gastado: number;
  /** Presupuesto × días. `null` cuando el rubro no tiene tope. */
  tope: number | null;
  /** Cuánto se pasó. Cero si no se pasó o si no hay tope. */
  exceso: number;
  excedido: boolean;
};

/**
 * QUÉ SE PASÓ DEL PRESUPUESTO EN ESTE VIAJE.
 *
 * Se compara el TOTAL del rubro contra presupuesto × días, y no cada gasto
 * suelto contra el tope diario. Una factura de hotel por tres noches es un solo
 * renglón de 4 500 que contra un tope de 1 500 al día parecería el triple de lo
 * autorizado sin serlo; comparar totales es lo único que da una respuesta que
 * se sostiene delante de quien firma.
 *
 * Los rubros SIN tope no se marcan nunca: nulo es «no lo hemos definido», no
 * «no se paga». Ver la migración 0029.
 */
export function consumoPorRubro(
  gastos: Array<{ rubroId: string; amountMxn: string | number }>,
  rubros: Rubro[],
  dias: number,
): ConsumoDeRubro[] {
  const porRubro = new Map<string, number>();
  for (const g of gastos) {
    porRubro.set(g.rubroId, (porRubro.get(g.rubroId) ?? 0) + Number(g.amountMxn));
  }

  return [...porRubro.entries()].map(([rubroId, gastado]) => {
    const r = rubros.find((x) => x.id === rubroId);
    const tope =
      r?.dailyBudgetMxn != null ? r.dailyBudgetMxn * Math.max(1, dias) : null;
    const exceso = tope != null && gastado > tope ? gastado - tope : 0;
    return {
      rubroId,
      // El rubro puede haberse desactivado después de capturar el gasto: el
      // histórico conserva el nombre porque se lee de la fila, que sigue ahí.
      nombre: r?.name ?? "—",
      gastado,
      tope,
      exceso,
      excedido: exceso > 0,
    };
  });
}

/**
 * El estimado que se le propone a quien pide: la suma de todos los topes.
 *
 * Es una SUGERENCIA y no un límite —el formulario la ofrece y quien pide la
 * cambia—, porque un viaje no consume todos los rubros: quien va en coche de la
 * empresa no gasta en vuelos y el número saldría alto. Sirve para no partir de
 * una casilla vacía, que es de donde salen los estimados inventados.
 */
export function estimadoSugerido(rubros: Rubro[], dias: number): number {
  const d = Math.max(1, dias);
  return rubros.reduce((a, r) => a + (r.dailyBudgetMxn ?? 0) * d, 0);
}

export const VIATICO_ESTADOS = [
  "borrador",
  "enviado",
  "autorizado",
  "rechazado",
  "en_revision",
  "cerrado",
  "cancelado",
] as const;
export type ViaticoEstado = (typeof VIATICO_ESTADOS)[number];

/**
 * Lo que dice cada estado, EN VOZ DE QUIEN ESPERA.
 *
 * «Enviado» y «En revisión» son el mismo hecho visto desde dos sitios —alguien
 * mandó algo, alguien tiene que mirarlo— y por eso el texto nombra a quién le
 * toca mover. Un estado que solo se nombra a sí mismo obliga a cada persona a
 * traducir mentalmente si la pelota es suya.
 */
export const ESTADO_LABELS: Record<ViaticoEstado, string> = {
  // «Borrador» a secas no decía que faltara hacer algo, y un viático que nadie
  // envía es un viático que nadie autoriza: quien lo pidió cree que está en
  // camino y quien firma no ve nada que firmar. El estado tiene que decir el
  // trabajo pendiente, no solo nombrarse.
  borrador: "Borrador · sin enviar",
  enviado: "Esperando autorización",
  autorizado: "Autorizado · por comprobar",
  rechazado: "Rechazado",
  en_revision: "Comprobado · por revisar",
  cerrado: "Cerrado",
  cancelado: "Cancelado",
};

/** Los que todavía piden algo de alguien. Ordena la bandeja. */
export const ESTADOS_ABIERTOS: readonly ViaticoEstado[] = [
  "borrador",
  "enviado",
  "autorizado",
  "en_revision",
];

/** ¿El documento ya terminó su recorrido? */
export function estaCerrado(estado: ViaticoEstado): boolean {
  return estado === "cerrado" || estado === "rechazado" || estado === "cancelado";
}

export type Cuadre = {
  /** Lo que se autorizó y se entregó por adelantado. */
  anticipo: number;
  /** Lo que se comprobó con gastos. */
  gastado: number;
  /**
   * Anticipo menos gastado.
   *
   * POSITIVO: sobró dinero del anticipo y el ingeniero lo devuelve.
   * NEGATIVO: gastó de su bolsa y la empresa le reembolsa la diferencia.
   *
   * El signo se elige así —y no al revés— porque el saldo se lee desde la
   * empresa, que es quien entregó el dinero: lo mismo que hace un estado de
   * cuenta. Invertirlo obligaría a explicar el signo cada vez.
   */
  saldo: number;
  /** Cuánto del anticipo se consumió, en %. Cero anticipo → 0. */
  consumido: number;
  /** Se gastó más de lo autorizado. Es lo que la pantalla marca. */
  excedido: boolean;
};

export function cuadre(anticipo: number, gastado: number): Cuadre {
  const saldo = anticipo - gastado;
  return {
    anticipo,
    gastado,
    saldo,
    consumido: anticipo > 0 ? (gastado / anticipo) * 100 : 0,
    excedido: gastado > anticipo,
  };
}

/**
 * Cómo se lee el saldo, en palabras.
 *
 * Existe para que las dos pantallas que lo enseñan no redacten cada una la
 * suya: «saldo −1 200» no le dice a nadie quién le debe a quién, y esa es
 * justamente la única pregunta que se le hace a un cuadre de viáticos.
 */
export function saldoEnPalabras(c: Cuadre): string {
  if (c.saldo > 0) return "Por devolver a la empresa";
  if (c.saldo < 0) return "Por reembolsar a quien viajó";
  return "Cuadra exacto";
}

export const mxnViatico = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
