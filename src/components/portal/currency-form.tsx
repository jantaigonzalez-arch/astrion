"use client";

import { useActionState } from "react";
import { CheckCircle2, Coins, Loader2, Save } from "lucide-react";
import { updateFxRate, type SettingsState } from "@/lib/actions/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: SettingsState = { ok: false };

/**
 * Configuración → Moneda.
 *
 * Una sección propia y no un campo más entre las tarifas de mano de obra: son
 * decisiones distintas, con dueños distintos y ritmos distintos. La tarifa se
 * pacta una vez al año; el tipo de cambio se toca cuando hay una cotización en
 * dólares sobre la mesa.
 *
 * El texto explica qué pasa al cambiarlo, porque es la duda razonable de quien
 * lo edita: "¿se me van a mover los informes del mes pasado?". No — el tipo de
 * cambio se copia dentro de cada negocio al guardarlo.
 */
export function CurrencyForm({ usdRate }: { usdRate: number | null }) {
  const [state, action, pending] = useActionState(updateFxRate, initial);

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-5 flex items-center gap-2">
        <Coins className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Moneda</h2>
      </div>

      <form action={action} className="grid gap-5">
        <div>
          <Label htmlFor="usdRate">Tipo de cambio USD → MXN</Label>
          <Input
            id="usdRate"
            name="usdRate"
            inputMode="decimal"
            defaultValue={usdRate ?? ""}
            placeholder="Ej. 18.20"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Con qué paridad se convierten a pesos los negocios capturados en
            dólares, para poder sumarlos en el embudo y en los informes.
          </p>
        </div>

        <div className="rounded-lg bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
          {usdRate ? (
            <>
              Al guardar un negocio en dólares se le copia este tipo de cambio
              con la fecha del día. Cambiarlo aquí afecta a los negocios que se
              guarden <span className="font-medium text-foreground">a partir de ahora</span>:
              los informes de meses ya cerrados no se mueven.
            </>
          ) : (
            <>
              Sin tipo de cambio, un negocio capturado en dólares{" "}
              <span className="font-medium text-foreground">no suma</span> al
              embudo ni al pronóstico — se muestra aparte, rotulado «sin
              convertir», en vez de contarse como cero.
            </>
          )}
        </div>

        {state.error && (
          <p className="text-sm text-destructive">
            {state.error === "auth"
              ? "Solo un administrador puede cambiar el tipo de cambio."
              : state.error === "invalid"
                ? "El tipo de cambio tiene que ser un número mayor que cero. Déjalo vacío si prefieres no convertir."
                : "Ocurrió un error."}
          </p>
        )}
        {state.ok && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" /> Tipo de cambio actualizado.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="accent" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar tipo de cambio
          </Button>
        </div>
      </form>
    </Card>
  );
}
