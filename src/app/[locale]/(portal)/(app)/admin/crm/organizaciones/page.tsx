import { setRequestLocale } from "next-intl/server";
import { Building2, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { getOrganizations } from "@/lib/data/crm";
import { money } from "@/lib/crm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizaciones</h1>
          <p className="text-sm text-muted-foreground">
            {orgs.length} laboratorio(s) y empresa(s) en tu cartera.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link href="/admin/crm/organizaciones/nueva">
            <Plus className="size-4" /> Nueva organización
          </Link>
        </Button>
      </div>

      {orgs.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Building2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay organizaciones registradas.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {orgs.map((o) => {
            const open = o.deals.filter((d) => d.status === "open");
            const total = open.reduce((a, d) => a + Number(d.valueMxn ?? 0), 0);
            return (
              <Card
                key={o.id}
                className="p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/crm/organizaciones/${o.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {o.name}
                    </Link>
                    {o.industry && (
                      <p className="text-xs text-muted-foreground">{o.industry}</p>
                    )}
                  </div>
                  {o.client && (
                    <Badge className="bg-success/15 text-success ring-success/25">
                      Cliente
                    </Badge>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>{o.contacts.length} contacto(s)</span>
                  <span>{open.length} negocio(s) abierto(s)</span>
                  <span className="font-mono">{money(String(total), "MXN", locale)}</span>
                </div>

                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  Responsable: {o.owner?.name ?? o.owner?.email ?? "Sin asignar"}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
