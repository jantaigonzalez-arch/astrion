import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AlertTriangle, BarChart3, CalendarClock, Plus, Upload, Wallet } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { AGING_LABEL, countPayables, getPayables, getPayablesAging, getPayablesSummary, type AgingKey } from "@/lib/data/payables";
import { parsePage } from "@/lib/pagination";
import { Pagination } from "@/components/portal/pagination";
import { INVOICE_STATUS_LABEL } from "@/lib/domain/payables";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";
import { cn } from "@/lib/utils";
import { DashboardFab } from "@/components/portal/dashboard-fab";
import { AnalysisSection, AnalysisSectionSkeleton } from "@/components/portal/analysis-section";

export default async function CuentasPorPagarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; por?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const pageParams = parsePage(await searchParams);

  // Cuentas por pagar es de administración, no de soporte: reconocer una deuda
  // y sacar dinero de la empresa no es lo mismo que recibir mercancía.
  if (!(await puedeEn("pagar", "ver"))) {
    await redirectInTenant("/admin/compras", locale);
  }

  // Dos consultas en vez de una que trae todo y parte en memoria.
  //
  // Lo pendiente se enseña entero: es la lista de trabajo, y esconder una
  // factura por vencer detrás de un paginador sería esconder justamente lo que
  // esta pantalla existe para no dejar pasar. El archivo, en cambio, crece para
  // siempre y se pagina.
  const [abiertas, cerradas, totalCerradas, resumen, antiguedad] = await Promise.all([
    getPayables({ onlyOpen: true }),
    getPayables({
      onlyClosed: true,
      limit: pageParams.perPage,
      offset: pageParams.offset,
    }),
    countPayables({ onlyClosed: true }),
    getPayablesSummary(),
    getPayablesAging(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cuentas por pagar</h1>
          <p className="text-sm text-muted-foreground">
            Lo que se le debe a cada proveedor y cuándo vence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <Link href="/admin/compras/cuentas-por-pagar/analisis">
              <BarChart3 className="size-4" /> Análisis
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/compras/cuentas-por-pagar/importar">
              <Upload className="size-4" /> Importar
            </Link>
          </Button>
          <Button asChild variant="accent">
            <Link href="/admin/compras/cuentas-por-pagar/nueva">
              <Plus className="size-4" /> Capturar factura
            </Link>
          </Button>
        </div>
      </div>

      {/* Vencido y por vencer separados: son dos decisiones distintas. Lo
          vencido ya es un problema con el proveedor; lo que vence esta semana
          es la lista de pagos a programar.

          Un bloque POR MONEDA. Sumar dólares con pesos daría un «saldo total»
          que no existe en ninguna divisa, y convertirlos exigiría fijar tipo de
          cambio y fecha — una decisión contable, no algo que esta pantalla
          deba inventar. */}
      {resumen.byCurrency.map((r) => (
        <div key={r.currency} className="space-y-2">
          {resumen.multiCurrency && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {r.currency}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              Icon={Wallet}
              label="Saldo total"
              value={money(r.balance, r.currency)}
              detail={`${r.count} ${r.count === 1 ? "factura abierta" : "facturas abiertas"}`}
            />
            <Stat
              Icon={AlertTriangle}
              label="Vencido"
              value={money(r.overdue, r.currency)}
              detail={`${r.overdueCount} ${r.overdueCount === 1 ? "factura" : "facturas"}`}
              tone={r.overdue > 0 ? "bad" : undefined}
            />
            <Stat
              Icon={CalendarClock}
              label="Vence en 7 días"
              value={money(r.dueSoon, r.currency)}
              detail={`${r.dueSoonCount} ${r.dueSoonCount === 1 ? "factura" : "facturas"}`}
              tone={r.dueSoon > 0 ? "watch" : undefined}
            />
          </div>
        </div>
      ))}

      {/* Antigüedad. El total dice si hay problema; los tramos dicen de quién
          es y qué tan viejo, que es con lo que se decide a quién pagar. Se mide
          desde el VENCIMIENTO —un proveedor a 90 días no está moroso el día
          60— y, con parcialidades, desde el vencimiento de cada una. */}
      {antiguedad.byCurrency.map((ag) => (
        <Card key={ag.currency} className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">
              Antigüedad de saldos
              {antiguedad.multiCurrency && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {ag.currency}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              Días transcurridos desde el vencimiento.
            </p>
          </div>

          <div className="grid gap-px bg-border sm:grid-cols-5">
            {ag.buckets.map((b) => (
              <div key={b.key} className="bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">{AGING_LABEL[b.key]}</p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold tabular-nums",
                    b.amount > 0 && TRAMO_TONO[b.key],
                  )}
                >
                  {money(b.amount, ag.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {b.count} {b.count === 1 ? "factura" : "facturas"}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border-t border-border">
            <table className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Proveedor</th>
                  <th data-num className="px-4 py-2 text-right font-medium">Al corriente</th>
                  <th data-num className="px-4 py-2 text-right font-medium">1–30</th>
                  <th data-num className="px-4 py-2 text-right font-medium">31–60</th>
                  <th data-num className="px-4 py-2 text-right font-medium">61–90</th>
                  <th data-num className="px-4 py-2 text-right font-medium">+90</th>
                  <th data-num className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ag.bySupplier.map((s) => (
                  <tr key={s.supplierId} className="hover:bg-secondary/30">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/compras/proveedores/${s.supplierId}`}
                        className="text-primary hover:underline"
                      >
                        {s.supplierName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.paymentTermsDays === 0
                          ? "contado"
                          : `${s.paymentTermsDays} días`}
                      </span>
                    </td>
                    {(
                      ["al_corriente", "d1_30", "d31_60", "d61_90", "d90_mas"] as const
                    ).map((k) => (
                      <td
                        key={k}
                        className={cn(
                          "px-4 py-2 text-right tabular-nums",
                          s.buckets[k] > 0 ? TRAMO_TONO[k] : "text-muted-foreground/40",
                        )}
                      >
                        {s.buckets[k] > 0 ? money(s.buckets[k], ag.currency) : "—"}
                      </td>
                    ))}
                    <td data-num className="px-4 py-2 text-right font-medium tabular-nums">
                      {money(s.total, ag.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {abiertas.length === 0 && totalCerradas === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay facturas de proveedor.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Al capturar la factura de una orden recibida nace la deuda, con su
            vencimiento calculado a partir de los días de crédito del proveedor.
          </p>
        </Card>
      ) : (
        <>
          <Tabla titulo="Por pagar" rows={abiertas} vacio="Nada pendiente de pago." />
          {totalCerradas > 0 && (
            <Tabla
              titulo="Cerradas"
              rows={cerradas}
              vacio=""
              apagada
              pie={
                <Pagination
                  {...pageParams}
                  total={totalCerradas}
                  basePath="/admin/compras/cuentas-por-pagar"
                />
              }
            />
          )}
        </>
      )}
      {/* Aquí van los avisos, el calendario y el pronóstico del mes que viene: es
          la pantalla donde se decide si hay que mover una línea de crédito.

          En `Suspense` para que la pantalla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/compras/cuentas-por-pagar" />
      </Suspense>


      {/* La salida al tablero del módulo. Flotante, así que no ocupa
          sitio en el flujo — y va al FINAL del contenedor justo por eso:
          puesto arriba, el `space-y` le daría margen al hermano siguiente
          y la página se movería 24 px cuando el botón llega por streaming.

          En `Suspense` porque decidir si aparece exige leer el estado del
          tablero, y eso no puede retrasar la pantalla. */}
      <Suspense fallback={null}>
        <DashboardFab modulo="pagos" />
      </Suspense>
    </div>
  );
}

function Tabla({
  titulo,
  rows,
  vacio,
  apagada,
  pie,
}: {
  titulo: string;
  rows: Awaited<ReturnType<typeof getPayables>>;
  vacio: string;
  apagada?: boolean;
  /** Controles de página, cuando la tabla es solo un tramo del total. */
  pie?: React.ReactNode;
}) {
  if (!rows.length) {
    return vacio ? (
      <Card className="p-6 text-center text-sm text-muted-foreground">{vacio}</Card>
    ) : null;
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-3">
        <h2 className="font-semibold">{titulo}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="tabla-erp w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Folio</th>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 font-medium">Su folio</th>
              <th className="px-4 py-3 font-medium">Vence</th>
              <th data-num className="px-4 py-3 text-right font-medium">Total</th>
              <th data-num className="px-4 py-3 text-right font-medium">Saldo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const vencida =
                r.daysLate > 0 && (r.status === "pending" || r.status === "partial");
              return (
                <tr key={r.id} className={cn("hover:bg-secondary/30", apagada && "opacity-60")}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/compras/cuentas-por-pagar/${r.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.supplierName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {r.supplierFolio ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={vencida ? "font-medium text-destructive" : ""}>
                      {r.dueAt}
                    </span>
                    {vencida && (
                      <span className="ml-2 text-xs text-destructive">
                        {r.daysLate} {r.daysLate === 1 ? "día" : "días"}
                      </span>
                    )}
                  </td>
                  <td data-num className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {money(r.total, r.currency)}
                  </td>
                  <td data-num className="px-4 py-3 text-right font-medium tabular-nums">
                    {r.balance > 0 ? money(r.balance, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={ESTADO_ESTILO[r.status]}>
                      {INVOICE_STATUS_LABEL[r.status]}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pie}
    </Card>
  );
}

/** El color sube con la mora: al corriente es neutro, +90 es rojo. */
const TRAMO_TONO: Record<AgingKey, string> = {
  al_corriente: "text-foreground",
  d1_30: "text-warning",
  d31_60: "text-warning",
  d61_90: "text-destructive",
  d90_mas: "text-destructive",
};

const ESTADO_ESTILO: Record<string, string> = {
  pending: "bg-warning/15 text-warning ring-warning/25",
  partial: "bg-signal/15 text-signal-bright ring-signal/25",
  paid: "bg-success/15 text-success ring-success/25",
  cancelled: "bg-muted text-muted-foreground ring-border",
};

function Stat({
  Icon,
  label,
  value,
  detail,
  tone,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
  tone?: "bad" | "watch";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "watch" && "text-warning",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function money(n: number, currency = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
