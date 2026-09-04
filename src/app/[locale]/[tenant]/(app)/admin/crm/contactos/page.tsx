import { setRequestLocale } from "next-intl/server";
import { Plus, Users2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { getContacts } from "@/lib/data/crm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/nav";
import { puedeEn } from "@/lib/tenancy/context";

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const admin = await puedeEn("ventas", "administrar");
  const contacts = await getContacts(admin ? undefined : session!.user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contactos</h1>
          <p className="text-sm text-muted-foreground">
            {contacts.length} persona(s) registradas.
          </p>
        </div>
        <Button asChild variant="accent">
          <Link href="/admin/crm/contactos/nuevo">
            <Plus className="size-4" /> Nuevo contacto
          </Link>
        </Button>
      </div>

      {contacts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-14 text-center">
          <Users2 className="size-10 text-primary" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Aún no hay contactos registrados.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Puesto</th>
                  <th className="px-4 py-3 font-medium">Organización</th>
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <th className="px-4 py-3 font-medium">Negocios</th>
                  <th className="px-4 py-3 font-medium">Responsable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-secondary/40">
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {c.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.position ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.organization ? (
                        <Link
                          href={`/admin/crm/organizaciones/${c.organization.id}`}
                          className="text-primary hover:underline"
                        >
                          {c.organization.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="hover:text-primary">
                          {c.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.deals.length}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.owner?.name ?? c.owner?.email ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
