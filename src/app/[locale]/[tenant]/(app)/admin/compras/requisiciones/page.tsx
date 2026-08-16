import { setRequestLocale } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { isSupport } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getRequisitions } from "@/lib/data/requisitions";
import { RequisitionStatusBadge } from "@/components/portal/purchasing/requisition-badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import type { RequisitionStatus } from "@/lib/db/schema";
import { currentRole } from "@/lib/tenancy/context";

export default async function RequisicionesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isSupport(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const rows = await getRequisitions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requisiciones</h1>
        <p className="text-sm text-muted-foreground">
          Lo que hace falta comprar, ya descontado lo que hay en almacén y lo que
          viene en camino. De aquí salen las órdenes.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay requisiciones.</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
            Se levantan desde un pedido: en el detalle del negocio, «Generar
            requisición» compara lo que pidió el cliente contra la existencia y
            lo que ya está pedido a proveedor, y deja solo lo que falta.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Folio</th>
                  <th className="px-4 py-3 font-medium">Concepto</th>
                  <th className="px-4 py-3 font-medium">Pedido</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Renglones</th>
                  <th className="px-4 py-3 text-right font-medium">Por comprar</th>
                  <th className="px-4 py-3 font-medium">Se necesita</th>
                  <th className="px-4 py-3 font-medium">Pidió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/compras/requisiciones/${r.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {r.reference}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3">
                      {r.dealId && r.dealReference ? (
                        <Link
                          href={`/admin/crm/negocios/${r.dealId}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {r.dealReference}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Reposición
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RequisitionStatusBadge
                          status={r.status as RequisitionStatus}
                        />
                        {/* Un renglón sin identificar es lo que deja la
                            requisición atorada sin que nadie se entere: no falla
                            nada, simplemente nunca acaba de convertirse. */}
                        {r.unresolved > 0 && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-warning"
                            title={`${r.unresolved} sin refacción del catálogo`}
                          >
                            <AlertTriangle className="size-3.5" />
                            {r.unresolved}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.lines}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.pending > 0 ? (
                        r.pending
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.neededBy ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.requestedBy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
