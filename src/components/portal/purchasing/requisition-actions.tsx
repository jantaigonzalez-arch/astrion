"use client";

import { useActionState, useState } from "react";
import { Ban, Check, Loader2, Send, ShoppingCart, X } from "lucide-react";
import {
  approveRequisitionAction,
  cancelRequisitionAction,
  convertRequisitionAction,
  rejectRequisitionAction,
  submitRequisitionAction,
  type RequisitionState,
} from "@/lib/actions/requisitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RequisitionStatus } from "@/lib/db/schema";

const initial: RequisitionState = { ok: false };

function Feedback({ state }: { state: RequisitionState }) {
  return (
    <div className="space-y-2">
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && state.message && (
        <p className="text-sm text-success">{state.message}</p>
      )}
      {/* Lo omitido se enseña SIEMPRE, haya salido bien o mal. Es el caso que
          más daño hace callado: salieron dos órdenes, el mensaje dice «listo» y
          el renglón sin proveedor se queda esperando a que alguien lo note. */}
      {state.omitidas && state.omitidas.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-warning">
            No se pudieron convertir
          </p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {state.omitidas.map((o, i) => (
              <li key={`${o.description}-${i}`}>
                <span className="font-medium">{o.description}</span>
                <span className="text-muted-foreground"> — {o.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * La barra de acciones de una requisición.
 *
 * Enseña SOLO lo que se puede hacer desde el estado actual, en vez de pintar
 * todos los botones y desactivar los que no aplican. Un botón apagado obliga a
 * adivinar por qué lo está; no tenerlo dice lo mismo sin ruido, y la máquina de
 * estados del dominio ya es la que manda.
 */
export function RequisitionActions({
  id,
  status,
  puedeAutorizar,
  pendientes,
}: {
  id: string;
  status: RequisitionStatus;
  /** Rol de administración: es el único que autoriza y convierte. */
  puedeAutorizar: boolean;
  /** Renglones listos para convertir. Sin ellos, el botón no tendría qué hacer. */
  pendientes: number;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {status === "draft" && <BotonSimple id={id} />}
      {status === "submitted" && puedeAutorizar && <Resolucion id={id} />}
      {(status === "approved" || status === "partial") && puedeAutorizar && (
        <Convertir id={id} pendientes={pendientes} />
      )}
      {status !== "cancelled" &&
        status !== "rejected" &&
        status !== "ordered" &&
        puedeAutorizar && <Cancelar id={id} />}
    </div>
  );
}

function BotonSimple({ id }: { id: string }) {
  const [state, action, pending] = useActionState(submitRequisitionAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        Enviar a autorizar
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function Resolucion({ id }: { id: string }) {
  const [aprobar, accionAprobar, pendAprobar] = useActionState(
    approveRequisitionAction,
    initial,
  );
  const [rechazo, accionRechazo, pendRechazo] = useActionState(
    rejectRequisitionAction,
    initial,
  );
  const [rechazando, setRechazando] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={accionAprobar}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="accent" disabled={pendAprobar}>
            {pendAprobar ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Autorizar
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          onClick={() => setRechazando((v) => !v)}
        >
          <X className="size-4" /> Rechazar
        </Button>
      </div>

      {rechazando && (
        <form action={accionRechazo} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={id} />
          <Label htmlFor={`motivo-${id}`} className="text-xs">
            Por qué se rechaza
          </Label>
          {/* El motivo es obligatorio en el dominio y por eso también aquí:
              sin él, quien la levantó no sabe qué corregir para volver a pedirla. */}
          <Input
            id={`motivo-${id}`}
            name="reason"
            required
            minLength={4}
            placeholder="Falta cotización del proveedor"
            className="w-72"
          />
          <Button
            type="submit"
            variant="outline"
            className="text-destructive"
            disabled={pendRechazo}
          >
            {pendRechazo && <Loader2 className="size-4 animate-spin" />}
            Confirmar rechazo
          </Button>
        </form>
      )}

      <Feedback state={aprobar} />
      <Feedback state={rechazo} />
    </div>
  );
}

function Convertir({ id, pendientes }: { id: string; pendientes: number }) {
  const [state, action, pending] = useActionState(convertRequisitionAction, initial);

  if (pendientes === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No queda nada por convertir.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShoppingCart className="size-4" />
        )}
        Generar órdenes de compra
      </Button>
      {/* Que salgan varias no es un detalle de implementación: es lo que el
          usuario tiene que esperar antes de darle al botón. */}
      <p className="max-w-xs text-xs text-muted-foreground">
        Sale una orden por proveedor, en borrador. Revísalas antes de mandarlas.
      </p>
      <Feedback state={state} />
    </form>
  );
}

function Cancelar({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelRequisitionAction, initial);
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <Button type="button" variant="ghost" onClick={() => setAbierto(true)}>
        <Ban className="size-4" /> Cancelar
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor={`cancel-${id}`} className="text-xs">
        Por qué se cancela
      </Label>
      <Input
        id={`cancel-${id}`}
        name="reason"
        required
        minLength={4}
        placeholder="El cliente canceló el pedido"
        className="w-72"
      />
      <p className="max-w-xs text-xs text-muted-foreground">
        Las órdenes ya generadas no se cancelan con esto: si hay que pararlas,
        se cancelan una por una.
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="outline"
          className="text-destructive"
          disabled={pending}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Confirmar
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
          Volver
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
