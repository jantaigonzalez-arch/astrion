"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { updateTipoCambioAutomatico, type SettingsState } from "@/lib/actions/settings";
import { Button } from "@/components/ui/button";

const initial: SettingsState = { ok: false };

/**
 * El interruptor de Configuración → Moneda: Banxico o manual.
 *
 * Se guarda con un botón y no al pulsar la casilla: cambia de dónde sale la
 * paridad de cada negocio en dólares que se guarde después, y un clic
 * accidental no debería hacer eso sin que nadie lo confirme.
 */
export function TipoCambioAutomaticoForm({ automatico }: { automatico: boolean }) {
  const [state, action, pending] = useActionState(updateTipoCambioAutomatico, initial);
  const [marcado, setMarcado] = useState(automatico);

  return (
    <form action={action} className="grid gap-3">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 hover:bg-secondary/40">
        <input
          type="checkbox"
          name="automatico"
          checked={marcado}
          onChange={(e) => setMarcado(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-primary)]"
        />
        <span className="text-sm">
          <span className="font-medium">Tomar el tipo de cambio de Banxico automáticamente</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            El FIX publicado en el Diario Oficial el día anterior, que es el que vale para
            una operación en dólares (art. 20 del Código Fiscal). Se actualiza solo cada
            día hábil.
          </span>
        </span>
      </label>

      {state.error && (
        <p className="text-sm text-destructive">
          {state.error === "auth"
            ? "Solo un administrador puede cambiar esto."
            : "Ocurrió un error al guardar."}
        </p>
      )}
      {state.ok && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" /> Guardado. Aplica a los negocios que se guarden a partir de ahora.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" variant="accent" disabled={pending || marcado === automatico}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar
        </Button>
      </div>
    </form>
  );
}
