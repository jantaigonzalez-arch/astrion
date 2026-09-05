import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft, Package } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { getPurchaseOrder } from "@/lib/data/purchasing";
import { PurchaseStatusBadge } from "@/components/portal/purchasing/status-badge";
import { CancelOrderForm, ReceiveForm, SendOrderButton } from "@/components/portal/purchasing/order-actions";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import type { PurchaseOrderStatus } from "@/lib/db/schema";
import { puedeEn } from "@/lib/tenancy/context";

export default async function OrdenPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const data = await getPurchaseOrder(id);
  if (!data) notFound();

  const { order, lines, receipts } = data;
  const status = order.status as PurchaseOrderStatus;
  const currency = order.currency;

  const total = lines.reduce(
    (a, l) => a + l.quantity * Number(l.unitCostMxn ?? l.unitCostUsd ?? 0),
    0,
  );
  const pedido = lines.reduce((a, l) => a + l.quantity, 0);
  const recibido = lines.reduce((a, l) => a + l.receivedQuantity, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Órdenes de compra
        </Link>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">
                {order.reference}
              </h1>
              <PurchaseStatusBadge status={status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.supplierName}
              {order.paymentTermsDays > 0
                ? ` · ${order.paymentTermsDays} días de crédito`
                : " · de contado"}
              {order.createdByName ? ` · levantó ${order.createdByName}` : ""}
            </p>
          </div>

          {status === "draft" && <SendOrderButton orderId={order.id} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Piezas pedidas" value={String(pedido)} />
        <Stat
          label="Recibidas"
          value={`${recibido} / ${pedido}`}
          tone={recibido < pedido ? "watch" : "good"}
        />
        <Stat label="Total" value={money(total, currency)} />
        <Stat label="Se espera" value={order.expectedAt ?? "Sin fecha"} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-3">
          <h2 className="font-semibold">Renglones</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tabla-erp w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium"># Parte</th>
                <th className="px-4 py-3 font-medium">Descripción</th>
                <th data-num className="px-4 py-3 text-right font-medium">Pedido</th>
                <th data-num className="px-4 py-3 text-right font-medium">Recibido</th>
                <th data-num className="px-4 py-3 text-right font-medium">Costo unit.</th>
                <th data-num className="px-4 py-3 text-right font-medium">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => {
                const unit = Number(l.unitCostMxn ?? l.unitCostUsd ?? 0);
                const falta = l.quantity - l.receivedQuantity;
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-mono text-xs">{l.partNumber}</td>
                    <td className="px-4 py-3">{l.description}</td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {l.receivedQuantity}
                      {falta > 0 && (
                        <span className="ml-1 text-xs text-warning">
                          (faltan {falta})
                        </span>
                      )}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {unit > 0 ? money(unit, currency) : "—"}
                    </td>
                    <td data-num className="px-4 py-3 text-right tabular-nums">
                      {unit > 0 ? money(unit * l.quantity, currency) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(status === "sent" || status === "partial") && (
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Registrar recepción</h2>
          <ReceiveForm orderId={order.id} lines={lines} />
        </Card>
      )}

      {/* El historial se lee del ledger de inventario. No hay tabla de
          recepciones: el movimiento ES el documento de entrada. */}
      {receipts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Entradas registradas</h2>
          <ul className="space-y-2 text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <Package className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p>
                    <span className="font-medium tabular-nums">+{r.quantity}</span>{" "}
                    piezas · saldo {r.balanceAfter}
                    {r.actorName ? ` · ${r.actorName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.occurredAt.toLocaleString("es-MX")}
                    {r.note ? ` — ${r.note}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {order.notes && (
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Notas</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {order.notes}
          </p>
        </Card>
      )}

      {(await puedeEn("compras", "administrar")) &&
        status !== "cancelled" &&
        status !== "received" && (
          <CancelOrderForm orderId={order.id} status={status} />
        )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "watch";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-xl font-semibold tabular-nums " +
          (tone === "watch" ? "text-warning" : tone === "good" ? "text-success" : "")
        }
      >
        {value}
      </p>
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
