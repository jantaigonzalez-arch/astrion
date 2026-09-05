/**
 * Viáticos — lo que se puede calcular sin base de datos.
 *
 * Mismo criterio que `lib/profit.ts`: aritmética y etiquetas puras, sin
 * `server-only`, para que la pantalla y el servidor cuenten lo mismo. Un cuadre
 * que se calcula en dos sitios acaba dando dos números, y el que ve el
 * ingeniero no es el que ve quien autoriza.
 */

export const VIATICO_CATEGORIAS = [
  "hotel",
  "transporte",
  "comida",
  "refacciones",
  "otros",
] as const;
export type ViaticoCategoria = (typeof VIATICO_CATEGORIAS)[number];

export const CATEGORIA_LABELS: Record<ViaticoCategoria, string> = {
  hotel: "Hotel",
  transporte: "Transporte",
  comida: "Comida",
  refacciones: "Refacciones",
  otros: "Otros",
};

/** Qué cabe en cada una, para que dos personas clasifiquen igual. */
export const CATEGORIA_AYUDA: Record<ViaticoCategoria, string> = {
  hotel: "Hospedaje y lo que venga en la factura del hotel.",
  transporte: "Vuelos, autobús, taxis, gasolina, casetas y estacionamiento.",
  comida: "Alimentos del viaje.",
  refacciones: "Piezas compradas en ruta, que no salieron del almacén.",
  otros: "Cualquier otra cosa. Hay que especificar qué.",
};

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
  if (c.saldo < 0) return "Por reembolsar al ingeniero";
  return "Cuadra exacto";
}

export const mxnViatico = (n: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
