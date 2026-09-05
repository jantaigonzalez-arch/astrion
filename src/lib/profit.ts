// Cálculo de utilidad — puro, sin dependencias de BD (usable en cliente y servidor).

export type ProfitInput = {
  hours: number;
  parts: {
    quantity: number;
    unitCostMxn: string | null;
    unitPriceMxn: string | null;
  }[];
  laborCostPerHour: number;
  laborRatePerHour: number;
  /**
   * Lo que costó LLEGAR: viáticos comprobados y cerrados de este servicio.
   *
   * ── POR QUÉ ES COSTO Y NO TIENE INGRESO AL LADO ──────────────────────────
   *
   * Las otras dos partidas vienen en pareja —una refacción se compra y se
   * vende, una hora se paga y se cobra—. El viaje no: al cliente no se le
   * factura el vuelo, va dentro del precio del contrato. Por eso entra solo en
   * `cost`, y por eso su efecto es bajar el margen en vez de moverlo en las dos
   * direcciones.
   *
   * Es justo lo que faltaba para que un contrato foráneo dejara de parecer tan
   * rentable como uno de la misma ciudad.
   *
   * ── OPCIONAL A PROPÓSITO ─────────────────────────────────────────────────
   *
   * Omitirlo da cero, que es exactamente lo que este cálculo hacía antes de que
   * existieran los viáticos. Así ninguna de las llamadas que ya había cambia de
   * resultado, y las que quieran contarlo lo piden. Obligatorio habría forzado
   * a cada quien a pasar un cero, que es la clase de parámetro que alguien
   * acaba rellenando con lo primero que tiene a mano.
   */
  viaticosCost?: number;
};

export type Profit = {
  partsRevenue: number;
  partsCost: number;
  laborRevenue: number;
  laborCost: number;
  /** Viáticos cerrados imputados a este servicio. Costo sin ingreso al lado. */
  viaticosCost: number;
  revenue: number;
  cost: number;
  profit: number;
  /** Margen sobre el ingreso, en % (0 si no hay ingreso). */
  margin: number;
  hours: number;
};

const num = (v: string | null) => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? 0 : n;
};

export function computeProfit(input: ProfitInput): Profit {
  const partsRevenue = input.parts.reduce(
    (a, p) => a + num(p.unitPriceMxn) * p.quantity,
    0,
  );
  const partsCost = input.parts.reduce(
    (a, p) => a + num(p.unitCostMxn) * p.quantity,
    0,
  );
  const laborRevenue = input.hours * input.laborRatePerHour;
  const laborCost = input.hours * input.laborCostPerHour;
  const viaticosCost = input.viaticosCost ?? 0;

  const revenue = partsRevenue + laborRevenue;
  const cost = partsCost + laborCost + viaticosCost;
  const profit = revenue - cost;

  return {
    partsRevenue,
    partsCost,
    laborRevenue,
    laborCost,
    viaticosCost,
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    hours: input.hours,
  };
}

/** Suma varias utilidades (p. ej. todos los servicios de un contrato). */
export function sumProfits(list: Profit[]): Profit {
  const z: Profit = {
    partsRevenue: 0,
    partsCost: 0,
    laborRevenue: 0,
    laborCost: 0,
    viaticosCost: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
    margin: 0,
    hours: 0,
  };
  const t = list.reduce(
    (a, p) => ({
      partsRevenue: a.partsRevenue + p.partsRevenue,
      partsCost: a.partsCost + p.partsCost,
      laborRevenue: a.laborRevenue + p.laborRevenue,
      laborCost: a.laborCost + p.laborCost,
      viaticosCost: a.viaticosCost + p.viaticosCost,
      revenue: a.revenue + p.revenue,
      cost: a.cost + p.cost,
      profit: a.profit + p.profit,
      margin: 0,
      hours: a.hours + p.hours,
    }),
    z,
  );
  t.margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0;
  return t;
}

export const mxn = (n: number, locale = "es-MX") =>
  new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(n);
