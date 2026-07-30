"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, FileSignature, Loader2 } from "lucide-react";
import { createContract, type ContractState } from "@/lib/actions/contracts";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const initial: ContractState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type ClientWithEquipment = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  equipment: { id: string; brand: string; name: string; model: string | null }[];
};

export type SalesRepOption = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

/** Valores que llegan prellenados cuando el contrato nace de un negocio del CRM. */
export type ContractDefaults = {
  dealId?: string;
  dealTitle?: string;
  number?: string;
  clientId?: string;
  salesRepId?: string | null;
  amountMxn?: string | null;
  amountUsd?: string | null;
  notes?: string;
};

export function ContractForm({
  clients,
  salesReps,
  defaults,
}: {
  clients: ClientWithEquipment[];
  salesReps: SalesRepOption[];
  defaults?: ContractDefaults;
}) {
  const [state, action, pending] = useActionState(createContract, initial);
  const [clientId, setClientId] = useState(defaults?.clientId ?? "");
  const client = clients.find((c) => c.id === clientId);
  const equipment = client?.equipment ?? [];

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">Contrato registrado</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{state.number}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href="/admin/contratos">Ver contratos</Link>
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            Registrar otro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {defaults?.dealId && (
        <>
          <input type="hidden" name="dealId" value={defaults.dealId} />
          <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            Generando el contrato a partir del negocio ganado{" "}
            <strong>{defaults.dealTitle}</strong>. Los datos vienen prellenados;
            ajústalos si hace falta.
          </p>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="number">Número de contrato</Label>
          <Input
            id="number"
            name="number"
            required
            defaultValue={defaults?.number}
            placeholder="Ej. EVO-C-2026-014"
          />
        </div>
        <div>
          <Label htmlFor="clientId">Laboratorio (cliente)</Label>
          <select
            id="clientId"
            name="clientId"
            required
            className={selectCls}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">— Selecciona —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company ?? c.name ?? c.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="amountMxn">Costo (MXN)</Label>
          <Input
            id="amountMxn"
            name="amountMxn"
            inputMode="decimal"
            defaultValue={defaults?.amountMxn ?? ""}
            placeholder="Ej. 185000.00"
          />
        </div>
        <div>
          <Label htmlFor="amountUsd">Costo (USD)</Label>
          <Input
            id="amountUsd"
            name="amountUsd"
            inputMode="decimal"
            defaultValue={defaults?.amountUsd ?? ""}
            placeholder="Ej. 9800.00"
          />
        </div>
        <div>
          <Label htmlFor="salesRepId">Vendedor responsable</Label>
          <select
            id="salesRepId"
            name="salesRepId"
            className={selectCls}
            defaultValue={defaults?.salesRepId ?? ""}
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
          <Input id="startDate" name="startDate" type="date" />
        </div>
        <div>
          <Label htmlFor="endDate">Fin de vigencia</Label>
          <Input id="endDate" name="endDate" type="date" />
        </div>
      </div>

      {/* Equipos amparados */}
      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        <Label>Equipos amparados por el contrato</Label>
        {!clientId ? (
          <p className="text-sm text-muted-foreground">
            Selecciona primero el laboratorio.
          </p>
        ) : equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este laboratorio aún no tiene equipos registrados.
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
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults?.notes}
          placeholder="Alcance, condiciones, renovación…"
        />
      </div>

      {state.error === "duplicate" && (
        <p className="text-sm text-destructive">Ya existe un contrato con ese número.</p>
      )}
      {state.error === "invalid" && (
        <p className="text-sm text-destructive">Revisa los campos obligatorios y los montos.</p>
      )}
      {state.error === "auth" && (
        <p className="text-sm text-destructive">Solo un administrador puede registrar contratos.</p>
      )}
      {state.error === "server" && (
        <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />}
        Registrar contrato
      </Button>
    </form>
  );
}
