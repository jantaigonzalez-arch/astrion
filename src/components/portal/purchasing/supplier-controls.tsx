"use client";

import { useActionState, useState } from "react";
import { Ban, CheckCircle2, HandCoins, Loader2, ShieldOff, Undo2 } from "lucide-react";
import { createAdvance, type PayableState } from "@/lib/actions/payables";
import {
  reinstateSupplierAction,
  suspendSupplierAction,
  type PurchaseState,
} from "@/lib/actions/purchasing";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialPayable: PayableState = { ok: false };
const initialPurchase: PurchaseState = { ok: false };

const selectCls =
  "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/**
 * Anticipo a un proveedor.
 *
 * Vive en la pantalla del proveedor y no en la de una factura porque un
 * anticipo nace antes de que haya factura — ese es todo el punto. Se le imputa
 * después, desde la factura.
 */
export function AdvanceForm({
  supplierId,
  currency,
  hoy,
  suspended,
}: {
  supplierId: string;
  currency: string;
  /** Fecha del servidor: el navegador puede estar en otra zona. */
  hoy: string;
  suspended: boolean;
}) {
  const [state, action, pending] = useActionState(createAdvance, initialPayable);
  const [abierto, setAbierto] = useState(false);

  if (suspended) {
    return (
      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <HandCoins className="size-4 text-muted-foreground" /> Anticipos
        </h2>
        <p className="text-sm text-muted-foreground">
          No se le pueden dar anticipos mientras esté suspendido: comprometer más
          dinero es justo lo que la suspensión trata de frenar.
        </p>
      </Card>
    );
  }

  if (!abierto) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <HandCoins className="size-4 text-primary" /> Registrar anticipo
          </h2>
          <p className="text-sm text-muted-foreground">
            Dinero entregado antes de que exista la factura.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setAbierto(true)}>
          Registrar
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <HandCoins className="size-4 text-primary" /> Registrar anticipo
      </h2>

      <form action={action} className="space-y-4">
        <input type="hidden" name="supplierId" value={supplierId} />
        <input type="hidden" name="currency" value={currency} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="amount">Importe</Label>
            <Input id="amount" name="amount" inputMode="decimal" required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="paidAt">¿Cuándo salió el dinero?</Label>
            <Input
              id="paidAt"
              name="paidAt"
              type="date"
              defaultValue={hoy}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="method">Método</Label>
            <select id="method" name="method" defaultValue="transfer" className={selectCls}>
              <option value="transfer">Transferencia</option>
              <option value="cash">Efectivo</option>
              <option value="check">Cheque</option>
              <option value="card">Tarjeta</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div>
            <Label htmlFor="paymentReference">Referencia</Label>
            <Input
              id="paymentReference"
              name="paymentReference"
              placeholder="Folio de la transferencia…"
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Concepto</Label>
            <Input
              id="notes"
              name="notes"
              placeholder="Anticipo 30 % del pedido de bombas…"
              className="mt-1"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          El anticipo sale de la caja hoy y queda a favor del proveedor. Cuando
          llegue su factura, se imputa desde ahí — esa imputación ya no mueve
          dinero.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Registrando…
              </>
            ) : (
              "Registrar anticipo"
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          {state.error && <span className="text-sm text-destructive">{state.error}</span>}
          {state.ok && state.message && (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" /> {state.message}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

/**
 * Suspender o reanudar las compras a un proveedor.
 *
 * El texto insiste en lo que la suspensión NO hace —dejar de pagarle— porque es
 * la confusión previsible: suena a «cortar con él», y cortar el pago de una
 * deuda reconocida es un incumplimiento nuestro, no una medida de compras.
 */
export function SuspensionPanel({
  supplierId,
  supplierName,
  suspendedAt,
  suspendReason,
  suspendedBy,
}: {
  supplierId: string;
  supplierName: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  suspendedBy: string | null;
}) {
  const [sState, suspend, suspending] = useActionState(
    suspendSupplierAction,
    initialPurchase,
  );
  const [rState, reinstate, reinstating] = useActionState(
    reinstateSupplierAction,
    initialPurchase,
  );
  const [abierto, setAbierto] = useState(false);

  if (suspendedAt) {
    return (
      <Card className="border-destructive/40 p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-destructive">
          <ShieldOff className="size-4" /> Compras suspendidas
        </h2>
        <p className="text-sm">{suspendReason}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Desde el {suspendedAt}
          {suspendedBy ? ` · suspendió ${suspendedBy}` : ""}
        </p>

        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>✗ No se pueden crear ni enviar órdenes de compra</li>
          <li>✗ No se le pueden dar anticipos</li>
          <li>✓ Sí se le puede pagar lo que ya se le debe</li>
        </ul>

        <form action={reinstate} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="supplierId" value={supplierId} />
          <Input
            name="note"
            placeholder="¿Qué se resolvió? (opcional)"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" disabled={reinstating}>
            {reinstating ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Levantando…
              </>
            ) : (
              <>
                <Undo2 className="size-4" /> Levantar suspensión
              </>
            )}
          </Button>
          {rState.error && (
            <span className="text-sm text-destructive">{rState.error}</span>
          )}
        </form>
      </Card>
    );
  }

  if (!abierto) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Ban className="size-4 text-muted-foreground" /> Suspender compras
          </h2>
          <p className="text-sm text-muted-foreground">
            Bloquea órdenes nuevas sin dar de baja al proveedor ni congelar lo
            que ya se le debe.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setAbierto(true)}>
          Suspender
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Ban className="size-4 text-destructive" /> Suspender compras a {supplierName}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Se le seguirá pagando lo que ya se le debe. Solo se bloquean las órdenes
        nuevas y los anticipos.
      </p>

      <form action={suspend} className="space-y-4">
        <input type="hidden" name="supplierId" value={supplierId} />
        <div>
          <Label htmlFor="reason">Motivo</Label>
          <Input
            id="reason"
            name="reason"
            required
            minLength={4}
            placeholder="Entregó fuera de especificación, disputa abierta, está en la lista del SAT…"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Queda en la bitácora. Sin causa escrita, nadie sabrá qué tiene que
            pasar para levantarla.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={suspending}>
            {suspending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Suspendiendo…
              </>
            ) : (
              "Suspender compras"
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          {sState.error && (
            <span className="text-sm text-destructive">{sState.error}</span>
          )}
        </div>
      </form>
    </Card>
  );
}
