import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirectInTenant } from "@/lib/nav-server";
import { tenantDb, puedeEn } from "@/lib/tenancy/context";
import { crmOrganizations } from "@/lib/db/schema";
import { getTenantMember } from "@/lib/data/people";
import { ajustesGuardados } from "@/lib/permisos";
import { getOrgOptions } from "@/lib/data/crm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/nav";
import { EditUserForm, ResetPasswordForm } from "@/components/portal/edit-user-form";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!(await puedeEn("configuracion", "administrar"))) {
    await redirectInTenant("/admin/tickets", locale);
  }

  // Por membresía, no por id suelto: un uuid de otra empresa da 404 en vez de
  // abrir la ficha de alguien que no es de aquí.
  const user = await getTenantMember(id);
  if (!user) notFound();

  const db = await tenantDb();

  // Para poder vincular la cuenta con su ficha comercial del CRM.
  const [organizations, [linked]] = await Promise.all([
    getOrgOptions(),
    db
      .select({ id: crmOrganizations.id })
      .from(crmOrganizations)
      .where(eq(crmOrganizations.clientId, user.id))
      .limit(1),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editar cuenta</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          {user.role === "client" && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/equipos/${user.id}`}>Equipos</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/configuracion/usuarios">← Usuarios</Link>
          </Button>
        </div>
      </div>

      {/*
        Al dueño no se le edita el rol ni se le restablece la contraseña desde
        aquí. No es una limitación técnica: es quien puede facturar y ceder los
        datos de la empresa, así que un administrador que pudiera degradarlo —o
        entrar con su cuenta— se quedaría con la titularidad. Transferirla es
        otra operación, deliberada y con su propio rastro.
      */}
      {user.role === "owner" ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Esta es la cuenta del <strong className="text-foreground">dueño</strong>{" "}
          de la empresa. Su rol y su contraseña no se administran desde este
          listado.
        </Card>
      ) : (
        <>
          <EditUserForm
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              company: user.company,
              phone: user.phone,
              role: user.role,
              permisos: ajustesGuardados(user.permissions),
              active: user.memberActive,
            }}
            isSelf={user.id === session!.user.id}
            organizations={organizations}
            crmOrganizationId={linked?.id ?? ""}
          />

          <ResetPasswordForm userId={user.id} email={user.email} />
        </>
      )}
    </div>
  );
}
