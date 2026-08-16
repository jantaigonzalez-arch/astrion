"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import {
  removeRequisitionLine,
  resolveRequisitionLine,
  type RequisitionState,
} from "@/lib/actions/requisitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: RequisitionState = { ok: false };

export type LineaVista = {
  id: string;
  description: string;
  quantity: number;
  orderedQuantity: number;
  notes: string | null;
  partId: string | null;
  partNumber: string | null;
  stock: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierReason: string | null;
  supplierSuspended: Date | null;
};

export type Opcion = { id: string; label: string };

/**
 * Los renglones de una requisición.
 *
 * Lo que esta tabla tiene que dejar claro de un vistazo es CUÁL RENGLÓN ESTÁ
 * ATORADO. Un renglón sin refacción del catálogo o sin proveedor no falla: se
 * queda quieto para siempre mientras la requisición dice «autorizada» y todo
 * parece ir bien. Por eso el hueco se marca en ámbar con su palabra escrita, y
 * no simplemente con una celda vacía.
 */
export function RequisitionLines({
  lines,
  parts,
  suppliers,
  editable,
}: {
  lines: LineaVista[];
  parts: Opcion[];
  suppliers: Opcion[];
  /** Solo el borrador se toca. Después, la tabla es de lectura. */
  editable: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Qué</th>
            <th className="px-4 py-3 font-medium">Refacción</th>
            <th className="px-4 py-3 font-medium">Proveedor</th>
            <th className="px-4 py-3 text-right font-medium">Pide</th>
            <th className="px-4 py-3 text-right font-medium">Pedido a prov.</th>
            {editable && <th className="w-px px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l) => (
            <Fila
              key={l.id}
              linea={l}
              parts={parts}
              suppliers={suppliers}
              editable={editable}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fila({
  linea,
  parts,
  suppliers,
  editable,
}: {
  linea: LineaVista;
  parts: Opcion[];
  suppliers: Opcion[];
  editable: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [state, action, pending] = useActionState(resolveRequisitionLine, initial);
  const [borrado, accionBorrar, borrando] = useActionState(
    removeRequisitionLine,
    initial,
  );

  if (editando && editable) {
    return (
      <tr className="bg-secondary/20">
        <td colSpan={editable ? 6 : 5} className="px-4 py-4">
          <form action={action} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="lineId" value={linea.id} />
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">
                Refacción del catálogo
              </label>
              <select
                name="partId"
                defaultValue={linea.partId ?? ""}
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Sin identificar</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Proveedor</label>
              <select
                name="supplierId"
                defaultValue={linea.supplierId ?? ""}
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Sin asignar</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Cantidad</label>
              <Input
                name="quantity"
                type="number"
                min={Math.max(1, linea.orderedQuantity + 1)}
                defaultValue={linea.quantity}
                className="mt-1"
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" variant="accent" disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Guardar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditando(false)}
              >
                Cancelar
              </Button>
              {state.error && (
                <span className="text-sm text-destructive">{state.error}</span>
              )}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="align-top hover:bg-secondary/30">
      <td className="px-4 py-3">
        <p>{linea.description}</p>
        {/* La resta, escrita en el renglón el día que se creó. No se recalcula:
            la existencia de entonces ya no es la de hoy, y el documento tiene
            que poder explicarse a sí mismo dentro de un año. */}
        {linea.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground">{linea.notes}</p>
        )}
      </td>

      <td className="px-4 py-3">
        {linea.partId ? (
          <div>
            <span className="font-mono text-xs">{linea.partNumber}</span>
            {linea.stock !== null && (
              <span className="ml-2 text-xs text-muted-foreground">
                {linea.stock} en almacén
              </span>
            )}
          </div>
        ) : (
          <Hueco texto="Sin identificar" />
        )}
      </td>

      <td className="px-4 py-3">
        {linea.supplierId ? (
          <div>
            <p>{linea.supplierName}</p>
            {linea.supplierSuspended ? (
              <Hueco texto="Suspendido: no se le puede comprar" />
            ) : (
              linea.supplierReason && (
                <p className="text-xs text-muted-foreground">
                  {linea.supplierReason}
                </p>
              )
            )}
          </div>
        ) : (
          <Hueco texto="Sin asignar" />
        )}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">{linea.quantity}</td>

      <td className="px-4 py-3 text-right tabular-nums">
        {linea.orderedQuantity > 0 ? (
          <span
            className={
              linea.orderedQuantity >= linea.quantity
                ? "text-success"
                : "text-warning"
            }
          >
            {linea.orderedQuantity}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {editable && (
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditando(true)}
              aria-label="Editar renglón"
            >
              <Pencil className="size-4" />
            </Button>
            {linea.orderedQuantity === 0 && (
              <form action={accionBorrar}>
                <input type="hidden" name="lineId" value={linea.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  disabled={borrando}
                  aria-label="Quitar renglón"
                >
                  {borrando ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </form>
            )}
          </div>
          {borrado.error && (
            <p className="text-xs text-destructive">{borrado.error}</p>
          )}
        </td>
      )}
    </tr>
  );
}

/** Un dato que falta y bloquea la compra. Se dice con palabras, no con vacío. */
function Hueco({ texto }: { texto: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-warning">
      <TriangleAlert className="size-3.5" />
      {texto}
    </span>
  );
}
