import { Boxes } from "lucide-react";
import {
  getNecesidadDePedido,
  getRequisitionsForDeal,
} from "@/lib/data/requisitions";
import { RequisitionStatusBadge } from "@/components/portal/purchasing/requisition-badge";
import { RequisitionForm } from "@/components/portal/crm/requisition-form";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import type { RequisitionStatus } from "@/lib/db/schema";

/**
 * Surtido del pedido: la resta, a la vista, antes de comprar nada.
 *
 * Este panel es el módulo entero en una tabla. Lo que se enseña NO es «hay que
 * comprar 4»: son los cuatro sumandos —pedido, existencia, en camino, en
 * trámite— y luego el 4. La diferencia entre las dos cosas es que la primera
 * hay que creérsela y la segunda se puede verificar; y quien no puede verificar
 * el número acaba pidiendo de más «por si acaso», que es justo el gasto que
 * este módulo viene a evitar.
 *
 * «Viene» y «En trámite» parecen lo mismo y no lo son, y por eso son dos
 * columnas: viene es una orden ENVIADA, el proveedor ya la tiene; en trámite es
 * lo que está dentro de casa —una requisición viva o una orden en borrador— y
 * todavía no ha salido. Las dos cubren, pero solo una tiene fecha de llegada.
 *
 * Vive en el detalle del negocio y no en compras a propósito: el momento en que
 * alguien se pregunta si hay que comprar algo es cuando está mirando el pedido.
 */
export async function DealSupplyPanel({
  dealId,
  puedeRequisitar,
}: {
  dealId: string;
  /**
   * Si no, la tabla se enseña igual pero sin el botón.
   *
   * El vendedor tiene que poder ver por qué su pedido no se ha comprado —para
   * eso está la resta— sin poder levantar la requisición él. Esconderle la
   * tabla entera lo dejaría preguntando por chat lo que la pantalla ya sabe;
   * enseñarle un botón que el servidor va a rechazar sería peor.
   */
  puedeRequisitar: boolean;
}) {
  const [necesidad, previas] = await Promise.all([
    getNecesidadDePedido(dealId),
    getRequisitionsForDeal(dealId),
  ]);

  if (necesidad.length === 0) return null;

  const faltantes = necesidad.filter((n) => n.falta > 0);
  const cubierto = necesidad.reduce(
    (a, n) => a + n.existencia + n.enCamino + n.enTramite,
    0,
  );

  return (
    <Card className="p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Boxes className="size-4" /> Surtido y compras
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Concepto</th>
              <th className="px-3 py-2 text-right font-medium">Pide</th>
              <th className="px-3 py-2 text-right font-medium">Hay</th>
              <th className="px-3 py-2 text-right font-medium">Viene</th>
              <th className="px-3 py-2 text-right font-medium">En trámite</th>
              <th className="py-2 pl-3 text-right font-medium">Falta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {necesidad.map((n) => (
              <tr key={n.dealProductId ?? n.description}>
                <td className="py-2 pr-3">
                  <p className="truncate">{n.description}</p>
                  {!n.partId && (
                    <p className="text-xs text-warning">
                      Sin refacción del catálogo: se pide entera.
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n.pedido}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {n.existencia || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {n.enCamino || "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {n.enTramite || "—"}
                </td>
                <td className="py-2 pl-3 text-right font-medium tabular-nums">
                  {n.falta > 0 ? (
                    n.falta
                  ) : (
                    <span className="text-success">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* El ahorro, dicho en voz alta. Es el número que justifica que exista el
          paso intermedio: sin él, todo esto parece burocracia. */}
      {cubierto > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {cubierto} {cubierto === 1 ? "pieza ya está" : "piezas ya están"}{" "}
          cubiertas por el almacén, por lo que viene en camino o por lo que ya
          está en trámite. No se vuelven a comprar.
        </p>
      )}

      <div className="mt-5">
        {faltantes.length === 0 ? (
          <p className="text-sm text-success">
            No hace falta comprar nada: el pedido se surte con lo que hay y lo
            que ya viene.
          </p>
        ) : puedeRequisitar ? (
          <RequisitionForm dealId={dealId} faltantes={faltantes.length} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Faltan {faltantes.length}{" "}
            {faltantes.length === 1 ? "renglón" : "renglones"} por requisitar.
            Lo levanta compras.
          </p>
        )}
      </div>

      {previas.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Requisiciones de este pedido
          </p>
          <ul className="space-y-1.5">
            {previas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={`/admin/compras/requisiciones/${r.id}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {r.reference}
                </Link>
                <RequisitionStatusBadge status={r.status as RequisitionStatus} />
                {r.pending > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {r.pending} por comprar
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
