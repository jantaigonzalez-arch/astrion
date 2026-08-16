"use client";

import { Fragment, useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DeleteSupplierButton,
  SupplierEditForm,
  type EditableSupplier,
} from "@/components/portal/purchasing/supplier-forms";
import { Link } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Las filas de la tabla de proveedores, con su edición desplegable.
 *
 * El formulario se abre como una fila a todo lo ancho y no dentro de la celda
 * de acciones: son diez campos en tres columnas, y encajarlos en la última
 * columna de una tabla los dejaba en una tira ilegible que además ensanchaba
 * todo lo demás.
 *
 * Solo una fila abierta a la vez. Con varias, guardar en una y que las otras
 * conserven cambios sin guardar es la forma de perder trabajo sin enterarse.
 */
export function SupplierRows({
  suppliers,
  canDelete,
}: {
  suppliers: EditableSupplier[];
  canDelete: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <tbody className="divide-y divide-border">
      {suppliers.map((s) => (
        <Fragment key={s.id}>
          <tr className={cn("hover:bg-secondary/30", openId === s.id && "bg-secondary/40")}>
            <td className="px-4 py-3">
              {/* El nombre lleva a su estado de cuenta: es la pantalla que
                  contesta la pregunta de antes de comprarle. */}
              <Link
                href={`/admin/compras/proveedores/${s.id}`}
                className={cn(
                  "hover:underline",
                  s.active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {s.name}
              </Link>
              {!s.active && (
                <Badge className="ml-2 bg-secondary text-muted-foreground ring-border">
                  Inactivo
                </Badge>
              )}
              {s.suspendedAt && (
                // Suspendido e inactivo pueden coincidir, y son cosas distintas:
                // una es temporal con causa, la otra es la baja.
                <Badge className="ml-2 bg-destructive/15 text-destructive ring-destructive/25">
                  Compras suspendidas
                </Badge>
              )}
            </td>
            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
              {s.rfc ?? "—"}
            </td>
            <td className="px-4 py-3 text-muted-foreground">
              {s.contactName ?? s.email ?? s.phone ?? "—"}
            </td>
            <td className="px-4 py-3 tabular-nums">
              {s.paymentTermsDays > 0 ? `${s.paymentTermsDays} días` : "Contado"}
            </td>
            <td className="px-4 py-3">{s.currency}</td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  aria-label={`Editar ${s.name}`}
                  aria-expanded={openId === s.id}
                  className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-primary"
                >
                  <Pencil className="size-4" />
                </button>
                {/* La baja es del administrador; corregir los datos, de
                    cualquiera que compre. Reactivar va dentro del formulario:
                    es lo único que deshace una baja. */}
                {canDelete && s.active && (
                  <DeleteSupplierButton supplierId={s.id} name={s.name} />
                )}
              </div>
            </td>
          </tr>

          {openId === s.id && (
            <tr className="bg-secondary/20">
              <td colSpan={6} className="px-4 pb-4">
                <SupplierEditForm supplier={s} onDone={() => setOpenId(null)} />
              </td>
            </tr>
          )}
        </Fragment>
      ))}
    </tbody>
  );
}
