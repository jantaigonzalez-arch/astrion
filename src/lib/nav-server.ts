import "server-only";
import { cookies, headers } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";
import { ACTIVE_TENANT_COOKIE } from "@/lib/tenancy/context";
import {
  apexOrigin,
  defaultProto,
  portOf,
  tenantFromHost,
  tenantOrigin,
} from "@/lib/tenancy/host";
import { tenantHref } from "@/lib/tenant-path";

/**
 * Redirect dentro de la empresa activa, para guardas de servidor.
 *
 * El inquilino sale de la cookie que el proxy escribe A PARTIR DE LA URL en
 * cada petición —incluida ésta—, así que decir "cookie" aquí es decir "lo que
 * dice la barra de direcciones". Se lee de ahí y no de los params porque estas
 * guardas viven en trece archivos distintos que solo desestructuraban
 * `locale`, y hacerles cambiar la firma para pasar el inquilino a mano sería
 * trece oportunidades de equivocarse sin ganar nada.
 *
 * En modo subdominio NO se prefija: el host ya dice de quién es el portal, y
 * añadir el segmento mandaría al usuario a `evoelution.astraion.com/evoelution/
 * dashboard`. La comprobación se hace sobre el host de ESTA petición y no sobre
 * la configuración global, porque durante una migración conviven los dos: el
 * apex sigue sirviendo paths mientras el DNS comodín termina de propagar.
 */
export async function redirectInTenant(href: string, locale: string): Promise<never> {
  const host = (await headers()).get("host");
  const onSubdomain = tenantFromHost(host) !== null;
  const slug = onSubdomain
    ? null
    : ((await cookies()).get(ACTIVE_TENANT_COOKIE)?.value ?? null);
  const apex = onSubdomain ? apexOrigin(defaultProto(), portOf(host)) : null;

  const to = tenantHref(href, { tenant: slug, apex });
  // Un destino absoluto ya lleva su propio host: meterle `/en` delante lo
  // rompería. El idioma solo prefija rutas relativas.
  if (to.startsWith("http")) nextRedirect(to);
  nextRedirect(locale === "en" ? `/en${to}` : to);
}

/**
 * Idioma de la petición en curso, deducido de quién nos trajo aquí.
 *
 * Las server actions no reciben `params`, así que no tienen el `locale` que sí
 * tiene cualquier página. Se saca del `Referer` —la pantalla desde la que se
 * envió el formulario— porque con `localePrefix: "as-needed"` el prefijo solo
 * aparece en inglés: si el path del referente empieza por `/en`, el usuario
 * está en inglés; en cualquier otro caso, en español.
 *
 * Sin `Referer` (peticiones directas, algunos clientes) cae al idioma por
 * omisión. Equivocarse aquí manda a alguien a la versión en español de la
 * misma pantalla, que es un inconveniente; no tener esto manda a un 404, que
 * es lo que pasaba.
 */
export async function localeFromRequest(): Promise<string> {
  const referer = (await headers()).get("referer");
  if (!referer) return "es";
  try {
    const { pathname } = new URL(referer);
    return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "es";
  } catch {
    return "es";
  }
}

/**
 * Redirect al terminar una server action, dentro de la empresa activa.
 *
 * Es `redirectInTenant` sin tener que pasarle el idioma, y existe porque las
 * acciones no lo tienen a mano. Lo que arregla: cuatro acciones —convertir un
 * lead, borrar un negocio, borrar una organización, borrar un contrato—
 * llamaban a `redirect("/admin/crm")` a secas. Con el inquilino en el path eso
 * apunta a una empresa llamada «admin», así que el usuario terminaba en un 404
 * después de una operación que SÍ se había ejecutado: lo peor de los dos
 * mundos, porque parece que falló y en realidad ya se hizo.
 */
export async function redirectAfterAction(href: string): Promise<never> {
  return redirectInTenant(href, await localeFromRequest());
}

/**
 * Prefijo para construir una URL DENTRO de una empresa, desde el servidor.
 *
 * Existe porque tres layouts se lo armaban a mano (`` `/${tenant}` ``) y esa
 * línea es correcta exactamente en un modo de despliegue. En subdominio manda
 * al usuario a `evoelution.astraion.com/evoelution/acceso`, que el proxy vuelve
 * a reescribir — un bucle que solo se ve probándolo, no leyéndolo.
 *
 * Devuelve tres formas distintas según el caso, y esa es toda la complejidad
 * que absorbe para que quien llama no la vea:
 *
 *   modo path                → `/evoelution`      (o `/en/evoelution`)
 *   subdominio, misma empresa → ``                (o `/en`)
 *   subdominio, OTRA empresa  → `https://acme.astraion.com` (o …/en)
 *
 * El tercer caso es el que justifica la función: mandar a alguien al portal de
 * otra empresa cruza de host, así que un path relativo no alcanza.
 */
export async function tenantBase(slug: string, locale: string): Promise<string> {
  const lang = locale === "en" ? "/en" : "";
  const host = (await headers()).get("host");
  const current = tenantFromHost(host);

  // Ya estamos en su portal: relativo y listo.
  if (current === slug) return lang;

  // Con dominio raíz configurado, el subdominio es la forma CANÓNICA, se mire
  // desde donde se mire. Antes esto miraba solo el host actual, así que desde
  // el apex —que es de donde sale `/entrar` tras iniciar sesión— devolvía
  // `/evoelution/dashboard` y dejaba al usuario en la URL vieja para siempre.
  const origin = tenantOrigin(slug, defaultProto(), portOf(host));
  if (origin) return `${origin}${lang}`;

  return `${lang}/${slug}`;
}
