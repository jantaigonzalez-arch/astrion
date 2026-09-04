import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getSettings } from "@/lib/data/settings";
import { getTenantBrand } from "@/lib/data/platform";
import { SettingsForm } from "@/components/portal/settings-form";
import { BrandForm } from "@/components/portal/brand-form";
import { CurrencyForm } from "@/components/portal/currency-form";
import { CorreoForm } from "@/components/portal/correo-form";
import { getCorreoDeLaEmpresa } from "@/lib/data/correo";
import { SuscripcionCard } from "@/components/portal/suscripcion-card";
import { requireTenant } from "@/lib/tenancy/context";
import { puedeEn } from "@/lib/tenancy/context";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [s, brand, correo, ctx] = await Promise.all([
    getSettings(),
    getTenantBrand(tenant),
    getCorreoDeLaEmpresa(),
    requireTenant(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {brand && <BrandForm brand={brand} folioPrefix={brand.folioPrefix ?? ""} />}

      {/* Debajo de la marca y antes del resto: es de la cuenta, no de la
          operación. Va aquí y en ningún otro sitio — ver `SuscripcionCard`. */}
      <SuscripcionCard estado={ctx.suscripcion} plan={ctx.plan} />

      <CorreoForm {...correo} />

      <SettingsForm
        laborCostPerHour={s.laborCostPerHour}
        laborRatePerHour={s.laborRatePerHour}
      />

      <CurrencyForm usdRate={s.usdRate} />
    </div>
  );
}
