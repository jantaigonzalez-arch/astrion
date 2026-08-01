import { setRequestLocale } from "next-intl/server";
import { Building2, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { getOrganizations } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  OrganizationsList,
  type OrganizationRow,
} from "@/components/portal/organizations-list";

export default async function OrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = isAdminRole(session?.user.role);
  const orgs = await getOrganizations(admin ? undefined : session!.user.id);

  // Se aplana a lo que la lista necesita: el componente es de cliente, así que
  // todo lo que se le pase cruza el límite servidor→cliente serializado. Pasar
  // las entidades completas mandaría de más al navegador.
  const rows: OrganizationRow[] = orgs.map((o) => {
    const open = o.deals.filter((d) => d.status === "open");
    return {
      id: o.id,
      name: o.name,
      taxId: o.taxId,
      industry: o.industry,
      address: o.address,
      phone: o.phone,
      ownerName: o.owner?.name ?? o.owner?.email ?? null,
      isClient: Boolean(o.client),
      contacts: o.contacts.length,
      openDeals: open.length,
      openValue: open.reduce((a, d) => a + Number(d.valueMxn ?? 0), 0),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizaciones</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} laboratorio(s) y empresa(s) en tu cartera.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link href="/admin/crm/organizaciones/nueva">
            <Plus className="size-4" /> Nueva organización
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Building2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay organizaciones registradas.
          </p>
        </Card>
      ) : (
        <OrganizationsList orgs={rows} locale={locale} />
      )}
    </div>
  );
}
