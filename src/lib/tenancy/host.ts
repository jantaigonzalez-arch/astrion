/**
 * El inquilino en el SUBDOMINIO: `evoelution.astraion.com`.
 *
 * Sin "use client" ni "server-only" a propósito, igual que `tenant-path.ts`:
 * lo usan el proxy, los componentes de servidor y el navegador, y tienen que
 * dar exactamente el mismo resultado en los tres lados. Un desacuerdo aquí
 * significa enlaces que sacan al usuario de su empresa sin avisar.
 *
 * Por qué subdominio y no path:
 *
 *  · Comercialmente, `evoelution.astraion.com` se lee como el sistema DE la
 *    empresa. `astraion.com/evoelution` se lee como una carpeta dentro del
 *    sistema de otro. Es la misma información y no vale lo mismo.
 *
 *  · Técnicamente, elimina la ambigüedad del primer segmento. Con el inquilino
 *    en el path hay una lista de slugs reservados (`productos`, `servicios`…)
 *    que hay que mantener sincronizada en tres archivos, y el día que alguien
 *    registre una empresa llamada como una sección del sitio, su portal
 *    secuestra esa página.
 *
 * El modo path SIGUE FUNCIONANDO. No es nostalgia: en desarrollo no hay DNS
 * comodín, y si `ROOT_DOMAIN` no está configurado la aplicación se comporta
 * exactamente como antes. Son dos caminos hacia el mismo sitio, no una
 * migración a medias.
 */

/**
 * Dominio raíz del producto. `astraion.com`.
 *
 * Sin esto, no hay modo subdominio: es la señal de "esta instalación ya tiene
 * su dominio". En desarrollo se puede poner `localhost` y funciona igual,
 * porque los navegadores resuelven `*.localhost` al bucle local sin tocar DNS
 * ni editar /etc/hosts.
 *
 * SIN el prefijo `NEXT_PUBLIC_`, y es una decisión, no un olvido. Con él, Next
 * incrusta el valor en el bundle DURANTE EL BUILD, y el build de la imagen no
 * conoce el dominio de producción: quedaría congelado en `undefined` y el modo
 * subdominio se apagaría en silencio del lado del navegador mientras el
 * servidor cree que está activo. Ese desacuerdo es la peor forma de fallar aquí.
 *
 * El navegador no lo necesita: recibe el modo desde el layout del inquilino
 * (`TenantRoutingProvider`), que sí lo sabe porque corre en el servidor.
 */
export const ROOT_DOMAIN =
  process.env.ROOT_DOMAIN?.trim().toLowerCase() || null;

/**
 * Subdominios que nunca son una empresa.
 *
 * Es la misma idea que `NOT_A_TENANT` del proxy pero mucho más corta, y esa
 * brevedad es medio argumento a favor del subdominio: en el path compite con
 * cada sección del sitio público; aquí solo con la infraestructura.
 */
const RESERVED = new Set([
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "smtp",
  "static",
  "cdn",
  "assets",
  "status",
  // Sube el backend de cromatografía cuando viva bajo este dominio.
  "cromatografia",
]);

/** Formato de slug. El mismo que exige `schemaNameFor`. */
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;

/** Quita el puerto: `evoelution.localhost:3000` → `evoelution.localhost`. */
function bare(host: string | null | undefined): string | null {
  if (!host) return null;
  return host.trim().toLowerCase().split(":")[0] || null;
}

/**
 * El inquilino de este host, o `null` si el host no lo lleva.
 *
 * `null` cubre tres casos que quien llama trata igual: el apex, un subdominio
 * reservado, y un host que no pertenece al dominio raíz. En los tres la
 * respuesta correcta es "resolvé el inquilino de otra manera".
 */
export function tenantFromHost(host: string | null | undefined): string | null {
  const h = bare(host);
  if (!h || !ROOT_DOMAIN) return null;
  if (h === ROOT_DOMAIN) return null;
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null;

  const sub = h.slice(0, -(ROOT_DOMAIN.length + 1));
  // Solo un nivel. `a.b.astraion.com` no es el inquilino "a.b": es un host que
  // no esperábamos, y adivinar qué quiso decir es peor que no servirlo.
  if (sub.includes(".")) return null;
  if (RESERVED.has(sub) || !SLUG.test(sub)) return null;

  return sub;
}

/** ¿Este host es el dominio del producto, sin empresa? */
export function isApexHost(host: string | null | undefined): boolean {
  const h = bare(host);
  if (!h || !ROOT_DOMAIN) return false;
  return h === ROOT_DOMAIN || h === `www.${ROOT_DOMAIN}`;
}

/**
 * URL absoluta del portal de una empresa.
 *
 * Devuelve `null` cuando no hay dominio raíz, y ahí está el contrato: quien
 * llama debe caer al path (`/evoelution/dashboard`). Nunca inventa un dominio.
 */
export function tenantOrigin(
  slug: string,
  proto: "http" | "https" = "https",
  port?: string | null,
): string | null {
  if (!ROOT_DOMAIN) return null;
  return `${proto}://${slug}.${ROOT_DOMAIN}${port ? `:${port}` : ""}`;
}

/** URL absoluta del dominio del producto. */
export function apexOrigin(
  proto: "http" | "https" = "https",
  port?: string | null,
): string | null {
  if (!ROOT_DOMAIN) return null;
  return `${proto}://${ROOT_DOMAIN}${port ? `:${port}` : ""}`;
}

/**
 * El puerto del host de la petición, o null si es el estándar.
 *
 * Los saltos entre dominios tienen que conservarlo. En producción no hay
 * ninguno —nginx escucha en 443— pero en desarrollo la aplicación vive en un
 * puerto cualquiera, y un enlace a `http://astraion.test` sin él apunta al 80,
 * donde no escucha nadie. El resultado es un enlace que en local no lleva a
 * ningún sitio y en producción funciona: la peor clase de diferencia entre
 * entornos, porque no se descubre hasta que alguien la sufre.
 */
export function portOf(host: string | null | undefined): string | null {
  const port = (host ?? "").trim().split(":")[1];
  return port || null;
}

/**
 * Esquema para los saltos entre dominios.
 *
 * En desarrollo `*.localhost` se sirve por http y forzar https daría un salto a
 * un puerto donde no escucha nadie. En producción siempre https: nginx redirige
 * :80 a :443 igual, pero emitir ya la redirección en claro es un viaje de más y
 * una ventana para que alguien la intercepte.
 */
export function defaultProto(): "http" | "https" {
  return process.env.NODE_ENV === "production" ? "https" : "http";
}

/* ------------------------- Rutas que no son empresas ------------------------- */

/**
 * Los segmentos de PRIMER NIVEL que la aplicación sirve por su cuenta.
 *
 * ── POR QUÉ ESTÁN AQUÍ Y NO EN LOS DOS SITIOS QUE LOS USAN ────────────────
 *
 * Porque estaban en los dos y se separaron. `proxy.ts` tenía su `NOT_A_TENANT`
 * y `db/platform.ts` su `RESERVED_SLUGS`, con un comentario pidiendo
 * mantenerlas en línea a mano. No se mantuvieron: `consola` —la puerta de quien
 * opera Astraion— faltaba en las dos.
 *
 * Las consecuencias eran las dos que esas listas existen para evitar. En modo
 * path, visitar `/consola` hacía que el proxy escribiera `evo_tenant=consola`,
 * una empresa que no existe, pisando la que la persona tenía activa. Y nada
 * impedía dar de alta un inquilino llamado «consola», cuyo portal habría
 * secuestrado esa puerta.
 *
 * Aquí viven una vez. Este módulo ya lo importa el proxy —o sea que es
 * ligero y corre donde el proxy corre— y no arrastra nada de base de datos.
 *
 * ── LO QUE NO ESTÁ EN LA LISTA, Y POR QUÉ ─────────────────────────────────
 *
 * `evoelution` es una ruta de primer nivel del sitio público Y el slug de la
 * primera empresa que usa el sistema. No puede entrar: con el inquilino en el
 * path, meterla aquí rompería `/evoelution/tickets` para ese cliente. Que la
 * página de marketing y el portal compartan segmento se resuelve en Next, que
 * prefiere la ruta estática sobre `[tenant]`; el precio es que visitar la
 * página de marketing deja la cookie de esa empresa, que es inofensivo porque
 * es la suya.
 *
 * Solo el PRIMER nivel importa: con el inquilino en el path, lo que compite es
 * el primer segmento. `/admin/...` vive dentro de una empresa y nunca compite.
 */
export const RUTAS_DE_PRIMER_NIVEL = [
  // La consola de Astraion y las dos puertas de entrada.
  "consola",
  "platform",
  "entrar",
  "login",
  // El sitio público.
  "contacto",
  "nosotros",
  "productos",
  "servicios",
  "marcas",
  "evo-ai",
] as const;

/**
 * ¿Este primer segmento del path es una sección de la plataforma y no una
 * empresa?
 *
 * Solo aplica al MODO PATH. En subdominio no hay ambigüedad:
 * `productos.astraion.com` y `astraion.com/productos` son direcciones
 * distintas y no compiten.
 */
export function esRutaDePlataforma(segmento: string): boolean {
  return (RUTAS_DE_PRIMER_NIVEL as readonly string[]).includes(segmento);
}

/* ------------------------- Reescritura del path ------------------------- */

/**
 * Mete el inquilino en el path, respetando el prefijo de idioma.
 *
 * Es el corazón del modo subdominio: el navegador ve `/tickets` y Next recibe
 * `/evoelution/tickets`, así que TODA la estructura de rutas —el segmento
 * `[tenant]`, sus layouts, sus `params`— sigue funcionando sin tocar un solo
 * archivo de `app/`. La alternativa era duplicar el árbol de rutas fuera de
 * `[tenant]`, que son ~40 páginas mantenidas por partida doble.
 *
 * `locales` se pasa como argumento y no se importa de `i18n/routing` para que
 * este módulo no arrastre dependencias al navegador.
 */
export function withTenantSegment(
  pathname: string,
  tenant: string,
  locales: readonly string[],
): string {
  const segments = pathname.split("/").filter(Boolean);
  const hasLocale = locales.includes(segments[0]);

  // Ya lo lleva: puede pasar si algo reenvía una URL interna. Insertarlo dos
  // veces daría `/evoelution/evoelution/tickets`, un 404 difícil de leer.
  if (segments[hasLocale ? 1 : 0] === tenant) return pathname;

  const head = hasLocale ? [segments[0]] : [];
  const tail = hasLocale ? segments.slice(1) : segments;
  return `/${[...head, tenant, ...tail].join("/")}`;
}

/** La operación inversa, para que el inquilino no se escape a la barra. */
export function withoutTenantSegment(
  pathname: string,
  tenant: string,
  locales: readonly string[],
): string {
  const segments = pathname.split("/").filter(Boolean);
  const hasLocale = locales.includes(segments[0]);
  const at = hasLocale ? 1 : 0;
  if (segments[at] !== tenant) return pathname;

  segments.splice(at, 1);
  return `/${segments.join("/")}`;
}
