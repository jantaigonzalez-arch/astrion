/**
 * Lectura de un CFDI (XML del SAT).
 *
 * Sirve para el atajo del día a día: se sueltan los XML que manda el proveedor
 * —o los de la descarga masiva— y el emisor, el UUID, los importes y la fecha
 * salen del propio archivo. Cero tecleo, y por tanto cero importes mal
 * capturados, que es el error caro de cuentas por pagar.
 *
 * Sin dependencia nueva: el XML de un CFDI es plano y con atributos, y lo que
 * hace falta se saca con expresiones regulares sobre las dos etiquetas que
 * importan. Un parser de XML completo aquí traería namespaces, entidades y
 * validación de esquema que no se usan para nada.
 *
 * Deliberadamente NO valida el sello ni el certificado. Eso lo hace el SAT, y
 * fingir aquí una validación fiscal que no es tal sería peor que no hacerla:
 * daría por bueno un comprobante por el mero hecho de haberse importado.
 */

export type CfdiDoc = {
  /** Folio fiscal del timbre. Sin él no hay control antiduplicado. */
  uuid: string | null;
  /** RFC de quien emite: el proveedor. Con él se resuelve a quién se le debe. */
  emisorRfc: string | null;
  emisorNombre: string | null;
  /** RFC del receptor: nosotros. Sirve para detectar un XML que no es nuestro. */
  receptorRfc: string | null;
  serie: string | null;
  folio: string | null;
  /** `YYYY-MM-DD`, del atributo `Fecha`. */
  fecha: string | null;
  moneda: string;
  subtotal: number | null;
  descuento: number;
  impuestosTrasladados: number;
  total: number | null;
  /** `I` ingreso (una factura), `E` egreso (una nota de crédito), `P` pago… */
  tipoComprobante: string | null;
};

/** Valor de un atributo en la primera etiqueta que lo lleve. */
function attr(xml: string, tag: string, name: string): string | null {
  // La etiqueta puede venir con o sin prefijo de namespace (`cfdi:Emisor`).
  const re = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${tag}\\b[^>]*?\\b${name}\\s*=\\s*"([^"]*)"`,
    "i",
  );
  return re.exec(xml)?.[1]?.trim() || null;
}

/** Igual, pero sobre la raíz `Comprobante`, que es donde van los importes. */
function root(xml: string, name: string): string | null {
  return attr(xml, "Comprobante", name);
}

const num = (v: string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseCfdi(xml: string): CfdiDoc {
  const fechaRaw = root(xml, "Fecha");

  return {
    // El UUID vive en el TimbreFiscalDigital, no en el comprobante: un CFDI sin
    // timbrar no lo trae, y esa ausencia es información —significa que el
    // comprobante no está vigente ante el SAT—.
    uuid: attr(xml, "TimbreFiscalDigital", "UUID")?.toUpperCase() ?? null,
    emisorRfc: attr(xml, "Emisor", "Rfc")?.toUpperCase() ?? null,
    emisorNombre: attr(xml, "Emisor", "Nombre"),
    receptorRfc: attr(xml, "Receptor", "Rfc")?.toUpperCase() ?? null,
    serie: root(xml, "Serie"),
    folio: root(xml, "Folio"),
    // `Fecha` es un instante local sin zona (2026-03-14T11:02:33). Se corta el
    // día tal cual en vez de pasarlo por `Date`: convertirlo a instante lo
    // correría un día para cualquiera que no esté en UTC, y la emisión de una
    // factura es un día del calendario, no un momento.
    fecha: fechaRaw ? (/^\d{4}-\d{2}-\d{2}/.exec(fechaRaw)?.[0] ?? null) : null,
    moneda: root(xml, "Moneda") ?? "MXN",
    subtotal: num(root(xml, "SubTotal")),
    descuento: num(root(xml, "Descuento")) ?? 0,
    impuestosTrasladados: num(attr(xml, "Impuestos", "TotalImpuestosTrasladados")) ?? 0,
    total: num(root(xml, "Total")),
    tipoComprobante: root(xml, "TipoDeComprobante")?.toUpperCase() ?? null,
  };
}

/**
 * Qué documento es este comprobante para cuentas por pagar.
 *
 * `I` (ingreso) es una factura y por tanto un cargo; `E` (egreso) es la nota de
 * crédito y por tanto un abono. Los demás tipos —`P` de complemento de pago,
 * `N` de nómina, `T` de traslado— no crean ni cancelan deuda y se rechazan con
 * su motivo en vez de colarse como una factura de cero.
 */
export function tipoDeDocumento(
  doc: CfdiDoc,
): { kind: "charge" | "credit" } | { kind: null; reason: string } {
  switch (doc.tipoComprobante) {
    case "I":
      return { kind: "charge" };
    case "E":
      return { kind: "credit" };
    case "P":
      return {
        kind: null,
        reason: "Es un complemento de pago (tipo P): no crea deuda por sí mismo.",
      };
    case null:
      return { kind: null, reason: "El archivo no parece un CFDI." };
    default:
      return {
        kind: null,
        reason: `Tipo de comprobante ${doc.tipoComprobante}: no afecta cuentas por pagar.`,
      };
  }
}
