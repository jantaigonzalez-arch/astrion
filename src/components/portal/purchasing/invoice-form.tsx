"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import {
  createSupplierInvoice,
  type PayableState,
} from "@/lib/actions/payables";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/lib/nav";
import { cn } from "@/lib/utils";

const initial: PayableState = { ok: false };

export type SupplierOption = {
  id: string;
  name: string;
  paymentTermsDays: number;
  currency: string;
};

export type OrderOption = {
  id: string;
  supplierId: string;
  reference: string;
  status: string;
  currency: string;
  total: string;
};

const selectCls =
  "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/** Suma días a `YYYY-MM-DD` sin pasar por horas: el vencimiento es un día del calendario. */
function sumarDias(fecha: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const num = (v: string) => Number(v.replace(/[^0-9.-]/g, "")) || 0;
const dos = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * Captura de una factura de proveedor.
 *
 * Dos cosas que la pantalla hace y el formulario de una orden no necesita:
 *
 * 1. Muestra el descuadre ANTES de enviar. El servidor rechaza una factura cuyo
 *    subtotal más impuestos no dé el total —ver `domain/payables.ts`—, pero
 *    enterarse al enviar obliga a recapturar diez campos por un dígito.
 * 2. Calcula el vencimiento con los días de crédito del proveedor en cuanto se
 *    elige, y lo deja editable: es un dato que se pacta y a veces se negocia
 *    factura por factura.
 */
export function InvoiceForm({
  suppliers,
  orders,
  hoy,
}: {
  suppliers: SupplierOption[];
  orders: OrderOption[];
  /** La fecha del servidor: el navegador puede estar en otra zona. */
  hoy: string;
}) {
  const [state, action, pending] = useActionState(createSupplierInvoice, initial);
  const router = useRouter();

  const [supplierId, setSupplierId] = useState("");
  const [issuedAt, setIssuedAt] = useState(hoy);
  const [dueAt, setDueAt] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [taxTotal, setTaxTotal] = useState("");
  const [total, setTotal] = useState("");

  const supplier = suppliers.find((s) => s.id === supplierId);
  const suyas = useMemo(
    () => orders.filter((o) => o.supplierId === supplierId),
    [orders, supplierId],
  );

  // Navegar es un efecto, no algo que se pueda hacer durante el render.
  useEffect(() => {
    if (state.ok && state.invoiceId) {
      router.push(`/admin/compras/cuentas-por-pagar/${state.invoiceId}`);
    }
  }, [state, router]);

  function elegirProveedor(id: string) {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    if (s && issuedAt) setDueAt(sumarDias(issuedAt, s.paymentTermsDays));
  }

  function cambiarEmision(v: string) {
    setIssuedAt(v);
    if (supplier && v) setDueAt(sumarDias(v, supplier.paymentTermsDays));
  }

  const sub = num(subtotal);
  const iva = num(taxTotal);
  const tot = num(total);
  const descuadre = tot > 0 && Math.abs(sub + iva - tot) > 0.01;

  return (
    <form action={action} className="space-y-6">
      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold">De quién y cuál</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="supplierId">Proveedor</Label>
            <select
              id="supplierId"
              name="supplierId"
              required
              value={supplierId}
              onChange={(e) => elegirProveedor(e.target.value)}
              className={selectCls}
            >
              <option value="">Elegir…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.paymentTermsDays > 0 ? ` · ${s.paymentTermsDays} días` : " · contado"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="supplierFolio">Folio de la factura</Label>
            <Input
              id="supplierFolio"
              name="supplierFolio"
              placeholder="El que trae impreso, ej. A-4471"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cfdiUuid">UUID del CFDI</Label>
            <Input
              id="cfdiUuid"
              name="cfdiUuid"
              maxLength={36}
              placeholder="Folio fiscal; vacío si es del extranjero"
              className="font-mono text-xs"
            />
            {/* El control que evita pagar dos veces la misma factura. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Con esto el sistema impide capturar dos veces la misma factura.
            </p>
          </div>
          <div>
            <Label htmlFor="currency">Moneda</Label>
            <select
              id="currency"
              name="currency"
              defaultValue={supplier?.currency ?? "MXN"}
              key={supplier?.currency}
              className={selectCls}
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold">Importes</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="subtotal">Subtotal</Label>
            <Input
              id="subtotal"
              name="subtotal"
              required
              inputMode="decimal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label htmlFor="taxTotal">Impuestos</Label>
            <Input
              id="taxTotal"
              name="taxTotal"
              inputMode="decimal"
              value={taxTotal}
              onChange={(e) => setTaxTotal(e.target.value)}
              placeholder="0.00"
            />
            <button
              type="button"
              onClick={() => {
                const s = num(subtotal);
                setTaxTotal(dos(s * 0.16));
                setTotal(dos(s * 1.16));
              }}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Calcular IVA 16%
            </button>
          </div>
          <div>
            <Label htmlFor="total">Total</Label>
            <Input
              id="total"
              name="total"
              required
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="0.00"
              className={cn(descuadre && "border-destructive")}
            />
          </div>
        </div>

        {/* Se avisa aquí y no al enviar: el servidor también lo rechaza, pero
            enterarse después obliga a recapturar todo por un dígito. */}
        {descuadre && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Subtotal más impuestos da {dos(sub + iva)}, y el total dice {dos(tot)}.
            Revisa contra el documento: no se guarda así.
          </p>
        )}
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold">Fechas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="issuedAt">Emisión</Label>
            <Input
              id="issuedAt"
              name="issuedAt"
              type="date"
              required
              value={issuedAt}
              onChange={(e) => cambiarEmision(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="dueAt">Vencimiento</Label>
            <Input
              id="dueAt"
              name="dueAt"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {supplier
                ? supplier.paymentTermsDays > 0
                  ? `Calculado con los ${supplier.paymentTermsDays} días de crédito. Se puede ajustar.`
                  : "El proveedor es de contado: vence el mismo día."
                : "Se calcula al elegir el proveedor."}
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="font-semibold">Qué ampara</h2>
        {!supplierId ? (
          <p className="text-sm text-muted-foreground">
            Elige un proveedor para ver sus órdenes sin facturar.
          </p>
        ) : suyas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este proveedor no tiene órdenes pendientes de facturar. Puedes
            capturar la factura igual: no todo lo que se factura viene de una
            orden — un flete, un servicio.
          </p>
        ) : (
          <ul className="space-y-2">
            {suyas.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm hover:bg-secondary/40">
                  <input
                    type="checkbox"
                    name="orderIds"
                    value={o.id}
                    className="size-4 rounded border-input"
                  />
                  <span className="font-mono text-xs">{o.reference}</span>
                  <span className="text-muted-foreground">{o.status}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {Number(o.total).toLocaleString("es-MX", {
                      style: "currency",
                      currency: o.currency || "MXN",
                    })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <Label htmlFor="notes">Notas</Label>
        <Input id="notes" name="notes" placeholder="Opcional" />
      </Card>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="submit" variant="accent" size="lg" disabled={pending || descuadre}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Capturar factura
        </Button>
      </div>
    </form>
  );
}
