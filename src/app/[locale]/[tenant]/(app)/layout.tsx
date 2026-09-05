import { SessionProvider } from "next-auth/react";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { redirectInTenant, tenantBase } from "@/lib/nav-server";
import { Sidebar, SIDEBAR_COOKIE } from "@/components/portal/sidebar";
import { SoloLectura } from "@/components/portal/solo-lectura";
import { Topbar } from "@/components/portal/topbar";
import { TenantBar } from "@/components/portal/tenant-bar";
import { Campana } from "@/components/portal/campana";
import { DENSIDAD_COOKIE, densidadGuardada } from "@/lib/densidad";
import { contarSinLeer, misAvisos } from "@/lib/notificaciones";
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
  /*
    EL CANDADO DE LA SUSCRIPCIÓN.

    Va aquí, antes de leer nada, porque es la puerta del portal entero: la
    prueba vencida o la cuenta suspendida no dejan entrar a ninguna pantalla, y
    no tiene sentido consultar tableros ni avisos de una empresa que no va a
    ver ninguno.

    `/suscripcion` vive FUERA de `(app)`, así que este desvío no la alcanza y no
    hay bucle. Y no es la única defensa: `tenantDb()` devuelve además una
    conexión de solo lectura mientras el acceso esté cerrado, porque un
    `redirect` en un layout no impide que la página se renderice en paralelo ni
    cubre una server action invocada a mano.

    Un operador de Astraion no pasa por aquí: su contexto se marca siempre al
    corriente, justamente para poder entrar a ver por qué la empresa no puede.
  */
  if (!ctx!.suscripcion.entra) {
    await redirectInTenant("/suscripcion", locale);
  }

  // Va junto a los tableros y no antes: son dos lecturas independientes y
  // encadenarlas sumaría sus tiempos en cada navegación del portal.
  // Las dos en paralelo: son independientes y encadenarlas sumaría sus tiempos
  // en cada navegación. Las dos están en caché por empresa, así que en una
  // navegación normal ninguna toca la base.
  const [marca, tableros, avisosCrudos, sinLeer] = await Promise.all([
    getTenantBrand(tenant),
    tablerosDelMenu(),
    // Los avisos NO están en caché ni pueden estarlo: son de cada persona y
    // cambian en cuanto alguien comenta. Van en el mismo `Promise.all` para
    // que su tiempo no se sume al de las otras dos.
    //
    // De visita se saltan: un operador de Astraion no es miembro y no tiene
    // avisos, así que preguntarlos sería una consulta que siempre devuelve nada.
    ctx!.impersonated ? Promise.resolve([]) : misAvisos(),
    ctx!.impersonated ? Promise.resolve(0) : contarSinLeer(),
  ]);

  /*
    La fecha se formatea AQUÍ y no en la campana.

    La campana es un componente de cliente, y una fecha formateada en el
    navegador sale distinta de la que renderizó el servidor —zona horaria y
    locale del visitante contra los del contenedor—, que es un desajuste de
    hidratación clásico y silencioso. Formateada en el servidor, las dos mitades
    dicen lo mismo.
  */
  const formato = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const avisos = avisosCrudos.map((a) => ({
    id: a.id,
    ticketId: a.ticketId,
    reference: a.reference,
    title: a.title,
    body: a.body,
    leido: a.readAt !== null,
    cuando: formato.format(a.createdAt),
  }));

  const brand = marca ?? {
    name: ctx!.name,
    brandName: null,
    logoUrl: null,
  };

  // El ancho de la barra se decide en el servidor. Si se leyera en el navegador
  // después de montar, cada carga completa pintaría la barra ancha y la
  // encogería un instante después — el salto se ve.
  const galletas = await cookies();
  const sidebarCollapsed = galletas.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        <Sidebar
          role={ctx!.role}
          permisos={ctx!.permisos}
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
            densidad={densidadGuardada(galletas.get(DENSIDAD_COOKIE)?.value)}
            /*
              La campana se monta aquí, en el layout, para que esté en TODA la
              aplicación: enterarse de algo no puede depender de en qué pantalla
              estabas. Es el mismo criterio que puso al asistente en un sitio
              fijo.

              De visita no se pinta: un operador de Astraion entra en solo
              lectura y no es miembro de la empresa, así que no tiene avisos
              propios que ver y la campana solo diría cero para siempre.
            */
            campana={
              ctx!.impersonated ? undefined : (
                <Campana avisos={avisos} sinLeer={sinLeer} />
              )
            }
          />
          <main className="print-main flex-1 bg-background p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
