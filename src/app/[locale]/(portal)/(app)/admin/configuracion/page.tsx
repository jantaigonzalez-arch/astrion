import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { getSettings } from "@/lib/data/settings";
import { SettingsForm } from "@/components/portal/settings-form";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect({ href: "/dashboard", locale });
  }

  const s = await getSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Tarifas de mano de obra usadas para calcular la utilidad de los servicios.
        </p>
      </div>
      <SettingsForm
        laborCostPerHour={s.laborCostPerHour}
        laborRatePerHour={s.laborRatePerHour}
      />
    </div>
  );
}
