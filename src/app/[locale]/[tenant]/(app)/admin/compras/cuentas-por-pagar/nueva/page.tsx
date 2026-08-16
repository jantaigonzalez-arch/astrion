import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getSuppliers } from "@/lib/data/purchasing";
import { getInvoiceableOrders } from "@/lib/data/payables";
import { InvoiceForm } from "@/components/portal/purchasing/invoice-form";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";

export default async function NuevaFacturaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/admin/compras", locale);
  }

  // Las órdenes de TODOS los proveedores en una sola consulta: el formulario
  // filtra al elegir. Son pocas —solo las recibidas sin facturar— y traerlas
  // juntas evita recargar la página a mitad de la captura.
  const [suppliers, orders] = await Promise.all([
    getSuppliers(true),
    getInvoiceableOrders(),
  ]);

  // La fecha la pone el servidor: el navegador puede estar en otra zona y la
  // emisión es un día del calendario, no un instante.
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/compras/cuentas-por-pagar"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Cuentas por pagar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Capturar factura de proveedor
        </h1>
        <p className="text-sm text-muted-foreground">
          Es la factura la que crea la deuda, no la orden: aquí quedan el folio
          fiscal, el importe real y el vencimiento.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No hay proveedores activos.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Da de alta al menos uno antes de capturar una factura:{" "}
            <Link href="/admin/compras/proveedores" className="text-primary hover:underline">
              ir a Proveedores
            </Link>
            .
          </p>
        </Card>
      ) : (
        <InvoiceForm
          suppliers={suppliers.map((s) => ({
            id: s.id,
            name: s.name,
            paymentTermsDays: s.paymentTermsDays,
            currency: s.currency,
          }))}
          orders={orders.map((o) => ({
            id: o.id,
            supplierId: o.supplierId,
            reference: o.reference,
            status: o.status,
            currency: o.currency,
            total: o.total,
          }))}
          hoy={hoy}
        />
      )}
    </div>
  );
}
