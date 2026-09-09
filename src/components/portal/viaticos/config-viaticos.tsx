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
 * El interruptor de prospectos, mudado desde «Marca y tarifas».
 *
 * Nació allá y por lo tanto lo guardaba `configuracion: administrar`, que es
 * justo lo que el rol General NO tiene: el único rol que existe para administrar
 * el gasto no podía ver la política de gasto. Aquí lo manda
 * `viaticos: administrar`.
 */
export function ProspectosCard({ activo }: { activo: boolean }) {
  const [state, action, pending] = useActionState(guardarViaticosProspectos, initial);
  const [marcado, setMarcado] = useState(activo);

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Viajes a prospectos</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Si tu equipo visita empresas que todavía no te han comprado, enciéndelo
        para poder registrar esos viajes.
      </p>

      <form action={action} className="mt-4 grid gap-3">
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
              Su gasto no entra en la utilidad de ningún contrato —no hay
              contrato—: queda como costo comercial, y quien autoriza puede
              cargarlo a una oportunidad al revisar la comprobación.
            </span>
          </span>
        </label>

        {marcado ? (
          <p className="rounded-lg bg-secondary/50 px-3 py-2.5 text-sm text-muted-foreground">
            Falta darle acceso a <span className="font-medium">Ventas</span> a
            quien vaya a pedirlos, en Usuarios → su hoja de permisos. Con{" "}
            <span className="font-medium">Ver</span> pide el viaje; con{" "}
            <span className="font-medium">Ver y editar</span>, además da de alta
            el prospecto desde el formulario.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Aviso state={state} />
          <Button type="submit" disabled={pending || marcado === activo}>
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
              SE VE SIEMPRE, PERO APAGADA SIN TOPE.

              Estaba escondida cuando el rubro no tenía presupuesto, con el
              argumento de que una casilla sin efecto enseña a desconfiar de la
              pantalla. El argumento era bueno y la consecuencia, mala: los
              cinco rubros de fábrica nacen sin tope, así que la casilla no
              aparecía en NINGUNO y quien la buscaba concluía que no existe.

              Deshabilitada dice las dos cosas a la vez —existe, y le falta un
              tope—, que es justo lo que la ausencia no decía. El `title` lo
              explica al pasar por encima.
            */}
            <label
              className={`flex items-center gap-1.5 ${
                budget.trim() ? "" : "opacity-50"
              }`}
              title={
                budget.trim()
                  ? "Impide guardar un gasto que rebase el tope del viaje"
                  : "Ponle un presupuesto por día para poder hacerlo cumplir"
              }
            >
              <input
                type="checkbox"
                name="blocksOverBudget"
                checked={bloquea && Boolean(budget.trim())}
                disabled={!budget.trim()}
                onChange={(e) => setBloquea(e.target.checked)}
                className="size-3.5 rounded border-input"
              />
              No dejar pasarse
              {budget.trim() ? "" : " (necesita tope)"}
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
