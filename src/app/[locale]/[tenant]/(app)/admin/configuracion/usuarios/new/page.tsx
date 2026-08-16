import { setRequestLocale } from "next-intl/server";
import { redirectInTenant } from "@/lib/nav-server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { CreateUserForm } from "@/components/portal/create-user-form";
import { currentRole } from "@/lib/tenancy/context";
import { isAdminRole } from "@/lib/roles";

export default async function NewUserPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Solo administradores dan de alta cuentas.
  if (!isAdminRole(await currentRole())) {
    await redirectInTenant("/admin/tickets", locale);
  }

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
          <Link href="/admin/configuracion/usuarios">← Volver</Link>
        </Button>
      </div>
      <Card className="p-6 sm:p-8">
        <CreateUserForm />
      </Card>
    </div>
  );
}
