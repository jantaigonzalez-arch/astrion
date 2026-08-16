"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { createTicket, type TicketFormState } from "@/lib/actions/tickets";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

export type EquipmentOption = {
  id: string;
  brand: string;
  name: string;
  model: string | null;
  modules: { id: string; brand: string; name: string; serialNumber: string | null }[];
};

export function NewTicketForm({
  locale,
  equipment = [],
}: {
  locale: string;
  equipment?: EquipmentOption[];
}) {
  const [state, action, pending] = useActionState(createTicket, initial);
  const [equipmentId, setEquipmentId] = useState("");
  const modules = equipment.find((e) => e.id === equipmentId)?.modules ?? [];

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <div>
          <p className="font-medium">Ticket creado</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{state.reference}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Un especialista responderá en menos de 2 horas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="accent">
            <Link href="/tickets">Ver mis tickets</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <div>
        <Label htmlFor="subject">Asunto</Label>
        <Input id="subject" name="subject" required maxLength={240} placeholder="Ej. Falla en bomba HPLC Waters 1525" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="category">Categoría</Label>
          <select id="category" name="category" className={selectCls} defaultValue="support">
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

      {equipment.length > 0 && (
        <div className="grid gap-4 rounded-xl border border-border bg-secondary/30 p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="equipmentId">Equipo relacionado</Label>
            <select
              id="equipmentId"
              name="equipmentId"
              className={selectCls}
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
            >
              <option value="">— Sin especificar —</option>
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.brand} {eq.name}
                  {eq.model ? ` · ${eq.model}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="moduleId">Módulo (opcional)</Label>
            <select
              id="moduleId"
              name="moduleId"
              className={selectCls}
              disabled={!equipmentId || modules.length === 0}
              defaultValue=""
            >
              <option value="">
                {!equipmentId
                  ? "Elige un equipo primero"
                  : modules.length === 0
                    ? "Sin módulos registrados"
                    : "— Todo el equipo —"}
              </option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.serialNumber ? ` · S/N ${m.serialNumber}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="description">Descripción</Label>
        <Textarea id="description" name="description" rows={6} required minLength={10}
          placeholder="Describe el problema: equipo, marca/modelo, síntomas, mensajes de error…" />
      </div>

      {state.error === "invalid" && (
        <p className="text-sm text-destructive">Revisa los campos: asunto y descripción son obligatorios.</p>
      )}
      {state.error === "server" && (
        <p className="text-sm text-destructive">Ocurrió un error. Intenta de nuevo.</p>
      )}

      <Button type="submit" variant="accent" size="lg" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Enviar ticket
      </Button>
    </form>
  );
}
