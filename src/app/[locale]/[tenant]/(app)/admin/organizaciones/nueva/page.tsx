import { setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getClientAccounts, getCrmOwners } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { redirectInTenant } from "@/lib/nav-server";
import { puedeEnAlguno } from "@/lib/tenancy/context";
import { OrganizationForm } from "@/components/portal/crm/crm-forms";

export default async function NewOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Ver la ficha y CAMBIARLA no son lo mismo. El layout ya filtró a quien no
  // tiene nada que hacer aquí; esto exige además poder escribir, en cualquiera
  // de las dos puertas.
  if (!(await puedeEnAlguno(["ventas", "clientes"], "editar"))) {
    await redirectInTenant("/admin/organizaciones", locale);
  }

  const [owners, clients] = await Promise.all([getCrmOwners(), getClientAccounts()]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/organizaciones">
            <ArrowLeft className="size-4" /> Organizaciones
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva organización</h1>
        <p className="text-sm text-muted-foreground">
          Da de alta el laboratorio aunque todavía no sea cliente del portal.
        </p>
      </div>

      <Card className="p-6">
        <OrganizationForm owners={owners} clients={clients} />
      </Card>
    </div>
  );
}
