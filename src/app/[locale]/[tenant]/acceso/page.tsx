import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { tenantBase } from "@/lib/nav-server";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenancy/context";
import { getTenantBrand } from "@/lib/data/platform";
import { TenantMark } from "@/components/portal/tenant-mark";
import { LoginForm } from "@/components/portal/login-form";
import { PoweredByAstraion } from "@/components/portal/powered-by";

/**
 * Acceso a una empresa: `astraion.com/evoelution/acceso`.
 *
 * Es la frontera entre los dos mundos, y por eso lleva las dos marcas: arriba
 * la empresa —es SU portal, y quien entra viene por ella—, y al pie la
 * plataforma sobre la que corre. El sitio público de Evoelution no lleva ese
 * pie: ahí Astraion no pinta nada.
 */
export default async function AccesoPage({
  params,
}: {
  params: Promise<{ locale: string; tenant: string }>;
}) {
  const { locale, tenant } = await params;
  setRequestLocale(locale);

  /*
    CON SESIÓN ABIERTA SE PASA AL PORTAL — PERO SOLO SI HAY PORTAL AL QUE PASAR.

    ── EL BUCLE QUE ESTO ARREGLA ──────────────────────────────────────────

    Antes bastaba con que hubiera sesión para redirigir al panel, confiando en
    que el layout de `(app)` comprobara el derecho «y, si no, devolviera a la
    propia». El supuesto falla cuando la sesión no tiene NINGUNA empresa: no hay
    «propia» a la que devolver, así que el layout rebota aquí, aquí se ve que
    hay sesión y se vuelve a mandar al panel. Infinito.

    En el navegador sale como `ERR_TOO_MANY_REDIRECTS`, que no menciona ni la
    sesión ni las membresías. Y no es un caso raro: le pasa a cualquiera que
    tenga el portal abierto y corra `npm run sync:prod`, porque la copia de
    producción reemplaza la base y la sesión del navegador sobrevive apuntando a
    un usuario que ya no está.

    ── EL ARREGLO ES QUE LAS DOS PUERTAS PREGUNTEN LO MISMO ────────────────

    El layout exige «sesión Y contexto de inquilino»; esto exigía solo «sesión».
    Una condición más débil que la del sitio al que redirige es un bucle
    esperando a que alguien cumpla la primera y no la segunda. Ahora se resuelve
    aquí el mismo contexto que resolverá el layout, y con él hay tres salidas y
    ninguna vuelve sobre sus pasos:

      · derecho sobre ESTA empresa   → su panel
      · derecho sobre OTRA           → el panel de la suya, aunque sea otro host
      · ninguna empresa              → se enseña el formulario, que es la única
                                       acción que puede sacar a esa sesión del
                                       atolladero
  */
  const session = await auth();
  if (session?.user) {
    const ctx = await getTenantContext();
    if (ctx) {
      redirect(`${await tenantBase(ctx.slug, locale)}/dashboard`);
    }
    // Sin contexto se cae al formulario. Entrar de nuevo sustituye la cookie
    // vieja, así que la propia pantalla es la salida.
  }

  // El layout de `[tenant]` ya garantizó que existe; aquí se necesita su marca
  // para que el cliente entre por SU puerta y no por la de otro laboratorio.
  const brand = await getTenantBrand(tenant);

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-80 w-[720px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />

      <div className="relative w-full max-w-md">
        {brand && (
          <div className="mb-8 flex justify-center">
            <TenantMark brand={brand} />
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card/80 p-8 shadow-2xl shadow-primary/5 backdrop-blur">
          {brand?.logoUrl && (
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {brand.brandName ?? brand.name}
            </p>
          )}
          {/* Entrar por la puerta de una empresa lleva a esa empresa, aunque
              quien entre sea personal de Astraion. Desde ahí siempre se puede
              subir a la consola con «Volver a Astraion». */}
          <LoginForm destination="/dashboard" />
        </div>

        <div className="mt-8 flex justify-center">
          <PoweredByAstraion />
        </div>
      </div>
    </div>
  );
}
