import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
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

  /*
    GUARDIA PROPIO, y no heredado del layout.

    Colgaba del layout del área, que hasta ahora exigía `configuracion:
    administrar` para todo. Al abrirse el área a quien administra VIÁTICOS —para
    que General llegue a su pestaña— ese listón dejó de proteger esta pantalla:
    sin esta comprobación, General podría abrirla escribiendo la dirección.

    Es exactamente el hueco que el layout documenta haber corregido en su día
    con agentes y vendedores, reaparecido por el otro lado.
  */
  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const ctx = await requireTenant();
  return <SuscripcionCard estado={ctx.suscripcion} plan={ctx.plan} />;
}
