import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { redirectInTenant } from "@/lib/nav-server";
import { currentRole } from "@/lib/tenancy/context";
import { PLANTILLA_ABONOS, PLANTILLA_CARGOS } from "@/lib/import/payables-csv";
import { ImportPayables } from "@/components/portal/purchasing/import-payables";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";

export default async function ImportarCuentasPorPagarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/admin/compras", locale);
  }

  // Las plantillas van como data URI y no como archivos en `public/`: son dos
  // líneas de texto que se generan del mismo módulo que define las columnas
  // aceptadas, así que no pueden quedarse desfasadas de lo que el lector espera.
  const plantillas = {
    charges_csv: dataUri(PLANTILLA_CARGOS),
    credits_csv: dataUri(PLANTILLA_ABONOS),
    charges_cfdi: "",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Importar cargos y abonos
          </h1>
          <p className="text-sm text-muted-foreground">
            Carga masiva de facturas, pagos y notas de crédito.
          </p>
        </div>
        <Button asChild variant="ghost">
          <Link href="/admin/compras/cuentas-por-pagar">
            <ArrowLeft className="size-4" /> Volver
          </Link>
        </Button>
      </div>

      <ImportPayables plantillas={plantillas} />

      <Card className="p-5">
        <h2 className="mb-2 font-semibold">Lo que conviene saber antes</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">El proveedor tiene que existir.</strong>{" "}
            Se busca por RFC y, si no, por nombre. Nunca se da de alta solo: un
            proveedor nacido de un error de dedo ensucia el estado de cuenta y
            cuesta mucho más limpiarlo que corregir la fila.
          </li>
          <li>
            <strong className="text-foreground">Una factura no entra dos veces.</strong>{" "}
            Si el CFDI ya está capturado, la fila se rechaza diciendo en qué
            folio está. Puedes reimportar el mismo archivo sin miedo a duplicar
            la deuda.
          </li>
          <li>
            <strong className="text-foreground">
              Un pago y una nota de crédito no son lo mismo.
            </strong>{" "}
            Los dos bajan la deuda, pero solo el pago sacó dinero. La columna{" "}
            <code className="rounded bg-secondary px-1 text-xs">tipo</code> del
            archivo de abonos decide cuál es, y de eso depende que el reporte de
            salidas de caja diga la verdad.
          </li>
          <li>
            <strong className="text-foreground">Sin vencimiento, se calcula.</strong>{" "}
            Si la fila no trae fecha de vencimiento, sale de los días de crédito
            pactados con ese proveedor.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function dataUri(csv: string): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}
