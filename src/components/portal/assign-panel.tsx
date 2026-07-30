"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, UserCheck } from "lucide-react";
import { assignTicket } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type AgentOption = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Guardar
    </Button>
  );
}

export function AssignPanel({
  ticketId,
  agents,
  currentAssigneeId,
  currentUserId,
}: {
  ticketId: string;
  agents: AgentOption[];
  currentAssigneeId: string | null;
  currentUserId: string;
}) {
  // Controlado y re-sincronizado con el servidor: React resetea el form
  // tras la server action y con defaultValue volvería al valor anterior.
  const [value, setValue] = useState(currentAssigneeId ?? "");
  useEffect(() => setValue(currentAssigneeId ?? ""), [currentAssigneeId]);

  const isMine = currentAssigneeId === currentUserId;

  return (
    <Card className="p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <UserCheck className="size-4 text-primary" /> Agente asignado
      </h3>

      <form action={assignTicket} className="space-y-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <select
          name="assignedToId"
          className={selectCls}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">— Sin asignar —</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.email}
              {a.id === currentUserId ? " (yo)" : ""}
              {a.role === "admin" ? " · admin" : ""}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          {!isMine && (
            <Button
              type="submit"
              name="assignedToId"
              value={currentUserId}
              variant="outline"
              size="sm"
            >
              Asignármelo
            </Button>
          )}
          <SaveBtn />
        </div>
      </form>
    </Card>
  );
}
