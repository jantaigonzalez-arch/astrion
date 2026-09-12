"use client";

import { useActionState, useState } from "react";
import { Loader2, Paperclip, Plus } from "lucide-react";
import { agregarGastoAction, type ViaticoState } from "@/lib/actions/viaticos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Selector } from "@/components/ui/selector";
import { mxnViatico, type Rubro } from "@/lib/viaticos";

const initial: ViaticoState = { ok: false };
const selectCls =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Una opción de «¿a qué se carga?». Ver `opcionesDeGasto` en `data/viaticos.ts`. */
export type OpcionDeGasto = { value: string; label: string; detalle?: string };

/**
 * Capturar un gasto del viaje.
 *
 * ── EL DESTINO ESTÁ ARRIBA, Y NO ES SIEMPRE UN TICKET ──────────────────────
 *
 * Es el primer campo porque es el que decide a dónde va el costo, y el que más
 * fácil se contesta mal si se pregunta al final —cuando ya se está pensando en
 * el importe—.
 *
 * Una sola lista, agrupada por destino (0037): los tickets de los contratos
 * del viaje —SOLO los de sus equipos: cargar un gasto a un ticket de otro
 * contrato le sumaría costo a uno y se lo quitaría al que de verdad lo
 * generó—, los negocios abiertos de cada visita y prospecto, cada empresa «sin
 * negocio concreto» y, si el viaje tiene varios destinos, el gasto general.
 *
 * Nada se elige por omisión salvo cuando hay un solo sitio posible: un vacío
 * no distingue «es gasto del viaje» de «se me olvidó», y esa es justo la
 * diferencia que quien revisa mira. Además puede cambiarlo al firmar: ver
 * `reclassifyExpense` en `domain/viaticos.ts`.
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
  opciones,
  rubros,
  dias,
}: {
  viaticoId: string;
  /** A qué se puede cargar. La arma `opcionesDeGasto` con los destinos del viaje. */
  opciones: OpcionDeGasto[];
  /** Solo los activos: ofrecer uno retirado sería invitar a seguir usándolo. */
  rubros: Rubro[];
  /** Días del viaje, para poder decir el tope de ESTE viaje y no el diario. */
  dias: number;
}) {
  const [state, action, pending] = useActionState(agregarGastoAction, initial);
  // El primero de la lista, que es el que la empresa puso arriba. No hay un
  // «hotel» por omisión que se pueda dar por hecho desde que el catálogo lo
  // manda cada empresa.
  const [rubroId, setRubroId] = useState(rubros[0]?.id ?? "");
  const rubro = rubros.find((r) => r.id === rubroId);

  /*
    Sin rubros no se puede capturar nada, y se dice con la salida a la vista.

    Pasa en una empresa que desactivó todos los suyos. Enseñar el formulario con
    un desplegable vacío dejaría a alguien intentando guardar un gasto que la
    base va a rechazar por una llave foránea que no significa nada para él.
  */
  if (rubros.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No hay rubros de gasto activos. Quien administre viáticos los da de alta
        en Configuración → Viáticos.
      </p>
    );
  }

  // Solo pasa en un viaje de contratos cuyos equipos no tienen ningún ticket:
  // un destino de contrato carga a tickets, y no hay ninguno al que cargar.
  if (opciones.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Los contratos de este viaje todavía no tienen tickets de servicio.
        Levanta el ticket del trabajo que fuiste a hacer y aquí podrás cargarle
        los gastos.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="viaticoId" value={viaticoId} />

      <div>
        <Label htmlFor="opcion">¿A qué se carga?</Label>
        {/*
          Buscable: en un viaje con varios contratos los tickets pueden ser
          decenas, y el folio no dice nada por sí solo —el contrato y el asunto
          van de segundo renglón para reconocer el servicio de cada comida—.
        */}
        <Selector
          id="opcion"
          name="opcion"
          required
          placeholder="¿A qué servicio, negocio o empresa pertenece este gasto?"
          defaultValue={opciones.length === 1 ? opciones[0].value : ""}
          opciones={opciones}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Un ticket entra en la utilidad de su contrato; un negocio, en el costo
          de esa oportunidad; una visita o un prospecto, en el costo comercial de
          esa empresa. El gasto general del viaje no se carga a nadie.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rubroId">Rubro</Label>
          <select
            id="rubroId"
            name="rubroId"
            required
            className={selectCls}
            value={rubroId}
            onChange={(e) => setRubroId(e.target.value)}
          >
            {rubros.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {/*
            EL PRESUPUESTO SE DICE AQUÍ, ANTES DE TECLEAR EL IMPORTE.

            Es el único momento en que sirve: enterarse del tope cuando quien
            revisa te devuelve la comprobación no evita nada. Se enseña el tope
            del VIAJE —presupuesto × días— y no el diario, porque es contra ese
            número contra el que se compara lo que se capture.
          */}
          {/*
            EL TOPE Y QUÉ PASA AL PASARLO, ANTES DE TECLEAR EL IMPORTE.

            Enterarse del tope cuando el servidor rechaza el gasto no evita
            nada. Y desde la 0031 el «qué pasa» es de cada rubro, así que el
            texto tiene que decir el de ESTE: con dos rubros que se comportan
            distinto, una frase genérica miente en la mitad de los casos.
          */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {rubro?.dailyBudgetMxn != null ? (
              <>
                Presupuesto: {mxnViatico(rubro.dailyBudgetMxn)} por día ·{" "}
                <span className="font-medium">
                  {mxnViatico(rubro.dailyBudgetMxn * Math.max(1, dias))}
                </span>{" "}
                en este viaje de {dias} día(s).{" "}
                {rubro.blocksOverBudget ? (
                  <span className="text-warning">
                    No se puede guardar un gasto que lo rebase.
                  </span>
                ) : (
                  "Pasarse no bloquea: se marca para quien firma."
                )}
              </>
            ) : (
              "Este rubro no tiene tope configurado."
            )}
          </p>
        </div>

        {rubro?.requiresNote ? (
          <div>
            <Label htmlFor="note">¿De qué se trata?</Label>
            <Input
              id="note"
              name="note"
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
          <Label htmlFor="amountMxn">Importe total del recibo (MXN)</Label>
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
