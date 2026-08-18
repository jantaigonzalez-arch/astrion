import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { isSupport } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getPurchaseOrders } from "@/lib/data/purchasing";
import { PurchaseStatusBadge } from "@/components/portal/purchasing/status-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import type { PurchaseOrderStatus } from "@/lib/db/schema";
import { currentRole } from "@/lib/tenancy/context";
import {
  AnalysisSection,
  AnalysisSectionSkeleton,
} from "@/components/portal/analysis-section";

export default async function ComprasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isSupport(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const orders = await getPurchaseOrders();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Órdenes de compra
          </h1>
          <p className="text-sm text-muted-foreground">
            Lo que se pide a proveedor. Lo que se recibe entra al inventario.
          </p>
        </div>
        {/* Proveedores salió de aquí: ahora es su propio renglón del menú, al
            lado de este. Un botón que lleva a otra sección hacía parecer que
            los proveedores vivían dentro de las órdenes. */}
        <Button asChild variant="accent">
          <Link href="/admin/compras/nueva">
            <Plus className="size-4" /> Nueva orden
          </Link>
        </Button>
      </div>

      {orders.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay órdenes de compra.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando registres una y la recibas, las piezas van a entrar solas al
            inventario y el historial de costos empieza a construirse.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Folio</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Piezas</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Se espera</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/compras/${o.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {o.reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{o.supplierName}</td>
                    <td className="px-4 py-3">
                      <PurchaseStatusBadge status={o.status as PurchaseOrderStatus} />
                    </td>
                    {/* Recibido sobre pedido: es el dato que dice si la orden
                        sigue viva, y leerlo de un vistazo evita abrirla. */}
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span
                        className={
                          o.received < o.units ? "text-foreground" : "text-muted-foreground"
                        }
                      >
                        {o.received}
                      </span>
                      <span className="text-muted-foreground"> / {o.units}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(o.total, o.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {o.expectedAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* Debajo de las órdenes, que es lo que se viene a atender.

          En `Suspense` para que la pantalla se pinte sin esperarlo: el análisis
          llega por streaming después. Un pronóstico no puede retrasar el trabajo
          que la gente vino a hacer. */}
      <Suspense fallback={<AnalysisSectionSkeleton />}>
        <AnalysisSection route="/admin/compras" />
      </Suspense>

    </div>
  );
}

function money(n: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
