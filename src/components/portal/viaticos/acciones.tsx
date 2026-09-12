"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Send, ThumbsUp, Undo2, UserRoundCog, X } from "lucide-react";
import {
  autorizarViaticoAction,
  cerrarViaticoAction,
  devolverViaticoAction,
  enviarViaticoAction,
  mandarARevisionAction,
  quitarGastoAction as quitarGastoActionRef,
  reasignarViaticoAction as reasignarViaticoActionRef,
  reclasificarGastoAction as reclasificarGastoActionRef,
  rechazarViaticoAction,
  type ViaticoState,
} from "@/lib/actions/viaticos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ViaticoEstado } from "@/lib/viaticos";

const initial: ViaticoState = { ok: false };

function Aviso({ state }: { state: ViaticoState }) {
  if (state.error) {
    return (
      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * LO QUE LE TOCA HACER A QUIEN ESTÁ MIRANDO.
 *
 * ── UN SOLO COMPONENTE Y NO UNO POR BOTÓN ──────────────────────────────────
 *
 * Porque la pregunta que contesta es una sola —¿de quién es el turno?— y
 * repartirla en seis componentes obligaría a que la página la contestara antes,
 * para saber cuál montar. Ahí es donde se cuela que una pantalla enseñe
 * «Autorizar» a quien pidió el viático.
 *
 * ── LOS BOTONES QUE NO TOCAN NO SE PINTAN APAGADOS: NO SE PINTAN ───────────
 *
 * Un «Autorizar» deshabilitado le dice a quien pidió el viático que existe una
 * puerta que él no puede abrir, y lo invita a pedirla. Si no es su turno o no
 * es su papel, el botón no está — que es también lo que hace el guardia del
 * servidor, así que la pantalla y la regla dicen lo mismo.
 */
export function AccionesViatico({
  id,
  estado,
  soyElSolicitante,
  puedoFirmar,
  estimado,
  gastos,
}: {
  id: string;
  estado: ViaticoEstado;
  soyElSolicitante: boolean;
  /** Puede administrar viáticos Y no es quien lo pidió. Ver `domain/viaticos`. */
  puedoFirmar: boolean;
  estimado: number;
  gastos: number;
}) {
  const [sEnviar, aEnviar, pEnviar] = useActionState(enviarViaticoAction, initial);
  const [sAut, aAut, pAut] = useActionState(autorizarViaticoAction, initial);
  const [sRech, aRech, pRech] = useActionState(rechazarViaticoAction, initial);
  const [sRev, aRev, pRev] = useActionState(mandarARevisionAction, initial);
  const [sCerrar, aCerrar, pCerrar] = useActionState(cerrarViaticoAction, initial);
  const [sDev, aDev, pDev] = useActionState(devolverViaticoAction, initial);

  /* ── Borrador: quien pidió lo manda ── */
  if (estado === "borrador" && soyElSolicitante) {
    return (
      <div className="space-y-3">
        <Aviso state={sEnviar} />
        <form action={aEnviar}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="accent" disabled={pEnviar}>
            {pEnviar ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviar a autorización
          </Button>
        </form>
      </div>
    );
  }

  /* ── Enviado: le toca a quien firma ── */
  if (estado === "enviado" && puedoFirmar) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <form action={aAut} className="space-y-3 rounded-lg border border-border p-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm font-medium">Autorizar</p>
          <div>
            <Label htmlFor="authorizedMxn">Monto que se autoriza, con IVA (MXN)</Label>
            {/*
              Viene relleno con lo que se pidió, y es editable: autorizar menos
              es una respuesta legítima y frecuente. Lo pedido queda guardado
              aparte, así que después se puede explicar por qué un reporte se
              pasó del anticipo.
            */}
            <Input
              id="authorizedMxn"
              name="authorizedMxn"
              inputMode="decimal"
              required
              defaultValue={estimado.toFixed(2)}
            />
          </div>
          <div>
            <Label htmlFor="note">Respuesta a quien lo pidió</Label>
            <Textarea id="note" name="note" rows={2} placeholder="Opcional." />
          </div>
          <Aviso state={sAut} />
          <Button type="submit" variant="accent" disabled={pAut} className="w-full">
            {pAut ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Autorizar
          </Button>
        </form>

        <form action={aRech} className="space-y-3 rounded-lg border border-border p-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm font-medium">Rechazar</p>
          <div>
            <Label htmlFor="reason-rech">Por qué</Label>
            <Textarea
              id="reason-rech"
              name="reason"
              rows={4}
              required
              placeholder="Obligatorio: sin motivo, quien pidió vuelve a mandar lo mismo."
            />
          </div>
          <Aviso state={sRech} />
          <Button type="submit" variant="ghost" disabled={pRech} className="w-full">
            {pRech ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Rechazar
          </Button>
        </form>
      </div>
    );
  }

  /* ── Autorizado: quien viajó comprueba ── */
  if (estado === "autorizado" && soyElSolicitante) {
    return (
      <div className="space-y-3">
        <Aviso state={sRev} />
        <form action={aRev}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="accent" disabled={pRev || gastos === 0}>
            {pRev ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Mandar a revisión
          </Button>
          {gastos === 0 ? (
            <span className="ml-3 text-xs text-muted-foreground">
              Carga al menos un gasto.
            </span>
          ) : null}
        </form>
      </div>
    );
  }

  /* ── En revisión: el visto bueno ── */
  if (estado === "en_revision" && puedoFirmar) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <form action={aCerrar} className="space-y-3 rounded-lg border border-border p-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm font-medium">Visto bueno y cierre</p>
          <p className="text-xs text-muted-foreground">
            Al cerrar, el gasto empieza a contar en la utilidad del contrato.
          </p>
          <div>
            <Label htmlFor="note-cierre">Nota</Label>
            <Textarea id="note-cierre" name="note" rows={2} placeholder="Opcional." />
          </div>
          <Aviso state={sCerrar} />
          <Button type="submit" variant="accent" disabled={pCerrar} className="w-full">
            {pCerrar ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ThumbsUp className="size-4" />
            )}
            Cerrar
          </Button>
        </form>

        <form action={aDev} className="space-y-3 rounded-lg border border-border p-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm font-medium">Devolver para corregir</p>
          <div>
            <Label htmlFor="reason-dev">Qué falta</Label>
            <Textarea
              id="reason-dev"
              name="reason"
              rows={3}
              required
              placeholder="Ej. Falta el comprobante del hotel del día 12."
            />
          </div>
          <Aviso state={sDev} />
          <Button type="submit" variant="ghost" disabled={pDev} className="w-full">
            {pDev ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Devolver
          </Button>
        </form>
      </div>
    );
  }

  /*
    NO ES TU TURNO, Y SE DICE.

    El vacío haría pensar que la pantalla se rompió o que falta un permiso. Un
    renglón que nombra a quién le toca cierra la pregunta sin que nadie tenga
    que ir a preguntar por el pasillo.
  */
  const enQuienEspera: Partial<Record<ViaticoEstado, string>> = {
    borrador: "Espera a que quien lo pidió lo mande.",
    enviado: "Espera autorización de quien administra viáticos.",
    autorizado: "Espera a que quien viajó cargue y mande sus gastos.",
    en_revision: "Espera el visto bueno de quien administra viáticos.",
  };
  const texto = enQuienEspera[estado];
  return texto ? (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{texto}</p>
  ) : null;
}

/**
 * Quitar un gasto ya capturado.
 *
 * Componente aparte y diminuto porque necesita su propio estado de envío: con
 * uno compartido, borrar un renglón dejaría los ocho botones de la tabla en
 * «cargando» a la vez.
 */
export function QuitarGasto({ gastoId }: { gastoId: string }) {
  const [state, action, pending] = useActionState(
    // Importación diferida no: la acción se importa arriba con las demás. Este
    // wrapper existe solo para el estado por renglón.
    quitarGastoActionRef,
    initial,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="gastoId" value={gastoId} />
      <button
        type="submit"
        disabled={pending}
        title={state.error ?? "Quitar este gasto"}
        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
      </button>
    </form>
  );
}

/**
 * MANDARLE EL VIÁTICO A OTRA PERSONA PARA QUE LO FIRME.
 *
 * Desde la 0028 el viático va a nombre de alguien y solo esa persona firma. Eso
 * arregla el documento que nadie mira porque cada uno supone que lo mirará
 * otro, y crea un problema nuevo: si quien tiene que firmar está de vacaciones,
 * el viático se queda parado y nadie más puede tocarlo.
 *
 * Esta es la salida, y es deliberadamente un GESTO APARTE y no un botón más
 * entre las firmas. Reasignar no es una decisión sobre el viaje —autorizar,
 * rechazar, cerrar—: es una decisión sobre quién lo mira, y mezclarla con las
 * otras haría que se pulsara por descuido buscando «Autorizar».
 *
 * Empieza plegado por la misma razón: en el caso normal no hace falta, y un
 * desplegable de personas siempre visible invita a cambiar de firmante como si
 * fuera parte del trámite.
 */
export function ReasignarViatico({
  id,
  actual,
  aprobadores,
}: {
  id: string;
  actual: string | null;
  aprobadores: Array<{ id: string; name: string | null; role: string }>;
}) {
  const [state, action, pending] = useActionState(reasignarViaticoActionRef, initial);
  const [abierto, setAbierto] = useState(false);

  // Los que ya pueden recibirlo: todos menos quien lo tiene. Ofrecer al actual
  // sería ofrecer una operación que el dominio rechaza con «ya está a nombre de
  // esa persona», y el error saldría después de dos clics.
  const posibles = aprobadores.filter((a) => a.id !== actual);
  if (posibles.length === 0) return null;

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        <UserRoundCog className="size-3.5" />
        Que lo firme otra persona
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 grid gap-2 border-t border-border pt-3">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor="reasignar-a" className="text-xs">
        ¿Quién lo firma?
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="reasignar-a"
          name="approverId"
          required
          className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
        >
          {posibles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? "Sin nombre"}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Reasignar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Le llega el aviso y pasa a ser quien puede firmarlo.
      </p>
      <Aviso state={state} />
    </form>
  );
}

/**
 * MOVER UN GASTO DE DESTINO AL REVISARLO.
 *
 * Quien capturó propuso; quien firma decide. El ingeniero marca la cena como
 * gasto del viaje y quien revisa ve que sí era de la oportunidad que se está
 * negociando — o al revés. Sin esto, la única forma de corregirlo sería
 * devolver la comprobación entera por un renglón.
 *
 * Estado propio por renglón, igual que `QuitarGasto` y por el mismo motivo:
 * compartirlo dejaría toda la tabla en «cargando» al mover uno solo.
 *
 * Solo aparece en `en_revision` y cuando hay más de un sitio al que moverlo; la
 * página decide eso y aquí no se vuelve a preguntar. El dominio lo comprueba de
 * todas formas.
 *
 * Las mismas opciones que tuvo quien capturó (`opcionesDeGasto`): tickets de
 * los contratos del viaje, negocios y empresas de las visitas y prospectos, y
 * —con varios destinos— el gasto general del viaje. Una sola lista en vez de un
 * desplegable por clase de destino: desde la 0037 un viaje junta varias, y
 * elegir primero la clase y luego la cosa era pedir dos decisiones para una.
 */
export function ReclasificarGasto({
  gastoId,
  opciones,
  actual,
}: {
  gastoId: string;
  opciones: Array<{ value: string; label: string; detalle?: string }>;
  /** La opción en la que está hoy, con el mismo formato (`ticket:<id>`…). */
  actual: string;
}) {
  const [state, action, pending] = useActionState(reclasificarGastoActionRef, initial);
  const [opcion, setOpcion] = useState(actual);

  return (
    <form action={action} className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="gastoId" value={gastoId} />
      <select
        name="opcion"
        aria-label="Mover este gasto"
        className="h-7 max-w-64 rounded border border-input bg-background px-1.5 text-xs"
        value={opcion}
        onChange={(e) => setOpcion(e.target.value)}
      >
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.detalle ? `${o.label} — ${o.detalle}` : o.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={pending || opcion === actual}
        className="rounded border border-input px-1.5 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
        title={state.error ?? "Guardar el destino de este gasto"}
      >
        {pending ? <Loader2 className="inline size-3 animate-spin" /> : "Mover"}
      </button>
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
    </form>
  );
}
