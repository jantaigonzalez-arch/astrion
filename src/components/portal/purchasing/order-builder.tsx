"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createPurchaseOrder, type PurchaseState } from "@/lib/actions/purchasing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import { Link, useRouter } from "@/lib/nav";

/**
 * Armado de una orden de compra.
 *
 * Los renglones se mandan como campos repetidos (`line-part`, `line-qty`,
 * `line-cost`) en vez de como JSON en un input oculto. Es más aburrido y es a
 * propósito: así el formulario sigue siendo un formulario —se envía sin
 * JavaScript, el navegador valida los números, y el servidor recibe algo que
 * puede leer sin confiar en que el cliente serializó bien—.
 *
 * El estado de React aquí solo gobierna CUÁNTOS renglones hay en pantalla; los
 * valores viven en el DOM, que es donde el navegador ya sabe cuidarlos.
 */

type Part = {
  id: string;
  partNumber: string;
  description: string;
  stock: number;
  costMxn: string | null;
  costUsd: string | null;
};

type Supplier = { id: string; name: string; currency: string };

const initial: PurchaseState = { ok: false };

export function OrderBuilder({
  suppliers,
  parts,
}: {
  suppliers: Supplier[];
  parts: Part[];
}) {
  const [state, action, pending] = useActionState(createPurchaseOrder, initial);
  const router = useRouter();

  // Renglones como lista de ids locales: agregar y quitar sin que React
  // reordene los inputs existentes y les pierda el valor escrito.
  const [rows, setRows] = useState<number[]>([0]);
  const [next, setNext] = useState(1);
  const [currency, setCurrency] = useState("MXN");

  useEffect(() => {
    if (state.ok && state.orderId) router.push(`/admin/compras/${state.orderId}`);
  }, [state, router]);

  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  if (suppliers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm">
        <p className="font-medium">Todavía no hay proveedores.</p>
        <p className="mt-1 text-muted-foreground">
          Una orden de compra necesita a quién comprarle. Da de alta el primero
          y vuelve aquí.
        </p>
        {/* Link del enrutador, no <a>: en modo subdominio un href crudo se
            queda sin el prefijo del inquilino y cae en 404. */}
        <Button asChild className="mt-4" variant="accent">
          <Link href="/admin/compras/proveedores">Dar de alta un proveedor</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="o-sup">Proveedor</Label>
          <select
            id="o-sup"
            name="supplierId"
            required
            defaultValue=""
            onChange={(e) => {
              const s = suppliers.find((x) => x.id === e.target.value);
              if (s) setCurrency(s.currency);
            }}
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="" disabled>
              Elige un proveedor…
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="o-cur">Moneda</Label>
          <select
            id="o-cur"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>

        <div>
          <Label htmlFor="o-exp">Fecha esperada</Label>
          <Input id="o-exp" name="expectedAt" type="date" />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="o-notes">Notas para el proveedor</Label>
          <Input id="o-notes" name="notes" placeholder="Referencia, condiciones de entrega…" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-semibold">Renglones</h3>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRows((r) => [...r, next]);
              setNext((n) => n + 1);
            }}
          >
            <Plus className="size-4" /> Agregar
          </Button>
        </div>

        <div className="divide-y divide-border">
          {rows.map((key) => (
            <LineRow
              key={key}
              parts={parts}
              byId={byId}
              currency={currency}
              onRemove={
                rows.length > 1 ? () => setRows((r) => r.filter((k) => k !== key)) : undefined
              }
            />
          ))}
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Crear orden en borrador
        </Button>
        <p className="text-xs text-muted-foreground">
          Se crea como borrador: podrás revisarla antes de marcarla como enviada.
        </p>
      </div>
    </form>
  );
}

function LineRow({
  parts,
  byId,
  currency,
  onRemove,
}: {
  parts: Part[];
  byId: Map<string, Part>;
  currency: string;
  onRemove?: () => void;
}) {
  const [partId, setPartId] = useState("");
  const part = partId ? byId.get(partId) : undefined;
  // El costo del catálogo se propone, no se impone: es el último que se pagó,
  // y quien está capturando la orden tiene la cotización de hoy enfrente.
  const suggested = part
    ? currency === "USD"
      ? part.costUsd
      : currency === "MXN"
        ? part.costMxn
        : null
    : null;

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_6rem_8rem_auto] sm:items-end">
      <div className="min-w-0">
        <Label>Refacción</Label>
        <div className="mt-1">
          <Selector
            name="line-part"
            placeholder="Elige…"
            opciones={parts.map((p) => ({
              value: p.id,
              label: p.partNumber,
              detalle: p.description,
            }))}
            onChange={setPartId}
          />
        </div>
        {part && (
          <p className="mt-1 text-xs text-muted-foreground">
            Existencias:{" "}
            <span className={part.stock < 0 ? "font-medium text-destructive" : ""}>
              {part.stock}
            </span>
          </p>
        )}
      </div>

      <div>
        <Label>Cantidad</Label>
        <Input name="line-qty" type="number" min={1} step={1} defaultValue="" />
      </div>

      <div>
        <Label>Costo unit. ({currency})</Label>
        {/* `key` fuerza a recrear el input cuando cambia la sugerencia: sin él,
            React conserva el valor anterior y el precio propuesto no aparece. */}
        <Input
          key={`${partId}-${currency}`}
          name="line-cost"
          inputMode="decimal"
          defaultValue={suggested ?? ""}
          placeholder="0.00"
        />
      </div>

      <div className="flex justify-end">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Quitar renglón"
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
