import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { redirect } from "@/i18n/navigation";
import { getContractById, getSalesReps } from "@/lib/data/contracts";
import { getEquipmentTree } from "@/lib/data/equipment";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { EditContractForm } from "@/components/portal/edit-contract-form";

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect({ href: `/admin/contratos/${id}`, locale });
  }

  const contract = await getContractById(id);
  if (!contract) notFound();

  const [salesReps, tree] = await Promise.all([
    getSalesReps(),
    getEquipmentTree(contract.clientId),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editar contrato</h1>
          <p className="font-mono text-sm text-muted-foreground">{contract.number}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/contratos/${contract.id}`}>← Detalle</Link>
        </Button>
      </div>

      <EditContractForm
        contract={{
          id: contract.id,
          number: contract.number,
          clientLabel:
            contract.client.company ?? contract.client.name ?? contract.client.email,
          salesRepId: contract.salesRepId,
          amountMxn: contract.amountMxn,
          amountUsd: contract.amountUsd,
          startDate: contract.startDate,
          endDate: contract.endDate,
          notes: contract.notes,
          linkedEquipmentIds: contract.equipmentLinks.map((l) => l.equipmentId),
        }}
        salesReps={salesReps}
        equipment={tree.map((eq) => ({
          id: eq.id,
          brand: eq.brand,
          name: eq.name,
          model: eq.model,
        }))}
      />
    </div>
  );
}
