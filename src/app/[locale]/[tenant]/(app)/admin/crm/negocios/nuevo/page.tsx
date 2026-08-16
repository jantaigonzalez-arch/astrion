import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import {
  ensureDefaultPipeline,
  getContactOptions,
  getCrmOwners,
  getOrgOptions,
  getPipelines,
} from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { DealForm } from "@/components/portal/crm/deal-form";

export default async function NewDealPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pipeline?: string; lead?: string; org?: string }>;
}) {
  const { locale } = await params;
  const { pipeline: pipelineParam, lead, org } = await searchParams;
  setRequestLocale(locale);

  await ensureDefaultPipeline();
  const [pipelines, owners, organizations, contacts] = await Promise.all([
    getPipelines(),
    getCrmOwners(),
    getOrgOptions(),
    getContactOptions(),
  ]);
  const active = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/crm">
            <ArrowLeft className="size-4" /> Embudo
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo negocio</h1>
        <p className="text-sm text-muted-foreground">
          Registra la oportunidad en el embudo <strong>{active.name}</strong>.
        </p>
      </div>

      <Card className="p-6">
        <DealForm
          pipelineId={active.id}
          stages={active.stages}
          owners={owners}
          organizations={organizations}
          contacts={contacts}
          locale={locale}
          leadId={lead}
          defaults={org ? { organizationId: org } : undefined}
        />
      </Card>
    </div>
  );
}
