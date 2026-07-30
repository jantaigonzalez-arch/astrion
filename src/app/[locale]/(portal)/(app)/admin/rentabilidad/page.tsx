import { setRequestLocale } from "next-intl/server";
import {
  Clock,
  Lock,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { redirect, Link } from "@/i18n/navigation";
import { getTicketsWithCostData } from "@/lib/data/profitability";
import { getSettings } from "@/lib/data/settings";
import { computeProfit, sumProfits, mxn, type Profit } from "@/lib/profit";
import { Card } from "@/components/ui/card";
import { MonthlyTrend, RankBars, ProfitSplit } from "@/components/portal/charts";
import { cn } from "@/lib/utils";

const PERIODS = {
  "1m": { label: "Este mes", months: 1 },
  "3m": { label: "3 meses", months: 3 },
  "12m": { label: "12 meses", months: 12 },
  all: { label: "Todo", months: 0 },
} as const;
type PeriodKey = keyof typeof PERIODS;

export default async function ProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { locale } = await params;
  const { periodo } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }

  const period: PeriodKey =
    periodo && periodo in PERIODS ? (periodo as PeriodKey) : "12m";

  const [rows, appSettings] = await Promise.all([
    getTicketsWithCostData(),
    getSettings(),
  ]);

  // Utilidad por ticket.
  const withProfit = rows.map((t) => {
    const hours = t.comments.reduce((a, c) => a + Number(c.hours ?? 0), 0);
    const parts = t.comments.flatMap((c) => c.parts);
    return {
      ...t,
      p: computeProfit({
        hours,
        parts,
        laborCostPerHour: appSettings.laborCostPerHour,
        laborRatePerHour: appSettings.laborRatePerHour,
      }),
    };
  });

  // Filtro de periodo (por fecha de creación del ticket).
  const now = new Date();
  const cutoff =
    PERIODS[period].months > 0
      ? new Date(
          now.getFullYear(),
          now.getMonth() - (PERIODS[period].months - 1),
          1,
        )
      : null;
  const inPeriod = withProfit.filter(
    (t) => !cutoff || new Date(t.createdAt) >= cutoff,
  );
  // Solo servicios con actividad registrada aportan rentabilidad.
  const billable = inPeriod.filter((t) => t.p.revenue > 0 || t.p.cost > 0);

  const total = sumProfits(billable.map((t) => t.p));
  const partsProfit = total.partsRevenue - total.partsCost;
  const laborProfit = total.laborRevenue - total.laborCost;

  // Serie mensual (últimos 6 meses del periodo).
  const monthsBack = period === "1m" ? 1 : period === "3m" ? 3 : 6;
  const monthly: { label: string; revenue: number; cost: number; profit: number }[] =
    [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const bucket = billable.filter((t) => {
      const c = new Date(t.createdAt);
      return c >= d && c < next;
    });
    const s = sumProfits(bucket.map((t) => t.p));
    monthly.push({
      label: d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
        month: "short",
      }),
      revenue: s.revenue,
      cost: s.cost,
      profit: s.profit,
    });
  }

  // Top clientes por utilidad.
  const byClient = new Map<string, { label: string; profits: Profit[] }>();
  for (const t of billable) {
    const key = t.createdBy.id;
    const label =
      t.createdBy.company ?? t.createdBy.name ?? t.createdBy.email;
    const cur = byClient.get(key) ?? { label, profits: [] };
    cur.profits.push(t.p);
    byClient.set(key, cur);
  }
  const clientRows = Array.from(byClient.values())
    .map((c) => {
      const s = sumProfits(c.profits);
      return {
        label: c.label,
        sub: `${c.profits.length} servicio(s) · margen ${s.margin.toFixed(1)}%`,
        value: s.profit,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Servicios menos rentables.
  const worst = [...billable]
    .filter((t) => t.p.revenue > 0)
    .sort((a, b) => a.p.margin - b.p.margin)
    .slice(0, 6);

  const positive = total.profit >= 0;

  const kpis = [
    { label: "Ingreso", value: mxn(total.revenue), Icon: Wallet, tone: "" },
    { label: "Costo", value: mxn(total.cost), Icon: Receipt, tone: "" },
    {
      label: "Utilidad",
      value: mxn(total.profit),
      Icon: positive ? TrendingUp : TrendingDown,
      tone: positive ? "text-success" : "text-destructive",
    },
    {
      label: "Horas facturadas",
      value: `${total.hours.toFixed(2)} h`,
      Icon: Clock,
      tone: "",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Rentabilidad
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              <Lock className="size-3" /> interno
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {billable.length} servicio(s) con actividad registrada · margen global{" "}
            <span
              className={cn(
                "font-semibold",
                positive ? "text-success" : "text-destructive",
              )}
            >
              {total.margin.toFixed(1)}%
            </span>
          </p>
        </div>

        {/* Filtro de periodo — una fila arriba de las gráficas */}
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
            <Link
              key={k}
              href={`/admin/rentabilidad?periodo=${k}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                k === period
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PERIODS[k].label}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{k.label}</span>
              <k.Icon className={cn("size-4 text-muted-foreground", k.tone)} />
            </div>
            <div className={cn("mt-2 text-2xl font-semibold tabular-nums", k.tone)}>
              {k.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Tendencia */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Utilidad por mes</h2>
          <MonthlyTrend data={monthly} />
        </Card>

        {/* Composición */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Origen de la utilidad</h2>
          <ProfitSplit partsProfit={partsProfit} laborProfit={laborProfit} />
          <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Venta refacciones</dt>
              <dd className="tabular-nums">{mxn(total.partsRevenue)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Venta mano de obra</dt>
              <dd className="tabular-nums">{mxn(total.laborRevenue)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Top clientes */}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Clientes más rentables</h2>
          <RankBars rows={clientRows} emptyText="Aún no hay servicios facturables." />
        </Card>

        {/* Menos rentables */}
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Servicios menos rentables</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Ordenados por margen ascendente — revisa tiempos o refacciones.
          </p>
          {worst.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sin servicios facturables en el periodo.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {worst.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="flex items-center gap-3 py-2.5 transition-colors hover:opacity-80"
                  >
                    <span className="font-mono text-xs text-primary">
                      {t.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.subject}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        t.p.margin < 20 ? "text-warning" : "",
                        t.p.profit < 0 ? "text-destructive" : "",
                      )}
                    >
                      {t.p.margin.toFixed(0)}%
                    </span>
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {mxn(t.p.profit)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Vista de tabla — identidad y cifras nunca dependen solo del color */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Detalle por servicio</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Folio</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Horas</th>
                <th className="px-4 py-3 font-medium">Ingreso</th>
                <th className="px-4 py-3 font-medium">Costo</th>
                <th className="px-4 py-3 font-medium">Utilidad</th>
                <th className="px-4 py-3 font-medium">Margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {billable.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <Link href={`/tickets/${t.id}`} className="text-primary hover:underline">
                      {t.reference}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                    {t.createdBy.company ?? t.createdBy.name ?? t.createdBy.email}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{t.p.hours}</td>
                  <td className="px-4 py-3 tabular-nums">{mxn(t.p.revenue)}</td>
                  <td className="px-4 py-3 tabular-nums">{mxn(t.p.cost)}</td>
                  <td
                    className={cn(
                      "px-4 py-3 font-semibold tabular-nums",
                      t.p.profit >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {mxn(t.p.profit)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{t.p.margin.toFixed(1)}%</td>
                </tr>
              ))}
              {billable.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    Sin servicios con actividad registrada en el periodo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
