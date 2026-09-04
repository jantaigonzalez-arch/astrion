import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowLeft, CalendarClock, Gauge, TrendingUp, Wallet } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { getPayables, getSupplierControls, getSupplierCreditHistory, getSupplierCreditNotes } from "@/lib/data/payables";
import { CREDIT_NOTE_STATUS_LABEL, INVOICE_STATUS_LABEL } from "@/lib/domain/payables";
import { hoyCivil } from "@/lib/fechas";
import { AdvanceForm, SuspensionPanel } from "@/components/portal/purchasing/supplier-controls";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Estado de cuenta e historial crediticio de un proveedor.
 *
 * La pregunta que contesta es la de antes de comprar: ¿cuánto le debo, y qué
 * clase de pagador he sido con él? Lo segundo importa porque es la mitad de la
 * negociación — pedir treinta días más de crédito a quien se le paga con
 * cuarenta de retraso es una conversación distinta.
 */
export default async function ProveedorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "administrar"))) {
    await redirectInTenant("/admin/compras", locale);
  }

  const historia = await getSupplierCreditHistory(id);
  if (!historia) notFound();

  const [facturas, notas, controles] = await Promise.all([
    getPayables({ supplierId: id }),
    getSupplierCreditNotes(id),
    getSupplierControls(id),
  ]);
  if (!controles) notFound();

  const hoy = hoyCivil();
  const anticiposAbiertos = controles.advances.filter((a) => a.remaining > 0);

  const abiertas = facturas.filter(
    (f) => f.status === "pending" || f.status === "partial",
  );

  // Puntualidad contra el plazo pactado. Se compara lo real con lo prometido y
  // no con un ideal: pagar a 35 días a quien dio 30 es distinto de pagarle a 35
  // a quien dio 60, y un solo número sin esa vara no dice nada.
  const desvio =
    historia.avgDaysToPay === null
      ? null
      : historia.avgDaysToPay - historia.paymentTermsDays;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {historia.supplierName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {historia.rfc ? `${historia.rfc} · ` : ""}
            {historia.paymentTermsDays === 0
              ? "De contado"
              : `${historia.paymentTermsDays} días de crédito`}
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/admin/compras/proveedores">
            <ArrowLeft className="size-4" /> Proveedores
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          Icon={Wallet}
          label="Saldo actual"
          value={money(historia.balance)}
          detail={`${historia.openCount} ${historia.openCount === 1 ? "factura abierta" : "facturas abiertas"}`}
          tone={historia.balance > 0 ? "watch" : undefined}
        />
        <Stat
          Icon={TrendingUp}
          label="Comprado 12 meses"
          value={money(historia.purchased12m)}
          detail="Facturado, sin contar canceladas"
        />
        <Stat
          Icon={CalendarClock}
          label="Pago real promedio"
          value={
            historia.avgDaysToPay === null ? "—" : `${historia.avgDaysToPay} días`
          }
          detail={
            desvio === null
              ? "Sin facturas saldadas todavía"
              : desvio <= 0
                ? `${Math.abs(desvio)} días antes de lo pactado`
                : `${desvio} días después de lo pactado`
          }
          tone={desvio === null ? undefined : desvio > 5 ? "bad" : undefined}
        />
        <Stat
          Icon={Gauge}
          label="Puntualidad"
          value={historia.onTimePct === null ? "—" : `${historia.onTimePct} %`}
          detail={
            historia.settledCount === 0
              ? "Sin historial"
              : `Sobre ${historia.settledCount} ${historia.settledCount === 1 ? "factura saldada" : "facturas saldadas"}`
          }
          tone={
            historia.onTimePct === null
              ? undefined
              : historia.onTimePct < 60
                ? "bad"
                : historia.onTimePct < 85
                  ? "watch"
                  : undefined
          }
        />
      </div>

      {(historia.worstLateDays !== null || historia.creditAvailable > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {historia.worstLateDays !== null && (
            <Card className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Peor retraso registrado
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {historia.worstLateDays === 0
                  ? "Ninguno"
                  : `${historia.worstLateDays} días`}
              </p>
              <p className="text-xs text-muted-foreground">
                Medido desde el vencimiento hasta que quedó cubierta.
              </p>
            </Card>
          )}
          {historia.creditAvailable > 0 && (
            <Card className="border-success/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Saldo a favor
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-success">
                {money(historia.creditAvailable)}
              </p>
              <p className="text-xs text-muted-foreground">
                Notas de crédito sin aplicar. Aplícalas antes de pagar.
              </p>
            </Card>
          )}
        </div>
      )}

      <SuspensionPanel
        supplierId={id}
        supplierName={historia.supplierName}
        suspendedAt={controles.supplier.suspendedAt}
        suspendReason={controles.supplier.suspendReason}
        suspendedBy={controles.supplier.suspendedBy}
      />

      <AdvanceForm
        supplierId={id}
        currency={controles.supplier.currency}
        hoy={hoy}
        suspended={Boolean(controles.supplier.suspendedAt)}
      />

      {anticiposAbiertos.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Anticipos con saldo</h2>
            <p className="text-xs text-muted-foreground">
              Dinero ya entregado. Se imputa desde la factura correspondiente.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Folio</th>
                <th className="px-4 py-3 font-medium">Pagado el</th>
                <th className="px-4 py-3 font-medium">Referencia</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
                <th className="px-4 py-3 text-right font-medium">Sin imputar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {anticiposAbiertos.map((a) => (
                <tr key={a.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3 font-mono text-xs">{a.reference}</td>
                  <td className="whitespace-nowrap px-4 py-3">{a.paidAt}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {a.paymentReference ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {money(a.amount, a.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-primary">
                    {money(a.remaining, a.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Tabla
        titulo="Facturas abiertas"
        vacio="Nada pendiente con este proveedor."
        rows={abiertas}
      />

      {notas.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-semibold">Notas de crédito</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Folio</th>
                  <th className="px-4 py-3 font-medium">Su folio</th>
                  <th className="px-4 py-3 font-medium">Emitida</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Sin aplicar</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {notas.map((n) => (
                  <tr key={n.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3 font-mono text-xs">{n.reference}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {n.supplierFolio ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{n.issuedAt}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {money(n.total, n.currency)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-medium tabular-nums",
                        n.remaining > 0 && "text-success",
                      )}
                    >
                      {n.remaining > 0 ? money(n.remaining, n.currency) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={NOTA_ESTILO[n.status]}>
                        {CREDIT_NOTE_STATUS_LABEL[n.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Tabla({
  titulo,
  rows,
  vacio,
}: {
  titulo: string;
  rows: Awaited<ReturnType<typeof getPayables>>;
  vacio: string;
}) {
  if (!rows.length) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">{vacio}</Card>;
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-3">
        <h2 className="font-semibold">{titulo}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Folio</th>
              <th className="px-4 py-3 font-medium">Vence</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">Pagado</th>
              <th className="px-4 py-3 text-right font-medium">Nota de crédito</th>
              <th className="px-4 py-3 text-right font-medium">Saldo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const vencida = r.daysLate > 0;
              return (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/compras/cuentas-por-pagar/${r.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.reference}
                    </Link>
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
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {money(r.total, r.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {r.paid > 0 ? money(r.paid, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {r.credited > 0 ? money(r.credited, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
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
    </Card>
  );
}

const ESTADO_ESTILO: Record<string, string> = {
  pending: "bg-warning/15 text-warning ring-warning/25",
  partial: "bg-signal/15 text-signal-bright ring-signal/25",
  paid: "bg-success/15 text-success ring-success/25",
  cancelled: "bg-muted text-muted-foreground ring-border",
};

const NOTA_ESTILO: Record<string, string> = {
  open: "bg-success/15 text-success ring-success/25",
  applied: "bg-muted text-muted-foreground ring-border",
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
