import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { tenantBase } from "@/lib/nav-server";
import { Sidebar, SIDEBAR_COOKIE, type TableroItem } from "@/components/portal/sidebar";
import { Topbar } from "@/components/portal/topbar";
import { TenantBar } from "@/components/portal/tenant-bar";
import { dashboardStates } from "@/lib/ml/dashboards";

/**
 * Los tableros que la barra lateral puede llegar a enseñar.
 *
 * Se filtra AQUÍ lo que no tiene nada que enseñar —cero bloques encendidos y sin
 * publicar— y no en el menú: un tablero vacío no es una opción que alguien
 * quiera ver, y mandarlo al cliente para que lo descarte es mandar trabajo y
 * datos de más en cada navegación. Quién ve cuál sí se decide en el menú, que
 * es donde ya vive el mapa de rol a pantallas.
 *
 * Un fallo aquí NO tumba el portal. Es la misma garantía que el tablero se da a
 * sí mismo resolviendo bloque a bloque con `allSettled`, y aquí pesa más: esto
 * cuelga del layout, así que una consulta rota —una migración que todavía no
 * corrió en un despliegue, por ejemplo— dejaría sin portal a todo el mundo para
 * no poder pintar una sección del menú.
 */
async function tablerosDelMenu(): Promise<TableroItem[]> {
  try {
    return (await dashboardStates())
      .filter((s) => s.bloques > 0 || s.publishedAt)
      .map((s) => ({
        id: s.modulo.id,
        // El nombre puesto por alguien, si lo hay; si no, el del módulo. El de
        // nacimiento —«Dashboard de Compras»— sobra bajo un encabezado que ya
        // dice «Tableros».
        label: s.nombre ?? s.modulo.label,
        home: s.modulo.home,
        publicado: Boolean(s.publishedAt),
      }));
  } catch (e) {
    console.error("[layout] no se pudieron leer los tableros del menú", e);
    return [];
  }
}

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
  const isPlatform = Boolean(session!.user.platformRole);

  // La marca es de ESTA empresa. Se resuelve una vez aquí y baja a las dos
  // piezas de chrome que la muestran.
  //
  // Va junto a los tableros y no antes: son dos lecturas independientes y
  // encadenarlas sumaría sus tiempos en cada navegación del portal.
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
        />
        <div className="flex min-w-0 flex-1 flex-col">
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
