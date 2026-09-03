"use client";

import { useActionState, useState } from "react";
import { Ban, CheckCircle2, Loader2, Undo2, Wallet } from "lucide-react";
import {
  cancelInvoice,
  payInvoice,
  unapplyCredit,
  type PayableState,
} from "@/lib/actions/payables";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: PayableState = { ok: false };

const selectCls =
  "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

/**
 * Registro de un pago contra una factura.
 *
 * El botón «Saldar» llena el importe con el saldo exacto. No es comodidad
 * solamente: teclear el saldo a mano es de donde salen los pagos de más y los
 * que dejan un centavo colgando, y el servidor rechaza los primeros pero de los
 * segundos nadie se entera hasta la conciliación.
 */
export function PaymentForm({
  invoiceId,
  balance,
  currency,
  hoy,
}: {
  invoiceId: string;
  balance: number;
  currency: string;
  /** Fecha del servidor: el navegador puede estar en otra zona. */
  hoy: string;
}) {
  const [state, action, pending] = useActionState(payInvoice, initial);
  const [amount, setAmount] = useState("");

  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setAmount("");
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Wallet className="size-4 text-primary" /> Registrar pago
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Saldo pendiente:{" "}
        <span className="font-medium tabular-nums text-foreground">
          {money(balance, currency)}
        </span>
      </p>

      <form action={action} className="grid gap-4">
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="amount">Importe</Label>
            <Input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <button
              type="button"
              onClick={() => setAmount(balance.toFixed(2))}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Saldar ({money(balance, currency)})
            </button>
          </div>
          <div>
            <Label htmlFor="paidAt">Fecha del pago</Label>
            <Input id="paidAt" name="paidAt" type="date" required defaultValue={hoy} />
            <p className="mt-1 text-xs text-muted-foreground">
              Cuándo salió el dinero, no cuándo se captura.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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
            <Label htmlFor="reference">Referencia</Label>
            <Input
              id="reference"
              name="reference"
              placeholder="Folio de la transferencia, número de cheque…"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="note">Nota</Label>
          <Input id="note" name="note" placeholder="Opcional" />
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.ok && state.message && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" /> {state.message}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Registrar pago
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Cancelación de una factura capturada por error.
 *
 * Solo aparece mientras no tenga pagos: con dinero ya salido, el camino es una
 * nota de crédito y no hacer desaparecer el documento. El dominio lo rechaza
 * igual; esconder el botón evita que alguien lo intente y se lleve el susto.
 */
export function CancelInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(cancelInvoice, initial);
  const [abierto, setAbierto] = useState(false);

  if (state.ok) {
    return (
      <p className="text-sm text-muted-foreground">
        {state.message ?? "Factura cancelada."}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive"
      >
        <Ban className="size-4" /> Cancelar esta factura
      </button>
    );
  }

  return (
    <Card className="border-destructive/30 bg-destructive/5 p-5">
      <h3 className="font-semibold text-destructive">Cancelar la factura</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        La deuda deja de contar. Queda registrada con su motivo en la bitácora,
        que es de solo escritura: esto no borra nada.
      </p>
      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <Input
          name="reason"
          required
          minLength={4}
          placeholder="Motivo — ej. capturada dos veces por error"
        />
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Cancelar factura
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
            No
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Quita una aplicación de nota de crédito o una imputación de anticipo.
 *
 * ── POR QUÉ ES UN BOTÓN Y NO UNA PANTALLA ─────────────────────────────────
 *
 * Porque el renglón que se quita ya está a la vista, con su importe, su folio y
 * quién lo aplicó. Llevar a otra pantalla a elegir cuál obliga a reconocerlo
 * por el importe, que es justo cómo se cometió el error que se viene a
 * corregir: dos facturas del mismo proveedor por cantidades parecidas.
 *
 * ── PIDE MOTIVO, Y NO ES BUROCRACIA ───────────────────────────────────────
 *
 * La fila desaparece y lo que queda es el evento de la bitácora. Sin motivo,
 * ese evento dice que alguien quitó 12 000 pesos de una factura y nada más, que
 * seis meses después no se distingue de un error. El mismo criterio que
 * cancelar una factura, y por eso se ve igual.
 *
 * Confirma en dos pasos por la misma razón que `CancelInvoiceForm`: es
 * destructivo y está a un clic de renglones que solo se leen.
 */
export function UnapplyForm({
  tipo,
  applicationId,
}: {
  tipo: "nota" | "anticipo";
  applicationId: string;
}) {
  const [state, action, pending] = useActionState(unapplyCredit, initial);
  const [abierto, setAbierto] = useState(false);

  const sustantivo = tipo === "nota" ? "la aplicación" : "la imputación";

  if (state.ok) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {state.message ?? "Quitada."}
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
      >
        <Undo2 className="size-3.5" /> Quitar {sustantivo}
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="applicationId" value={applicationId} />
      <p className="text-xs text-muted-foreground">
        {tipo === "nota"
          ? "El saldo vuelve a la factura y la nota recupera su saldo a favor."
          : "El saldo vuelve a la factura y el anticipo recupera su saldo a favor. El dinero no se mueve: salió el día del anticipo."}
      </p>
      <Input
        name="reason"
        required
        minLength={3}
        className="h-9 text-sm"
        placeholder="Motivo — ej. iba a la factura EVO-P-000042"
      />
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Quitar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          No
        </Button>
      </div>
    </form>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
