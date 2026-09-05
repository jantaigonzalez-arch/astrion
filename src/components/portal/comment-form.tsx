"use client";

import { useRef, useState } from "react";
import { Link } from "@/lib/nav";
import { useFormStatus } from "react-dom";
import { Clock, Loader2, Package, Send, Wrench } from "lucide-react";
import {
  PartsPicker,
  type PartOption,
  type PickedPart,
} from "@/components/portal/parts-picker";
import { addComment } from "@/lib/actions/tickets";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export type CommentEquipment = {
  id: string;
  brand: string;
  name: string;
  model: string | null;
  modules: {
    id: string;
    name: string;
    serialNumber: string | null;
    submodules: { id: string; name: string; serialNumber: string | null }[];
  }[];
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="accent" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      Responder
    </Button>
  );
}

export function CommentForm({
  ticketId,
  canMarkInternal,
  equipment = [],
  parts = [],
  defaultEquipmentId = "",
  defaultModuleId = "",
}: {
  ticketId: string;
  canMarkInternal: boolean;
  equipment?: CommentEquipment[];
  parts?: PartOption[];
  defaultEquipmentId?: string;
  defaultModuleId?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  // Se precargan con el equipo/módulo del ticket para agilizar la captura.
  const [eqId, setEqId] = useState(defaultEquipmentId);
  const [modId, setModId] = useState(defaultModuleId);
  const [subId, setSubId] = useState("");
  // Refacciones utilizadas en esta actividad.
  const [used, setUsed] = useState<PickedPart[]>([]);

  const modules = equipment.find((e) => e.id === eqId)?.modules ?? [];
  const submodules = modules.find((m) => m.id === modId)?.submodules ?? [];

  return (
    <form
      ref={ref}
      action={async (fd) => {
        await addComment(fd);
        ref.current?.reset();
        // Vuelve al componente por defecto del ticket.
        setEqId(defaultEquipmentId);
        setModId(defaultModuleId);
        setSubId("");
        setUsed([]);
      }}
      className="space-y-3"
    >
      <input type="hidden" name="ticketId" value={ticketId} />

      <Textarea name="body" rows={3} required placeholder="Describe la actividad realizada…" />

      {/* Componente sobre el que se trabajó + horas de servicio */}
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        {equipment.length > 0 && (
          <>
          <Label className="flex items-center gap-1.5">
            <Wrench className="size-3.5 text-primary" /> Actividad sobre
          </Label>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              name="cEquipmentId"
              className={selectCls}
              value={eqId}
              onChange={(e) => {
                setEqId(e.target.value);
                setModId("");
                setSubId("");
              }}
            >
              <option value="">— Equipo —</option>
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.brand} {eq.name}
                  {eq.model ? ` · ${eq.model}` : ""}
                </option>
              ))}
            </select>

            <select
              name="cModuleId"
              className={selectCls}
              value={modId}
              disabled={!eqId || modules.length === 0}
              onChange={(e) => {
                setModId(e.target.value);
                setSubId("");
              }}
            >
              <option value="">
                {!eqId
                  ? "— Módulo —"
                  : modules.length === 0
                    ? "Sin módulos"
                    : "— Módulo —"}
              </option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.serialNumber ? ` · S/N ${m.serialNumber}` : ""}
                </option>
              ))}
            </select>

            <select
              name="cSubmoduleId"
              className={selectCls}
              value={subId}
              disabled={!modId || submodules.length === 0}
              onChange={(e) => setSubId(e.target.value)}
            >
              <option value="">
                {!modId
                  ? "— Submódulo —"
                  : submodules.length === 0
                    ? "Sin submódulos"
                    : "— Submódulo —"}
              </option>
              {submodules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.serialNumber ? ` · S/N ${s.serialNumber}` : ""}
                </option>
              ))}
            </select>
          </div>
          </>
        )}

        {/* Horas de servicio de esta actividad */}
        <div
          className={
            equipment.length > 0
              ? "mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
              : "flex flex-wrap items-center gap-2"
          }
        >
            <Label className="mb-0 flex items-center gap-1.5">
              <Clock className="size-3.5 text-primary" /> Horas de servicio
            </Label>
            <input
              type="number"
              name="hours"
              step="0.25"
              min="0"
              max="999"
              placeholder="Ej. 1.5"
              className="h-9 w-28 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          <span className="text-xs text-muted-foreground">
            horas dedicadas (opcional)
          </span>
        </div>

        {/*
          REFACCIONES UTILIZADAS.

          El bloque se pinta para todo el EQUIPO, no solo cuando hay catálogo.
          Antes colgaba de `parts.length > 0` y con el catálogo vacío
          desaparecía entero: quien buscaba dónde registrar una refacción en un
          servicio no encontraba nada y no había forma de saber si la función no
          existía o si faltaban datos. Un control ausente sin explicación se lee
          como una función que falta.

          `canMarkInternal` es «esta persona es del equipo», que es lo mismo que
          gobierna la nota interna: el cliente no captura bitácora ni consume
          refacciones, así que a él no se le enseña ninguna de las dos.
        */}
        {canMarkInternal && (
          <div className="mt-3 border-t border-border pt-3">
            <Label className="flex items-center gap-1.5">
              <Package className="size-3.5 text-primary" /> Refacciones utilizadas
            </Label>
            {parts.length > 0 ? (
              <PartsPicker parts={parts} value={used} onChange={setUsed} />
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                No hay refacciones en el catálogo todavía. Se dan de alta en{" "}
                <Link
                  href="/admin/refacciones"
                  className="font-medium text-primary hover:underline"
                >
                  Inventario · Refacciones
                </Link>{" "}
                y desde ahí quedan disponibles para cualquier servicio.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        {canMarkInternal ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="internal" className="size-4 rounded border-input" />
            Nota interna (no visible para el cliente)
          </label>
        ) : (
          <span />
        )}
        <SubmitBtn />
      </div>
    </form>
  );
}
