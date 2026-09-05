"use client";

import { useState } from "react";
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

/**
 * A quién le toca este ticket.
 *
 * ── EL SELECTOR SE QUEDABA EN «SIN ASIGNAR» ───────────────────────────────
 *
 * Al asignar un agente a un ticket que NO tenía ninguno, el desplegable volvía
 * a la primera opción. Son dos comportamientos de React 19 que se encadenan, y
 * ninguno es un fallo por su cuenta:
 *
 *   1. Un `<form>` cuya `action` es una función se RESETEA al terminar. Un
 *      `<select>` controlado no lleva `selected` en ninguna opción —React lo
 *      gobierna por la propiedad `value` del nodo—, así que el reseteo lo manda
 *      a la primera. Que fuera «Sin asignar» y no el agente anterior es la
 *      firma de esto: sin asignado previo, no había opción marcada a la que
 *      volver.
 *
 *   2. La corrección venía de un efecto que ponía el valor del servidor. Pero
 *      ese valor YA era el del estado —lo acababa de elegir la persona—, así
 *      que `setValue` con lo mismo no cambia nada, React no vuelve a renderizar
 *      y nunca reescribe el DOM. El efecto existía justo para esto y no podía
 *      llegar.
 *
 * Ahora la re-sincronización va por `key` desde la pantalla: cuando el servidor
 * manda otro asignado, React desmonta y vuelve a montar, y `useState` lee el
 * valor nuevo sobre un `<select>` recién creado que ningún reseteo tocó. Es el
 * «resetear el estado con una key» de la documentación, y el mismo mecanismo
 * que usa `StatusPanel` — que tuvo este problema en su otra forma.
 *
 * De paso desaparece el efecto que ESLint marcaba: actualizar estado dentro de
 * uno es lo que la propia documentación desaconseja, y aquí además no
 * funcionaba.
 */
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
  const [value, setValue] = useState(currentAssigneeId ?? "");

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
