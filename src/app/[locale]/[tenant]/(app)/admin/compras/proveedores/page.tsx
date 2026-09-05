import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import {
  CAMPOS_ORDEN_PROVEEDORES,
  ORDEN_PROVEEDORES_DEFECTO,
  getSuppliers,
} from "@/lib/data/purchasing";
import { parseOrden } from "@/lib/listado";
import { ThOrden } from "@/components/portal/listado-controles";
import { AddSupplierForm } from "@/components/portal/purchasing/supplier-forms";
import { SupplierRows } from "@/components/portal/purchasing/supplier-rows";
import { Card } from "@/components/ui/card";
import { puedeEn } from "@/lib/tenancy/context";

const BASE = "/admin/compras/proveedores";

export default async function ProveedoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orden?: string; dir?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("compras", "ver"))) {
    await redirectInTenant("/dashboard", locale);
  }
  const admin = await puedeEn("compras", "administrar");

  // El orden viaja en la URL: un padrón ordenado por días de crédito es una
  // vista concreta —«a quién le debemos a más plazo»— y esa vista se comparte.
  const orden = parseOrden(
    await searchParams,
    CAMPOS_ORDEN_PROVEEDORES,
    ORDEN_PROVEEDORES_DEFECTO,
  );
  const rows = await getSuppliers(false, false, orden);

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
                  <ThOrden campo="nombre" actual={orden} basePath={BASE}>
                    Proveedor
                  </ThOrden>
                  <ThOrden campo="rfc" actual={orden} basePath={BASE}>
                    RFC
                  </ThOrden>
                  {/* Contacto no ordena: son tres datos en una celda —nombre,
                      correo y teléfono— y ordenar por «el contacto» no
                      significa nada. Una columna que ordena por algo que no se
                      puede nombrar enseña a desconfiar del resto. */}
                  <th className="px-4 py-3 font-medium">Contacto</th>
                  <ThOrden campo="credito" actual={orden} basePath={BASE} numerica>
                    Crédito
                  </ThOrden>
                  <ThOrden campo="moneda" actual={orden} basePath={BASE}>
                    Moneda
                  </ThOrden>
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
