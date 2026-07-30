import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getCrmOwners, getOrgOptions } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ContactForm } from "@/components/portal/crm/crm-forms";

export default async function NewContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { locale } = await params;
  const { org } = await searchParams;
  setRequestLocale(locale);

  const [owners, organizations] = await Promise.all([
    getCrmOwners(),
    getOrgOptions(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/crm/contactos">
            <ArrowLeft className="size-4" /> Contactos
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo contacto</h1>
        <p className="text-sm text-muted-foreground">
          La persona con la que negocias dentro del laboratorio.
        </p>
      </div>

      <Card className="p-6">
        <ContactForm
          owners={owners}
          organizations={organizations}
          defaults={org ? { organizationId: org } : undefined}
        />
      </Card>
    </div>
  );
}
