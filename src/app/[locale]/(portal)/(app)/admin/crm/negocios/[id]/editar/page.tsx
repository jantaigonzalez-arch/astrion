import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import {
  getContactOptions,
  getCrmOwners,
  getDealById,
  getOrgOptions,
} from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { DealForm } from "@/components/portal/crm/deal-form";

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const deal = await getDealById(id);
  if (!deal) notFound();

  const [owners, organizations, contacts] = await Promise.all([
    getCrmOwners(),
    getOrgOptions(),
    getContactOptions(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/crm/negocios/${deal.id}`}>
            <ArrowLeft className="size-4" /> Volver al negocio
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editar negocio</h1>
        <p className="font-mono text-sm text-muted-foreground">{deal.reference}</p>
      </div>

      <Card className="p-6">
        <DealForm
          pipelineId={deal.pipelineId}
          stages={deal.pipeline.stages}
          owners={owners}
          organizations={organizations}
          contacts={contacts}
          locale={locale}
          defaults={{
            id: deal.id,
            title: deal.title,
            stageId: deal.stageId,
            organizationId: deal.organizationId,
            contactId: deal.contactId,
            ownerId: deal.ownerId,
            valueMxn: deal.valueMxn,
            valueUsd: deal.valueUsd,
            expectedCloseDate: deal.expectedCloseDate,
            source: deal.source,
          }}
        />
      </Card>
    </div>
  );
}
