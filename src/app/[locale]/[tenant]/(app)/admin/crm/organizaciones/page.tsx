import { setRequestLocale } from "next-intl/server";
import { Building2, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { getOrganizations } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { currentRole } from "@/lib/tenancy/context";
import {
  OrganizationsList,
  type OrganizationRow,
} from "@/components/portal/organizations-list";

/**
 * Catálogo completo: clientes y leads juntos.
 *
 * Ya no está en el menú, y es deliberado. El trabajo diario se hace en Clientes
 * o en Leads, que son las dos pantallas enfocadas; ésta queda para lo que
 * necesita ver la cartera ENTERA de una vez —depurar duplicados, buscar algo de
 * lo que solo se recuerda el RFC, reasignar responsables— y es a donde apunta
 * el selector de organización del negocio.
 *
 * También sigue siendo el padre de la ficha (`/[id]`), que es una sola para las
 * dos listas: la organización es una, lo que cambia es desde dónde se la mira.
 */
export default async function OrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = isAdminRole(await currentRole());
  const orgs = await getOrganizations(admin ? undefined : session!.user.id);

  // Se aplana a lo que la lista necesita: el componente es de cliente, así que
  // todo lo que se le pase cruza el límite servidor→cliente serializado. Pasar
  // las entidades completas mandaría de más al navegador.
  //
  // Los conteos ya vienen resueltos de la consulta; antes se calculaban aquí
  // recorriendo los contactos y negocios de cada organización, que era la razón
  // por la que había que traerlos todos.
  const rows: OrganizationRow[] = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    taxId: o.taxId,
    industry: o.industry,
    address: o.address,
    phone: o.phone,
    ownerName: o.ownerName,
    kind: o.kind,
    hasPortal: o.hasPortal,
    contacts: o.contacts,
    openDeals: o.openDeals,
    openValue: o.openValue,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Todas las organizaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} en total — clientes y leads juntos. Para el trabajo
            diario están{" "}
            <Link href="/admin/clientes" className="text-primary hover:underline">
              Clientes
            </Link>{" "}
            y{" "}
            <Link href="/admin/crm/leads" className="text-primary hover:underline">
              Leads
            </Link>
            .
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
