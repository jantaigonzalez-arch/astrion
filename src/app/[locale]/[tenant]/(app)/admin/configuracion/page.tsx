import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { getTenantBrand } from "@/lib/data/platform";
import { BrandForm } from "@/components/portal/brand-form";
import { DocumentoForm } from "@/components/portal/documento-form";
import { CorreoForm } from "@/components/portal/correo-form";
import { getCorreoDeLaEmpresa } from "@/lib/data/correo";
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

  const [brand, correo] = await Promise.all([
    getTenantBrand(tenant),
    getCorreoDeLaEmpresa(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {brand && <BrandForm brand={brand} folioPrefix={brand.folioPrefix ?? ""} />}

      {/*
        Justo debajo de Marca, y no al final de la pantalla.

        Son la misma pregunta en dos soportes —cómo se ve la empresa— y quien
        acaba de subir el logo de la barra lateral es exactamente quien tiene
        que enterarse de que el del documento es otro. Enterrarlo bajo las
        tarifas garantizaba que nadie lo encontrara hasta imprimir el primer
        reporte con la marca equivocada.
      */}
      {brand && <DocumentoForm membrete={{ ...brand, name: brand.name }} />}

      <CorreoForm {...correo} />

      {/*
        Las tarifas de mano de obra ya no están aquí: tienen su pestaña,
        Configuración → Servicio, y la manda quien administra el servicio.
      */}
    </div>
  );
}
