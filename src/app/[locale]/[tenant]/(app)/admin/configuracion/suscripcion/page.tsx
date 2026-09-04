import { setRequestLocale } from "next-intl/server";
import { requireTenant } from "@/lib/tenancy/context";
import { SuscripcionCard } from "@/components/portal/suscripcion-card";

/**
 * La pestaña de suscripción.
 *
 * Sin guardia propio: el layout de `/admin/configuracion` ya exige administrar
 * ese módulo, y repetirlo aquí sería una segunda lista que mantener al día.
 */
export default async function SuscripcionSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireTenant();
  return <SuscripcionCard estado={ctx.suscripcion} plan={ctx.plan} />;
}
