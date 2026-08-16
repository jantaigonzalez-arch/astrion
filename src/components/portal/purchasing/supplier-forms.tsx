"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createSupplier,
  deleteSupplier,
  updateSupplier,
  type PurchaseState,
} from "@/lib/actions/purchasing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: PurchaseState = { ok: false };

export function AddSupplierForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createSupplier, initial);

  // El panel se cierra solo cuando el alta salió bien. Se ajusta DURANTE el
  // render comparando contra el estado ya visto, no desde un efecto: cerrar
  // desde un efecto pinta primero el formulario lleno y luego lo quita, que es
  // un parpadeo visible además de un render en cascada.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nuevo proveedor
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="grid w-full gap-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Nuevo proveedor</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="s-name">Nombre o razón social</Label>
          <Input id="s-name" name="name" required placeholder="Ej. Waters de México" />
        </div>
        <div>
          <Label htmlFor="s-rfc">RFC</Label>
          <Input id="s-rfc" name="rfc" placeholder="Opcional; los extranjeros no tienen" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="s-contact">Contacto</Label>
          <Input id="s-contact" name="contactName" placeholder="A quién se le llama" />
        </div>
        <div>
          <Label htmlFor="s-email">Correo</Label>
          <Input id="s-email" name="email" type="email" placeholder="ventas@proveedor.com" />
        </div>
        <div>
          <Label htmlFor="s-phone">Teléfono</Label>
          <Input id="s-phone" name="phone" placeholder="55 0000 0000" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="s-terms">Días de crédito</Label>
          <Input
            id="s-terms"
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={0}
          />
          <p className="mt-1 text-xs text-muted-foreground">0 = de contado.</p>
        </div>
        <div>
          <Label htmlFor="s-cur">Moneda habitual</Label>
          <select
            id="s-cur"
            name="currency"
            defaultValue="MXN"
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <Label htmlFor="s-addr">Dirección</Label>
          <Input id="s-addr" name="address" placeholder="Opcional" />
        </div>
      </div>

      <div>
        <Label htmlFor="s-notes">Notas</Label>
        <Input id="s-notes" name="notes" placeholder="Tiempos de entrega, condiciones…" />
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Guardar proveedor
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export type EditableSupplier = {
  id: string;
  name: string;
  rfc: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  currency: string;
  notes: string | null;
  active: boolean;
  /** Fecha de suspensión, o null. Distinta de `active`: ver el esquema. */
  suspendedAt?: Date | string | null;
};

/**
 * Corrección de un proveedor, incluida su reactivación.
 *
 * Es la contraparte de `DeleteSupplierButton`: aquello desactiva a quien ya
 * tiene compras —para no evaporar el historial— y esto es lo único que lo trae
 * de vuelta. Sin este formulario, una baja por error era definitiva: el
 * proveedor desaparecía del selector de órdenes y no había forma de volver a
 * comprarle.
 */
export function SupplierEditForm({
  supplier,
  onDone,
}: {
  supplier: EditableSupplier;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateSupplier, initial);

  // Igual que en el alta: se cierra durante el render, no desde un efecto.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) onDone();
  }

  return (
    <form action={action} className="grid gap-4 py-2">
      <input type="hidden" name="supplierId" value={supplier.id} />

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Editar proveedor</h3>
        <button type="button" onClick={onDone} aria-label="Cerrar">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`e-name-${supplier.id}`}>Nombre o razón social</Label>
          <Input
            id={`e-name-${supplier.id}`}
            name="name"
            required
            defaultValue={supplier.name}
          />
        </div>
        <div>
          <Label htmlFor={`e-rfc-${supplier.id}`}>RFC</Label>
          <Input
            id={`e-rfc-${supplier.id}`}
            name="rfc"
            defaultValue={supplier.rfc ?? ""}
            placeholder="Opcional; los extranjeros no tienen"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`e-contact-${supplier.id}`}>Contacto</Label>
          <Input
            id={`e-contact-${supplier.id}`}
            name="contactName"
            defaultValue={supplier.contactName ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`e-email-${supplier.id}`}>Correo</Label>
          <Input
            id={`e-email-${supplier.id}`}
            name="email"
            type="email"
            defaultValue={supplier.email ?? ""}
          />
        </div>
        <div>
          <Label htmlFor={`e-phone-${supplier.id}`}>Teléfono</Label>
          <Input
            id={`e-phone-${supplier.id}`}
            name="phone"
            defaultValue={supplier.phone ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`e-terms-${supplier.id}`}>Días de crédito</Label>
          <Input
            id={`e-terms-${supplier.id}`}
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={supplier.paymentTermsDays}
          />
          <p className="mt-1 text-xs text-muted-foreground">0 = de contado.</p>
        </div>
        <div>
          <Label htmlFor={`e-cur-${supplier.id}`}>Moneda habitual</Label>
          <select
            id={`e-cur-${supplier.id}`}
            name="currency"
            defaultValue={supplier.currency}
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Las órdenes ya emitidas conservan la suya.
          </p>
        </div>
        <div>
          <Label htmlFor={`e-addr-${supplier.id}`}>Dirección</Label>
          <Input
            id={`e-addr-${supplier.id}`}
            name="address"
            defaultValue={supplier.address ?? ""}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`e-notes-${supplier.id}`}>Notas</Label>
        <Input
          id={`e-notes-${supplier.id}`}
          name="notes"
          defaultValue={supplier.notes ?? ""}
          placeholder="Tiempos de entrega, condiciones…"
        />
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={supplier.active}
          className="size-4 rounded border-input"
        />
        Activo
        <span className="text-xs text-muted-foreground">
          — solo los activos aparecen al levantar una orden.
        </span>
      </label>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="accent" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Guardar cambios
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Baja de proveedor.
 *
 * El texto del botón no promete borrar: si el proveedor tiene compras, la
 * acción lo desactiva y lo dice. Prometer un borrado que no ocurre es la forma
 * más rápida de que alguien deje de confiar en lo que dice la pantalla.
 */
export function DeleteSupplierButton({
  supplierId,
  name,
}: {
  supplierId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(deleteSupplier, initial);
  const [confirming, setConfirming] = useState(false);

  if (state.ok && state.message) {
    return <span className="text-xs text-muted-foreground">{state.message}</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Dar de baja a ${name}`}
        className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="supplierId" value={supplierId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending && <Loader2 className="size-3 animate-spin" />}
        Dar de baja
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs text-muted-foreground hover:underline"
      >
        No
      </button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
