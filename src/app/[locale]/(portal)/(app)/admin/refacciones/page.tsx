import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { isSupport } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { getSpareParts } from "@/lib/data/parts";
import { AddPartForm } from "@/components/portal/part-forms";
import { PartsInventory } from "@/components/portal/parts-inventory";

export default async function SparePartsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!isSupport(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }

  const parts = await getSpareParts();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Inventario de refacciones
          </h1>
          <p className="text-sm text-muted-foreground">
            Busca por número de parte, descripción o marca.
          </p>
        </div>
        <AddPartForm />
      </div>

      <PartsInventory
        parts={parts.map((p) => ({
          id: p.id,
          partNumber: p.partNumber,
          description: p.description,
          brand: p.brand,
          costMxn: p.costMxn,
          costUsd: p.costUsd,
          priceMxn: p.priceMxn,
          priceUsd: p.priceUsd,
          stock: p.stock,
          active: p.active,
        }))}
      />
    </div>
  );
}
