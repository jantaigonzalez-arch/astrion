import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft, FileMinus, HandCoins, Receipt } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getPayable } from "@/lib/data/payables";
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/domain/payables";
import { hoyCivil } from "@/lib/fechas";
import {
  CancelInvoiceForm,
  PaymentForm,
  UnapplyForm,
} from "@/components/portal/purchasing/payment-forms";
import {
  InstallmentPlan,
  SplitInvoiceForm,
} from "@/components/portal/purchasing/installment-forms";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";
import { cn } from "@/lib/utils";

export default async function FacturaPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/admin/compras", locale);
  }

  const data = await getPayable(id);
  if (!data) notFound();

  const {
    invoice, payments, credits, advances, installments,
    orders, paid, credited, advanced, balance,
  } = data;
  const abierta = invoice.status === "pending" || invoice.status === "partial";
  const vencida = abierta && invoice.daysLate > 0;
  const hoy = hoyCivil();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras/cuentas-por-pagar"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Cuentas por pagar
        </Link>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">
                {invoice.reference}
              </h1>
              <Badge className={ESTADO_ESTILO[invoice.status]}>
                {INVOICE_STATUS_LABEL[invoice.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.supplierName}
              {invoice.supplierFolio ? ` · factura ${invoice.supplierFolio}` : ""}
              {invoice.createdByName ? ` · capturó ${invoice.createdByName}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-4 sm:grid-cols-4",
          (credited > 0 || advanced > 0) && "sm:grid-cols-5",
        )}
      >
        <Stat label="Total" value={money(invoice.total, invoice.currency)} />
        <Stat label="Pagado" value={money(paid, invoice.currency)} />
        {/* Solo aparece si hay: en la mayoría de las facturas no la hay, y una
            columna vacía en todas para el caso raro es ruido permanente. */}
        {credited > 0 && (
          <Stat
            label="Nota de crédito"
            value={money(credited, invoice.currency)}
            detail="No salió dinero"
          />
        )}
        {advanced > 0 && (
          <Stat
            label="Anticipos"
            value={money(advanced, invoice.currency)}
            detail="Salió antes de la factura"
          />
        )}
        <Stat
          label="Saldo"
          value={money(balance, invoice.currency)}
          tone={balance > 0 ? "watch" : "good"}
        />
        <Stat
          label="Vence"
          value={invoice.dueAt}
          detail={
            vencida
              ? `${invoice.daysLate} ${invoice.daysLate === 1 ? "día" : "días"} de atraso`
              : abierta
                ? `en ${Math.abs(invoice.daysLate)} ${Math.abs(invoice.daysLate) === 1 ? "día" : "días"}`
                : undefined
          }
          tone={vencida ? "bad" : undefined}
        />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">El documento</h2>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Dato k="Emisión" v={invoice.issuedAt} />
          <Dato k="Vencimiento" v={invoice.dueAt} />
          <Dato k="Subtotal" v={money(invoice.subtotal, invoice.currency)} />
          <Dato k="Impuestos" v={money(invoice.taxTotal, invoice.currency)} />
          <Dato k="Total" v={money(invoice.total, invoice.currency)} />
          <Dato
            k="Días de crédito"
            v={
              invoice.paymentTermsDays > 0
                ? `${invoice.paymentTermsDays} días`
                : "De contado"
            }
          />
          <Dato
            k="CFDI"
            v={invoice.cfdiUuid ?? "— sin folio fiscal"}
            mono={Boolean(invoice.cfdiUuid)}
            full
          />
        </dl>
        {invoice.notes && (
          <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm text-muted-foreground">
            {invoice.notes}
          </p>
        )}
        {invoice.status === "cancelled" && invoice.cancelReason && (
          <p className="mt-4 border-t border-border pt-4 text-sm text-destructive">
            Cancelada: {invoice.cancelReason}
          </p>
        )}
      </Card>

      {orders.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Órdenes que ampara</h2>
          <ul className="flex flex-wrap gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/admin/compras/${o.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-mono text-xs text-primary hover:bg-secondary"
                >
                  {o.reference}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* El plan de pagos, si la factura está partida. Va antes del formulario
          de pago: quien va a pagar necesita ver primero qué vencimiento toca. */}
      {installments.length > 0 && (
        <InstallmentPlan installments={installments} currency={invoice.currency} />
      )}

      {/* Dividir solo mientras no haya nada encima. El dominio lo vuelve a
          comprobar; esto evita ofrecer un botón que va a fallar. */}
      {abierta && installments.length === 0 && paid + credited + advanced === 0 && (
        <SplitInvoiceForm
          invoiceId={invoice.id}
          total={invoice.total}
          currency={invoice.currency}
          suggestedFirstDue={invoice.dueAt}
        />
      )}

      {abierta && (
        <PaymentForm
          invoiceId={invoice.id}
          balance={balance}
          currency={invoice.currency}
          hoy={hoy}
        />
      )}

      {payments.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Pagos</h2>
          {/* Cada renglón lleva el saldo que quedó tras aplicarlo: así se lee la
              historia de la deuda sin sumar de cabeza. */}
          <ul className="space-y-3 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-start gap-3">
                <Receipt className="mt-0.5 size-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium tabular-nums">
                      {money(Number(p.amount), invoice.currency)}
                    </span>{" "}
                    · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference ? ` · ${p.reference}` : ""}
                    <span className="text-muted-foreground">
                      {" "}
                      → saldo {money(Number(p.balanceAfter), invoice.currency)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.paidAt}
                    {p.actorName ? ` · registró ${p.actorName}` : ""}
                    {p.note ? ` — ${p.note}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Las notas van en su propia tarjeta y no mezcladas con los pagos. Leer
          «se abonaron 1 500» sin saber si ese dinero salió de la caja es
          exactamente la confusión que la nota de crédito existe para eliminar. */}
      {credits.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Notas de crédito aplicadas</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Bajan el saldo sin que salga dinero.
          </p>
          <ul className="space-y-3 text-sm">
            {credits.map((c) => (
              <li key={c.id} className="flex items-start gap-3">
                <FileMinus className="mt-0.5 size-4 shrink-0 text-signal-bright" />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium tabular-nums">
                      {money(Number(c.amount), invoice.currency)}
                    </span>{" "}
                    · <span className="font-mono text-xs">{c.creditNoteRef}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      → saldo {money(Number(c.balanceAfter), invoice.currency)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.appliedAt}
                    {c.actorName ? ` · aplicó ${c.actorName}` : ""}
                    {c.note ? ` — ${c.note}` : ""}
                  </p>
                  {/* Solo mientras la factura siga viva: quitarle una
                      aplicación a una cancelada no la resucita —el dominio no
                      la toca— así que el botón prometería algo que no pasa. */}
                  {invoice.status !== "cancelled" && (
                    <UnapplyForm tipo="nota" applicationId={c.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Los anticipos imputados también van aparte. Es dinero, sí, pero salió
          antes de que esta factura existiera: mezclarlos con los pagos haría
          creer que el desembolso ocurrió el día de la imputación. */}
      {advances.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Anticipos imputados</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            El dinero salió el día del anticipo, no el de la imputación.
          </p>
          <ul className="space-y-3 text-sm">
            {advances.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <HandCoins className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium tabular-nums">
                      {money(Number(a.amount), invoice.currency)}
                    </span>{" "}
                    · <span className="font-mono text-xs">{a.advanceRef}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      → saldo {money(Number(a.balanceAfter), invoice.currency)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Imputado el {a.appliedAt} · pagado el {a.advancePaidAt}
                    {a.actorName ? ` · ${a.actorName}` : ""}
                    {a.note ? ` — ${a.note}` : ""}
                  </p>
                  {invoice.status !== "cancelled" && (
                    <UnapplyForm tipo="anticipo" applicationId={a.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Cancelar solo mientras no haya nada encima: con dinero, notas o
          anticipos, anularla dejaría esos documentos apuntando al vacío. El
          dominio lo vuelve a comprobar. */}
      {invoice.status === "pending" &&
        payments.length === 0 &&
        credits.length === 0 &&
        advances.length === 0 && <CancelInvoiceForm invoiceId={invoice.id} />}
    </div>
  );
}

const ESTADO_ESTILO: Record<string, string> = {
  pending: "bg-warning/15 text-warning ring-warning/25",
  partial: "bg-signal/15 text-signal-bright ring-signal/25",
  paid: "bg-success/15 text-success ring-success/25",
  cancelled: "bg-muted text-muted-foreground ring-border",
};

function Dato({
  k,
  v,
  mono,
  full,
}: {
  k: string;
  v: string;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className={cn("mt-0.5", mono && "break-all font-mono text-xs")}>{v}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "good" | "watch" | "bad";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "watch" && "text-warning",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </Card>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
