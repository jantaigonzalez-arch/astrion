"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  addEquipment,
  addModule,
  addSubmodule,
  deleteEquipmentItem,
  type EquipState,
} from "@/lib/actions/equipment";
import { EQUIPMENT_BRANDS } from "@/lib/equipment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: EquipState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function BrandSelect() {
  return (
    <select name="brand" className={selectCls} defaultValue="Waters" required>
      {EQUIPMENT_BRANDS.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}

function PhotoField({ id }: { id: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div>
      <Label htmlFor={id}>Foto (opcional)</Label>
      <div className="flex items-center gap-3">
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
        >
          <ImagePlus className="size-4" /> Elegir imagen
        </label>
        <input
          id={id}
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Vista previa"
            className="size-11 rounded-md border border-border object-cover"
          />
        )}
      </div>
    </div>
  );
}

function useResetOnOk(state: EquipState, onOk: () => void) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      onOk();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return ref;
}

function ErrorMsg({ error }: { error?: string }) {
  if (!error) return null;
  const msg =
    error === "invalid"
      ? "Revisa los campos obligatorios."
      : error === "auth"
        ? "No autorizado."
        : error;
  return <p className="text-sm text-destructive">{msg}</p>;
}

/* ------------------------- Agregar equipo ------------------------- */
export function AddEquipmentForm({ ownerId }: { ownerId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addEquipment, initial);
  const formRef = useResetOnOk(state, () => setOpen(false));

  if (!open) {
    return (
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Agregar equipo
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Nuevo equipo</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
      <input type="hidden" name="ownerId" value={ownerId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Marca</Label>
          <BrandSelect />
        </div>
        <div>
          <Label htmlFor="eq-name">Nombre / tipo</Label>
          <Input id="eq-name" name="name" required placeholder="Ej. HPLC" />
        </div>
        <div>
          <Label htmlFor="eq-model">Modelo</Label>
          <Input id="eq-model" name="model" placeholder="Ej. Alliance 2695" />
        </div>
      </div>
      <PhotoField id="eq-photo" />
      <ErrorMsg error={state.error} />
      <div className="flex justify-end">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Guardar equipo
        </Button>
      </div>
    </form>
  );
}

/* ------------------------- Agregar módulo ------------------------- */
export function AddModuleForm({
  ownerId,
  equipmentId,
}: {
  ownerId: string;
  equipmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addModule, initial);
  const formRef = useResetOnOk(state, () => setOpen(false));

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Módulo
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-4"
    >
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Marca</Label>
          <BrandSelect />
        </div>
        <div>
          <Label htmlFor={`mod-name-${equipmentId}`}>Nombre / modelo</Label>
          <Input id={`mod-name-${equipmentId}`} name="name" required placeholder="Ej. Bomba binaria" />
        </div>
        <div>
          <Label htmlFor={`mod-sn-${equipmentId}`}>N° de serie</Label>
          <Input id={`mod-sn-${equipmentId}`} name="serialNumber" placeholder="Ej. F21ABC123" />
        </div>
      </div>
      <PhotoField id={`mod-photo-${equipmentId}`} />
      <ErrorMsg error={state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar módulo
        </Button>
      </div>
    </form>
  );
}

/* ------------------------- Agregar submódulo ------------------------- */
export function AddSubmoduleForm({
  ownerId,
  moduleId,
}: {
  ownerId: string;
  moduleId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addSubmodule, initial);
  const formRef = useResetOnOk(state, () => setOpen(false));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="size-3" /> Submódulo
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 rounded-lg border border-border bg-background p-3"
    >
      <input type="hidden" name="ownerId" value={ownerId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`sub-name-${moduleId}`}>Submodelo</Label>
          <Input id={`sub-name-${moduleId}`} name="name" required placeholder="Ej. Detector PDA" />
        </div>
        <div>
          <Label htmlFor={`sub-sn-${moduleId}`}>N° de serie</Label>
          <Input id={`sub-sn-${moduleId}`} name="serialNumber" placeholder="Ej. K19XYZ" />
        </div>
      </div>
      <PhotoField id={`sub-photo-${moduleId}`} />
      <ErrorMsg error={state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Guardar submódulo
        </Button>
      </div>
    </form>
  );
}

/* ------------------------- Eliminar ------------------------- */
export function DeleteButton({
  kind,
  id,
  ownerId,
  label,
}: {
  kind: "equipment" | "module" | "submodule";
  id: string;
  ownerId: string;
  label: string;
}) {
  return (
    <form
      action={deleteEquipmentItem}
      onSubmit={(e) => {
        if (!confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <button
        type="submit"
        aria-label={`Eliminar ${label}`}
        className="text-muted-foreground transition-colors hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>
    </form>
  );
}
