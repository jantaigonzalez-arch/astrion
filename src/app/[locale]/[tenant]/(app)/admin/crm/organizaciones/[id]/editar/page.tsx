import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import {
  getClientAccounts,
  getCrmOwners,
  getOrganizationById,
} from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { OrganizationForm } from "@/components/portal/crm/crm-forms";

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const org = await getOrganizationById(id);
  if (!org) notFound();

  const [owners, clients] = await Promise.all([
    getCrmOwners(),
    getClientAccounts(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/crm/organizaciones/${org.id}`}>
            <ArrowLeft className="size-4" /> Volver a la organización
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Editar organización
        </h1>
        <p className="text-sm text-muted-foreground">
          Enlaza la <strong>cuenta de portal</strong> para ver aquí sus
          contratos, equipos y tickets.
        </p>
      </div>

      <Card className="p-6">
        <OrganizationForm
          owners={owners}
          clients={clients}
          defaults={{
            id: org.id,
            name: org.name,
            industry: org.industry,
            website: org.website,
            phone: org.phone,
            address: org.address,
            ownerId: org.ownerId,
            clientId: org.clientId,
            notes: org.notes,
          }}
        />
      </Card>
    </div>
  );
}
