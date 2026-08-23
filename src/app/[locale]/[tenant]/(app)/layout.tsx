import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { tenantBase } from "@/lib/nav-server";
import { Sidebar, SIDEBAR_COOKIE } from "@/components/portal/sidebar";
import { SoloLectura } from "@/components/portal/solo-lectura";
import { Topbar } from "@/components/portal/topbar";
import { TenantBar } from "@/components/portal/tenant-bar";
import { tablerosDelMenu } from "@/lib/ml/dashboards";

export default async function TenantAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);
  // Dónde vive el inquilino en la URL depende del despliegue: subdominio o
  // primer segmento del path. `tenantBase` lo resuelve; armarlo a mano aquí
  // funcionaba en un modo y hacía rebotar al usuario en el otro.
  const base = await tenantBase(tenant, locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`${base}/acceso`);
  }

  const ctx = await getTenantContext();

  /**
   * La URL manda, y aquí se comprueba que el permiso la acompañe.
   *
   * `getTenantContext()` cae a la empresa propia del usuario cuando no tiene
   * derecho sobre la pedida. Sin esta verificación, abrir `/acme/tickets` sin
   * ser de ACME mostraría —bajo esa URL— los tickets de la empresa propia: no
   * es una fuga de datos ajenos, pero sí una pantalla que miente sobre de
   * quién es lo que enseña.
   */
  if (!ctx || ctx.slug !== tenant) {
    // Puede cruzar de host: el portal de su empresa es OTRO subdominio.
    const suya = ctx ? await tenantBase(ctx.slug, locale) : null;
    redirect(suya ? `${suya}/dashboard` : `${base}/acceso`);
  }

  // La franja de contexto solo le interesa a quien opera Astraion: un usuario
  // normal tiene una sola empresa y decirle en cuál está sería ruido.
  const isPlatform = session!.user.kind === "platform";

  // La marca es de ESTA empresa. Se resuelve una vez aquí y baja a las dos
  // piezas de chrome que la muestran.
  //
  // Va junto a los tableros y no antes: son dos lecturas independientes y
  // encadenarlas sumaría sus tiempos en cada navegación del portal.
  // Las dos en paralelo: son independientes y encadenarlas sumaría sus tiempos
  // en cada navegación. Las dos están en caché por empresa, así que en una
  // navegación normal ninguna toca la base.
  const [marca, tableros] = await Promise.all([
    getTenantBrand(tenant),
    tablerosDelMenu(),
  ]);

  const brand = marca ?? {
    name: ctx!.name,
    brandName: null,
    logoUrl: null,
  };

  // El ancho de la barra se decide en el servidor. Si se leyera en el navegador
  // después de montar, cada carga completa pintaría la barra ancha y la
  // encogería un instante después — el salto se ve.
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <Sidebar
          role={ctx!.role}
          brand={brand}
          defaultCollapsed={sidebarCollapsed}
          tableros={tableros}
          deVisita={ctx!.impersonated}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Corta las escrituras y las explica. Solo de visita: un miembro
              de la empresa escribe con normalidad. Ver `SoloLectura`. */}
          {ctx!.impersonated && <SoloLectura />}
          {isPlatform && (
            <TenantBar
              tenantName={ctx!.name}
              impersonated={ctx!.impersonated}
              locale={locale}
            />
          )}
          <Topbar
            name={session!.user.name}
            email={session!.user.email}
            brand={brand}
          />
          <main className="print-main flex-1 bg-background p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
