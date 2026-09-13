import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getSettings } from "@/lib/data/settings";
import { puedeEn } from "@/lib/tenancy/context";
import { SettingsForm } from "@/components/portal/settings-form";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN DE SERVICIO: las tarifas de mano de obra.
 *
 * ── APARTE DE «MARCA», Y LA MANDA `servicio: administrar` ─────────────────
 *
 * Vivían en «Marca y tarifas», revueltas con el logo, el membrete y el correo.
 * Pero cuánto le cuesta a la empresa una hora de técnico y cuánto se le cobra
 * al cliente no es cómo se ve la empresa: es la regla con la que se calcula la
 * utilidad de cada ticket (`lib/profit.ts`), y la decide quien administra el
 * servicio. Es el mismo caso que la pestaña de Viáticos, que manda
 * `viaticos: administrar` —ver `RUTAS` en `lib/permisos.ts`— y por eso la
 * pantalla lleva su guardia propio además del del área.
 */
export default async function ConfigServicioPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("servicio", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const s = await getSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <SettingsForm laborCostPerHour={s.laborCostPerHour} laborRatePerHour={s.laborRatePerHour} />
    </div>
  );
}
