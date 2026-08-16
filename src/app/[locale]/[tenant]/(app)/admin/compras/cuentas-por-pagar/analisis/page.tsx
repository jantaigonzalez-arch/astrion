import { setRequestLocale } from "next-intl/server";
import { ArrowLeft, Ban, Clock, HandCoins, PiggyBank } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";
import {
  getCashOutByMonth,
  getIdleMoney,
  getPaymentCalendar,
  getSupplierBehavior,
} from "@/lib/data/payables";
import {
  CashOutChart,
  PaymentCalendarChart,
  ShareBar,
} from "@/components/portal/purchasing/payables-charts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Análisis de cuentas por pagar.
 *
 * No repite la antigüedad, que vive en el listado y mira hacia atrás. Esto mira
 * hacia adelante y hacia los lados: qué hay que pagar las próximas semanas,
 * cuánto sale de caja al mes, qué dinero está parado sin usarse, y de qué
 * proveedores depende la deuda.
 */
export default async function AnalisisCuentasPorPagarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/admin/compras", locale);
  }

  const [calendario, caja, parado, comportamiento] = await Promise.all([
    getPaymentCalendar(6),
    getCashOutByMonth(12),
    getIdleMoney(),
    getSupplierBehavior(),
  ]);

  const conSaldo = comportamiento.filter((s) => s.balance > 0);
  const conHistorial = comportamiento.filter((s) => s.settledCount > 0);
  const dineroParado = parado.advances.total + parado.creditNotes.total;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Análisis de cuentas por pagar
          </h1>
          <p className="text-sm text-muted-foreground">
            Qué hay que pagar, cuánto sale de caja y de quién dependemos.
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/admin/compras/cuentas-por-pagar">
            <ArrowLeft className="size-4" /> Cuentas por pagar
          </Link>
        </Button>
      </div>

      {/* Dinero parado primero: es lo único de esta pantalla sobre lo que se
          puede actuar hoy mismo, y lo que se paga dos veces si se olvida. */}
      {dineroParado > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {parado.advances.total > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <HandCoins className="size-3.5" /> Anticipos sin imputar
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {money(parado.advances.total, parado.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {parado.advances.count}{" "}
                {parado.advances.count === 1 ? "anticipo" : "anticipos"} · dinero
                que ya salió del banco
                {parado.advances.oldestDays !== null &&
                  ` · el más viejo lleva ${parado.advances.oldestDays} días`}
              </p>
            </Card>
          )}
          {parado.creditNotes.total > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <PiggyBank className="size-3.5" /> Notas de crédito sin aplicar
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-success">
                {money(parado.creditNotes.total, parado.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {parado.creditNotes.count}{" "}
                {parado.creditNotes.count === 1 ? "nota" : "notas"} · descuento
                concedido que nadie ha usado
                {parado.creditNotes.oldestDays !== null &&
                  ` · la más vieja lleva ${parado.creditNotes.oldestDays} días`}
              </p>
            </Card>
          )}
        </div>
      )}

      {calendario.map((c) => (
        <Card key={c.currency} className="p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Clock className="size-4 text-muted-foreground" />
                Qué hay que pagar
                {calendario.length > 1 && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.currency}
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground">
                Próximas seis semanas, por vencimiento. Con parcialidades cuenta
                cada una por su fecha, no la factura entera.
              </p>
            </div>
            <p className="text-sm tabular-nums text-muted-foreground">
              total {money(c.total, c.currency)}
            </p>
          </div>
          <PaymentCalendarChart weeks={c.weeks} currency={c.currency} />
        </Card>
      ))}

      <Card className="p-5">
        <h2 className="font-semibold">Salida de caja</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Últimos doce meses en {caja.currency}. Suma pagos y anticipos porque los
          dos sacaron dinero del banco; las notas de crédito no aparecen aquí
          —bajan la deuda sin mover un peso— y las imputaciones de anticipo
          tampoco, porque ese dinero ya se contó el día que salió.
        </p>
        <CashOutChart data={caja.data} currency={caja.currency} />
      </Card>

      {conSaldo.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">De quién depende la deuda</h2>
            <p className="text-xs text-muted-foreground">
              Cuota sobre el saldo de su propia moneda.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Proveedor</th>
                <th className="px-4 py-2 text-right font-medium">Saldo</th>
                <th className="px-4 py-2 font-medium">Cuota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {conSaldo.map((s) => (
                <tr key={s.supplierId} className="hover:bg-secondary/30">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/compras/proveedores/${s.supplierId}`}
                      className="text-primary hover:underline"
                    >
                      {s.supplierName}
                    </Link>
                    {s.suspended && (
                      <Badge className="ml-2 bg-destructive/15 text-destructive ring-destructive/25">
                        <Ban className="mr-1 size-3" /> Suspendido
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {money(s.balance, s.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <ShareBar pct={s.share} />
                      <span className="tabular-nums text-muted-foreground">
                        {s.share.toFixed(0)} %
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {conHistorial.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Cómo les pagamos</h2>
            <p className="text-xs text-muted-foreground">
              Días reales contra los pactados, ponderados por importe y medidos
              solo sobre facturas ya saldadas.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Proveedor</th>
                <th className="px-4 py-2 text-right font-medium">Pactado</th>
                <th className="px-4 py-2 text-right font-medium">Real</th>
                <th className="px-4 py-2 text-right font-medium">Desvío</th>
                <th className="px-4 py-2 text-right font-medium">Puntualidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {conHistorial.map((s) => {
                const desvio =
                  s.avgDaysToPay === null ? null : s.avgDaysToPay - s.paymentTermsDays;
                return (
                  <tr key={s.supplierId} className="hover:bg-secondary/30">
                    <td className="px-4 py-2">
                      <Link
                        href={`/admin/compras/proveedores/${s.supplierId}`}
                        className="text-primary hover:underline"
                      >
                        {s.supplierName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.settledCount}{" "}
                        {s.settledCount === 1 ? "saldada" : "saldadas"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {s.paymentTermsDays === 0 ? "contado" : `${s.paymentTermsDays} d`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {s.avgDaysToPay === null ? "—" : `${s.avgDaysToPay} d`}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums",
                        desvio === null
                          ? "text-muted-foreground"
                          : desvio > 5
                            ? "text-destructive"
                            : desvio > 0
                              ? "text-warning"
                              : "text-success",
                      )}
                    >
                      {desvio === null ? "—" : `${desvio > 0 ? "+" : ""}${desvio} d`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {s.onTimePct === null ? "—" : `${s.onTimePct} %`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function money(n: number, currency = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
