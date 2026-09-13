import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getSettings } from "@/lib/data/settings";
import { getUsosPara } from "@/lib/data/sat";
import { puedeEn } from "@/lib/tenancy/context";
import { ClientesConfigCard } from "@/components/portal/clientes/config-clientes";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN DE CLIENTES (0038).
 *
 * Lo que decide la empresa sobre sus clientes: el SLA general, el uso de CFDI
 * con que nace un expediente, qué cuenta como cliente y qué hacer con la lista
 * 69-B. La manda `clientes: administrar` —ver `RUTAS` en `lib/permisos.ts`—, y
 * la pantalla lleva su guardia propio además del del área, como Viáticos y
 * Servicio.
 */
export default async function ConfigClientesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("clientes", "administrar"))) {
    await redirectInTenant("/dashboard", locale);
  }

  const [s, usos] = await Promise.all([getSettings(), getUsosPara(null)]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ClientesConfigCard
        politica={{
          slaHoras: s.clientesSlaHoras,
          usoCfdi: s.clientesUsoCfdiOmision,
          pruebas: s.clientesPruebas,
          lista69b: s.clientes69b,
        }}
        usos={usos.map((u) => ({ clave: u.clave, descripcion: u.descripcion }))}
      />
    </div>
  );
}
