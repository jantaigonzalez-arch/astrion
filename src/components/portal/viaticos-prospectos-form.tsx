"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, Plane, Save } from "lucide-react";
import {
  updateViaticosProspectos,
  type SettingsState,
} from "@/lib/actions/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const initial: SettingsState = { ok: false };

/**
 * VIAJES A PROSPECTOS: la política, no el permiso.
 *
 * Este interruptor contesta «¿esta empresa paga viajes a quien todavía no le ha
 * comprado nada?». No contesta quién puede pedirlos: eso sale de la hoja de
 * permisos de cada persona, donde ya se decide todo lo demás. Son dos preguntas
 * distintas y por eso no viven en el mismo sitio — juntarlas obligaría a repetir
 * la política en cada cuenta y a que apagarla fuera revisar seis fichas.
 *
 * Se dice en el texto de abajo con nombres concretos, porque la pregunta que
 * viene justo después de encenderlo es «¿y ahora quién?», y mandarla a buscar a
 * otra pantalla sin decir cuál es lo que hace que la función se quede a medio
 * configurar.
 *
 * ── EL BOTÓN NO SE ESCONDE CUANDO NO HAY CAMBIOS ───────────────────────────
 *
 * Se deshabilita. Un guardar que aparece y desaparece al marcar la casilla hace
 * saltar el resto del formulario, y en una pantalla de ajustes eso se lee como
 * que algo se rompió.
 */
export function ViaticosProspectosForm({ activo }: { activo: boolean }) {
  const [state, action, pending] = useActionState(updateViaticosProspectos, initial);
  const [marcado, setMarcado] = useState(activo);
  const cambiado = marcado !== activo;

  return (
    <Card className="p-6 sm:p-8">
      <form action={action} className="grid gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Plane className="size-4 text-primary" />
            Viáticos a prospectos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Si tu equipo viaja a ver empresas que todavía no te han comprado,
            enciéndelo para poder registrar esos viajes.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3.5 hover:bg-muted/50">
          <input
            type="checkbox"
            name="viaticosProspectos"
            checked={marcado}
            onChange={(e) => setMarcado(e.target.checked)}
            className="mt-0.5 size-4 rounded border-input"
          />
          <span className="text-sm">
            <span className="block font-medium">
              Se pueden pedir viáticos para prospectos
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              El gasto de esos viajes NO entra en la utilidad de ningún contrato
              —no hay contrato—: queda como costo comercial, y quien autoriza
              puede cargarlo a una oportunidad concreta al revisar la
              comprobación.
            </span>
          </span>
        </label>

        {/*
          QUIÉN, dicho aquí mismo y con la dirección exacta.

          Solo se enseña cuando está encendido: antes de eso es una instrucción
          para algo que todavía no existe, y una pantalla de ajustes llena de
          consejos condicionales se deja de leer entera.
        */}
        {marcado ? (
          <p className="rounded-lg bg-secondary/50 px-3 py-2.5 text-sm text-muted-foreground">
            Ahora dale acceso a <span className="font-medium">Ventas</span> a
            quien vaya a pedirlos, en Configuración → Usuarios → su hoja de
            permisos. Con <span className="font-medium">Ver</span> puede pedir el
            viaje; con <span className="font-medium">Ver y editar</span>, además
            dar de alta el prospecto desde el propio formulario.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          {state.ok ? (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" />
              Guardado
            </span>
          ) : null}
          {state.error ? (
            <span className="text-sm text-destructive">
              {state.error === "auth"
                ? "No tienes permiso para cambiar esto."
                : "No se pudo guardar."}
            </span>
          ) : null}
          <Button type="submit" disabled={pending || !cambiado}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
