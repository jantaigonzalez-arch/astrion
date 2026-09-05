import { setRequestLocale } from "next-intl/server";
import { Plane } from "lucide-react";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEn } from "@/lib/tenancy/context";
import { contratosParaViatico, modulosPorContrato } from "@/lib/data/viaticos";
import { Card } from "@/components/ui/card";
import {
  NuevoViaticoForm,
  type ContratoOpcion,
} from "@/components/portal/viaticos/nuevo-viatico-form";

export const dynamic = "force-dynamic";

export default async function NuevoViaticoPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!(await puedeEn("viaticos", "editar"))) {
    await redirectInTenant("/admin/viaticos", locale);
  }

  const contratos = await contratosParaViatico();
  /*
    Los módulos de TODOS los contratos, en UNA consulta.

    El formulario los necesita cargados para llenar el segundo campo sin ir a la
    red cada vez que se cambia el primero. Esto se hacía con un `Promise.all`
    que llamaba a `modulosDelContrato` por contrato: 55 consultas para pintar la
    pantalla, y una más por cada contrato que se firme.

    Medido: 55 → 2 consultas y 29,6 → 6,5 ms. Ver `modulosPorContrato`.
  */
  const porContrato = await modulosPorContrato(contratos.map((c) => c.id));
  const conModulos: ContratoOpcion[] = contratos.map((c) => ({
    id: c.id,
    number: c.number,
    cliente: c.cliente,
    domicilio: c.domicilio,
    modulos: porContrato.get(c.id) ?? [],
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Plane className="size-5 text-primary" />
          Pedir viáticos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo autoriza quien administra el gasto. Al volver, aquí mismo cargas
          tus comprobantes.
        </p>
      </div>

      <Card className="p-5">
        {contratos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay contratos de servicio capturados. Un viático se carga siempre
            a un contrato.
          </p>
        ) : (
          <NuevoViaticoForm contratos={conModulos} />
        )}
      </Card>
    </div>
  );
}
