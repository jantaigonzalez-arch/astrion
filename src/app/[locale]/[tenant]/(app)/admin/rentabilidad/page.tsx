import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import {
  Clock,
  Lock,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
} from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import {
  getProfitDetail,
  getProfitOverview,
  type Period,
  type ProfitOverview,
  type Rates,
} from "@/lib/data/profitability";
import { getSettings } from "@/lib/data/settings";
import { listTenantMembers } from "@/lib/data/people";
import { mxn } from "@/lib/profit";
import { parsePage } from "@/lib/pagination";
import { Card } from "@/components/ui/card";
import { MonthlyTrend, RankBars, ProfitSplit } from "@/components/portal/charts";
import { Pagination } from "@/components/portal/pagination";
import {
  ChartSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/portal/skeletons";
import { cn } from "@/lib/utils";
import { currentRole } from "@/lib/tenancy/context";

const PERIODS = {
  "1m": { label: "Este mes", months: 1 },
  "3m": { label: "3 meses", months: 3 },
  "12m": { label: "12 meses", months: 12 },
  all: { label: "Todo", months: 0 },
} as const;
type PeriodKey = keyof typeof PERIODS;

/**
 * El corte del periodo, calculado una vez y pasado a las consultas.
 *
 * Antes el periodo se aplicaba con un `.filter()` sobre el histórico entero ya
 * cargado en memoria. Ahora es una fecha que viaja al `where`, así que "este
 * mes" de verdad lee un mes.
 */
function periodOf(key: PeriodKey): Period {
  const { months } = PERIODS[key];
  if (months === 0) return { since: null };
  const now = new Date();
  return { since: new Date(now.getFullYear(), now.getMonth() - (months - 1), 1) };
}

export default async function ProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ periodo?: string; page?: string; por?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const period: PeriodKey =
    sp.periodo && sp.periodo in PERIODS ? (sp.periodo as PeriodKey) : "12m";
  const pageParams = parsePage(sp);

  // Las tarifas son una fila de `settings` y entran en TODAS las consultas como
  // parámetro: sin ellas no hay fórmula. Es la única lectura que bloquea, y
  // cuesta una consulta por clave primaria.
  const settings = await getSettings();
  const rates: Rates = {
    laborCostPerHour: settings.laborCostPerHour,
    laborRatePerHour: settings.laborRatePerHour,
  };
  const range = periodOf(period);

  /*
    Cada bloque tiene su propio límite: el encabezado y el selector de periodo
    se pintan de inmediato, y las consultas corren en paralelo y llegan cuando
    pueden. Antes la pantalla entera esperaba a la lectura del histórico
    completo.

    El resumen —totales, serie mensual, ranking de clientes y peores márgenes—
    es UNA consulta cuya promesa reciben los cinco bloques sin esperarla: cada
    uno la aguarda dentro de su propio Suspense. Pedir cada cifra por su lado
    habría sido más fácil de leer y habría recorrido el histórico cuatro veces
    para pintar una pantalla.

    El padrón para resolver nombres sigue la misma idea: lo piden el ranking de
    clientes y la tabla de detalle, y es una sola lectura.
  */
  const overview = getProfitOverview(range, rates, {
    months: period === "1m" ? 1 : period === "3m" ? 3 : 6,
  });
  const names = clientNames();

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
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">Calculando el periodo…</p>
            }
          >
            <Subtitle overview={overview} />
          </Suspense>
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

      <Suspense fallback={<StatCardsSkeleton />}>
        <Kpis overview={overview} />
      </Suspense>

      <div className="grid gap-5 lg:grid-cols-3">
        <Suspense fallback={<ChartSkeleton className="lg:col-span-2" />}>
          <Trend overview={overview} locale={locale} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <Split overview={overview} />
        </Suspense>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Suspense fallback={<ChartSkeleton />}>
          <TopClients overview={overview} names={names} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          <Worst overview={overview} />
        </Suspense>
      </div>

      <Suspense fallback={<TableSkeleton rows={10} cols={7} />}>
        <Detail
          period={range}
          rates={rates}
          page={pageParams}
          periodKey={period}
          names={names}
        />
      </Suspense>
    </div>
  );
}

/* ============================================================
   Bloques
   ============================================================ */

async function Subtitle({ overview }: { overview: Promise<ProfitOverview> }) {
  const { totals: total } = await overview;
  const positive = total.profit >= 0;
  return (
    <p className="text-sm text-muted-foreground">
      {total.services} servicio(s) con actividad registrada · margen global{" "}
      <span
        className={cn("font-semibold", positive ? "text-success" : "text-destructive")}
      >
        {total.margin.toFixed(1)}%
      </span>
    </p>
  );
}

async function Kpis({ overview }: { overview: Promise<ProfitOverview> }) {
  const { totals: total } = await overview;
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
  );
}

async function Trend({
  overview,
  locale,
}: {
  overview: Promise<ProfitOverview>;
  locale: string;
}) {
  const { monthly } = await overview;

  const data = monthly.map((p) => ({
    label: p.month.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      month: "short",
    }),
    revenue: p.revenue,
    cost: p.cost,
    profit: p.profit,
  }));

  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="mb-4 font-semibold">Utilidad por mes</h2>
      <MonthlyTrend data={data} />
    </Card>
  );
}

async function Split({ overview }: { overview: Promise<ProfitOverview> }) {
  const { totals: total } = await overview;
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Origen de la utilidad</h2>
      <ProfitSplit
        partsProfit={total.partsRevenue - total.partsCost}
        laborProfit={total.laborRevenue - total.laborCost}
      />
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
  );
}

/**
 * Nombre visible de un cliente a partir de su id.
 *
 * El ranking sale de la base agrupado por `created_by_id`, sin nombres: `users`
 * es plano de control y se lee por membresía. Se pide el padrón una vez y se
 * resuelven los seis ids contra él, en lugar de una consulta por cliente.
 */
async function clientNames() {
  const members = await listTenantMembers({ includeInactive: true });
  return new Map(
    members.map((m) => [m.id, m.company ?? m.name ?? m.email] as const),
  );
}

async function TopClients({
  overview,
  names,
}: {
  overview: Promise<ProfitOverview>;
  names: Promise<Map<string, string>>;
}) {
  const [{ byClient }, nameById] = await Promise.all([overview, names]);

  const rows = byClient.map((c) => ({
    label: nameById.get(c.clientId) ?? "—",
    sub: `${c.services} servicio(s) · margen ${c.margin.toFixed(1)}%`,
    value: c.profit,
  }));

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Clientes más rentables</h2>
      <RankBars rows={rows} emptyText="Aún no hay servicios facturables." />
    </Card>
  );
}

async function Worst({ overview }: { overview: Promise<ProfitOverview> }) {
  const { worst } = await overview;

  return (
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
                <span className="font-mono text-xs text-primary">{t.reference}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{t.subject}</span>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    t.margin < 20 ? "text-warning" : "",
                    t.profit < 0 ? "text-destructive" : "",
                  )}
                >
                  {t.margin.toFixed(0)}%
                </span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {mxn(t.profit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function Detail({
  period,
  rates,
  page,
  periodKey,
  names,
}: {
  period: Period;
  rates: Rates;
  page: ReturnType<typeof parsePage>;
  periodKey: PeriodKey;
  names: Promise<Map<string, string>>;
}) {
  const [{ rows, total }, nameById] = await Promise.all([
    getProfitDetail(period, rates, { limit: page.perPage, offset: page.offset }),
    names,
  ]);

  return (
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
            {rows.map((t) => (
              <tr key={t.id} className="transition-colors hover:bg-secondary/40">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  <Link href={`/tickets/${t.id}`} className="text-primary hover:underline">
                    {t.reference}
                  </Link>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                  {nameById.get(t.clientId) ?? "—"}
                </td>
                <td className="px-4 py-3 tabular-nums">{t.hours}</td>
                <td className="px-4 py-3 tabular-nums">{mxn(t.revenue)}</td>
                <td className="px-4 py-3 tabular-nums">{mxn(t.cost)}</td>
                <td
                  className={cn(
                    "px-4 py-3 font-semibold tabular-nums",
                    t.profit >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {mxn(t.profit)}
                </td>
                <td className="px-4 py-3 tabular-nums">{t.margin.toFixed(1)}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  Sin servicios con actividad registrada en el periodo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        {...page}
        total={total}
        basePath="/admin/rentabilidad"
        query={{ periodo: periodKey }}
      />
    </Card>
  );
}
