"use client";

import { useActionState, useState } from "react";
import { Loader2, Plane, Plus, Save, Trash2 } from "lucide-react";
import {
  borrarRubroAction,
  crearRubroAction,
  guardarRubroAction,
  guardarViaticosProspectos,
  type ConfigState,
} from "@/lib/actions/viaticos-config";
import type { RubroFila } from "@/lib/data/viaticos";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mxnViatico } from "@/lib/viaticos";
import { ROLE_LABELS } from "@/lib/roles";

const initial: ConfigState = { ok: false };

function Aviso({ state }: { state: ConfigState }) {
  if (state.error) {
    return <p className="text-sm text-destructive">{state.error}</p>;
  }
  if (state.ok && state.message) {
    return <p className="text-sm text-success">{state.message}</p>;
  }
  return null;
}

/* ─────────────────── ¿Se viaja a quien no es cliente? ─────────────────── */

/**
 * QUÉ ROLES PUEDEN VIAJAR A UN PROSPECTO.
 *
 * Era un interruptor de sí o no, y encenderlo no bastaba: había que entrar
 * además en la hoja de permisos de cada persona a darle acceso a Ventas. La
 * propia tarjeta tenía que confesarlo con un aviso —«falta darle acceso a
 * Ventas a quien vaya a pedirlos»—, que es la señal de que la regla estaba en
 * dos sitios. Ahora es una sola lista.
 *
 * SIN NINGÚN ROL MARCADO, nadie puede: la lista vacía ES el apagado, así que no
 * hay un interruptor aparte que pueda contradecirla.
 *
 * `client` queda fuera de las opciones y no por descuido: el cliente no entra
 * al portal interno, así que ofrecerlo sería ofrecer una casilla que no puede
 * cambiar nada.
 */
const ROLES_QUE_VIAJAN = ["owner", "admin", "general", "agent", "sales"] as const;
const ROL_LABEL: Record<string, string> = ROLE_LABELS;

export function ProspectosCard({ roles }: { roles: string[] }) {
  const [state, action, pending] = useActionState(guardarViaticosProspectos, initial);
  const [marcados, setMarcados] = useState<string[]>(roles);

  const alternar = (rol: string) =>
    setMarcados((prev) =>
      prev.includes(rol) ? prev.filter((r) => r !== rol) : [...prev, rol],
    );

  // Comparación por conjunto: marcar y desmarcar el mismo rol no debe dejar el
  // botón activo, y el orden en que se pulsan no significa nada.
  const cambiado =
    marcados.length !== roles.length || marcados.some((r) => !roles.includes(r));

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Viajes a prospectos</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Si tu equipo visita empresas que todavía no te han comprado, marca qué
        roles pueden pedir esos viajes. Sin ninguno marcado, nadie puede.
      </p>

      <form action={action} className="mt-4 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLES_QUE_VIAJAN.map((rol) => (
            <label
              key={rol}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border p-3 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                name="roles"
                value={rol}
                checked={marcados.includes(rol)}
                onChange={() => alternar(rol)}
                className="size-4 rounded border-input"
              />
              {ROL_LABEL[rol] ?? rol}
            </label>
          ))}
        </div>

        <p className="rounded-lg bg-secondary/50 px-3 py-2.5 text-xs text-muted-foreground">
          Su gasto no entra en la utilidad de ningún contrato —no hay contrato—:
          queda como costo comercial, y quien autoriza puede cargarlo a una
          oportunidad al revisar la comprobación.
          {marcados.length > 0 ? (
            <>
              {" "}
              Quien esté marcado verá los nombres de los prospectos al pedir el
              viaje. <span className="font-medium">Dar de alta uno nuevo</span>{" "}
              sigue pidiendo permiso de edición en Ventas: eso ya no es pedir un
              viaje, es escribir en el padrón comercial.
            </>
          ) : null}
        </p>

        <div className="flex items-center justify-end gap-3">
          <Aviso state={state} />
          <Button type="submit" disabled={pending || !cambiado}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ───────────────────────── Rubros y presupuesto ───────────────────────── */

/**
 * UN RENGLÓN DEL CATÁLOGO, con su propio estado de envío.
 *
 * Cada rubro es su propio formulario y no una fila de uno grande, por lo mismo
 * que `QuitarGasto` en el detalle: con un estado compartido, guardar el
 * presupuesto de Hotel dejaría los ocho renglones en «cargando» y el mensaje de
 * error de uno saldría al lado de otro.
 */
function RubroRow({ rubro }: { rubro: RubroFila }) {
  const [state, action, pending] = useActionState(guardarRubroAction, initial);
  const [borrar, borrarAction, borrando] = useActionState(borrarRubroAction, initial);

  const [name, setName] = useState(rubro.name);
  const [budget, setBudget] = useState(
    rubro.dailyBudgetMxn == null ? "" : String(rubro.dailyBudgetMxn),
  );
  const [nota, setNota] = useState(rubro.requiresNote);
  const [bloquea, setBloquea] = useState(rubro.blocksOverBudget);
  const [activo, setActivo] = useState(rubro.active);

  return (
    <div
      className={`rounded-lg border p-3 ${
        activo ? "border-border" : "border-dashed border-border bg-muted/30"
      }`}
    >
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input type="hidden" name="id" value={rubro.id} />

        <div className="grid gap-1.5">
          <Input
            name="name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nombre del rubro"
          />
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="requiresNote"
                checked={nota}
                onChange={(e) => setNota(e.target.checked)}
                className="size-3.5 rounded border-input"
              />
              Pide especificar de qué se trata
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="active"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="size-3.5 rounded border-input"
              />
              Activo
            </label>
            {/*
              SE PUEDE MARCAR SIEMPRE, Y AVISA SI NO VA A SURTIR EFECTO.

              Estuvo escondida cuando el rubro no tenía tope, y después visible
              pero DESHABILITADA. Las dos versiones fallaron con un usuario de
              verdad, y por la misma razón: los cinco rubros de fábrica nacen sin
              presupuesto, así que la casilla no se podía marcar en ninguno —y
              desde fuera eso se lee como «no guarda», que es exactamente lo que
              se reportó—.

              El miedo era una casilla que no hace nada. Es real, pero es MENOS
              grave que una que no se deja pulsar: la primera se explica con una
              línea de texto, la segunda parece una avería. Así que se guarda
              siempre y el aviso dice qué falta.

              Y de paso se cierra un fallo silencioso: con la versión
              deshabilitada, borrar el presupuesto de un rubro que sí bloqueaba
              lo mandaba al servidor sin la casilla —los campos deshabilitados no
              se envían— y lo apagaba sin que nadie lo pidiera.
            */}
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="blocksOverBudget"
                checked={bloquea}
                onChange={(e) => setBloquea(e.target.checked)}
                className="size-3.5 rounded border-input"
              />
              No dejar pasarse
            </label>
            {/*
              Los usos se enseñan siempre, no solo al intentar borrar: es lo que
              explica por qué un rubro no se puede quitar antes de que alguien
              lo intente y se lleve un error.
            */}
            {rubro.usos > 0 ? (
              <span>
                {rubro.usos} gasto{rubro.usos === 1 ? "" : "s"} lo usan
              </span>
            ) : null}
            {/*
              Marcado y sin tope no es un error —se guarda igual— pero no hace
              nada, y callarlo sería dejar a alguien creyendo que su gasto está
              controlado. Se dice aquí, en el renglón, no en un mensaje que
              desaparece al guardar.
            */}
            {bloquea && !budget.trim() ? (
              <span className="text-warning">
                Sin tope no hay nada que hacer cumplir: ponle un presupuesto.
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Input
            name="dailyBudgetMxn"
            value={budget}
            inputMode="decimal"
            placeholder="Sin tope"
            className="w-32"
            onChange={(e) => setBudget(e.target.value)}
            aria-label="Presupuesto por día"
          />
          <span className="text-xs text-muted-foreground">MXN por día, con IVA</span>
        </div>

        <div className="flex items-start gap-1">
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          </Button>
        </div>
      </form>

      <div className="mt-1 flex items-center justify-between gap-3">
        <Aviso state={state.ok || state.error ? state : borrar} />
        {/*
          Borrar solo se ofrece cuando NADIE lo usó. Con gastos encima la
          llave foránea lo impediría igual, pero enseñando un error que no
          explica nada; y la salida correcta no es borrar sino desactivar, que
          está a la vista dos líneas más arriba.
        */}
        {rubro.usos === 0 ? (
          <form action={borrarAction}>
            <input type="hidden" name="id" value={rubro.id} />
            <button
              type="submit"
              disabled={borrando}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              {borrando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Borrar
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function RubrosCard({ rubros }: { rubros: RubroFila[] }) {
  const [state, action, pending] = useActionState(crearRubroAction, initial);
  const [abierto, setAbierto] = useState(false);

  const conTope = rubros.filter((r) => r.active && r.dailyBudgetMxn != null);
  const sumaDiaria = conTope.reduce((a, r) => a + (r.dailyBudgetMxn ?? 0), 0);

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Plane className="size-4 text-primary" />
        Rubros de gasto y presupuesto
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        En qué se puede gastar durante un viaje y cuánto se autoriza por día. El
        tope de cada viaje se calcula solo: presupuesto × días entre salida y
        regreso.
      </p>

      {/*
        LO QUE PASA AL PASARSE SE DECIDE EN CADA RENGLÓN, y aquí solo se explica.

        Primero fue un párrafo afirmando que nunca bloquea, después un
        interruptor de toda la empresa, y ninguna de las dos servía: el hotel se
        cotiza antes de viajar y su tope es un tope, la comida depende de dónde
        se pare uno. La casilla vive en cada rubro; esto solo dice qué significa
        marcarla, que es la primera pregunta de quien teclea un número aquí.
      */}
      <p className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
        De fábrica, pasarse <span className="font-medium">no bloquea</span>: el
        gasto se registra y sale marcado en la comprobación, con cuánto se pasó.
        Marca <span className="font-medium">«No dejar pasarse»</span> en los
        rubros donde el tope sea un tope de verdad. Un rubro{" "}
        <span className="font-medium">sin tope</span> nunca se marca ni bloquea.
      </p>

      {sumaDiaria > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Con lo configurado, un día de viaje cuesta como máximo{" "}
          <span className="font-medium text-foreground">{mxnViatico(sumaDiaria)}</span>
          {conTope.length < rubros.filter((r) => r.active).length
            ? " (sin contar los rubros sin tope)"
            : ""}
          .
        </p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {rubros.map((r) => (
          <RubroRow key={r.id} rubro={r} />
        ))}
      </div>

      {abierto ? (
        <form action={action} className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">Rubro nuevo</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <Label htmlFor="rubro-nuevo" className="text-xs">
                Nombre
              </Label>
              <Input
                id="rubro-nuevo"
                name="name"
                maxLength={80}
                required
                placeholder="Ej. Casetas y peajes"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rubro-budget" className="text-xs">
                MXN por día, con IVA
              </Label>
              <Input
                id="rubro-budget"
                name="dailyBudgetMxn"
                inputMode="decimal"
                placeholder="Sin tope"
                className="w-32"
              />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="requiresNote"
              className="size-3.5 rounded border-input"
            />
            Pide especificar de qué se trata (como «Otros»)
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="blocksOverBudget"
              className="size-3.5 rounded border-input"
            />
            No dejar pasarse del tope (si no, solo se marca)
          </label>
          <div className="flex items-center justify-end gap-3">
            <Aviso state={state} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Crear
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="mt-3 flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Plus className="size-4" />
          Agregar un rubro
        </button>
      )}
    </Card>
  );
}
