"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import {
  updateContract,
  deleteContract,
  type ContractState,
} from "@/lib/actions/contracts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const initial: ContractState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type EditableContract = {
  id: string;
  number: string;
  clientLabel: string;
  salesRepId: string | null;
  amountMxn: string | null;
  amountUsd: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  linkedEquipmentIds: string[];
};

export type EquipmentChoice = {
  id: string;
  brand: string;
  name: string;
  model: string | null;
};

export function EditContractForm({
  contract,
  salesReps,
  equipment,
}: {
  contract: EditableContract;
  salesReps: { id: string; name: string | null; email: string; role: string }[];
  equipment: EquipmentChoice[];
}) {
  const [state, action, pending] = useActionState(updateContract, initial);

  // Controlados y re-sincronizados: React resetea el form tras la server action.
  const [salesRepId, setSalesRepId] = useState(contract.salesRepId ?? "");
  const [checked, setChecked] = useState<string[]>(contract.linkedEquipmentIds);
  useEffect(() => setSalesRepId(contract.salesRepId ?? ""), [contract.salesRepId]);
  useEffect(
    () => setChecked(contract.linkedEquipmentIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contract.linkedEquipmentIds.join(",")],
  );

  function toggle(id: string) {
    setChecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-8">
        <form action={action} className="grid gap-5">
          <input type="hidden" name="id" value={contract.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="number">Número de contrato</Label>
              <Input id="number" name="number" required defaultValue={contract.number} />
            </div>
            <div>
              <Label>Laboratorio (no editable)</Label>
              <Input value={contract.clientLabel} disabled readOnly />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="amountMxn">Costo (MXN)</Label>
              <Input
                id="amountMxn"
                name="amountMxn"
                inputMode="decimal"
                defaultValue={contract.amountMxn ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="amountUsd">Costo (USD)</Label>
              <Input
                id="amountUsd"
                name="amountUsd"
                inputMode="decimal"
                defaultValue={contract.amountUsd ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="salesRepId">Vendedor responsable</Label>
              <select
                id="salesRepId"
                name="salesRepId"
                className={selectCls}
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
              >
                <option value="">— Sin asignar —</option>
                {salesReps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.email}
                    {s.role === "admin" ? " · admin" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="startDate">Inicio de vigencia</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={contract.startDate ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="endDate">Fin de vigencia</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={contract.endDate ?? ""}
              />
            </div>
          </div>

          {/* Equipos amparados */}
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <Label>Equipos amparados ({checked.length})</Label>
            {equipment.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Este laboratorio no tiene equipos registrados.
              </p>
            ) : (
              <ul className="mt-1 space-y-2">
                {equipment.map((eq) => (
                  <li key={eq.id}>
                    <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        name="equipmentIds"
                        value={eq.id}
                        checked={checked.includes(eq.id)}
                        onChange={() => toggle(eq.id)}
                        className="size-4 rounded border-input"
                      />
                      <span className="font-medium">{eq.brand} {eq.name}</span>
                      {eq.model && (
                        <span className="text-muted-foreground">· {eq.model}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" name="notes" rows={3} defaultValue={contract.notes ?? ""} />
          </div>

          {state.error === "duplicate" && (
            <p className="text-sm text-destructive">Ya existe otro contrato con ese número.</p>
          )}
          {state.error === "invalid" && (
            <p className="text-sm text-destructive">Revisa los campos y los montos.</p>
          )}
          {state.error === "auth" && (
            <p className="text-sm text-destructive">Solo un administrador puede editar contratos.</p>
          )}
          {state.error === "server" && (
            <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
          )}
          {state.ok && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" /> Cambios guardados.
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" variant="accent" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Guardar cambios
            </Button>
          </div>
        </form>
      </Card>

      {/* Zona de peligro */}
      <Card className="border-destructive/30 p-5">
        <h2 className="text-sm font-semibold text-destructive">Eliminar contrato</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se borrará el contrato y sus vínculos con equipos. Los equipos y tickets
          no se eliminan.
        </p>
        <form
          action={deleteContract}
          className="mt-3"
          onSubmit={(e) => {
            if (
              !confirm(
                `¿Eliminar el contrato ${contract.number}? Esta acción no se puede deshacer.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={contract.id} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" /> Eliminar contrato
          </Button>
        </form>
      </Card>
    </div>
  );
}
