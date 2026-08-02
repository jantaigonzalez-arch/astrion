import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { crmOrganizations } from "@/lib/db/schema";
import { users } from "@/lib/db/platform";
import { getOrgOptions } from "@/lib/data/crm";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  EditUserForm,
  ResetPasswordForm,
} from "@/components/portal/edit-user-form";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (session?.user.role !== "admin") {
    redirect({ href: "/admin/tickets", locale });
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) notFound();

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
              <Link href={`/admin/users/${user.id}/equipos`}>Equipos</Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/users">← Usuarios</Link>
          </Button>
        </div>
      </div>

      <EditUserForm
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          company: user.company,
          phone: user.phone,
          role: user.role,
          active: user.active,
        }}
        isSelf={user.id === session!.user.id}
        organizations={organizations}
        crmOrganizationId={linked?.id ?? ""}
      />

      <ResetPasswordForm userId={user.id} email={user.email} />
    </div>
  );
}
