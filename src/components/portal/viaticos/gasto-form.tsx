"use client";

import { useActionState, useState } from "react";
import { Loader2, Paperclip, Plus } from "lucide-react";
import { agregarGastoAction, type ViaticoState } from "@/lib/actions/viaticos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import {
  CATEGORIA_AYUDA,
  CATEGORIA_LABELS,
  VIATICO_CATEGORIAS,
  type ViaticoCategoria,
} from "@/lib/viaticos";

const initial: ViaticoState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type TicketOpcion = { id: string; reference: string; subject: string };
export type NegocioOpcion = { id: string; reference: string; title: string };

/**
 * Capturar un gasto del viaje.
 *
 * ── EL DESTINO ESTÁ ARRIBA, Y NO ES SIEMPRE UN TICKET ──────────────────────
 *
 * Es el primer campo porque es el que decide a dónde va el costo, y el que más
 * fácil se contesta mal si se pregunta al final —cuando ya se está pensando en
 * el importe—.
 *
 * En un viático DE CONTRATO la pregunta es a qué ticket, y los que ofrece son
 * SOLO los de los equipos de ese contrato: cargar un gasto a un ticket de otro
 * contrato le sumaría costo a uno y se lo quitaría al que de verdad lo generó.
 *
 * En uno DE PROSPECTO no hay tickets, así que la pregunta cambia: al negocio o
 * a nada. Y «a nada» se elige explícitamente —no se deja el campo vacío—
 * porque un vacío no distingue «es gasto del viaje» de «se me olvidó», y esa es
 * justo la diferencia que quien revisa mira. Además puede cambiarlo al firmar:
 * ver `reclassifyExpense` en `domain/viaticos.ts`.
 *
 * ── «OTROS» PIDE EXPLICACIÓN EN CUANTO SE ELIGE ────────────────────────────
 *
 * El campo aparece al elegirlo, no después de que el servidor lo rechace. Lo
 * exigen las tres capas —esta, la acción y un CHECK en la base—, y son tres a
 * propósito: aquí para que se entienda, en la acción para que no se salte por
 * otro camino, y en la base para que no dependa de ninguna de las dos.
 */
export function GastoForm({
  viaticoId,
  tickets,
  negocios,
  esProspecto,
}: {
  viaticoId: string;
  tickets: TicketOpcion[];
  negocios: NegocioOpcion[];
  /** El viático es de un prospecto: no hay tickets, hay negocio o nada. */
  esProspecto: boolean;
}) {
  const [state, action, pending] = useActionState(agregarGastoAction, initial);
  const [categoria, setCategoria] = useState<ViaticoCategoria>("hotel");
  const [destino, setDestino] = useState<"negocio" | "comercial">(
    // Se abre en «gasto del viaje» y no en «negocio»: en un viaje de
    // prospección la mayoría de los renglones son del viaje, y el valor por
    // omisión tiene que ser el que se elige más veces. Quien firma lo mueve si
    // hace falta.
    "comercial",
  );

  if (!esProspecto && tickets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Este contrato todavía no tiene tickets de servicio. Levanta el ticket del
        trabajo que fuiste a hacer y aquí podrás cargarle los gastos.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="viaticoId" value={viaticoId} />

      {esProspecto ? (
        <div>
          <input type="hidden" name="destino" value={destino} />
          <Label htmlFor="destinoGasto">¿A qué se carga?</Label>
          <select
            id="destinoGasto"
            className={selectCls}
            value={destino}
            onChange={(e) => setDestino(e.target.value as "negocio" | "comercial")}
          >
            <option value="comercial">Gasto comercial del viaje</option>
            {/*
              La opción de negocio desaparece cuando no hay ninguno abierto, en
              vez de quedarse vacía: un desplegable que se abre sin opciones
              parece un fallo de carga y manda a buscar dónde está el error.
            */}
            {negocios.length > 0 ? (
              <option value="negocio">Un negocio concreto</option>
            ) : null}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {destino === "comercial"
              ? "No entra en la utilidad de ningún contrato ni ticket: es costo de prospección."
              : "El costo se podrá leer en la ficha de esa oportunidad."}
          </p>
        </div>
      ) : (
        <input type="hidden" name="destino" value="ticket" />
      )}

      {esProspecto ? (
        destino === "negocio" ? (
          <div>
            <Label htmlFor="dealId">Negocio</Label>
            <Selector
              id="dealId"
              name="dealId"
              required
              placeholder="¿Por qué oportunidad fue este gasto?"
              opciones={negocios.map((n) => ({
                value: n.id,
                label: n.title,
                detalle: n.reference,
              }))}
            />
          </div>
        ) : null
      ) : (
        <div>
          <Label htmlFor="ticketId">Ticket de servicio</Label>
          {/*
            Los tickets de un contrato pueden ser decenas, y el folio no dice
            nada por sí solo: el asunto va de segundo renglón para poder
            reconocer el servicio al que pertenece cada comida.
          */}
          <Selector
            id="ticketId"
            name="ticketId"
            required
            placeholder="¿A qué servicio pertenece este gasto?"
            opciones={tickets.map((t) => ({
              value: t.id,
              label: t.reference,
              detalle: t.subject,
            }))}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="category">Categoría</Label>
          <select
            id="category"
            name="category"
            required
            className={selectCls}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as ViaticoCategoria)}
          >
            {VIATICO_CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_LABELS[c]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {CATEGORIA_AYUDA[categoria]}
          </p>
        </div>

        {categoria === "otros" ? (
          <div>
            <Label htmlFor="otherLabel">¿De qué se trata?</Label>
            <Input
              id="otherLabel"
              name="otherLabel"
              required
              maxLength={120}
              placeholder="Ej. Envío de paquetería"
            />
          </div>
        ) : null}
      </div>

      <div>
        <Label htmlFor="description">Descripción</Label>
        <Input
          id="description"
          name="description"
          required
          maxLength={300}
          placeholder="Ej. Hotel Fiesta Inn, 2 noches"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="spentOn">Fecha</Label>
          <Input id="spentOn" name="spentOn" type="date" required />
        </div>
        <div>
          <Label htmlFor="amountMxn">Importe (MXN)</Label>
          <Input
            id="amountMxn"
            name="amountMxn"
            inputMode="decimal"
            required
            placeholder="0.00"
          />
        </div>
        <div>
          <Label htmlFor="receipt">Comprobante</Label>
          <Input
            id="receipt"
            name="receipt"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
          />
          {/*
            Se dice que se puede subir después en vez de bloquear el guardado.
            Un taxi sin recibo existe, y obligar a un comprobante para poder
            registrar el gasto no hace aparecer el papel: hace que el gasto no
            se registre. La pantalla de revisión marca los que van sin él.
          */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            Foto o PDF. Si no hay, se marca.
          </p>
        </div>
      </div>

      {state.error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <Paperclip className="mr-1 inline size-3.5" />
          {state.message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Agregar gasto
        </Button>
      </div>
    </form>
  );
}
