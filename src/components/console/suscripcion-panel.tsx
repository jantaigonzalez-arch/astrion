"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarClock, Loader2, Pause, Play } from "lucide-react";
import {
  activarSuscripcion,
  iniciarPrueba,
  suspenderSuscripcion,
  type SuscripcionState,
} from "@/lib/actions/suscripcion";
import { DIAS_DE_PRUEBA, estadoDe } from "@/lib/suscripcion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Enviar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </Button>
  );
}

/**
 * El reloj de una empresa, desde la consola de Astraion.
 *
 * ── LO QUE ENSEÑA ES LA CONSECUENCIA, NO EL CAMPO ─────────────────────────
 *
 * Un estado y una fecha no dicen nada por sí solos: lo que quien opera necesita
 * saber es si ese cliente PUEDE ENTRAR hoy y cuánto le queda. Por eso el
 * renglón de arriba está escrito en esos términos y no como «status: trial».
 *
 * Se calcula con la misma función que decide el acceso de verdad —`estadoDe`—,
 * así que esta pantalla no puede decir una cosa mientras el portal hace otra.
 *
 * ── SUSPENDER PIDE MOTIVO ─────────────────────────────────────────────────
 *
 * Igual que cancelar una factura. Es la acción que deja a una empresa entera
 * fuera, y dentro de seis meses la única forma de saber por qué será lo que se
 * escribió aquí. Queda en `platform_events`, que sobrevive a la baja del
 * inquilino.
 */
export function SuscripcionPanel({
  tenantId,
  status,
  trialEndsAt,
  plan,
}: {
  tenantId: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  trialEndsAt: Date | null;
  plan: string;
}) {
  const inicial: SuscripcionState = { ok: false };
  const [rPrueba, darPrueba] = useActionState(iniciarPrueba, inicial);
  const [rActivar, activar] = useActionState(activarSuscripcion, inicial);
  const [rSuspender, suspender] = useActionState(suspenderSuscripcion, inicial);
  const [abrirSuspender, setAbrirSuspender] = useState(false);
  const error = rPrueba.error ?? rActivar.error ?? rSuspender.error;
  const e = estadoDe({
    status,
    trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
    plan,
  });

  const resumen =
    e.clave === "activa"
      ? "Activa · entra con normalidad"
      : e.clave === "prueba"
        ? `Prueba · ${e.dias} día${e.dias === 1 ? "" : "s"} restante${e.dias === 1 ? "" : "s"}`
        : e.clave === "prueba-abierta"
          ? "Prueba sin fecha de término · entra"
          : e.clave === "vencida"
            ? "Prueba vencida · NO entra"
            : e.clave === "suspendida"
              ? "Suspendida · NO entra"
              : "Cancelada · NO entra";

  return (
    <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <CalendarClock className="size-3.5 text-primary" />
        {resumen}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <form action={darPrueba} className="flex items-center gap-1.5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Input
            name="dias"
            type="number"
            min={1}
            max={365}
            defaultValue={DIAS_DE_PRUEBA}
            className="h-8 w-16 text-xs"
            aria-label="Días de prueba"
          />
          <Enviar>Dar prueba</Enviar>
        </form>

        {status !== "active" && (
          <form action={activar}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <Enviar>
              <Play className="size-3.5" /> Activar
            </Enviar>
          </form>
        )}

        {status !== "suspended" && !abrirSuspender && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAbrirSuspender(true)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Pause className="size-3.5" /> Suspender
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {abrirSuspender && (
        <form
          action={suspender}
          className="mt-2.5 grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5"
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <p className="text-xs text-muted-foreground">
            La empresa deja de entrar. No se borra nada: sus datos quedan como
            están y vuelven en cuanto se reactive.
          </p>
          <Input
            name="motivo"
            required
            minLength={3}
            placeholder="Motivo — ej. tres meses sin pago"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Enviar>Suspender</Enviar>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAbrirSuspender(false)}
            >
              No
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
