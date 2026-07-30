"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Save, X } from "lucide-react";
import { createPart, updatePart, type PartState } from "@/lib/actions/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: PartState = { ok: false };

function ErrorMsg({ error }: { error?: string }) {
  if (!error) return null;
  const map: Record<string, string> = {
    auth: "No autorizado.",
    invalid: "Revisa los campos obligatorios.",
    duplicate: "Ya existe una refacción con ese número de parte.",
    server: "Ocurrió un error. Intenta de nuevo.",
  };
  return <p className="text-sm text-destructive">{map[error] ?? error}</p>;
}

export function AddPartForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPart, initial);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nueva refacción
      </Button>
    );
  }

  return (
    <form
      ref={ref}
      action={action}
      className="grid gap-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Nueva refacción</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="p-num"># Parte</Label>
          <Input id="p-num" name="partNumber" required placeholder="Ej. WAT097397" />
        </div>
        <div>
          <Label htmlFor="p-brand">Marca</Label>
          <Input id="p-brand" name="brand" placeholder="Ej. Waters" />
        </div>
      </div>

      <div>
        <Label htmlFor="p-desc">Descripción</Label>
        <Input id="p-desc" name="description" required placeholder="Ej. Sello de pistón para bomba HPLC" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="p-mxn">Costo actual (MXN)</Label>
          <Input id="p-mxn" name="costMxn" inputMode="decimal" placeholder="3450.00" />
        </div>
        <div>
          <Label htmlFor="p-usd">Costo actual (USD)</Label>
          <Input id="p-usd" name="costUsd" inputMode="decimal" placeholder="182.00" />
        </div>
        <div>
          <Label htmlFor="p-stock">Existencias</Label>
          <Input id="p-stock" name="stock" type="number" min="0" defaultValue={0} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="p-pmxn">Precio de venta (MXN)</Label>
          <Input id="p-pmxn" name="priceMxn" inputMode="decimal" placeholder="5002.50" />
        </div>
        <div>
          <Label htmlFor="p-pusd">Precio de venta (USD)</Label>
          <Input id="p-pusd" name="priceUsd" inputMode="decimal" placeholder="263.90" />
        </div>
      </div>

      <ErrorMsg error={state.error} />
      <div className="flex justify-end">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Guardar refacción
        </Button>
      </div>
    </form>
  );
}

export type EditablePart = {
  id: string;
  partNumber: string;
  description: string;
  brand: string | null;
  costMxn: string | null;
  costUsd: string | null;
  priceMxn: string | null;
  priceUsd: string | null;
  stock: number;
  active: boolean;
};

export function EditPartRow({ part }: { part: EditablePart }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updatePart, initial);
  const [active, setActive] = useState(part.active);
  useEffect(() => setActive(part.active), [part.active]);
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <Pencil className="size-3.5" /> Editar
      </button>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left">
      <input type="hidden" name="id" value={part.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="partNumber" defaultValue={part.partNumber} required />
        <Input name="brand" defaultValue={part.brand ?? ""} placeholder="Marca" />
      </div>
      <Input name="description" defaultValue={part.description} required />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input name="costMxn" defaultValue={part.costMxn ?? ""} placeholder="Costo MXN" inputMode="decimal" />
        <Input name="costUsd" defaultValue={part.costUsd ?? ""} placeholder="Costo USD" inputMode="decimal" />
        <Input name="stock" type="number" min="0" defaultValue={part.stock} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="priceMxn" defaultValue={part.priceMxn ?? ""} placeholder="Precio venta MXN" inputMode="decimal" />
        <Input name="priceUsd" defaultValue={part.priceUsd ?? ""} placeholder="Precio venta USD" inputMode="decimal" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Activa (disponible para usarse en servicios)
      </label>
      <ErrorMsg error={state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}
