"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { approveTicket, rejectTicket } from "@/lib/actions/tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Revisión de una solicitud del cliente: el staff decide si procede
 * (pasa a la cola de atención) o se rechaza con motivo.
 */
export function ReviewPanel({ ticketId }: { ticketId: string }) {
  const [rejecting, setRejecting] = useState(false);

  return (
    <Card className="border-warning/40 bg-warning/5 p-5">
      <h3 className="text-sm font-semibold">Revisión de la solicitud</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Esta solicitud requiere tu aprobación antes de poder atenderse.
      </p>

      {!rejecting ? (
        <div className="mt-4 flex flex-col gap-2">
          <form action={approveTicket}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <Button type="submit" variant="accent" className="w-full">
              <CheckCircle2 className="size-4" /> Aprobar y atender
            </Button>
          </form>
          <Button variant="outline" onClick={() => setRejecting(true)}>
            <XCircle className="size-4" /> Rechazar
          </Button>
        </div>
      ) : (
        <form action={rejectTicket} className="mt-4 space-y-2">
          <input type="hidden" name="ticketId" value={ticketId} />
          <Textarea
            name="reason"
            rows={3}
            required
            placeholder="Motivo del rechazo (lo verá el cliente)…"
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="flex-1 bg-destructive text-destructive-foreground hover:brightness-110">
              Confirmar rechazo
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
