import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { CreateUserForm } from "@/components/portal/create-user-form";
import { puedeEn } from "@/lib/tenancy/context";
import { parseFiltro } from "@/lib/listado";
import { ASSIGNABLE_ROLES, grupoDeRol } from "@/lib/roles";

export default async function NewUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ rol?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Solo administradores dan de alta cuentas.
  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/admin/tickets", locale);
  }
  // El rol con el que abre el formulario: el del padrón desde el que se pulsó
  // «Nuevo». Solo preselecciona; se puede cambiar, y el servidor valida igual.
  const rolInicial = parseFiltro((await searchParams).rol, ASSIGNABLE_ROLES);
  const volver =
    rolInicial && grupoDeRol(rolInicial) === "clientes"
      ? "/admin/configuracion/usuarios?grupo=clientes"
      : "/admin/configuracion/usuarios";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva cuenta</h1>
          <p className="text-sm text-muted-foreground">
            Registra a un laboratorio o miembro del equipo. El acceso es por invitación.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={volver}>← Volver</Link>
        </Button>
      </div>
      <Card className="p-6 sm:p-8">
        <CreateUserForm rolInicial={rolInicial} />
      </Card>
    </div>
  );
}
