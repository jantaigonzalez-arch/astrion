import { setRequestLocale } from "next-intl/server";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { SettingsTabs } from "@/components/portal/settings-tabs";
import { currentRole } from "@/lib/tenancy/context";

/**
 * Área de configuración de la empresa.
 *
 * Reúne lo que antes estaba repartido entre "Administración" y las pestañas
 * del CRM. El criterio para que algo viva aquí no es quién lo usa sino cada
 * cuánto: son pantallas que se tocan al montar la empresa y luego cada varios
 * meses. Mezclarlas con el trabajo diario hacía que la barra tuviera veinte
 * renglones y que la respuesta a "¿dónde cambio las tarifas?" fuera "en
 * Administración, abajo del todo, después de Leads".
 *
 * El guard es del ÁREA y no de cada pantalla, y eso corrige un hueco real:
 * `usuarios`, `catálogo` y `plantillas` no tenían guard propio. Colgaban del
 * layout de `/admin`, que deja pasar a agentes y vendedores, así que un agente
 * podía abrir la lista de usuarios por URL y editar roles. La barra le ocultaba
 * el enlace; la ruta estaba abierta.
 */
export default async function ConfiguracionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/dashboard", locale);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Cómo se ve tu empresa, quién entra y con qué reglas trabaja.
        </p>
      </div>
      <SettingsTabs />
      {children}
    </div>
  );
}
