"use client";

import { useActionState, useState } from "react";
import { Ban, Loader2, PackageCheck, Send } from "lucide-react";
import {
  cancelOrder,
  receiveOrder,
  sendOrder,
  type PurchaseState,
} from "@/lib/actions/purchasing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurchaseOrderStatus } from "@/lib/db/schema";

const initial: PurchaseState = { ok: false };

function Feedback({ state }: { state: PurchaseState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok && state.message)
    return <p className="text-sm text-success">{state.message}</p>;
  return null;
}

/** Marca la orden como enviada. A partir de aquí se puede recibir. */
export function SendOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(sendOrder, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Marcar como enviada
      </Button>
      <Feedback state={state} />
    </form>
  );
}

type Line = {
  id: string;
  partNumber: string;
  description: string;
  quantity: number;
  receivedQuantity: number;
};

/**
 * Registro de la mercancía que llegó.
 *
 * Cada renglón viene precargado con lo que FALTA, que es lo que pasa el 90 % de
 * las veces: llega el pedido completo y el trabajo se reduce a confirmar. Quien
 * recibió menos corrige el número, que es el caso raro.
 *
 * No se puede escribir más de lo pendiente —el `max` del input y, por si acaso,
 * la validación del servidor—: recibir de más no es un dato, es una diferencia
 * con el proveedor.
 */
export function ReceiveForm({
  orderId,
  lines,
}: {
  orderId: string;
  lines: Line[];
}) {
  const [state, action, pending] = useActionState(receiveOrder, initial);
  const pendientes = lines.filter((l) => l.quantity > l.receivedQuantity);

  if (pendientes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No queda nada por recibir en esta orden.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="orderId" value={orderId} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Refacción</th>
              <th className="py-2 text-right font-medium">Pedido</th>
              <th className="py-2 text-right font-medium">Recibido</th>
              <th className="py-2 text-right font-medium">Entra ahora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pendientes.map((l) => {
              const falta = l.quantity - l.receivedQuantity;
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-4">
                    <input type="hidden" name="receive-line" value={l.id} />
                    <span className="font-mono text-xs">{l.partNumber}</span>
                    <p className="text-xs text-muted-foreground">{l.description}</p>
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {l.receivedQuantity}
                  </td>
                  <td className="py-2 pl-4 text-right">
                    <Input
                      name="receive-qty"
                      type="number"
                      min={0}
                      max={falta}
                      step={1}
                      defaultValue={falta}
                      className="ml-auto w-24 text-right"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <Label htmlFor="r-note">Nota de la entrada</Label>
        <Input id="r-note" name="note" placeholder="Factura, guía, quién recibió…" />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PackageCheck className="size-4" />
          )}
          Registrar entrada al inventario
        </Button>
        <p className="text-xs text-muted-foreground">
          Suma las existencias y queda en el historial de la refacción.
        </p>
      </div>

      <Feedback state={state} />
    </form>
  );
}

/** Cancela lo que falta por llegar. Exige motivo. */
export function CancelOrderForm({
  orderId,
  status,
}: {
  orderId: string;
  status: PurchaseOrderStatus;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelOrder, initial);

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Ban className="size-4" /> Cancelar orden
      </Button>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-border p-4">
      <input type="hidden" name="orderId" value={orderId} />
      <div>
        <Label htmlFor="c-reason">Motivo de la cancelación</Label>
        <Input id="c-reason" name="reason" required placeholder="El proveedor ya no lo surte…" />
      </div>
      {status === "partial" && (
        <p className="text-xs text-muted-foreground">
          Lo que ya se recibió se queda en el inventario: la mercancía está en la
          bodega. Solo se cancela lo que falta.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Confirmar cancelación
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Volver
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
