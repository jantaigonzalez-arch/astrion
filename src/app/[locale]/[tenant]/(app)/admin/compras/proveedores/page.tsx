import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getSuppliers } from "@/lib/data/purchasing";
import { AddSupplierForm } from "@/components/portal/purchasing/supplier-forms";
import { SupplierRows } from "@/components/portal/purchasing/supplier-rows";
import { Card } from "@/components/ui/card";
import { puedeEn } from "@/lib/tenancy/context";

export default async function ProveedoresPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }
  const admin = await puedeEn("compras", "administrar");

  const rows = await getSuppliers();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
            <p className="text-sm text-muted-foreground">
              A quién se le compra. Los días de crédito son los que se van a usar
              después para cuentas por pagar.
            </p>
          </div>
          <AddSupplierForm />
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">Todavía no hay proveedores.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Da de alta al primero para poder levantar una orden de compra.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="tabla-erp w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">RFC</th>
                  <th className="px-4 py-3 font-medium">Contacto</th>
                  <th className="px-4 py-3 font-medium">Crédito</th>
                  <th className="px-4 py-3 font-medium">Moneda</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <SupplierRows suppliers={rows} canDelete={admin} />
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
