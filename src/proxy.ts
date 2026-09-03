// Convención `proxy` de Next 16. Reemplaza a `middleware`, que quedó
// deprecada: mismo contrato (export default + config.matcher), solo cambia
// el nombre del archivo.
import { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import {
  esRutaDePlataforma,
  isApexHost,
  tenantFromHost,
  withTenantSegment,
  withoutTenantSegment,
} from "./lib/tenancy/host";

const handleI18n = createMiddleware(routing);

/** Debe coincidir con `ACTIVE_TENANT_COOKIE` de lib/tenancy/context. */
const TENANT_COOKIE = "evo_tenant";

/**
 * Segmentos de primer nivel que NO son un inquilino: `RUTAS_DE_PRIMER_NIVEL`.
 *
 * Vivía aquí como una lista propia, y `RESERVED_SLUGS` tenía la suya en
 * `db/platform.ts` con un comentario pidiendo mantenerlas en línea a mano. No
 * se mantuvieron —faltaba `consola` en las dos—, así que ahora las dos derivan
 * del mismo sitio. El porqué de cada entrada está allá.
 */

/** Extrae el inquilino del path, o null si ese primer segmento no lo es. */
function tenantFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const rest = routing.locales.includes(segments[0] as "es" | "en")
    ? segments.slice(1)
    : segments;

  const candidate = rest[0];
  if (!candidate || esRutaDePlataforma(candidate)) return null;
  // Mismo formato que exige `schemaNameFor`: si no lo cumple, no puede ser
  // un inquilino y no vale la pena consultarlo.
  return /^[a-z][a-z0-9_]{1,39}$/.test(candidate) ? candidate : null;
}

/**
 * Resuelve el inquilino de la petición y lo deja en una cookie.
 *
 * La URL es la autoridad; la cookie es solo el vehículo para que el contexto
 * llegue a donde no hay params de ruta —las ~110 funciones de datos y, sobre
 * todo, las server actions—. Como el proxy la reescribe desde la URL en cada
 * navegación, no puede quedar apuntando a una empresa distinta de la que dice
 * la barra de direcciones, que era el defecto de usarla como fuente de verdad.
 *
 * Dos formas de decir la misma cosa, y el HOST gana:
 *
 *   evoelution.astraion.com/tickets   ← modo subdominio (producción)
 *   astraion.com/evoelution/tickets   ← modo path (desarrollo, compatibilidad)
 *
 * El host gana porque es el más específico: si alguien llega a
 * `evoelution.astraion.com/acme/tickets`, lo que manda es de quién es el
 * subdominio, no lo que diga el path.
 */
export default function proxy(req: NextRequest) {
  const hostTenant = tenantFromHost(req.headers.get("host"));

  // En modo subdominio, Next tiene que ver el path CON el inquilino para que el
  // segmento `[tenant]` y sus layouts sigan resolviendo. Se reescribe la
  // petición antes de dársela a next-intl —y no después— porque su respuesta
  // ya viene con la reescritura interna de idioma resuelta, y encadenar dos
  // reescrituras sobre la misma respuesta es frágil.
  let request = req;
  if (hostTenant) {
    const url = req.nextUrl.clone();
    // La raíz del subdominio es el portal, no el sitio público. Sin esto,
    // `acme.astraion.com/` cae en el segmento `[tenant]` sin página propia
    // (404), y si la empresa se llama como una sección del sitio —el caso real
    // de `evoelution`— sirve la página de marketing bajo el dominio del
    // portal, que es peor que un 404 porque parece que funciona.
    if (url.pathname === "/" || routing.locales.includes(url.pathname.slice(1) as "es" | "en")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/dashboard`;
    }
    url.pathname = withTenantSegment(url.pathname, hostTenant, routing.locales);
    request = new NextRequest(url, req);
  }

  const res = handleI18n(request);

  // Que Next VEA la reescritura, siempre.
  //
  // Modificar el objeto de la petición no basta: next-intl solo emite
  // `x-middleware-rewrite` cuando el idioma le obliga a reescribir. Con el
  // idioma por omisión siempre reescribe (`/acceso` → `/es/acceso`) y arrastra
  // el inquilino de paso, así que el español funcionaba; con `/en/acceso` el
  // path ya era correcto para next-intl, devolvía `next()` sin cabecera, y Next
  // enrutaba la URL ORIGINAL —sin inquilino— dando 404. Un fallo que solo
  // aparecía en inglés, que es exactamente el que nadie prueba.
  if (hostTenant && !res.headers.get("x-middleware-rewrite") && !res.headers.get("location")) {
    const target = req.nextUrl.clone();
    target.pathname = request.nextUrl.pathname;
    res.headers.set("x-middleware-rewrite", target.toString());
  }

  // Y aquí se deshace lo anterior, pero solo para el NAVEGADOR.
  //
  // `localePrefix: "as-needed"` hace que next-intl redirija para normalizar el
  // idioma (`/es/tickets` → `/tickets`). Esa redirección se calcula sobre el
  // path reescrito, así que su `Location` lleva el inquilino dentro. Sin este
  // arreglo, la primera navegación con prefijo de idioma dejaría al usuario en
  // `evoelution.astraion.com/evoelution/tickets`: funciona, pero delata la
  // reescritura y ensucia una URL que el cliente va a compartir.
  if (hostTenant) {
    const location = res.headers.get("location");
    if (location) {
      try {
        const url = new URL(location, req.nextUrl.origin);
        url.pathname = withoutTenantSegment(
          url.pathname,
          hostTenant,
          routing.locales,
        );
        res.headers.set(
          "location",
          location.startsWith("/") ? `${url.pathname}${url.search}` : url.toString(),
        );
      } catch {
        // Un `Location` que no parsea no es nuestro: se deja intacto.
      }
    }
  }

  const slug = hostTenant ?? tenantFromPath(req.nextUrl.pathname);
  if (slug) {
    // Cookie de HOST, sin `domain` compartido. Es deliberado y es lo que hace
    // que dos pestañas abiertas en dos empresas distintas no se pisen: cada
    // subdominio lleva la suya, y el proxy la reescribe desde su propia URL.
    // Una cookie compartida entre subdominios devolvería exactamente el
    // problema que mover el inquilino a la URL vino a resolver.
    res.cookies.set(TENANT_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // De sesión: estar dentro de una empresa no debe sobrevivir semanas en
      // el navegador. Además ahora la URL lo dice, así que no hay nada que
      // "recordar" entre visitas.
      maxAge: undefined,
    });
  } else if (isApexHost(req.headers.get("host"))) {
    // El apex no es de nadie. Si queda una cookie de una visita anterior, la
    // consola de plataforma creería estar dentro de una empresa mientras la
    // barra de direcciones dice otra cosa — que es justo la discrepancia que
    // este proxy existe para impedir.
    res.cookies.delete(TENANT_COOKIE);
  }

  return res;
}

export const config = {
  // Aplica i18n a todo excepto API, estáticos y archivos con extensión.
  // Las fotos subidas (/uploads/*.jpg) entran por la regla de extensión; en
  // producción ni siquiera llegan aquí: las sirve nginx desde el volumen.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
