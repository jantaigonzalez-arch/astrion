import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getTenants } from "@/lib/data/platform";
import { getTenantContext } from "@/lib/tenancy/context";
import { NewTenantForm } from "@/components/portal/new-tenant-form";
import { TenantCard } from "@/components/console/tenant-card";
import { isPlatformSuperadmin } from "@/lib/platform-session";

/**
 * Todas las empresas de la plataforma.
 *
 * Es lo que antes ocupaba el centro de la consola entera. Ahora es una sección,
 * y aquí sí van las cifras de cada una: quien entra a esta pantalla viene a
 * comparar o a buscar una concreta, no a orientarse — para eso está el inicio.
 */
export default async function EmpresasPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // El layout ya exigió sesión de plataforma, pero en Next el layout y la
  // página se renderizan EN PARALELO: su `redirect()` no impide que esto corra.
  // Sin esta línea, cada visita sin sesión registraba un TypeError en el
  // servidor mientras el usuario veía la redirección correcta.
  const session = await auth();
  if (!session?.user) return null;
  // De la BASE y no del token: ver `platform-session.ts`.
  const isSuper = await isPlatformSuperadmin();

  const [rows, active] = await Promise.all([getTenants(), getTenantContext()]);

  const fmt = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX");
  const totals = rows.reduce(
    (a, r) => ({
      tickets: a.tickets + (r.stats?.tickets ?? 0),
      orgs: a.orgs + (r.stats?.organizations ?? 0),
      members: a.members + r.members,
    }),
    { tickets: 0, orgs: 0, members: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} empresa(s) · {fmt.format(totals.tickets)} ticket(s) ·{" "}
          {fmt.format(totals.orgs)} cliente(s) · {totals.members} usuario(s)
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((t) => (
          <TenantCard
            key={t.id}
            t={t}
            locale={locale}
            aqui={active?.slug === t.slug}
            isSuper={isSuper}
          />
        ))}
      </div>

      {isSuper && <NewTenantForm />}
    </div>
  );
}
