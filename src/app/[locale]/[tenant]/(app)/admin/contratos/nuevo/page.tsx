import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { requireTenant, puedeEn } from "@/lib/tenancy/context";
import { getClientsWithEquipment } from "@/lib/data/equipment";
import { getSalesReps } from "@/lib/data/contracts";
import { getDealById } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { ContractForm, type ContractDefaults } from "@/components/portal/contract-form";

export default async function NewContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ deal?: string }>;
}) {
  const { locale } = await params;
  const { deal: dealParam } = await searchParams;
  setRequestLocale(locale);

  // `administrar` y no `editar`: dar de alta un contrato era de administración
  // antes de este modelo, y es lo que sigue exigiendo `createContract`. Con
  // `editar`, un vendedor abría el formulario y el guardado lo rechazaba — una
  // pantalla que promete algo que no puede cumplir.
  if (!(await puedeEn("clientes", "administrar"))) {
    await redirectInTenant("/admin/contratos", locale);
  }

  const [raw, salesReps] = await Promise.all([
    getClientsWithEquipment(),
    getSalesReps(),
  ]);

  const { folioPrefix } = await requireTenant();

  // Si viene de un negocio ganado del CRM, se prellena el formulario.
  let defaults: ContractDefaults | undefined;
  if (dealParam) {
    const deal = await getDealById(dealParam);
    if (deal && deal.status === "won") {
      const year = new Date().getFullYear();
      // Sugerencia de folio a partir del del negocio: EVO-D-000004 → EVO-C-2026-000004.
      // El número se recorta por posición y no quitando un prefijo literal:
      // recortar "EVO-D-" dejaba el folio de ACME entero (ACM-D-000004) y
      // producía "ACM-C-2026-ACM-D-000004".
      const consecutivo = deal.reference.split("-").pop() ?? deal.reference;
      defaults = {
        dealId: deal.id,
        dealTitle: deal.title,
        number: `${folioPrefix}-C-${year}-${consecutivo}`,
        clientId: deal.organization?.clientId ?? undefined,
        salesRepId: deal.ownerId,
        amountMxn: deal.valueMxn,
        amountUsd: deal.valueUsd,
        notes: `Contrato generado desde el negocio ${deal.reference} — ${deal.title}.`,
      };
    }
  }

  const clients = raw.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company,
    equipment: c.equipment.map((eq) => ({
      id: eq.id,
      brand: eq.brand,
      name: eq.name,
      model: eq.model,
    })),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo contrato</h1>
          <p className="text-sm text-muted-foreground">
            Asocia el contrato a un laboratorio, su vendedor y los equipos que ampara.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/contratos">← Contratos</Link>
        </Button>
      </div>
      <Card className="p-6 sm:p-8">
        <ContractForm
          folioPrefix={folioPrefix}
          clients={clients}
          salesReps={salesReps}
          defaults={defaults}
        />
      </Card>
    </div>
  );
}
