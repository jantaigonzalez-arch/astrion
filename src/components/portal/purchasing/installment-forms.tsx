"use client";

import { useActionState, useState } from "react";
import { CalendarRange, CheckCircle2, Loader2, Split } from "lucide-react";
import { splitInvoiceAction, type PayableState } from "@/lib/actions/payables";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const initial: PayableState = { ok: false };

/**
 * División de una factura en parcialidades.
 *
 * Solo aparece si no se ha cubierto nada: repactar el calendario con dinero ya
 * imputado recolocaría pagos que ya ocurrieron contra vencimientos que no
 * existían cuando se hicieron. El servidor lo vuelve a comprobar.
 *
 * El reparto se previsualiza en el cliente con la MISMA regla que aplica el
 * servidor —el sobrante del redondeo va a la última— para que lo que se ve
 * antes de guardar sea lo que queda guardado.
 */
export function SplitInvoiceForm({
  invoiceId,
  total,
  currency,
  suggestedFirstDue,
}: {
  invoiceId: string;
  total: number;
  currency: string;
  /** Vencimiento actual de la factura: el primer pago suele caer ahí. */
  suggestedFirstDue: string;
}) {
  const [state, action, pending] = useActionState(splitInvoiceAction, initial);
  const [count, setCount] = useState(3);
  const [firstDue, setFirstDue] = useState(suggestedFirstDue);
  const [abierto, setAbierto] = useState(false);

  const preview = repartir(total, count, firstDue);

  if (!abierto) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Split className="size-4 text-primary" /> Dividir en parcialidades
          </h2>
          <p className="text-sm text-muted-foreground">
            Si se pactó pagarla en varias exhibiciones, cada una con su
            vencimiento.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setAbierto(true)}>
          Dividir
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Split className="size-4 text-primary" /> Dividir en parcialidades
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Total a repartir:{" "}
        <span className="font-medium tabular-nums text-foreground">
          {money(total, currency)}
        </span>
      </p>

      <form action={action} className="space-y-4">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="modo" value="auto" />
        <input type="hidden" name="total" value={total} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="count">¿En cuántas?</Label>
            <Input
              id="count"
              name="count"
              type="number"
              min={2}
              max={60}
              value={count}
              onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="firstDueAt">Primer vencimiento</Label>
            <Input
              id="firstDueAt"
              name="firstDueAt"
              type="date"
              value={firstDue}
              onChange={(e) => setFirstDue(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        {preview.length > 0 && (
          <div className="rounded-md border border-border">
            <p className="border-b border-border bg-secondary/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarRange className="mr-1.5 inline size-3.5" />
              Así quedaría · una al mes
            </p>
            <ul className="divide-y divide-border text-sm">
              {preview.map((p, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">
                    {i + 1} de {preview.length}
                  </span>
                  <span className="tabular-nums">{p.dueAt}</span>
                  <span className="font-medium tabular-nums">
                    {money(p.amount, currency)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Suma{" "}
              <span className="font-medium tabular-nums text-foreground">
                {money(
                  preview.reduce((a, p) => a + p.amount, 0),
                  currency,
                )}
              </span>{" "}
              — el sobrante del redondeo va a la última.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Dividiendo…
              </>
            ) : (
              "Guardar el calendario"
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

/** El plan de pagos ya guardado, con el estado de cada parcialidad. */
export function InstallmentPlan({
  installments,
  currency,
}: {
  installments: Array<{
    id: string;
    seq: number;
    amount: number;
    dueAt: string;
    balance: number;
    paid: number;
    daysLate: number;
    status: "paid" | "partial" | "pending";
  }>;
  currency: string;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-3">
        <h2 className="font-semibold">Plan de pagos</h2>
        <p className="text-xs text-muted-foreground">
          Lo que se paga se imputa de la parcialidad más antigua a la más nueva.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Vence</th>
            <th className="px-4 py-2 text-right font-medium">Importe</th>
            <th className="px-4 py-2 text-right font-medium">Cubierto</th>
            <th className="px-4 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {installments.map((p) => {
            const vencida = p.status !== "paid" && p.daysLate > 0;
            return (
              <tr key={p.id} className={cn(p.status === "paid" && "opacity-60")}>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">
                  {p.seq}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span className={vencida ? "font-medium text-destructive" : ""}>
                    {p.dueAt}
                  </span>
                  {vencida && (
                    <span className="ml-2 text-xs text-destructive">
                      {p.daysLate} {p.daysLate === 1 ? "día" : "días"}
                    </span>
                  )}
                  {p.status === "paid" && (
                    <span className="ml-2 text-xs text-success">saldada</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {money(p.amount, currency)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {p.paid > 0 ? money(p.paid, currency) : "—"}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums">
                  {p.balance > 0 ? money(p.balance, currency) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Mismo reparto que `repartirEnParcialidades` del dominio.
 *
 * Se repite aquí porque el servidor no puede previsualizar sin ida y vuelta, y
 * ver el calendario antes de guardarlo es la mitad del valor de la pantalla. La
 * regla es la misma —sobrante a la última— así que lo mostrado coincide con lo
 * guardado; si una cambia, tiene que cambiar la otra.
 */
function repartir(total: number, n: number, primero: string) {
  if (!primero || n < 2 || n > 60) return [];
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  const out: Array<{ amount: number; dueAt: string }> = [];
  for (let i = 0; i < n; i++) {
    const c = i === n - 1 ? centavos - base * (n - 1) : base;
    out.push({ amount: c / 100, dueAt: sumarMeses(primero, i) });
  }
  return out;
}

function sumarMeses(fecha: string, meses: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return fecha;
  const [, y, mes, d] = m;
  const idx = Number(mes) - 1 + meses;
  const año = Number(y) + Math.floor(idx / 12);
  const mesDestino = ((idx % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(año, mesDestino + 1, 0)).getUTCDate();
  return new Date(Date.UTC(año, mesDestino, Math.min(Number(d), ultimo)))
    .toISOString()
    .slice(0, 10);
}

function money(n: number, currency = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
