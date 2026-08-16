"use client";

import { createContext, forwardRef, useContext, useMemo } from "react";
import {
  Link as IntlLink,
  usePathname as useIntlPathname,
  useRouter as useIntlRouter,
} from "@/i18n/navigation";
import { tenantHref } from "@/lib/tenant-path";

/**
 * Navegación DENTRO de una empresa.
 *
 * Con el inquilino en la URL (`/evoelution/tickets`), cada enlace del portal
 * tendría que llevar el prefijo. Escribirlo a mano en las ~50 rutas literales
 * repartidas por las páginas sería garantía de que alguna se olvide, y una
 * olvidada no falla de forma visible: te saca de la empresa sin avisar. Así
 * que el prefijo se pone en un solo sitio y las páginas siguen escribiendo
 * `/tickets/5` como siempre.
 *
 * El inquilino se lee del path y no de un contexto de React a propósito: es el
 * mismo dato que ve el servidor, así no pueden discrepar.
 */

/**
 * Dónde vive el inquilino en esta instalación.
 *
 * El navegador no puede deducirlo del path, y ahí está el problema que resuelve
 * este contexto: en modo subdominio la barra dice `/tickets`, así que leer "el
 * primer segmento" devolvería `tickets` como si fuera una empresa. El servidor
 * sí lo sabe —mira el `Host`— y lo baja por aquí.
 *
 * El valor por defecto es `"path"` a propósito. Fuera del portal —el sitio
 * público, la consola— no hay proveedor, y ahí el comportamiento correcto es
 * exactamente el de antes.
 */
export type TenantRouting = {
  mode: "host" | "path";
  /**
   * Origen del apex, solo en modo subdominio.
   *
   * Viaja junto al modo porque los dos responden a la misma pregunta desde
   * lados opuestos: el modo dice si hay que ESCRIBIR la empresa en el path, y
   * el apex, a dónde van las rutas que NO son de ninguna empresa. Separarlos
   * fue el error que dejó `/contacto` y `/platform` en 404 desde el portal.
   */
  apex: string | null;
};

const DEFAULT: TenantRouting = { mode: "path", apex: null };

const RoutingCtx = createContext<TenantRouting>(DEFAULT);

export function TenantRoutingProvider({
  mode,
  apex,
  children,
}: {
  mode: TenantRouting["mode"];
  apex: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ mode, apex }), [mode, apex]);
  return <RoutingCtx.Provider value={value}>{children}</RoutingCtx.Provider>;
}

/** El contexto de enlaces: qué prefijar y a dónde mandar lo que es del apex. */
export function useLinkContext(): TenantRouting {
  return useContext(RoutingCtx);
}

/**
 * El inquilino que hay que ESCRIBIR en las URLs, o `null` si no hace falta.
 *
 * No es "en qué empresa estoy" —eso lo sabe el servidor y no cambia—, es "¿este
 * enlace necesita el prefijo?". En modo subdominio la respuesta es siempre no,
 * porque el host ya lo lleva.
 */
export function useTenant(): string | null {
  const { mode } = useContext(RoutingCtx);
  // `usePathname` de next-intl ya viene sin el prefijo de idioma.
  const pathname = useIntlPathname();
  if (mode === "host") return null;
  return pathname.split("/").filter(Boolean)[0] ?? null;
}

type IntlLinkProps = React.ComponentProps<typeof IntlLink>;

/** `<Link href="/tickets">` → `/evoelution/tickets`. */
export const Link = forwardRef<HTMLAnchorElement, IntlLinkProps>(
  function TenantLink({ href, ...rest }, ref) {
    const tenant = useTenant();
    const { apex } = useLinkContext();
    const resolved =
      typeof href === "string" ? tenantHref(href, { tenant, apex }) : href;
    return (
      <IntlLink ref={ref} href={resolved as IntlLinkProps["href"]} {...rest} />
    );
  },
);

/** `router.push("/tickets")` → `/evoelution/tickets`. */
export function useRouter() {
  const router = useIntlRouter();
  const tenant = useTenant();
  const { apex } = useLinkContext();

  // Un enlace al apex cruza de host, y el router de next-intl solo sabe navegar
  // dentro de la aplicación: se delega en el navegador.
  const go = (href: string, how: "push" | "replace") => {
    const to = tenantHref(href, { tenant, apex });
    if (to.startsWith("http")) {
      window.location.assign(to);
      return;
    }
    if (how === "push") router.push(to);
    else router.replace(to);
  };

  return {
    ...router,
    push: (href: string) => go(href, "push"),
    replace: (href: string) => go(href, "replace"),
  };
}

/**
 * El path DENTRO de la empresa: `/evoelution/admin/crm` → `/admin/crm`.
 *
 * Simétrico a `Link`: si las páginas escriben `/admin/crm` para navegar, lo
 * que reciben al preguntar "¿dónde estoy?" tiene que estar en las mismas
 * coordenadas. Sin esto, el resaltado del menú y las pestañas del CRM
 * comparan `/evoelution/admin/crm` contra `/admin/crm` y nunca aciertan.
 */
export function usePathname(): string {
  const pathname = useIntlPathname();
  const tenant = useTenant();
  if (!tenant) return pathname;
  const rest = pathname.slice(`/${tenant}`.length);
  return rest === "" ? "/" : rest;
}
