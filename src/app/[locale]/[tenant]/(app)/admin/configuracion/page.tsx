import { setRequestLocale } from "next-intl/server";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { getSettings } from "@/lib/data/settings";
import { getTenantBrand } from "@/lib/data/platform";
import { SettingsForm } from "@/components/portal/settings-form";
import { BrandForm } from "@/components/portal/brand-form";
import { CurrencyForm } from "@/components/portal/currency-form";
import { CorreoForm } from "@/components/portal/correo-form";
import { getCorreoDeLaEmpresa } from "@/lib/data/correo";
import { currentRole } from "@/lib/tenancy/context";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  const [s, brand, correo] = await Promise.all([
    getSettings(),
    getTenantBrand(tenant),
    getCorreoDeLaEmpresa(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {brand && <BrandForm brand={brand} folioPrefix={brand.folioPrefix ?? ""} />}

      <CorreoForm {...correo} />

      <SettingsForm
        laborCostPerHour={s.laborCostPerHour}
        laborRatePerHour={s.laborRatePerHour}
      />

      <CurrencyForm usdRate={s.usdRate} />
    </div>
  );
}
