"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, ClipboardPlus, Loader2 } from "lucide-react";
import { createServiceTicket, type TicketFormState } from "@/lib/actions/tickets";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  label,
} from "@/lib/tickets";

const initial: TicketFormState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type ClientOption = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  equipment: {
    id: string;
    brand: string;
    name: string;
    model: string | null;
    modules: { id: string; name: string; serialNumber: string | null }[];
  }[];
};

export function ServiceTicketForm({
  locale,
  clients,
}: {
  locale: string;
  clients: ClientOption[];
}) {
  const [state, action, pending] = useActionState(createServiceTicket, initial);
  const [clientId, setClientId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");

  const client = clients.find((c) => c.id === clientId);
  const equipment = client?.equipment ?? [];
  const modules = equipment.find((e) => e.id === equipmentId)?.modules ?? [];

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">Levantamiento creado</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{state.reference}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Entró directo a la cola de atención (no requiere aprobación).
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href="/admin/tickets">Ver cola de tickets</Link>
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            Crear otro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <div>
        <Label htmlFor="clientId">Laboratorio</Label>
        {/* Con búsqueda en cuanto pasan de doce: el padrón de laboratorios
            crece con el negocio y ya va por más de ciento cincuenta. */}
        <Selector
          id="clientId"
          name="clientId"
          required
          placeholder="— Selecciona el laboratorio —"
          opciones={clients.map((c) => ({
            value: c.id,
            label: c.company ?? c.name ?? c.email,
            detalle: c.company ? (c.name ?? c.email) : null,
            buscar: c.email,
          }))}
          onChange={(v) => {
            setClientId(v);
            setEquipmentId("");
          }}
        />
      </div>

      <div>
        <Label htmlFor="subject">Asunto</Label>
        <Input id="subject" name="subject" required maxLength={240} placeholder="Ej. Mantenimiento preventivo semestral" />
      </div>

      <div className="grid gap-4 rounded-xl border border-border bg-secondary/30 p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="equipmentId">Equipo</Label>
          {/* `key` con el laboratorio: al cambiarlo, el componente se monta de
              nuevo y no se queda con el equipo del cliente anterior. Es la
              contrapartida de guardar la selección en estado propio. */}
          <Selector
            key={`eq-${clientId}`}
            id="equipmentId"
            name="equipmentId"
            disabled={!clientId}
            placeholder={!clientId ? "Elige un laboratorio primero" : "— Sin especificar —"}
            opciones={equipment.map((eq) => ({
              value: eq.id,
              label: `${eq.brand} ${eq.name}`,
              detalle: eq.model,
            }))}
            onChange={setEquipmentId}
          />
        </div>
        <div>
          <Label htmlFor="moduleId">Módulo (opcional)</Label>
          <Selector
            key={`mod-${equipmentId}`}
            id="moduleId"
            name="moduleId"
            disabled={!equipmentId || modules.length === 0}
            placeholder={
              !equipmentId
                ? "Elige un equipo primero"
                : modules.length === 0
                  ? "Sin módulos registrados"
                  : "— Todo el equipo —"
            }
            opciones={modules.map((m) => ({
              value: m.id,
              label: m.name,
              detalle: m.serialNumber ? `S/N ${m.serialNumber}` : null,
              buscar: m.serialNumber,
            }))}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="category">Categoría</Label>
          <select id="category" name="category" className={selectCls} defaultValue="maintenance">
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{label(CATEGORY_LABELS, c, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="priority">Prioridad</Label>
          <select id="priority" name="priority" className={selectCls} defaultValue="medium">
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>{label(PRIORITY_LABELS, p, locale)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Descripción del servicio</Label>
        <Textarea id="description" name="description" rows={6} required minLength={10}
          placeholder="Detalle del trabajo a realizar, hallazgos previos, alcance…" />
      </div>

      {state.error === "invalid" && (
        <p className="text-sm text-destructive">Revisa los campos: laboratorio, asunto y descripción son obligatorios.</p>
      )}
      {state.error === "server" && (
        <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardPlus className="size-4" />}
        Crear levantamiento
      </Button>
    </form>
  );
}
