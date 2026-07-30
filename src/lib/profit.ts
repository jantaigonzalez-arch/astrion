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
};

export type Profit = {
  partsRevenue: number;
  partsCost: number;
  laborRevenue: number;
  laborCost: number;
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

  const revenue = partsRevenue + laborRevenue;
  const cost = partsCost + laborCost;
  const profit = revenue - cost;

  return {
    partsRevenue,
    partsCost,
    laborRevenue,
    laborCost,
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
