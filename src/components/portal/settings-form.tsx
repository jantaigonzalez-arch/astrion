"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { updateSettings, type SettingsState } from "@/lib/actions/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: SettingsState = { ok: false };

export function SettingsForm({
  laborCostPerHour,
  laborRatePerHour,
}: {
  laborCostPerHour: number;
  laborRatePerHour: number;
}) {
  const [state, action, pending] = useActionState(updateSettings, initial);

  return (
    <Card className="p-6 sm:p-8">
      <form action={action} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cost">Costo por hora (interno)</Label>
            <Input
              id="cost"
              name="laborCostPerHour"
              inputMode="decimal"
              defaultValue={laborCostPerHour || ""}
              placeholder="Ej. 450.00"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {/* «a tu empresa» y no «a Evoelution»: esta pantalla la abre el
                  administrador de cualquier inquilino. Mismo error que el
                  membrete del reporte, una escala más chica. */}
              Lo que le cuesta a tu empresa una hora de técnico.
            </p>
          </div>
          <div>
            <Label htmlFor="rate">Tarifa por hora (cobrada)</Label>
            <Input
              id="rate"
              name="laborRatePerHour"
              inputMode="decimal"
              defaultValue={laborRatePerHour || ""}
              placeholder="Ej. 1250.00"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Lo que se cobra al cliente por hora de servicio.
            </p>
          </div>
        </div>

        {laborRatePerHour > 0 && laborCostPerHour > 0 && (
          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            Margen de mano de obra:{" "}
            <span className="font-semibold text-foreground">
              {(
                ((laborRatePerHour - laborCostPerHour) / laborRatePerHour) *
                100
              ).toFixed(1)}
              %
            </span>{" "}
            · utilidad de {(laborRatePerHour - laborCostPerHour).toLocaleString("es-MX")} MXN por hora
          </p>
        )}

        {state.error && (
          <p className="text-sm text-destructive">
            {state.error === "auth"
              ? "Solo un administrador puede cambiar las tarifas."
              : "Ocurrió un error."}
          </p>
        )}
        {state.ok && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" /> Tarifas actualizadas.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar tarifas
          </Button>
        </div>
      </form>
    </Card>
  );
}
