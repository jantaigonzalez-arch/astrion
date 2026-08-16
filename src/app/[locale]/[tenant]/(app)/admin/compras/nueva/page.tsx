import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { isSupport } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getSuppliers } from "@/lib/data/purchasing";
import { getSpareParts } from "@/lib/data/parts";
import { OrderBuilder } from "@/components/portal/purchasing/order-builder";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";

export default async function NuevaOrdenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isSupport(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const [suppliers, parts] = await Promise.all([
    getSuppliers(true, true),
    getSpareParts(true),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/compras"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Órdenes de compra
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Nueva orden de compra
        </h1>
        <p className="text-sm text-muted-foreground">
          Solo se pueden pedir refacciones del catálogo: así, cuando llegue la
          mercancía, entra directo al inventario sin capturar nada dos veces.
        </p>
      </div>

      <OrderBuilder
        suppliers={suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          currency: s.currency,
        }))}
        parts={parts.map((p) => ({
          id: p.id,
          partNumber: p.partNumber,
          description: p.description,
          stock: p.stock,
          costMxn: p.costMxn,
          costUsd: p.costUsd,
        }))}
      />
    </div>
  );
}
