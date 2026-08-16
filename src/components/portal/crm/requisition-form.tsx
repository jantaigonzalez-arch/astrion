"use client";

import { useActionState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import {
  createRequisitionFromDealAction,
  type RequisitionState,
} from "@/lib/actions/requisitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/nav";

const initial: RequisitionState = { ok: false };

/**
 * El botón que convierte un pedido en una requisición.
 *
 * Solo pide UNA cosa: para cuándo. Todo lo demás —qué renglones, cuántas
 * piezas, a quién comprárselas— ya lo sabe el sistema y se enseña arriba en la
 * tabla de la resta. Pedir aquí lo que ya está calculado invitaría a
 * contradecirlo, y entonces la resta no habría servido de nada.
 */
export function RequisitionForm({
  dealId,
  faltantes,
}: {
  dealId: string;
  /** Renglones con falta > 0. En cero, el formulario no se pinta. */
  faltantes: number;
}) {
  const [state, action, pending] = useActionState(
    createRequisitionFromDealAction,
    initial,
  );

  if (state.ok && state.requisitionId) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-4">
        <p className="text-sm text-success">{state.message}</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href={`/admin/compras/requisiciones/${state.requisitionId}`}>
            Abrir la requisición
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="dealId" value={dealId} />
      <div>
        <Label htmlFor="req-needed" className="text-xs">
          Para cuándo se necesita
        </Label>
        <Input
          id="req-needed"
          name="neededBy"
          type="date"
          className="mt-1 w-44"
        />
      </div>
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ClipboardList className="size-4" />
        )}
        Generar requisición ({faltantes})
      </Button>
      {state.error && (
        <p className="w-full text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
